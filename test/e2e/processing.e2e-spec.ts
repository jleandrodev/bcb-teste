import { TestApp, startApp, waitFor } from '../support/app';
import { FakeMessageGateway } from '../support/fake-message-gateway';
import { ClientJson, SendJson, balanceOf, createPostpaid, createPrepaid, get, sendTo, transactionsOf } from '../support/fixtures';

interface StatusJson {
  id: string;
  status: string;
  attempts: number;
  history: { status: string; at: string }[];
}

describe('Processamento, falhas e retry (S4)', () => {
  let t: TestApp;

  afterEach(() => t.close());

  const statusOf = async (client: ClientJson, id: string) => (await get(t, client, `/messages/${id}/status`)).body as StatusJson;

  describe('modos do worker', () => {
    it('async: responde "queued" na hora e entrega em segundo plano, sem nova requisição', async () => {
      const gateway = new FakeMessageGateway();
      gateway.delayMs = 30;
      t = await startApp({ queue: { mode: 'async' }, gateway });
      const ana = await createPrepaid(t, 5);

      const response = await sendTo(t, ana, 'em segundo plano');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'queued' });
      expect(gateway.delivered).toEqual([]); // a resposta chegou antes da entrega

      await waitFor(async () => (await statusOf(ana, (response.body as SendJson).id)).status === 'delivered');
      expect(gateway.delivered).toEqual(['em segundo plano']);
    });

    it('sync: só responde depois de processar', async () => {
      t = await startApp({ queue: { mode: 'sync' } });
      const ana = await createPrepaid(t, 5);

      const response = await sendTo(t, ana, 'na hora');

      expect(response.body).toMatchObject({ status: 'delivered' });
      expect(t.gateway.delivered).toEqual(['na hora']);
    });

    it('manual: nada anda até o consumo ser disparado', async () => {
      t = await startApp({ queue: { mode: 'manual' } });
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'parada')).body as SendJson;

      expect((await statusOf(ana, sent.id)).status).toBe('queued');

      expect(await t.processor.drain()).toBe(1);
      expect((await statusOf(ana, sent.id)).status).toBe('delivered');
    });
  });

  describe('ciclo de vida', () => {
    it('uma entrega bem-sucedida registra queued, processing, sent e delivered, com horários em ordem', async () => {
      t = await startApp();
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'Olá')).body as SendJson;

      await t.processor.drain();

      const status = await statusOf(ana, sent.id);
      expect(status).toMatchObject({ id: sent.id, status: 'delivered', attempts: 1 });
      expect(status.history.map((h) => h.status)).toEqual(['queued', 'processing', 'sent', 'delivered']);
      const times = status.history.map((h) => new Date(h.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('processar com a fila vazia não faz nada e não falha', async () => {
      t = await startApp();

      expect(await t.processor.processNext()).toBe(false);
      expect(await t.processor.drain()).toBe(0);
    });
  });

  describe('retry', () => {
    it('provedor falha duas vezes e aceita na terceira: entregue com três tentativas', async () => {
      t = await startApp({ queue: { maxAttempts: 3 }, gateway: new FakeMessageGateway().failNext(2) });
      const ana = await createPrepaid(t, 1);
      const sent = (await sendTo(t, ana, 'insistente')).body as SendJson;

      await t.processor.drain();

      const status = await statusOf(ana, sent.id);
      expect(status).toMatchObject({ status: 'delivered', attempts: 3 });
      expect(status.history.map((h) => h.status)).toEqual([
        'queued',
        'processing',
        'queued',
        'processing',
        'queued',
        'processing',
        'sent',
        'delivered',
      ]);
      expect((await t.api.get('/queue/status')).body).toMatchObject({ processed: 1, retried: 2, failed: 0 });
      expect((await balanceOf(t, ana)).balance).toBe(0.75); // cobrada uma vez só, sem estorno
    });

    it('a mensagem que falhou volta para o fim do seu nível: as outras não ficam presas atrás dela', async () => {
      t = await startApp({ gateway: new FakeMessageGateway().failNext(1) });
      const ana = await createPrepaid(t, 5);
      for (const label of ['n1', 'n2', 'n3']) await sendTo(t, ana, label);

      await t.processor.drain();

      expect(t.gateway.delivered).toEqual(['n2', 'n3', 'n1']);
    });

    it('com backoff, a nova tentativa espera RETRY_BACKOFF_MS e depois acontece sozinha', async () => {
      t = await startApp({ queue: { mode: 'async', retryBackoffMs: 80 }, gateway: new FakeMessageGateway().failNext(1) });
      const ana = await createPrepaid(t, 5);
      const startedAt = Date.now();
      const sent = (await sendTo(t, ana, 'com espera')).body as SendJson;

      await waitFor(async () => (await statusOf(ana, sent.id)).status === 'delivered');

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(80);
      expect((await statusOf(ana, sent.id)).attempts).toBe(2);
    });
  });

  describe('falha definitiva', () => {
    it('pré-pago: esgotadas as tentativas, a mensagem vira failed e o valor volta ao saldo', async () => {
      t = await startApp({ queue: { maxAttempts: 2 }, gateway: new FakeMessageGateway().failAlways() });
      const ana = await createPrepaid(t, 1);
      const sent = (await sendTo(t, ana, 'nunca chega', 'urgent')).body as SendJson;
      expect((await balanceOf(t, ana)).balance).toBe(0.5);

      await t.processor.drain();

      const status = await statusOf(ana, sent.id);
      expect(status).toMatchObject({ status: 'failed', attempts: 2 });
      expect(status.history.map((h) => h.status)).toEqual(['queued', 'processing', 'queued', 'processing', 'failed']);
      expect((await balanceOf(t, ana)).balance).toBe(1);
      expect(await transactionsOf(t, ana)).toEqual([
        expect.objectContaining({ type: 'debit', amount: 0.5, messageId: sent.id }),
        expect.objectContaining({ type: 'refund', amount: 0.5, messageId: sent.id }),
      ]);
      expect((await t.api.get('/queue/status')).body).toMatchObject({ processed: 0, retried: 1, failed: 1, size: { total: 0 } });
    });

    it('pós-pago: o estorno abate do consumo do mês', async () => {
      t = await startApp({ queue: { maxAttempts: 1 }, gateway: new FakeMessageGateway().failAlways() });
      const loja = await createPostpaid(t, 10);
      await sendTo(t, loja, 'nunca chega', 'urgent');
      expect((await balanceOf(t, loja)).used).toBe(0.5);

      await t.processor.drain();

      expect(await balanceOf(t, loja)).toMatchObject({ used: 0, available: 10 });
    });

    it('uma mensagem que falha não impede a entrega das seguintes', async () => {
      t = await startApp({ queue: { maxAttempts: 1 }, gateway: new FakeMessageGateway().failNext(1) });
      const ana = await createPrepaid(t, 5);
      const failed = (await sendTo(t, ana, 'falha')).body as SendJson;
      await sendTo(t, ana, 'passa');

      await t.processor.drain();

      expect((await statusOf(ana, failed.id)).status).toBe('failed');
      expect(t.gateway.delivered).toEqual(['passa']);
    });

    it('mensagem failed é estado final: não pode ser marcada como lida', async () => {
      t = await startApp({ queue: { maxAttempts: 1 }, gateway: new FakeMessageGateway().failAlways() });
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'falha')).body as SendJson;
      await t.processor.drain();

      const response = await t.api.patch(`/messages/${sent.id}/read`).set('X-Client-Document', ana.documentId);

      expect(response.status).toBe(409);
    });
  });

  describe('um único laço de consumo', () => {
    it('disparos simultâneos entregam cada mensagem uma vez só, uma por vez, na ordem da fila', async () => {
      const gateway = new FakeMessageGateway();
      gateway.delayMs = 5; // entrega lenta: se houvesse dois laços, as entregas se sobreporiam
      t = await startApp({ gateway });
      const ana = await createPrepaid(t, 100);
      for (const label of ['n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5'])
        await sendTo(t, ana, label, label.startsWith('u') ? 'urgent' : 'normal');

      const counts = await Promise.all([t.processor.drain(), t.processor.drain(), t.processor.drain()]);

      expect(gateway.delivered).toEqual(['u1', 'u2', 'u3', 'n1', 'u4', 'u5', 'n2']);
      expect(gateway.maxConcurrent).toBe(1);
      expect(counts).toEqual([7, 7, 7]); // as três chamadas compartilharam a mesma execução
    });

    it('mensagens que chegam durante o consumo entram no mesmo laço', async () => {
      t = await startApp();
      const ana = await createPrepaid(t, 100);
      await sendTo(t, ana, 'n1');
      t.gateway.duringNextDelivery(() => sendTo(t, ana, 'u1', 'urgent')); // u1 chega enquanto n1 está sendo entregue

      await t.processor.drain();

      expect(t.gateway.delivered).toEqual(['n1', 'u1']);
      expect(t.gateway.maxConcurrent).toBe(1);
    });
  });
});
