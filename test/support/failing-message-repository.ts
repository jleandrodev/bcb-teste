import { InMemoryMessageRepository } from '../../src/messaging/infra/memory/repositories';
import { Message, MessageStatus } from '../../src/messaging/domain/message';

/**
 * Repositório real (em memória) que simula uma falha de infraestrutura: a próxima
 * gravação de uma mensagem no status indicado lança, uma única vez.
 */
export class FailingMessageRepository extends InMemoryMessageRepository {
  private failOn: MessageStatus | null = null;

  failNextSaveOf(status: MessageStatus): this {
    this.failOn = status;
    return this;
  }

  async save(message: Message): Promise<void> {
    if (message.status === this.failOn) {
      this.failOn = null;
      throw new Error('banco indisponível');
    }
    return super.save(message);
  }
}
