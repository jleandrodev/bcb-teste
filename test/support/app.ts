import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MessageProcessor } from '../../src/messaging/application/message-processor';
import { MESSAGE_GATEWAY, QUEUE_OPTIONS, QueueOptions } from '../../src/messaging/application/ports';
import { CLOCK, Clock } from '../../src/shared/domain/clock';
import { resetDatabase } from './database';
import { FakeMessageGateway } from './fake-message-gateway';

/** Relógio que o teste adianta: é como se atravessa uma virada de mês em milissegundos. */
export class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(date: Date): void {
    this.current = date;
  }
}

export interface TestApp {
  app: INestApplication;
  /** Cliente HTTP ligado à aplicação. */
  api: ReturnType<typeof request>;
  gateway: FakeMessageGateway;
  processor: MessageProcessor;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Padrão: modo `manual` (o teste decide quando a fila anda) e retry sem espera. */
  queue?: Partial<QueueOptions>;
  gateway?: FakeMessageGateway;
  clock?: Clock;
  /** Mantém o que já está no banco (para simular reinício do processo). */
  keepData?: boolean;
  /** Troca de provedores além dos padrões, para cenários de falha de infraestrutura. */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Sobe a aplicação inteira (o mesmo AppModule e a mesma configuração de `main.ts`).
 * Só duas coisas são trocadas: o provedor externo de entrega e, se pedido, o relógio.
 * Com PERSISTENCE=postgres os repositórios são os de produção.
 */
export async function startApp(options: TestAppOptions = {}): Promise<TestApp> {
  if (!options.keepData) await resetDatabase();
  const gateway = options.gateway ?? new FakeMessageGateway();
  const queue: QueueOptions = { mode: 'manual', urgentBurst: 3, maxAttempts: 3, retryBackoffMs: 0, processingDelayMs: 0, ...options.queue };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MESSAGE_GATEWAY)
    .useValue(gateway)
    .overrideProvider(QUEUE_OPTIONS)
    .useValue(queue);
  if (options.clock) builder = builder.overrideProvider(CLOCK).useValue(options.clock);
  if (options.customize) builder = options.customize(builder);

  const app = configureApp((await builder.compile()).createNestApplication({ logger: false }));
  await app.init();
  return {
    app,
    api: request(app.getHttpServer()),
    gateway,
    processor: app.get(MessageProcessor),
    close: () => app.close(),
  };
}

/** Espera uma condição assíncrona ficar verdadeira (para o worker em segundo plano). */
export async function waitFor(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`condição não atendida em ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
