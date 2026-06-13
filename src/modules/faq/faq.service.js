const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const { hasAnyRole, isOwner } = require('../../config/permissions');

const publicFaqRoles = ['guest', 'member', 'caller', 'staff', 'adm', 'recruiter', 'treasurer'];
const staffFaqRoles = ['staff', 'adm', 'caller', 'recruiter'];

const faqAnswers = [
  {
    audience: 'public',
    keys: ['saldo', 'consultar saldo', 'ver saldo'],
    title: 'Saldo',
    body: 'Use o painel do canal de consultar saldo. O membro pode consultar o saldo e solicitar saque por ali.'
  },
  {
    audience: 'public',
    keys: ['saque', 'sacar', 'retirar prata'],
    title: 'Saque',
    body: 'O membro solicita saque no painel de saldo. A staff aprova, paga ou recusa no financeiro. O saldo so sai quando clicar em Pagar saque.'
  },
  {
    audience: 'public',
    keys: ['evento', 'criar evento', 'participar'],
    title: 'Eventos',
    body: 'Eventos sao criados no painel de criar evento. Depois aparecem no canal de eventos para o pessoal participar, assistir, pausar e finalizar.'
  },
  {
    audience: 'public',
    keys: ['registro', 'registrar', 'nick'],
    title: 'Registro',
    body: 'O visitante registra o nick no canal de registro. Depois a staff ou recrutador aprova na solicitacao de registro.'
  },
  {
    audience: 'staff',
    keys: ['deposito', 'depositar', 'adicionar saldo'],
    title: 'Deposito rapido',
    body: 'No canal de deposito, staff pode criar deposito dividido igualmente entre os membros selecionados.'
  },
  {
    audience: 'staff',
    keys: ['csv', 'backup', 'importar', 'exportar'],
    title: 'CSV e backup',
    body: 'Use o painel de arquivar para exportar CSV. Importacao de saldos precisa de previa e confirmacao antes de sobrescrever.'
  }
];

const tutorials = {
  eventos: {
    label: 'Eventos',
    description: 'Criar, iniciar, pausar e finalizar eventos.',
    text: [
      '**Tutorial de Eventos**',
      '1. Va no canal de criar evento e clique em Criar Evento.',
      '2. Se estiver com pressa, pode enviar vazio: o bot usa FastContent, horario +10 minutos e vagas 1,1,1,17.',
      '3. Confira o evento no canal de eventos e veja se as vagas ficaram certas.',
      '4. Quando for comecar, clique em Iniciar. O bot cria a sala de voz e move quem ja estiver em voz.',
      '5. Durante o evento, membros podem clicar em Quero participar, Assistir ou Pausar participacao.',
      '6. Ao finalizar, preencha loot total, reparo, sacos de prata e taxa.',
      '7. Revise participantes no canal temporario, edite tempos se precisar e envie para o financeiro.'
    ].join('\n')
  },
  financeiro: {
    label: 'Financeiro',
    description: 'Aprovar evento, saque e conferir saldos.',
    text: [
      '**Tutorial Financeiro**',
      '1. Evento finalizado vai para o financeiro como pendente.',
      '2. Antes de aprovar, confira loot liquido, participantes, valores e evidencias.',
      '3. Clique em aprovar pagamento apenas quando estiver certo.',
      '4. Saque solicitado aparece no financeiro com Aprovar, Pagar e Recusar.',
      '5. O saldo do membro so muda quando clicar em Pagar saque.',
      '6. Toda entrada ou saida gera log e DM para o membro.'
    ].join('\n')
  },
  deposito: {
    label: 'Deposito',
    description: 'Deposito rapido dividido igual.',
    text: [
      '**Tutorial de Deposito Rapido**',
      '1. No canal de deposito, clique em Criar deposito.',
      '2. Preencha loot total, reparo, sacos de prata e taxa.',
      '3. Selecione os membros no User Select Menu.',
      '4. Confira o resumo antes de confirmar.',
      '5. Ao confirmar, o valor liquido e dividido igualmente entre todos.'
    ].join('\n')
  },
  registro: {
    label: 'Registro',
    description: 'Aprovar convidados e membros.',
    text: [
      '**Tutorial de Registro**',
      '1. O visitante usa o canal de registrar nick.',
      '2. O bot cria uma pendencia no canal de solicitacoes de registro.',
      '3. Staff, ADM ou Recrutador decide se mantem Convidado ou aprova como Membro.',
      '4. Quando vira Membro, o bot remove Convidado.'
    ].join('\n')
  },
  csv: {
    label: 'CSV e backups',
    description: 'Exportar, importar e proteger dados.',
    text: [
      '**Tutorial de CSV e Backups**',
      '1. Exporte saldos e logs pelo painel de arquivar.',
      '2. Antes de importar CSV, confira a previa do bot.',
      '3. A importacao de saldo sobrescreve por discord_id e/ou albion_name.',
      '4. Nunca coloque banco SQLite real, .env ou token no Git.',
      '5. Antes de mexer em financeiro importante, faca backup do banco.'
    ].join('\n')
  },
  treinamento: {
    label: 'Treinamento',
    description: 'Testes seguros para a equipe praticar.',
    text: [
      '**Sugestao de Treinamento**',
      '1. Crie um evento teste com poucas vagas.',
      '2. Peca para 3 pessoas entrarem, uma assistir e uma pausar.',
      '3. Finalize com loot pequeno ficticio e revise os tempos.',
      '4. Envie para financeiro e confira se a staff entende onde aprovar.',
      '5. Faca um saque teste pequeno e treine aprovar, pagar e recusar.',
      '6. Exporte CSV de saldos e veja se todos sabem onde baixar.'
    ].join('\n')
  }
};

