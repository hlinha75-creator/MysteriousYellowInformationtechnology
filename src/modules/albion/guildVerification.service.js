const { AttachmentBuilder, ChannelType } = require('discord.js');
const ids = require('../../config/ids');

const STATUS = {
  exact: 'EXATO',
  similar: 'PARECIDO',
  missing: 'NAO_ENCONTRADO',
  issue: 'PROBLEMA'
};

const PROTECTED_ROLE_NAMES = ['staff', 'adm', 'caller', 'recruiter'];
const PROTECTED_PREFIXES = ['!', '.'];
const MIN_SIMILARITY = 0.72;
const AMBIGUOUS_DELTA = 0.06;

function db() {
  return require('../../database/connection').getDatabase();
}

function discordName(member) {
  return String(member?.nickname || member?.displayName || member?.user?.username || '').trim();
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[!.]+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function hasProtectedPrefix(name) {
  return PROTECTED_PREFIXES.some((prefix) => String(name || '').startsWith(prefix));
}

function hasProtectedRole(member) {
  if (member?.guild?.ownerId === member?.id) return true;
  return PROTECTED_ROLE_NAMES.some((roleName) => member?.roles?.cache?.has(ids.roles[roleName]));
}

function canRename(member, currentName, targetName) {
  if (!targetName || currentName === targetName) return false;
  if (hasProtectedPrefix(currentName)) return false;
  if (hasProtectedRole(member)) return false;
  if (!member?.manageable) return false;
  return true;
}

function parseDelimitedRows(text) {
  const delimiter = String(text || '').split(/\r?\n/)[0]?.includes('\t') ? '\t' : ',';
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function parseGuildExport(text) {
  const rows = parseDelimitedRows(String(text || '').replace(/^\uFEFF/, ''));
  const [headers, ...data] = rows;
  if (!headers?.length) throw new Error('Arquivo vazio.');

  const cleanHeaders = headers.map((header) => header.trim());
  const nameIndex = cleanHeaders.findIndex((header) => normalizedName(header) === 'charactername');
  if (nameIndex === -1) {
    throw new Error('Nao encontrei a coluna "Character Name" no arquivo.');
  }

  const names = [];
  const seen = new Set();
  const duplicates = [];

  for (const row of data) {
    const name = String(row[nameIndex] || '').trim();
    if (!name) continue;
    const key = normalizedName(name);
    if (seen.has(key)) {
      duplicates.push(name);
      continue;
    }
    seen.add(key);
    names.push(name);
  }

  if (names.length === 0) throw new Error('Nao encontrei nenhum personagem no arquivo.');
  return { names, duplicates };
}

function levenshtein(left, right) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarity(left, right) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - (levenshtein(a, b) / max);
}

function rankedMatches(name, sourceNames) {
  return sourceNames
    .map((sourceName) => ({ sourceName, score: similarity(name, sourceName) }))
    .sort((left, right) => right.score - left.score);
}

function analyzeMember(member, sourceNames) {
  const currentName = discordName(member);
  if (!currentName) {
    return {
      type: 'issue',
      row: baseRow(member, currentName, '', STATUS.issue, 0, 'Membro sem nome para comparar.', false)
    };
  }

  const ranked = rankedMatches(currentName, sourceNames);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MIN_SIMILARITY) {
    return {
      type: 'missing',
      row: baseRow(member, currentName, best?.sourceName || '', STATUS.missing, best?.score || 0, 'Nenhum nome parecido o suficiente no arquivo.', false)
    };
  }

  if (second && best.score < 1 && best.score - second.score <= AMBIGUOUS_DELTA) {
    return {
      type: 'issue',
      row: baseRow(member, currentName, best.sourceName, STATUS.issue, best.score, `Ambiguo: tambem parece com ${second.sourceName}.`, false)
    };
  }

  const exact = normalizedName(currentName) === normalizedName(best.sourceName);
  const renameAllowed = canRename(member, currentName, best.sourceName);
  let reason = exact ? 'Nome encontrado.' : 'Nome parecido encontrado.';
  if (currentName !== best.sourceName && hasProtectedPrefix(currentName)) reason = 'Ignorado para renomear: comeca com ! ou .';
  if (currentName !== best.sourceName && hasProtectedRole(member)) reason = 'Ignorado para renomear: cargo protegido.';
  if (currentName !== best.sourceName && !member.manageable) reason = 'Nao consigo renomear: cargo acima do bot ou permissao insuficiente.';

  return {
    type: exact || best.score >= MIN_SIMILARITY ? 'match' : 'missing',
    row: baseRow(member, currentName, best.sourceName, exact ? STATUS.exact : STATUS.similar, best.score, reason, renameAllowed)
  };
}

