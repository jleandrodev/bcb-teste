import { MESSAGE_REPOSITORY } from '../../src/messaging/application/ports';
import { TestApp, startApp } from '../support/app';
import { FailingMessageRepository } from '../support/failing-message-repository';
import { FakeMessageGateway } from '../support/fake-message-gateway';
import { SendJson, balanceOf, createPrepaid, get, sendTo, transactionsOf } from '../support/fixtures';

describe('Falhas de infraestrutura não viram prejuízo nem entrega em dobro', () => {
  let t: TestApp;
  let repository: FailingMessageRepository;

  const start = async (maxAttempts: number, gateway = new FakeMessageGateway()) => {
    repository = new FailingMessageRepository();
    t = await startApp({ queue: { maxAttempts }, gateway, customize: (b) => b.overrideProvider(MESSAGE_REPOSITORY).useValue(repository) });
  };

  afterEach(() => t.close());

  it('se o banco falha depois de o provedor aceitar, a mensagem não é estornada nem marcada como failed', async () => {
    await start(1);
    const ana = await createPrepaid(t, 1);
    const sent = (await sendTo(t, ana, 'entregue de fato', 'urgent')).body as SendJson;
    repository.failNextSaveOf('delivered');

    await expect(t.processor.drain()).rejects.toThrow('banco indisponível');

    expect(t.gateway.delivered).toEqual(['entregue de fato']);
    expect((await balanceOf(t, ana)).balance).toBe(0.5); // continua cobrada: foi entregue
    expect((await transactionsOf(t, ana)).map((x) => x.type)).toEqual(['debit']);
    expect((await get(t, ana, `/messages/${sent.id}/status`)).body).toMatchObject({ status: 'sent' });
  });

  it('se o banco falha depois de o provedor aceitar, o provedor não recebe a mensagem de novo', async () => {
    await start(3);
    const ana = await createPrepaid(t, 1);
    await sendTo(t, ana, 'uma vez só');
    repository.failNextSaveOf('sent');

    await expect(t.processor.drain()).rejects.toThrow('banco indisponível');
    await t.processor.drain();

    expect(t.gateway.delivered).toEqual(['uma vez só']);
  });

  it('o estorno da falha definitiva acontece antes de a mensagem ser marcada como failed, e nunca duas vezes', async () => {
    await start(1, new FakeMessageGateway().failAlways());
    const ana = await createPrepaid(t, 1);
    const sent = (await sendTo(t, ana, 'nunca chega', 'urgent')).body as SendJson;
    repository.failNextSaveOf('failed'); // cai depois de estornar, antes de registrar a falha

    await expect(t.processor.drain()).rejects.toThrow('banco indisponível');
    expect((await balanceOf(t, ana)).balance).toBe(1);

    // "Reinício": a mensagem ficou em processing e volta à fila; falha de novo.
    await t.processor.onApplicationBootstrap();
    await t.processor.drain();

    expect((await get(t, ana, `/messages/${sent.id}/status`)).body).toMatchObject({ status: 'failed' });
    expect((await balanceOf(t, ana)).balance).toBe(1); // não estornou em dobro
    expect((await transactionsOf(t, ana)).map((x) => x.type)).toEqual(['debit', 'refund']);
  });
});

describe('Modo sync', () => {
  let t: TestApp;

  afterEach(() => t.close());

  it('uma falha de infraestrutura durante o processamento não derruba a resposta de um envio já cobrado', async () => {
    const repository = new FailingMessageRepository();
    t = await startApp({ queue: { mode: 'sync' }, customize: (b) => b.overrideProvider(MESSAGE_REPOSITORY).useValue(repository) });
    const ana = await createPrepaid(t, 1);
    repository.failNextSaveOf('delivered');

    const response = await sendTo(t, ana, 'cobrada e aceita');

    expect(response.status).toBe(201);
    expect((await balanceOf(t, ana)).balance).toBe(0.75);
  });
});

describe('Envio recusado não deixa rastro', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await startApp();
  });

  afterEach(() => t.close());

  it('402 por saldo insuficiente não cria conversa com o destinatário', async () => {
    const ana = await createPrepaid(t, 0);

    expect((await sendTo(t, ana, 'sem saldo')).status).toBe(402);

    expect((await get(t, ana, '/conversations')).body).toEqual([]);
  });

  it('403 de cliente inativo não cria conversa com o destinatário', async () => {
    const ana = await createPrepaid(t, 5);
    await t.api.put(`/clients/${ana.id}`).send({ active: false });

    expect((await sendTo(t, ana, 'inativo')).status).toBe(403);

    expect((await get(t, ana, '/conversations')).body).toEqual([]);
  });
});