function canUseTutorial(member) {
  return canUseStaffFaq(member);
}

function canUsePublicFaq(member) {
  return isOwner(member) || hasAnyRole(member, publicFaqRoles);
}

function canUseStaffFaq(member) {
  return isOwner(member) || hasAnyRole(member, staffFaqRoles);
}

function canUseAnswer(member, answer) {
  if (answer.audience === 'staff') return canUseStaffFaq(member);
  return canUsePublicFaq(member);
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return false;

  const content = normalize(message.content);
  if (!content.includes('bot') && !content.includes('botnotag') && !content.includes('notag')) return false;

  if (content.includes('bot tutorial') || content.includes('botnotag tutorial') || content.includes('tutorial bot')) {
    if (!canUseTutorial(message.member)) {
      await message.reply('Esse tutorial e para Staff, ADM, Caller e Recrutador.');
      return true;
    }

    if (content.includes('completo')) {
      return sendFullTutorial(message);
    }

    await message.reply({
      embeds: [tutorialMenuEmbed()],
      components: [tutorialMenu()]
    });
    return true;
  }

  const triggered = content.includes('botnotag') || content.includes('notag bot') || content.includes('oi bot');
  if (!triggered) return false;

  const answer = faqAnswers.find((item) => item.keys.some((key) => content.includes(normalize(key))));
  if (answer) {
    if (!canUseAnswer(message.member, answer)) {
      await message.reply('Esse assunto e para Staff, ADM, Caller e Recrutador.');
      return true;
    }

    await message.reply({ embeds: [simpleEmbed(answer.title, answer.body)] });
    return true;
  }

  const helpText = canUseStaffFaq(message.member)
    ? 'Posso responder sobre saldo, saque, evento, registro, deposito, CSV e backup. Staff pode escrever `bot tutorial` para abrir os tutoriais.'
    : 'Posso responder sobre saldo, saque, evento e registro.';

  await message.reply({
    embeds: [simpleEmbed(
      'Em que posso ajudar?',
      helpText
    )]
  });
  return true;
}

async function handleTutorialSelect(interaction) {
  if (!canUseTutorial(interaction.member)) {
    return interaction.reply({ content: 'Esse tutorial e para Staff, ADM, Caller e Recrutador.', flags: MessageFlags.Ephemeral });
  }

  const value = interaction.values[0];
  if (value === 'completo') {
    return interaction.reply({
      embeds: [simpleEmbed('Tutorial completo', Object.values(tutorials).map((tutorial) => tutorial.text).join('\n\n'))],
      flags: MessageFlags.Ephemeral
    });
  }

  const tutorial = tutorials[value];
  if (!tutorial) {
    return interaction.reply({ content: 'Tutorial nao encontrado.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    embeds: [simpleEmbed(tutorial.label, tutorial.text)],
    flags: MessageFlags.Ephemeral
  });
}

async function sendFullTutorial(message) {
  const text = Object.values(tutorials).map((tutorial) => tutorial.text).join('\n\n');
  try {
    await message.author.send({ embeds: [simpleEmbed('Tutorial completo do bot', text)] });
    await message.reply('Te mandei o tutorial completo no privado.');
  } catch {
    await message.reply({
      embeds: [simpleEmbed('Tutorial completo do bot', text)],
      components: [tutorialMenu()]
    });
  }
  return true;
}

function tutorialMenuEmbed() {
  return simpleEmbed(
    'Tutoriais do bot',
    'Escolha um tutorial no menu. Se quiser tudo de uma vez, escreva `bot tutorial completo`.'
  );
}

function tutorialMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('faq_tutorial:select')
      .setPlaceholder('Escolha um tutorial')
      .addOptions([
        ...Object.entries(tutorials).map(([value, tutorial]) => ({
          label: tutorial.label,
          description: tutorial.description,
          value
        })),
        {
          label: 'Completo',
          description: 'Mostrar todos os tutoriais juntos.',
          value: 'completo'
        }
      ])
  );
}

function simpleEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(description);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

module.exports = {
  handleMessage,
  handleTutorialSelect
};
