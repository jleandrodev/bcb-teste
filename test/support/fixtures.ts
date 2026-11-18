import { TestApp } from './app';

/** Documentos válidos (dígitos verificadores corretos) para cadastrar clientes distintos. */
export const CPF = { ana: '52998224725', bruno: '11144477735', carla: '12345678909' };
export const CNPJ = { loja: '11222333000181', rede: '11444777000161' };

export interface ClientJson {
  id: string;
  name: string;
  documentId: string;
  documentType: string;
  planType: 'prepaid' | 'postpaid';
  balance?: number;
  limit?: number;
  active: boolean;
}

export interface SendJson {
  id: string;
  conversationId: string;
  status: string;
  estimatedDelivery: string;
  cost: number;
  currentBalance?: number;
}

export async function createPrepaid(t: TestApp, balance: number, documentId = CPF.ana): Promise<ClientJson> {
  const response = await t.api
    .post('/clients')
    .send({ name: 'Ana Pré-paga', documentId, documentType: 'CPF', planType: 'prepaid', balance });
  expect(response.status).toBe(201);
  return response.body as ClientJson;
}

export async function createPostpaid(t: TestApp, limit: number, documentId = CNPJ.loja): Promise<ClientJson> {
  const response = await t.api
    .post('/clients')
    .send({ name: 'Loja Pós-paga', documentId, documentType: 'CNPJ', planType: 'postpaid', limit });
  expect(response.status).toBe(201);
  return response.body as ClientJson;
}

/** Envia uma mensagem como `client` (identificado pelo documento, como permite a Parte 2). */
export function send(t: TestApp, client: ClientJson, body: Record<string, unknown>) {
  return t.api.post('/messages').set('X-Client-Document', client.documentId).send(body);
}

/** Atalho para o caso comum: mensagem para o destinatário padrão, com o conteúdo servindo de rótulo. */
export function sendTo(t: TestApp, client: ClientJson, content: string, priority: 'normal' | 'urgent' = 'normal') {
  return send(t, client, { recipientId: 'dest-1', recipientName: 'Destinatário', content, priority });
}

export function get(t: TestApp, client: ClientJson, path: string) {
  return t.api.get(path).set('X-Client-Document', client.documentId);
}

export async function balanceOf(
  t: TestApp,
  client: ClientJson,
): Promise<{ balance?: number; limit?: number; used?: number; available: number }> {
  return (await t.api.get(`/clients/${client.id}/balance`)).body as { balance?: number; limit?: number; used?: number; available: number };
}

export async function transactionsOf(t: TestApp, client: ClientJson): Promise<{ type: string; amount: number; messageId?: string }[]> {
  return (await t.api.get(`/clients/${client.id}/transactions`)).body as { type: string; amount: number; messageId?: string }[];
}