function baseRow(member, currentName, albionName, status, score, reason, canRenameValue) {
  return {
    discord_id: member.id,
    discord_tag: member.user?.tag || member.user?.username || member.id,
    discord_name: currentName,
    albion_name: albionName,
    status,
    score: Number(score || 0).toFixed(3),
    pode_renomear: canRenameValue ? 'sim' : 'nao',
    motivo: reason
  };
}

async function analyzeGuildFromText(guild, text, actorId) {
  const { names, duplicates } = parseGuildExport(text);
  const members = await fetchGuildMembersWithRetry(guild);
  const users = members.filter((member) => !member.user.bot);
  const matches = [];
  const missing = [];
  const issues = duplicates.map((name) => ({
    discord_id: '',
    discord_tag: '',
    discord_name: '',
    albion_name: name,
    status: STATUS.issue,
    score: '',
    pode_renomear: 'nao',
    motivo: 'Nome duplicado no arquivo do jogo.'
  }));

  for (const member of users.values()) {
    const result = analyzeMember(member, names);
    if (result.type === 'match') matches.push(result.row);
    else if (result.type === 'missing') missing.push(result.row);
    else issues.push(result.row);
  }

  const id = saveVerification({
    guildId: guild.id,
    actorId,
    sourceNames: names,
    matches,
    missing,
    issues
  });

  return { id, sourceNames: names, matches, missing, issues };
}

function saveVerification({ guildId, actorId, sourceNames, matches, missing, issues }) {
  const result = db()
    .prepare(`
      INSERT INTO guild_verifications (
        guild_id, created_by, source_names_json, matches_json, missing_json, issues_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      guildId,
      actorId,
      JSON.stringify(sourceNames),
      JSON.stringify(matches),
      JSON.stringify(missing),
      JSON.stringify(issues)
    );
  return result.lastInsertRowid;
}

function getVerification(id, guildId) {
  const row = db()
    .prepare('SELECT * FROM guild_verifications WHERE id = ? AND guild_id = ?')
    .get(id, guildId);
  if (!row) return null;
  return {
    ...row,
    sourceNames: JSON.parse(row.source_names_json),
    matches: JSON.parse(row.matches_json),
    missing: JSON.parse(row.missing_json),
    issues: JSON.parse(row.issues_json)
  };
}

function getLatestVerification(guildId) {
  const row = db()
    .prepare('SELECT * FROM guild_verifications WHERE guild_id = ? ORDER BY id DESC LIMIT 1')
    .get(guildId);
  if (!row) return null;
  return {
    ...row,
    sourceNames: JSON.parse(row.source_names_json),
    matches: JSON.parse(row.matches_json),
    missing: JSON.parse(row.missing_json),
    issues: JSON.parse(row.issues_json)
  };
}

function summarizeAnalysis(result) {
  const renameCount = result.matches.filter((row) => row.pode_renomear === 'sim').length;
  return [
    `Verificacao #${result.id}`,
    `Nomes no arquivo: ${result.sourceNames.length}`,
    `Encontrados/parecidos: ${result.matches.length}`,
    `Podem renomear depois: ${renameCount}`,
    `Nao encontrados: ${result.missing.length}`,
    `Problemas diversos: ${result.issues.length}`,
    '',
    `Para aplicar depois: /aplicar_verificacao_guild codigo:${result.id} acao:renomear_parecidos`,
    `Para perguntar aos nao encontrados: /aplicar_verificacao_guild codigo:${result.id} acao:perguntar_nao_encontrados`
  ].join('\n');
}

