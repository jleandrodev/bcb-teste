import { TestApp, startApp } from '../support/app';
import { createPrepaid, sendTo } from '../support/fixtures';

describe('Fila com prioridade pela API (S3)', () => {
  let t: TestApp;

  afterEach(() => t.close());

  /** Envia na ordem dada (`u*` urgente, `n*` normal), processa tudo e devolve a ordem de entrega. */
  async function deliveryOrder(urgentBurst: number, arrivals: string[]): Promise<string[]> {
    t = await startApp({ queue: { urgentBurst } });
    const ana = await createPrepaid(t, 100);
    for (const label of arrivals) await sendTo(t, ana, label, label.startsWith('u') ? 'urgent' : 'normal');
    await t.processor.drain();
    return t.gateway.delivered;
  }

  it('urgentes são entregues antes das normais', async () => {
    expect(await deliveryOrder(10, ['n1', 'u1', 'n2', 'u2'])).toEqual(['u1', 'u2', 'n1', 'n2']);
  });

  it('com o padrão de três urgentes por rajada, as normais não esperam para sempre', async () => {
    expect(await deliveryOrder(3, ['n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5'])).toEqual(['u1', 'u2', 'u3', 'n1', 'u4', 'u5', 'n2']);
  });

  it('com URGENT_BURST=2 a normal sai depois de duas urgentes', async () => {
    expect(await deliveryOrder(2, ['n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5'])).toEqual(['u1', 'u2', 'n1', 'u3', 'u4', 'n2', 'u5']);
  });

  it('GET /queue/status mostra tamanhos por nível antes e contadores depois do processamento', async () => {
    t = await startApp({ queue: { urgentBurst: 2 } });
    const ana = await createPrepaid(t, 100);
    for (const label of ['n1', 'n2', 'u1', 'u2', 'u3']) await sendTo(t, ana, label, label.startsWith('u') ? 'urgent' : 'normal');

    const before = await t.api.get('/queue/status');
    await t.processor.drain();
    const after = await t.api.get('/queue/status');

    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      size: { urgent: 3, normal: 2, total: 5 },
      enqueued: 5,
      processed: 0,
      failed: 0,
      retried: 0,
      averageWaitMs: 0,
      antiStarvation: { urgentBurst: 2, preventions: 0 },
      worker: { mode: 'manual', running: false },
    });
    expect(after.body).toMatchObject({
      size: { urgent: 0, normal: 0, total: 0 },
      enqueued: 5,
      processed: 5,
      antiStarvation: { urgentBurst: 2, preventions: 1 },
    });
    expect((after.body as { averageWaitMs: number }).averageWaitMs).toBeGreaterThanOrEqual(0);
  });

  it('a estimativa de entrega segue a prioridade: a urgente não espera as normais que estão na fila', async () => {
    t = await startApp();
    const ana = await createPrepaid(t, 100);
    const estimate = async (label: string, priority: 'normal' | 'urgent') =>
      new Date(((await sendTo(t, ana, label, priority)).body as { estimatedDelivery: string }).estimatedDelivery).getTime();

    const first = await estimate('n1', 'normal');
    await estimate('n2', 'normal');
    const third = await estimate('n3', 'normal');
    const urgent = await estimate('u1', 'urgent');

    expect(third).toBeGreaterThan(first); // cada normal espera as que chegaram antes
    expect(urgent).toBeLessThan(third); // a urgente passa na frente das três normais
  });
});
