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

/** Tempo médio assumido por mensagem, usado só para estimar a entrega. */
const ESTIMATED_MS_PER_MESSAGE = 500;

/**
 * Caso de uso central do desafio. A ordem dos passos é a das regras de negócio:
 * validar → cobrar → registrar → enfileirar. Se algo falhar depois da cobrança,
 * o valor é estornado (compensação), porque não há transação única entre os passos.
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
    const conversation = await this.resolveConversation(sender, input);
    const now = this.clock.now();
    const message = Message.create({
      id: randomUUID(),
      conversationId: conversation.id,
      senderId: sender.id,
      recipientId: conversation.recipientId,
      content: input.content,
      priority: input.priority,
      now,
    });

    const charged = await this.clients.charge(sender.id, costOf(input.priority), message.id);
    const ahead = this.queue.size;
    try {
      await this.messages.save(message);
      await this.conversations.save({ ...conversation, lastMessageContent: message.content, lastMessageTime: now });
      this.queue.enqueue({ messageId: message.id, priority: message.priority, enqueuedAt: now.getTime() }, message.priority);
    } catch (error) {
      await this.clients.refund(sender.id, message.cost, message.id);
      throw error;
    }
    await this.processor.onEnqueued();

    return {
      message: (await this.messages.findById(message.id)) ?? message,
      client: charged,
      estimatedDelivery: new Date(now.getTime() + (ahead + 1) * ESTIMATED_MS_PER_MESSAGE),
    };
  }

  private async resolveConversation(sender: Client, input: SendMessageInput): Promise<Conversation> {
    if (input.conversationId) {
      const found = await this.conversations.findById(input.conversationId);
      // Conversa de outro cliente responde 404, não 403: não revelamos que o id existe.
      if (!found || found.clientId !== sender.id) throw new NotFoundError('Conversation', input.conversationId);
      return found;
    }
    if (!input.recipientId) {
      throw new ValidationError('RECIPIENT_REQUIRED', 'Informe conversationId ou recipientId');
    }
    return this.conversations.getOrCreate({
      id: randomUUID(),
      clientId: sender.id,
      recipientId: input.recipientId,
      recipientName: input.recipientName ?? input.recipientId,
      lastMessageContent: null,
      lastMessageTime: null,
    });
  }
}
