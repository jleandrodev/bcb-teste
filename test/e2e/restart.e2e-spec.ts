import { MESSAGE_REPOSITORY, MessageRepository } from '../../src/messaging/application/ports';
import { startApp, waitFor } from '../support/app';
import { describePostgres } from '../support/database';
import { SendJson, createPrepaid, get, sendTo } from '../support/fixtures';

/*
 * A fila vive na memória do processo; as mensagens, no banco. Estes testes derrubam
 * a aplicação e sobem outra sobre o mesmo banco. Só fazem sentido com PostgreSQL:
 * rodam em `npm run test:pg` e aparecem como "skipped" em `npm run test:e2e`.
 */
describePostgres('Reinício do processo (S4)', () => {
  it('as mensagens pendentes voltam à fila na ordem de criação, e a que estava em processamento é reprocessada', async () => {
    const before = await startApp();
    const ana = await createPrepaid(before, 10);
    const n1 = (await sendTo(before, ana, 'n1')).body as SendJson;
    await sendTo(before, ana, 'u1', 'urgent');
    await sendTo(before, ana, 'n2');
    const done = (await before.api.get('/messages?priority=urgent').set('X-Client-Document', ana.documentId)).body as SendJson[];
    await sendTo(before, ana, 'u2', 'urgent');
    // u1 é entregue antes da queda; n1 é pega no meio do processamento.
    await before.processor.processNext();
    const repository = before.app.get<MessageRepository>(MESSAGE_REPOSITORY);
    const caught = await repository.findById(n1.id);
    await repository.save(caught!.transitionTo('processing', new Date()).withAttempt());
    await before.close(); // "queda": a fila em memória se perde

    const after = await startApp({ keepData: true });
    try {
      expect((await after.api.get('/queue/status')).body).toMatchObject({ size: { urgent: 1, normal: 2, total: 3 } });

      await after.processor.drain();

      expect(after.gateway.delivered).toEqual(['u2', 'n1', 'n2']); // u1 não é entregue de novo
      const recovered = (await get(after, ana, `/messages/${n1.id}/status`)).body as {
        status: string;
        attempts: number;
        history: { status: string }[];
      };
      expect(recovered).toMatchObject({ status: 'delivered', attempts: 2 });
      expect(recovered.history.map((h) => h.status)).toEqual(['queued', 'processing', 'queued', 'processing', 'sent', 'delivered']);
      expect((await get(after, ana, `/messages/${done[0].id}/status`)).body).toMatchObject({ status: 'delivered', attempts: 1 });
    } finally {
      await after.close();
    }
  });

  it('com o worker assíncrono, a entrega das pendentes recomeça sozinha ao iniciar', async () => {
    const before = await startApp();
    const ana = await createPrepaid(before, 10);
    const sent = (await sendTo(before, ana, 'ficou pendente')).body as SendJson;
    await before.close();

    const after = await startApp({ keepData: true, queue: { mode: 'async' } });
    try {
      await waitFor(async () => ((await get(after, ana, `/messages/${sent.id}/status`)).body as { status: string }).status === 'delivered');
      expect(after.gateway.delivered).toEqual(['ficou pendente']);
    } finally {
      await after.close();
    }
  });

  it('saldo, transações e conversas sobrevivem ao reinício', async () => {
    const before = await startApp();
    const ana = await createPrepaid(before, 1);
    await sendTo(before, ana, 'um', 'urgent');
    await before.close();

    const after = await startApp({ keepData: true });
    try {
      expect((await after.api.get(`/clients/${ana.id}/balance`)).body).toMatchObject({ balance: 0.5 });
      expect((await after.api.get(`/clients/${ana.id}/transactions`)).body).toHaveLength(1);
      expect((await get(after, ana, '/conversations')).body).toHaveLength(1);
    } finally {
      await after.close();
    }
  });
});
