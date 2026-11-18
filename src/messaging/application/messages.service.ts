import { Inject, Injectable } from '@nestjs/common';
import { Client } from '../../clients';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { NotFoundError } from '../../shared/domain/errors';
import { Conversation } from '../domain/conversation';
import { Message, MessageStatus } from '../domain/message';
import type { Priority } from '../queue/priority-message-queue';
import { CONVERSATION_REPOSITORY, MESSAGE_REPOSITORY } from './ports';
import type { ConversationRepository, MessageRepository } from './ports';

export interface ConversationView extends Conversation {
  unreadCount: number;
}

/** Consultas (leitura) de mensagens e conversas, sempre restritas ao cliente autenticado. */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(client: Client, filter: { conversationId?: string; status?: MessageStatus; priority?: Priority }): Promise<Message[]> {
    return this.messages.list({ senderId: client.id, ...filter });
  }

  async get(client: Client, id: string): Promise<Message> {
    const message = await this.messages.findById(id);
    if (!message || message.senderId !== client.id) throw new NotFoundError('Message', id);
    return message;
  }

  /** Simula o destinatário lendo a mensagem (delivered → read). */
  async markRead(client: Client, id: string): Promise<Message> {
    const read = (await this.get(client, id)).transitionTo('read', this.clock.now());
    await this.messages.save(read);
    return read;
  }

  async listConversations(client: Client): Promise<ConversationView[]> {
    const conversations = await this.conversations.listByClient(client.id);
    return Promise.all(conversations.map((c) => this.withUnread(c)));
  }

  async getConversation(client: Client, id: string): Promise<ConversationView> {
    const conversation = await this.conversations.findById(id);
    if (!conversation || conversation.clientId !== client.id) throw new NotFoundError('Conversation', id);
    return this.withUnread(conversation);
  }

  async conversationMessages(client: Client, id: string): Promise<Message[]> {
    await this.getConversation(client, id);
    return this.messages.list({ senderId: client.id, conversationId: id });
  }

  /** Não lidas = entregues que o destinatário ainda não leu. Calculado na leitura, sem contador para dessincronizar. */
  private async withUnread(conversation: Conversation): Promise<ConversationView> {
    const delivered = await this.messages.list({ senderId: conversation.clientId, conversationId: conversation.id, status: 'delivered' });
    return { ...conversation, unreadCount: delivered.length };
  }
}
