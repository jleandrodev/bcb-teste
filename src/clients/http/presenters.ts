import { Transaction } from '../application/ports';
import { Client } from '../domain/client';

/** Presenters: traduzem o domínio para o contrato JSON do enunciado (valores em reais). */
export function presentClient(client: Client) {
  return {
    id: client.id,
    name: client.name,
    documentId: client.document.value,
    documentType: client.document.type,
    planType: client.planType,
    balance: client.planType === 'prepaid' ? client.account.balance.toDecimal() : undefined,
    limit: client.planType === 'postpaid' ? client.account.limit.toDecimal() : undefined,
    active: client.active,
  };
}

export function presentBalance(client: Client, now: Date) {
  const available = client.available(now).toDecimal();
  if (client.planType === 'prepaid') {
    return { clientId: client.id, planType: client.planType, balance: client.account.balance.toDecimal(), available };
  }
  const limit = client.account.limit.toDecimal();
  return { clientId: client.id, planType: client.planType, limit, used: Number((limit - available).toFixed(2)), available };
}

export function presentTransaction(t: Transaction) {
  return { id: t.id, type: t.type, amount: t.amountCents / 100, messageId: t.messageId, createdAt: t.createdAt.toISOString() };
}
