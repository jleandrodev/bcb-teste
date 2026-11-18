import { MessageGateway } from '../../src/messaging/application/ports';
import { Message } from '../../src/messaging/domain/message';

/**
 * O único dublê da suíte (ADR-010). Fica no lugar do provedor externo de entrega,
 * que o desafio não fornece. É uma implementação real da porta `MessageGateway`,
 * escrita à mão: guarda o que entregou e falha quando o teste manda.
 */
export class FakeMessageGateway implements MessageGateway {
  /** Conteúdo das mensagens entregues, na ordem de entrega. */
  readonly delivered: string[] = [];
  /** Maior número de entregas em andamento ao mesmo tempo. */
  maxConcurrent = 0;
  delayMs = 0;
  private failuresLeft = 0;
  private inProgress = 0;
  private interruption: (() => Promise<unknown>) | null = null;

  failNext(times: number): this {
    this.failuresLeft = times;
    return this;
  }

  failAlways(): this {
    return this.failNext(Number.POSITIVE_INFINITY);
  }

  /** Roda `action` no meio da próxima entrega: é como o teste age "enquanto a fila está andando". */
  duringNextDelivery(action: () => Promise<unknown>): this {
    this.interruption = action;
    return this;
  }

  async deliver(message: Message): Promise<void> {
    this.inProgress += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inProgress);
    try {
      const interruption = this.interruption;
      this.interruption = null;
      if (interruption) await interruption();
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        throw new Error('provedor indisponível');
      }
      this.delivered.push(message.content);
    } finally {
      this.inProgress -= 1;
    }
  }
}