function importantLines(result, limit = 12) {
  const rows = [...result.matches.filter((row) => row.pode_renomear === 'sim'), ...result.missing, ...result.issues]
    .slice(0, limit)
    .map((row) => `${row.discord_name || row.albion_name} -> ${row.albion_name || '-'} | ${row.status} | ${row.motivo}`);
  return rows.length ? rows.join('\n') : 'Nada pendente.';
}

function csvAttachment(rows, name) {
  const columns = ['discord_id', 'discord_tag', 'discord_name', 'albion_name', 'status', 'score', 'pode_renomear', 'motivo'];
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column] || ''))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name });
}

function analysisAttachments(result) {
  return [
    csvAttachment(result.matches, `verificacao_${result.id}_encontrados.csv`),
    csvAttachment(result.missing, `verificacao_${result.id}_nao_encontrados.csv`),
    csvAttachment(result.issues, `verificacao_${result.id}_problemas.csv`)
  ];
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function applySimilarRenames(guild, verificationId, actorId) {
  const verification = getVerification(verificationId, guild.id);
  if (!verification) throw new Error('Verificacao nao encontrada para este servidor.');

  const rows = verification.matches.filter((row) => row.pode_renomear === 'sim');
  const results = [];
  for (const row of rows) {
    const member = await guild.members.fetch(row.discord_id).catch(() => null);
    if (!member) {
      results.push({ ...row, resultado: 'falhou', detalhe: 'Membro nao encontrado no Discord.' });
      continue;
    }
    const currentName = discordName(member);
    if (!canRename(member, currentName, row.albion_name)) {
      results.push({ ...row, resultado: 'ignorado', detalhe: 'Nao pode mais ser renomeado.' });
      continue;
    }
    try {
      await member.setNickname(row.albion_name.slice(0, 32), `Verificacao de guild #${verificationId} por ${actorId}`);
      results.push({ ...row, resultado: 'renomeado', detalhe: `${currentName} -> ${row.albion_name}` });
    } catch (error) {
      results.push({ ...row, resultado: 'falhou', detalhe: error.message });
    }
  }

  db()
    .prepare('UPDATE guild_verifications SET status = ?, applied_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('renamed', verificationId);
  return results;
}

async function askMissingMembers(guild, verificationId) {
  const verification = getVerification(verificationId, guild.id);
  if (!verification) throw new Error('Verificacao nao encontrada para este servidor.');

  const results = [];
  for (const row of verification.missing) {
    const member = await guild.members.fetch(row.discord_id).catch(() => null);
    if (!member) {
      results.push({ ...row, resultado: 'falhou', detalhe: 'Membro nao encontrado no Discord.' });
      continue;
    }
    await savePendingReply({
      discordId: member.id,
      guildId: guild.id,
      verificationId,
      sourceNames: verification.sourceNames
    });
    try {
      await member.send([
        'Mensagem automatica do bot da guild NoTag.',
        '',
        'Nao consegui confirmar seu nick do Albion pela lista atual da guild.',
        'Responda esta DM apenas com seu nick exatamente igual ao do jogo.',
        '',
        'Exemplo: NomeDoPersonagem'
      ].join('\n'));
      results.push({ ...row, resultado: 'dm_enviada', detalhe: 'Aguardando resposta do membro.' });
    } catch {
      results.push({ ...row, resultado: 'falhou', detalhe: 'Nao consegui enviar DM.' });
    }
  }
  return results;
}

function savePendingReply({ discordId, guildId, verificationId, sourceNames }) {
  db()
    .prepare(`
      INSERT INTO guild_verification_pending_replies (
        discord_id, guild_id, verification_id, source_names_json, status
      )
      VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(discord_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        verification_id = excluded.verification_id,
        source_names_json = excluded.source_names_json,
        created_at = CURRENT_TIMESTAMP,
        answered_at = NULL,
        status = 'pending'
    `)
    .run(discordId, guildId, verificationId, JSON.stringify(sourceNames));
}

async function handleDirectNickReply(message) {
  if (message.author?.bot || message.channel?.type !== ChannelType.DM) return false;
  const pending = db()
    .prepare("SELECT * FROM guild_verification_pending_replies WHERE discord_id = ? AND status = 'pending'")
    .get(message.author.id);
  if (!pending) return false;

  const nick = String(message.content || '').trim();
  const sourceNames = JSON.parse(pending.source_names_json);
  const acceptedName = sourceNames.find((name) => normalizedName(name) === normalizedName(nick));
  if (!acceptedName) {
    await message.reply('Mensagem automatica: nao encontrei esse nick na lista atual da guild. Responda somente com o nick exatamente igual ao do jogo.');
    return true;
  }

  const guild = await message.client.guilds.fetch(pending.guild_id).catch(() => null);
  const member = guild ? await guild.members.fetch(message.author.id).catch(() => null) : null;
  if (!member) {
    await markPendingAnswered(message.author.id, 'failed');
    await message.reply('Mensagem automatica: nao consegui encontrar voce no servidor para renomear.');
    return true;
  }

  const currentName = discordName(member);
  if (!canRename(member, currentName, acceptedName)) {
    await markPendingAnswered(message.author.id, 'blocked');
    await message.reply('Mensagem automatica: confirmei seu nick, mas nao tenho permissao para renomear automaticamente. A staff vai resolver manualmente.');
    return true;
  }

  try {
    await member.setNickname(acceptedName.slice(0, 32), `Nick confirmado por DM na verificacao #${pending.verification_id}`);
    await markPendingAnswered(message.author.id, 'renamed');
    await message.reply(`Mensagem automatica: obrigado! Renomeei seu apelido no Discord para ${acceptedName}.`);
  } catch (error) {
    await markPendingAnswered(message.author.id, 'failed');
    await message.reply('Mensagem automatica: confirmei seu nick, mas falhei ao renomear automaticamente. A staff vai resolver manualmente.');
  }
  return true;
}

function markPendingAnswered(discordId, status) {
  db()
    .prepare('UPDATE guild_verification_pending_replies SET status = ?, answered_at = CURRENT_TIMESTAMP WHERE discord_id = ?')
    .run(status, discordId);
}

function actionAttachment(rows, name) {
  const columns = ['discord_id', 'discord_tag', 'discord_name', 'albion_name', 'status', 'resultado', 'detalhe'];
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column] || ''))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name });
}

