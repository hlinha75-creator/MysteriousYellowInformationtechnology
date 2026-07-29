const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ids = require('../config/ids');
const { getDatabase, transaction } = require('../database/connection');
const audit = require('../modules/audit/audit.repository');
const accountLinks = require('../modules/accounts/accountLinks.service');
const finance = require('../modules/finance/finance.service');
const financeRepo = require('../modules/finance/finance.repository');
const { safeSend } = require('../utils/discord');
const { formatSilver, parseSilver } = require('../utils/silver');

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function pendingWithdraw(userId) {
  return getDatabase().prepare(`
    SELECT *
    FROM withdraw_requests
    WHERE user_id = ? AND status IN ('requested', 'approved')
    ORDER BY id DESC
    LIMIT 1
  `).get(userId) || null;
}

const createPortalWithdraw = transaction(({ discordId, rawAmount, note }) => {
  const userId = accountLinks.resolvePrimaryUserId(discordId);
  let amount;
  try {
    amount = parseSilver(rawAmount);
  } catch {
    throw actionError('Informe um valor válido. Exemplos: 850k, 1.5m ou 1500000.');
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw actionError('O valor do saque precisa ser maior que zero.');
  }

  const cleanNote = String(note || '').replace(/\s+/g, ' ').trim();
  if (cleanNote.length > 180) throw actionError('A observação pode ter no máximo 180 caracteres.');

  const existing = pendingWithdraw(userId);
  if (existing) {
    throw actionError(`Você já possui o saque #${existing.id} pendente. Aguarde a conclusão antes de pedir outro.`, 409);
  }

  const balance = financeRepo.getBalance(userId);
  if (amount > balance) {
    throw actionError(`Seu saldo disponível é ${formatSilver(balance)}. Escolha um valor igual ou menor.`, 409);
  }

  const result = finance.requestWithdraw({ userId, amount, note: cleanNote });
  const request = financeRepo.getWithdrawRequest(result.lastInsertRowid);
  audit.createAuditLog({
    type: 'withdraw_requested',
    actorId: discordId,
    targetId: userId,
    afterValue: amount,
    reason: cleanNote || 'Solicitado pelo portal',
    metadata: { source: 'portal', originalDiscordId: discordId }
  });
  return request;
});

function staffRequestContent(request) {
  const note = request.note ? ` | Obs: ${request.note}` : '';
  return `Saque #${request.id} | <@${request.user_id}> | ${formatSilver(request.amount)} | Aguardando aprovacao${note}`;
}

function staffRequestComponents(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`finance:approve_withdraw:${requestId}`).setLabel('Aprovar saque').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`finance:pay_withdraw:${requestId}`).setLabel('Pagar saque').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${requestId}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function requestPortalWithdraw(client, input) {
  const request = createPortalWithdraw(input);
  const staffMessage = await safeSend(client, ids.channels.finance, {
    content: staffRequestContent(request),
    components: staffRequestComponents(request.id),
    allowedMentions: { parse: [], users: [request.user_id], roles: [] }
  });
  if (!staffMessage) {
    audit.createAuditLog({
      type: 'withdraw_staff_notice_failed',
      actorId: input.discordId,
      targetId: request.user_id,
      afterValue: request.id,
      reason: 'Pedido salvo, mas o aviso não pôde ser enviado ao canal financeiro.',
      metadata: { source: 'portal' }
    });
  }
  return {
    request,
    staffNotified: Boolean(staffMessage),
    message: `Saque #${request.id} de ${formatSilver(request.amount)} enviado para a staff.`
  };
}

module.exports = { requestPortalWithdraw };
