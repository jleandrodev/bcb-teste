import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, ClientsService } from '../../clients';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { NotFoundError, ValidationError } from '../../shared/domain/errors';
import { Conversation } from '../domain/conversation';
import { Message, costOf } from '../domain/message';
import { PriorityMessageQueue } from '../queue/priority-message-queue';
import type { Priority } from '../queue/priority-message-queue';
import { MessageProcessor } from './message-processor';
import { CONVERSATION_REPOSITORY, MESSAGE_QUEUE, MESSAGE_REPOSITORY } from './ports';
import type { ConversationRepository, MessageRepository, QueueItem } from './ports';

export interface SendMessageInput {
  conversationId?: string;
  recipientId?: string;
  recipientName?: string;
  content: string;
  priority: Priority;
}

export interface SendMessageOutput {
  message: Message;
  client: Client;
  estimatedDelivery: Date;
}

/** Tempo médio assumido por mensagem. Serve só para a estimativa de entrega, que é uma aproximação. */
const ESTIMATED_MS_PER_MESSAGE = 500;

/**
 * Caso de uso central do desafio. A ordem dos passos é a das regras de negócio:
 * validar → cobrar → gravar → enfileirar.
 *
 * Nada é gravado antes da cobrança: um envio recusado (402, 403, 404) não deixa
 * rastro. Depois da cobrança há uma única gravação que pode falhar (a mensagem);
 * se falhar, o valor é estornado. Cobrança e mensagem pertencem a módulos
 * diferentes, por isso compensação e não transação única (ADR-006).
 */
@Injectable()
export class SendMessageUseCase {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MESSAGE_QUEUE) private readonly queue: PriorityMessageQueue<QueueItem>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly clients: ClientsService,
    private readonly processor: MessageProcessor,
  ) {}

  async execute(sender: Client, input: SendMessageInput): Promise<SendMessageOutput> {
    const existing = await this.requestedConversation(sender, input);
    const messageId = randomUUID();
    const cost = costOf(input.priority);

    const charged = await this.clients.charge(sender.id, cost, messageId);
    const estimatedDelivery = this.estimateDelivery(input.priority);
    let message: Message;
    try {
      message = await this.record(sender, existing, messageId, input);
      this.queue.enqueue({ messageId, priority: input.priority, enqueuedAt: message.timestamp.getTime() }, input.priority);
    } catch (error) {
      await this.clients.refund(sender.id, cost, messageId);
      throw error;
    }
    await this.processor.onEnqueued();

    return { message: (await this.messages.findById(messageId)) ?? message, client: charged, estimatedDelivery };
  }

  /** Só leitura: confere o destino pedido. Devolve a conversa quando o envio a indicou pelo id. */
  private async requestedConversation(sender: Client, input: SendMessageInput): Promise<Conversation | null> {
    if (input.conversationId) {
      const found = await this.conversations.findById(input.conversationId);
      // Conversa de outro cliente responde 404, não 403: não revelamos que o id existe.
      if (!found || found.clientId !== sender.id) throw new NotFoundError('Conversation', input.conversationId);
      return found;
    }
    if (!input.recipientId) throw new ValidationError('RECIPIENT_REQUIRED', 'Informe conversationId ou recipientId');
    return null;
  }

  private async record(sender: Client, existing: Conversation | null, messageId: string, input: SendMessageInput): Promise<Message> {
    const recipientId = input.recipientId as string; // garantido por requestedConversation quando não há conversa
    const conversation =
      existing ??
      (await this.conversations.getOrCreate({
        id: randomUUID(),
        clientId: sender.id,
        recipientId,
        recipientName: input.recipientName ?? recipientId,
      }));
    const message = Message.create({
      id: messageId,
      conversationId: conversation.id,
      senderId: sender.id,
      recipientId: conversation.recipientId,
      content: input.content,
      priority: input.priority,
      now: this.clock.now(),
    });
    await this.messages.save(message);
    return message;
  }

  /** Aproximação: quantas mensagens saem antes desta (as do próprio nível; para uma normal, também as urgentes). */
  private estimateDelivery(priority: Priority): Date {
    const { urgent, total } = this.queue.snapshot();
    const ahead = priority === 'urgent' ? urgent : total;
    return new Date(this.clock.now().getTime() + (ahead + 1) * ESTIMATED_MS_PER_MESSAGE);
  }
}
