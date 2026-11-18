import { TestingModuleBuilder } from '@nestjs/testing';
import { ClientsService } from '../../src/clients';
import { MESSAGE_REPOSITORY } from '../../src/messaging/application/ports';
import { SendMessageUseCase } from '../../src/messaging/application/send-message.use-case';
import { InMemoryMessageRepository } from '../../src/messaging/infra/memory/repositories';
import { TestApp, startApp } from '../support/app';
import { balanceOf, createPrepaid, get, sendTo, transactionsOf } from '../support/fixtures';

describe('Consistência da cobrança (S2)', () => {
  let t: TestApp;

  afterEach(() => t.close());

  describe('envios simultâneos do mesmo cliente', () => {
    beforeEach(async () => {
      t = await startApp();
    });

    it('dez requisições de R$ 0,25 com saldo R$ 1,00: exatamente quatro aceitas, seis recusadas, saldo zero', async () => {
      const ana = await createPrepaid(t, 1);

      const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => sendTo(t, ana, `m${i}`)));

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(4);
      expect(statuses.filter((s) => s === 402)).toHaveLength(6);
      expect((await balanceOf(t, ana)).balance).toBe(0);
      expect(await transactionsOf(t, ana)).toHaveLength(4);
      expect((await get(t, ana, '/messages')).body).toHaveLength(4);
      expect((await get(t, ana, '/conversations')).body).toHaveLength(1); // a corrida também não duplica a conversa
    });

    /*
     * O mesmo cenário sem HTTP no meio. Com os adaptadores em memória, cada requisição HTTP
     * roda em uma volta separada do event loop e a corrida não chega a acontecer; chamando
     * o caso de uso direto, as dez execuções se intercalam a cada `await`. É este teste que
     * fica vermelho se o débito virar "ler, decidir e gravar" em passos separados.
     */
    it('dez execuções intercaladas do caso de uso: o saldo nunca é gasto duas vezes', async () => {
      const ana = await createPrepaid(t, 1);
      const sender = await t.app.get(ClientsService).get(ana.id);
      const useCase = t.app.get(SendMessageUseCase);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => useCase.execute(sender, { recipientId: 'dest-1', content: `m${i}`, priority: 'normal' })),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
      expect(results.filter((r) => r.status === 'rejected').map((r) => (r.reason as { code: string }).code)).toEqual(
        Array.from({ length: 6 }, () => 'INSUFFICIENT_BALANCE'),
      );
      expect((await balanceOf(t, ana)).balance).toBe(0);
    });

    it('créditos e débitos simultâneos fecham a conta: 1,00 + 4 × 0,50 − 8 × 0,25 = 1,00', async () => {
      const ana = await createPrepaid(t, 1);

      const responses = await Promise.all([
        ...Array.from({ length: 4 }, () => t.api.post(`/clients/${ana.id}/credits`).send({ amount: 0.5 })),
        ...Array.from({ length: 8 }, (_, i) => sendTo(t, ana, `m${i}`)),
      ]);

      const accepted = responses.slice(4).filter((r) => r.status === 201).length;
      expect(accepted).toBeGreaterThanOrEqual(4); // quantas passam depende da ordem; a conta tem de fechar em qualquer ordem
      expect((await balanceOf(t, ana)).balance).toBe((100 + 4 * 50 - accepted * 25) / 100);
    });
  });

  describe('falha depois da cobrança', () => {
    /** Repositório real cujo disco "acabou": toda gravação de mensagem falha. */
    class OutOfSpaceMessageRepository extends InMemoryMessageRepository {
      async save(): Promise<void> {
        throw new Error('disco cheio');
      }
    }

    beforeEach(async () => {
      t = await startApp({
        customize: (builder: TestingModuleBuilder) =>
          builder.overrideProvider(MESSAGE_REPOSITORY).useValue(new OutOfSpaceMessageRepository()),
      });
    });

    it('se gravar a mensagem falha, o valor cobrado é estornado e o erro aparece', async () => {
      const ana = await createPrepaid(t, 1);

      const response = await sendTo(t, ana, 'não grava', 'urgent');

      expect(response.status).toBe(500);
      expect((await balanceOf(t, ana)).balance).toBe(1);
      expect(await transactionsOf(t, ana)).toEqual([
        expect.objectContaining({ type: 'debit', amount: 0.5 }),
        expect.objectContaining({ type: 'refund', amount: 0.5 }),
      ]);
      expect((await t.api.get('/queue/status')).body).toMatchObject({ size: { total: 0 } });
    });
  });
});