async function membersHtmlAttachment(guild) {
  const verification = getLatestVerification(guild.id);
  if (!verification) {
    throw new Error('Nenhuma verificacao encontrada. Rode /auditar_guilda arquivo:<anexo> primeiro.');
  }

  const members = await fetchGuildMembersWithRetry(guild);
  const rows = [];
  const relatedAlbionNames = new Set();

  for (const member of members.filter((item) => !item.user.bot).values()) {
    const result = analyzeMember(member, verification.sourceNames).row;
    if ([STATUS.exact, STATUS.similar].includes(result.status) && result.albion_name) {
      relatedAlbionNames.add(normalizedName(result.albion_name));
    }
    rows.push({
      kind: 'discord',
      discord_id: result.discord_id,
      discord_tag: result.discord_tag,
      discord_name: result.discord_name,
      albion_name: result.albion_name,
      status: result.status,
      score: result.score,
      motivo: result.motivo
    });
  }

  for (const name of verification.sourceNames) {
    if (relatedAlbionNames.has(normalizedName(name))) continue;
    rows.push({
      kind: 'albion',
      discord_id: '',
      discord_tag: '',
      discord_name: '',
      albion_name: name,
      status: 'ALBION_SEM_DISCORD',
      score: '',
      motivo: 'Jogador do arquivo Albion sem membro Discord relacionado.'
    });
  }

  return new AttachmentBuilder(Buffer.from(renderMembersHtml({ verification, rows }), 'utf8'), {
    name: `discord-albion-verificacao-${verification.id}.html`
  });
}

