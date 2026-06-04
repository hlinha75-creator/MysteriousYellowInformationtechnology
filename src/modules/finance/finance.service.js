const { transaction } = require('../../database/connection');
const { backupDatabase } = require('../../database/backup');
const audit = require('../audit/audit.repository');
const repo = require('./finance.repository');
const { formatSilver } = require('../../utils/silver');

function applyBalanceTransaction({ type, userId, amount, reason, referenceType, referenceId, createdBy }) {
  repo.ensureBalance(userId);
  const beforeBalance = repo.getBalance(userId);
  const afterBalance = beforeBalance + amount;
  repo.setBalance({ userId, amount: afterBalance });
  repo.insertTransaction({
    type,
    userId,
    amount,
    beforeBalance,
    afterBalance,
    reason,
    referenceType,
    referenceId,
    createdBy
  });
  audit.createAuditLog({
    type: `balance_${type}`,
    actorId: createdBy,
    targetId: userId,
    beforeValue: beforeBalance,
    afterValue: afterBalance,
    reason,
    metadata: { amount, referenceType, referenceId }
  });
  return { beforeBalance, afterBalance };
}

const applyManyTransactions = transaction((items) => {
  backupDatabase('before_finance_transaction');
  return items.map((item) => applyBalanceTransaction(item));
});

async function notifyPositiveTransactions({ client, transactions }) {
  if (!client) return;
  for (const item of transactions) {
    if (item.amount <= 0) continue;
    await notifyBalanceReceived({
      client,
      userId: item.userId,
      amount: item.amount,
      reason: item.reason
    });
  }
}

async function notifyBalanceReceived({ client, userId, amount, reason }) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(`Voce recebeu ${formatSilver(amount)} de prata no seu saldo.${reason ? ` Motivo: ${reason}` : ''}`);
  } catch (error) {
    audit.createAuditLog({
      type: 'balance_dm_failed',
      targetId: userId,
      afterValue: amount,
      reason: error.message
    });
  }
}

function requestWithdraw({ userId, amount, note }) {
  return repo.createWithdrawRequest({ userId, amount, note });
}

function approveWithdraw({ requestId, actorId }) {
  const request = repo.getWithdrawRequest(requestId);
  if (!request) throw new Error('Solicitacao de saque nao encontrada.');
  if (request.status !== 'requested') throw new Error('Solicitacao de saque nao esta solicitada.');
  repo.updateWithdrawStatus({ id: request.id, status: 'approved', actorId });
  audit.createAuditLog({
    type: 'withdraw_approved',
    actorId,
    targetId: request.user_id,
    afterValue: request.amount,
    reason: `Saque #${request.id} aprovado`
  });
  return request;
}

function refuseWithdraw({ requestId, actorId }) {
  const request = repo.getWithdrawRequest(requestId);
  if (!request) throw new Error('Solicitacao de saque nao encontrada.');
  if (!['requested', 'approved'].includes(request.status)) {
    throw new Error('Solicitacao de saque nao esta pendente.');
  }
  repo.updateWithdrawStatus({ id: request.id, status: 'refused', actorId });
  audit.createAuditLog({
    type: 'withdraw_refused',
    actorId,
    targetId: request.user_id,
    afterValue: request.amount,
    reason: `Saque #${request.id} recusado`
  });
  return request;
}

const payWithdraw = transaction(({ requestId, actorId }) => {
  backupDatabase('before_withdraw_payment');
  const request = repo.getWithdrawRequest(requestId);
  if (!request) throw new Error('Solicitacao de saque nao encontrada.');
  if (!['requested', 'approved'].includes(request.status)) {
    throw new Error('Solicitacao de saque nao esta pendente.');
  }

  const result = applyBalanceTransaction({
    type: 'withdraw_paid',
    userId: request.user_id,
    amount: -Math.abs(request.amount),
    reason: `Saque #${request.id} pago`,
    referenceType: 'withdraw_request',
    referenceId: String(request.id),
    createdBy: actorId
  });
  repo.updateWithdrawStatus({ id: request.id, status: 'paid', actorId });
  return result;
});

module.exports = {
  applyBalanceTransaction,
  applyManyTransactions,
  approveWithdraw,
  refuseWithdraw,
  notifyPositiveTransactions,
  payWithdraw,
  requestWithdraw
};
