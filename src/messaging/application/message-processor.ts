import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ClientsService } from '../../clients';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { Message } from '../domain/message';
import { PriorityMessageQueue } from '../queue/priority-message-queue';
import { MESSAGE_GATEWAY, MESSAGE_QUEUE, MESSAGE_REPOSITORY, QUEUE_OPTIONS } from './ports';
import type { MessageGateway, MessageRepository, QueueItem, QueueOptions } from './ports';

export interface ProcessorStats {
  mode: QueueOptions['mode'];
  running: boolean;
  processed: number;
  failed: number;
  retried: number;
  averageWaitMs: number;
}

/**
 * Worker que consome a fila. Garantia: at-least-once dentro do processo, com
 * retry limitado; ao esgotar as tentativas a mensagem vira `failed` e o valor é estornado.
 *
 * Só um laço de consumo roda por vez (`inFlight`), então a ordem que a fila
 * decide é a ordem em que as mensagens são processadas.
 */
@Injectable()
export class MessageProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessageProcessor.name);
  private inFlight: Promise<number> | null = null;
  private stopped = false;
  private readonly timers = new Set<NodeJS.Timeout>();
  private processed = 0;
  private failed = 0;
  private retried = 0;
  private totalWaitMs = 0;

  constructor(
    @Inject(MESSAGE_QUEUE) private readonly queue: PriorityMessageQueue<QueueItem>,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
    @Inject(MESSAGE_GATEWAY) private readonly gateway: MessageGateway,
    @Inject(QUEUE_OPTIONS) private readonly options: QueueOptions,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly clients: ClientsService,
  ) {}

  /**
   * A fila vive na memória; o estado das mensagens, no banco. Ao iniciar, o que
   * ficou pendente volta para a fila na ordem de criação. Uma mensagem pega em
   * `processing` pela queda do processo volta a `queued`: pode ser entregue duas
   * vezes, nunca zero (at-least-once, ADR-008).
   */
  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.messages.listPending();
    for (const message of pending) {
      if (message.status === 'processing') await this.messages.save(message.transitionTo('queued', this.clock.now()));
      this.queue.enqueue({ messageId: message.id, priority: message.priority, enqueuedAt: message.timestamp.getTime() }, message.priority);
    }
    if (pending.length > 0) {
      this.logger.log(`fila reconstruída com ${pending.length} mensagem(ns) pendente(s)`);
      await this.onEnqueued();
    }
  }

  /**
   * Chamado por quem enfileira. Decide, pelo modo, quando o consumo acontece.
   * Um erro durante o consumo é registrado em log e não chega a quem enfileirou:
   * a mensagem já foi cobrada e gravada, e o envio dela foi aceito.
   */
  async onEnqueued(): Promise<void> {
    if (this.options.mode === 'sync') {
      await this.drainLoggingErrors();
    } else if (this.options.mode === 'async') {
      // setImmediate devolve o controle ao event loop: o request responde 201 antes do processamento.
      setImmediate(() => void this.drainLoggingErrors());
    }
  }

  /** Consome até a fila esvaziar. Chamadas concorrentes compartilham o mesmo laço. */
  drain(): Promise<number> {
    if (!this.inFlight) {
      this.inFlight = this.consumeAll().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async drainLoggingErrors(): Promise<void> {
    await this.drain().catch((error) => this.logger.error(`consumo da fila interrompido: ${String(error)}`));
  }

  private async consumeAll(): Promise<number> {
    let count = 0;
    while (!this.stopped && (await this.processNext())) count += 1;
    return count;
  }

  /**
   * Processa um item. Devolve false quando a fila está vazia.
   *
   * Orquestra três passos com responsabilidades distintas: tentar a entrega,
   * registrar o sucesso, tratar a falha do provedor. Só a entrega decide entre
   * os dois caminhos; um erro ao GRAVAR o resultado é falha de infraestrutura e
   * propaga, sem virar retry nem estorno de algo que foi entregue.
   */
  async processNext(): Promise<boolean> {
    const item = this.queue.dequeue();
    if (!item) return false;
    const queued = await this.messages.findById(item.messageId);
    if (!queued || queued.status !== 'queued') return true; // item órfão ou já tratado: descarta

    this.totalWaitMs += Math.max(0, this.clock.now().getTime() - item.enqueuedAt);
    const processing = queued.transitionTo('processing', this.clock.now()).withAttempt();
    await this.messages.save(processing);

    const failure = await this.deliver(processing);
    if (failure) {
      await this.handleFailure(processing, item, failure);
    } else {
      await this.recordDelivery(processing);
    }
    return true;
  }

  /** Fala com o provedor. Devolve o erro em vez de lançar: falha de entrega é um resultado esperado. */
  private async deliver(message: Message): Promise<Error | null> {
    try {
      await this.gateway.deliver(message);
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async recordDelivery(processing: Message): Promise<void> {
    const sent = processing.transitionTo('sent', this.clock.now());
    await this.messages.save(sent);
    // O gateway simulado confirma a entrega na hora; num provedor real isso viria por webhook.
    await this.messages.save(sent.transitionTo('delivered', this.clock.now()));
    this.processed += 1;
  }

  private async handleFailure(message: Message, item: QueueItem, failure: Error): Promise<void> {
    if (message.attempts < this.options.maxAttempts) {
      this.retried += 1;
      this.logger.warn(`falha ao entregar ${message.id} (tentativa ${message.attempts}/${this.options.maxAttempts}): ${failure.message}`);
      await this.messages.save(message.transitionTo('queued', this.clock.now()));
      this.requeue(item, this.options.retryBackoffMs * 2 ** (message.attempts - 1));
      return;
    }
    this.failed += 1;
    this.logger.error(`mensagem ${message.id} falhou definitivamente: ${failure.message}`);
    // Estorna antes de registrar a falha: se o processo cair entre os dois passos, a
    // mensagem volta à fila no reinício e o estorno, idempotente, não se repete.
    await this.clients.refund(message.senderId, message.cost, message.id);
    await this.messages.save(message.transitionTo('failed', this.clock.now()));
  }

  /** Reenfileira após o backoff (exponencial). Com backoff 0 volta imediatamente ao fim do seu nível. */
  private requeue(item: QueueItem, delayMs: number): void {
    const put = () => this.queue.enqueue({ ...item, enqueuedAt: this.clock.now().getTime() }, item.priority);
    if (delayMs <= 0) {
      put();
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      put();
      void this.onEnqueued();
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  stats(): ProcessorStats {
    const handled = this.processed + this.failed + this.retried;
    return {
      mode: this.options.mode,
      running: this.inFlight !== null,
      processed: this.processed,
      failed: this.failed,
      retried: this.retried,
      averageWaitMs: handled === 0 ? 0 : Math.round(this.totalWaitMs / handled),
    };
  }

  /** Para de consumir e espera a entrega em andamento terminar, para não deixar mensagem em `processing`. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.inFlight?.catch(() => undefined);
  }
}
