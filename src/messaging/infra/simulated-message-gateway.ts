import { Logger } from '@nestjs/common';
import { MessageGateway } from '../application/ports';
import { Message } from '../domain/message';

/** Simula o envio: espera um pouco e registra em log. Não há provedor real no desafio. */
export class SimulatedMessageGateway implements MessageGateway {
  private readonly logger = new Logger('MessageGateway');

  constructor(private readonly delayMs = 0) {}

  async deliver(message: Message): Promise<void> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.logger.log(`entregue ${message.id} (${message.priority}) para ${message.recipientId}`);
  }
}
