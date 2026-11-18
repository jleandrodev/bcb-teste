import { queueOptionsFromEnv } from '../ports';

describe('queueOptionsFromEnv', () => {
  it('sem variáveis, usa worker assíncrono, rajada 3, três tentativas e backoff de 200 ms', () => {
    expect(queueOptionsFromEnv({})).toEqual({ mode: 'async', urgentBurst: 3, maxAttempts: 3, retryBackoffMs: 200, processingDelayMs: 0 });
  });

  it('lê os valores informados', () => {
    const options = queueOptionsFromEnv({
      QUEUE_MODE: 'sync',
      URGENT_BURST: '5',
      MAX_ATTEMPTS: '2',
      RETRY_BACKOFF_MS: '0',
      PROCESSING_DELAY_MS: '40',
    });

    expect(options).toEqual({ mode: 'sync', urgentBurst: 5, maxAttempts: 2, retryBackoffMs: 0, processingDelayMs: 40 });
  });

  it('variável vazia vale como ausente', () => {
    expect(queueOptionsFromEnv({ QUEUE_MODE: '', URGENT_BURST: '' })).toMatchObject({ mode: 'async', urgentBurst: 3 });
  });

  it.each([
    ['URGENT_BURST', '0'],
    ['URGENT_BURST', '2.5'],
    ['URGENT_BURST', 'abc'],
    ['MAX_ATTEMPTS', '0'],
    ['MAX_ATTEMPTS', '-4'],
    ['RETRY_BACKOFF_MS', '-1'],
    ['PROCESSING_DELAY_MS', 'rápido'],
  ])('recusa %s=%p na inicialização, dizendo qual variável está errada', (name, value) => {
    expect(() => queueOptionsFromEnv({ [name]: value })).toThrow(name);
  });

  it.each([['turbo'], ['manual']])('recusa QUEUE_MODE=%p: só async e sync são modos de produção', (mode) => {
    expect(() => queueOptionsFromEnv({ QUEUE_MODE: mode })).toThrow('QUEUE_MODE');
  });
});
