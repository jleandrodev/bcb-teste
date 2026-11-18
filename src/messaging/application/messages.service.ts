import { Inject, Injectable } from '@nestjs/common';
import { Client } from '../../clients';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { NotFoundError } from '../../shared/domain/errors';
import { Conversation } from '../domain/conversation';
import { Message, MessageStatus } from '../domain/message';
import type { Priority } from '../queue/priority-message-queue';
import { CONVERSATION_REPOSITORY, MESSAGE_REPOSITORY } from './ports';
import type { ConversationRepository, ConversationSummary, MessageRepository } from './ports';

/** Conversa como o cliente a vê: os dados dela mais o que se deriva das mensagens. */
export interface ConversationView extends Conversation {
  lastMessageContent: string | null;
  lastMessageTime: Date | null;
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
    // Mensagem de outro cliente responde 404, não 403: não revelamos que o id existe.
    if (!message || message.senderId !== client.id) throw new NotFoundError('Message', id);
    return message;
  }

  /** Simula o destinatário lendo a mensagem (delivered → read). */
  async markRead(client: Client, id: string): Promise<Message> {
    const read = (await this.get(client, id)).transitionTo('read', this.clock.now());
    await this.messages.save(read);
    return read;
  }

  /** Da conversa com mensagem mais recente para a mais antiga; as ainda sem mensagem ficam por último. */
  async listConversations(client: Client): Promise<ConversationView[]> {
    const [conversations, summaries] = await Promise.all([this.conversations.listByClient(client.id), this.messages.summarize(client.id)]);
    return conversations
      .map((conversation) => this.view(conversation, summaries))
      .sort((a, b) => (b.lastMessageTime?.getTime() ?? 0) - (a.lastMessageTime?.getTime() ?? 0));
  }

  async getConversation(client: Client, id: string): Promise<ConversationView> {
    const conversation = await this.conversations.findById(id);
    if (!conversation || conversation.clientId !== client.id) throw new NotFoundError('Conversation', id);
    return this.view(conversation, await this.messages.summarize(client.id));
  }

  async conversationMessages(client: Client, id: string): Promise<Message[]> {
    await this.getConversation(client, id);
    return this.messages.list({ senderId: client.id, conversationId: id });
  }

  private view(conversation: Conversation, summaries: ConversationSummary[]): ConversationView {
    const summary = summaries.find((s) => s.conversationId === conversation.id);
    return {
      ...conversation,
      lastMessageContent: summary?.lastMessageContent ?? null,
      lastMessageTime: summary?.lastMessageTime ?? null,
      unreadCount: summary?.unreadCount ?? 0,
    };
  }
}