function renderMembersHtml({ verification, rows }) {
  const generatedAt = new Date().toISOString();
  const json = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Discord x Albion</title>
  <style>
    :root {
      --bg: #f5f7fa;
      --panel: #fff;
      --text: #1f2937;
      --muted: #667085;
      --line: #d9dee7;
      --ok: #0f766e;
      --warn: #b54708;
      --bad: #b42318;
      --info: #175cd3;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
    main { width: min(1200px, calc(100% - 32px)); margin: 24px auto 40px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { margin: 0; color: var(--muted); }
    .filters, .metrics, .table-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .filters { display: grid; grid-template-columns: minmax(240px, 1.5fr) repeat(3, minmax(160px, 1fr)); gap: 12px; padding: 14px; margin-bottom: 14px; }
    label { display: grid; gap: 6px; font-size: 12px; font-weight: 800; color: var(--muted); text-transform: uppercase; }
    input, select { min-height: 38px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; background: #fff; color: var(--text); }
    .metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; overflow: hidden; margin-bottom: 14px; }
    .metric { padding: 14px; background: #fff; }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 5px; font-size: 22px; }
    .table-wrap { overflow: auto; }
    table { width: 100%; min-width: 980px; border-collapse: collapse; background: #fff; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #f8fafc; color: var(--muted); font-size: 12px; text-transform: uppercase; z-index: 1; }
    .name { font-weight: 800; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .pill { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 800; background: #eef2f6; color: #344054; }
    .EXATO { color: var(--ok); }
    .PARECIDO, .PROBLEMA { color: var(--warn); }
    .NAO_ENCONTRADO, .ALBION_SEM_DISCORD { color: var(--bad); }
    .empty { padding: 28px; text-align: center; color: var(--muted); }
    @media (max-width: 860px) {
      main { width: min(100% - 20px, 1200px); margin-top: 14px; }
      header { display: block; }
      .filters { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Discord x Albion</h1>
        <p>Verificacao #${escapeHtml(verification.id)} gerada em ${escapeHtml(generatedAt)}.</p>
      </div>
      <p id="visibleCount">0 linhas</p>
    </header>

    <section class="filters">
      <label>Buscar
        <input id="search" type="search" placeholder="Discord, Albion, ID ou motivo">
      </label>
      <label>Filtro
        <select id="relation">
          <option value="">Todos</option>
          <option value="related">Relacionados</option>
          <option value="unrelated">Nao relacionados</option>
          <option value="discord_only">Discord sem Albion</option>
          <option value="albion_only">Albion sem Discord</option>
          <option value="issues">Problemas</option>
        </select>
      </label>
      <label>Status
        <select id="status">
          <option value="">Todos</option>
          <option value="EXATO">Exato</option>
          <option value="PARECIDO">Parecido</option>
          <option value="NAO_ENCONTRADO">Nao encontrado</option>
          <option value="PROBLEMA">Problema</option>
          <option value="ALBION_SEM_DISCORD">Albion sem Discord</option>
        </select>
      </label>
      <label>Ordenar
        <select id="sort">
          <option value="status">Status</option>
          <option value="discord">Discord A-Z</option>
          <option value="albion">Albion A-Z</option>
          <option value="score">Melhor similaridade</option>
        </select>
      </label>
    </section>

    <section class="metrics" id="metrics"></section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Discord</th>
            <th>Jogador Albion</th>
            <th>Status</th>
            <th>Similaridade</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
  <script>
    const allRows = ${json};
    const search = document.querySelector('#search');
    const relation = document.querySelector('#relation');
    const status = document.querySelector('#status');
    const sort = document.querySelector('#sort');
    const rowsEl = document.querySelector('#rows');
    const metricsEl = document.querySelector('#metrics');
    const visibleCount = document.querySelector('#visibleCount');

    for (const input of [search, relation, status, sort]) {
      input.addEventListener('input', render);
      input.addEventListener('change', render);
    }

    function normalize(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }

    function isRelated(row) {
      return row.status === 'EXATO' || row.status === 'PARECIDO';
    }

    function filteredRows() {
      const query = normalize(search.value);
      const relationValue = relation.value;
      const statusValue = status.value;
      return allRows
        .filter((row) => !query || normalize(row.discord_name + ' ' + row.discord_tag + ' ' + row.discord_id + ' ' + row.albion_name + ' ' + row.motivo).includes(query))
        .filter((row) => !statusValue || row.status === statusValue)
        .filter((row) => relationValue !== 'related' || isRelated(row))
        .filter((row) => relationValue !== 'unrelated' || !isRelated(row))
        .filter((row) => relationValue !== 'discord_only' || row.status === 'NAO_ENCONTRADO')
        .filter((row) => relationValue !== 'albion_only' || row.status === 'ALBION_SEM_DISCORD')
        .filter((row) => relationValue !== 'issues' || row.status === 'PROBLEMA')
        .sort(sorter(sort.value));
    }

    function sorter(mode) {
      if (mode === 'discord') return (a, b) => String(a.discord_name).localeCompare(String(b.discord_name));
      if (mode === 'albion') return (a, b) => String(a.albion_name).localeCompare(String(b.albion_name));
      if (mode === 'score') return (a, b) => Number(b.score || 0) - Number(a.score || 0);
      return (a, b) => statusWeight(a.status) - statusWeight(b.status) || String(a.discord_name || a.albion_name).localeCompare(String(b.discord_name || b.albion_name));
    }

    function statusWeight(value) {
      return { EXATO: 0, PARECIDO: 1, NAO_ENCONTRADO: 2, ALBION_SEM_DISCORD: 3, PROBLEMA: 4 }[value] ?? 9;
    }

    function render() {
      const rows = filteredRows();
      visibleCount.textContent = rows.length + ' linhas';
      metricsEl.innerHTML = [
        metric('Relacionados', allRows.filter(isRelated).length),
        metric('Discord sem Albion', allRows.filter((row) => row.status === 'NAO_ENCONTRADO').length),
        metric('Albion sem Discord', allRows.filter((row) => row.status === 'ALBION_SEM_DISCORD').length),
        metric('Problemas', allRows.filter((row) => row.status === 'PROBLEMA').length),
        metric('Visiveis', rows.length)
      ].join('');
      rowsEl.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="5" class="empty">Nenhum registro com esses filtros.</td></tr>';
    }

    function metric(label, value) {
      return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function rowHtml(row) {
      return '<tr>' +
        '<td><div class="name">' + escapeHtml(row.discord_name || '-') + '</div><div class="sub">' + escapeHtml(row.discord_tag || row.discord_id || '-') + '</div></td>' +
        '<td><div class="name">' + escapeHtml(row.albion_name || '-') + '</div></td>' +
        '<td><span class="pill ' + escapeHtml(row.status) + '">' + escapeHtml(row.status) + '</span></td>' +
        '<td>' + escapeHtml(row.score || '-') + '</td>' +
        '<td>' + escapeHtml(row.motivo || '-') + '</td>' +
      '</tr>';
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    render();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function fetchGuildMembersWithRetry(guild) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await guild.members.fetch();
    } catch (error) {
      const retryAfter = retryAfterMs(error);
      if (!retryAfter || attempt === 3) {
        throw new Error('Discord limitou a busca da lista de membros. Tente novamente em alguns segundos.');
      }
      await sleep(retryAfter + 1000);
    }
  }
  throw new Error('Discord limitou a busca da lista de membros. Tente novamente em alguns segundos.');
}

function retryAfterMs(error) {
  const direct = Number(error?.data?.retry_after ?? error?.retry_after ?? error?.retryAfter ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct * 1000);
  const match = String(error?.message || '').match(/retry after ([\d.]+) seconds/i);
  if (!match) return 0;
  return Math.ceil(Number(match[1]) * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  STATUS,
  actionAttachment,
  analysisAttachments,
  analyzeGuildFromText,
  applySimilarRenames,
  askMissingMembers,
  handleDirectNickReply,
  importantLines,
  membersHtmlAttachment,
  parseGuildExport,
  summarizeAnalysis
};
