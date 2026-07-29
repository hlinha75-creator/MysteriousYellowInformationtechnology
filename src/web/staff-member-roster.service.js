const audit = require('../modules/audit/audit.repository');
const snapshots = require('../modules/members/memberSnapshot.service');

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function cleanSourceName(value) {
  const sourceName = String(value || 'Lista copiada do Albion').trim().slice(0, 120);
  return sourceName || 'Lista copiada do Albion';
}

function publicRosterData(details) {
  if (!details) return null;
  return {
    id: details.id,
    sourceName: details.source_name,
    memberCount: details.member_count,
    onlineCount: details.online_count,
    createdAt: details.created_at,
    createdBy: details.created_by,
    linkedCount: details.linkedCount,
    unlinkedCount: details.unlinkedCount,
    additions: details.additions,
    removals: details.removals,
    unlinked: details.unlinked.slice(0, 100),
    registeredOutside: details.registeredOutside.slice(0, 100)
  };
}

function getMemberRosterData() {
  return publicRosterData(snapshots.latestSnapshotDetails());
}

function manageMemberRoster(input) {
  const action = String(input.action || '').trim();
  const rosterText = String(input.rosterText || '');
  if (!rosterText.trim()) fail('Cole a lista de membros ou selecione um arquivo.');
  if (Buffer.byteLength(rosterText, 'utf8') > 512 * 1024) fail('A lista deve ter no máximo 512 KB.', 413);

  const sourceName = cleanSourceName(input.sourceName);
  const preview = snapshots.previewMemberSnapshot(rosterText);
  if (action === 'preview') {
    return {
      message: `${preview.memberCount} membros encontrados. Revise as diferenças antes de confirmar.`,
      preview: { ...preview, sourceName }
    };
  }
  if (action !== 'confirm') fail('Ação de lista de membros inválida.');

  const before = snapshots.latestSnapshot();
  const saved = snapshots.importMemberSnapshot(rosterText, {
    sourceName,
    actorId: input.actorId || 'website'
  });
  audit.createAuditLog({
    type: 'website_member_roster_imported',
    actorId: input.actorId,
    targetId: String(saved.id),
    beforeValue: before?.id || null,
    afterValue: saved.id,
    reason: sourceName,
    metadata: {
      memberCount: saved.memberCount,
      onlineCount: saved.onlineCount,
      linkedCount: preview.linkedCount,
      unlinkedCount: preview.unlinkedCount,
      additions: preview.additions.length,
      removals: preview.removals.length,
      duplicates: saved.duplicates.length
    }
  });
  return {
    message: `Lista atualizada com ${saved.memberCount} membros. Nenhum cargo do Discord foi removido automaticamente.`,
    roster: getMemberRosterData()
  };
}

module.exports = {
  getMemberRosterData,
  manageMemberRoster,
  publicRosterData
};
