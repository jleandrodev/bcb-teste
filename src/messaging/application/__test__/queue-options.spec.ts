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

  it('valor inválido não derruba a aplicação: volta ao padrão', () => {
    const options = queueOptionsFromEnv({ QUEUE_MODE: 'turbo', URGENT_BURST: 'abc', MAX_ATTEMPTS: '-4' });

    expect(options.mode).toBe('async');
    expect(options.urgentBurst).toBe(3);
    expect(options.maxAttempts).toBe(3);
  });

  it('rajada e tentativas nunca ficam abaixo de 1', () => {
    const options = queueOptionsFromEnv({ URGENT_BURST: '0', MAX_ATTEMPTS: '0' });

    expect(options.urgentBurst).toBe(1);
    expect(options.maxAttempts).toBe(1);
  });
});
