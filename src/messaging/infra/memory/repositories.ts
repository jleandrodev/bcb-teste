import { ConversationRepository, MessageFilter, MessageRepository } from '../../application/ports';
import { Conversation } from '../../domain/conversation';
import { Message } from '../../domain/message';

export class InMemoryMessageRepository implements MessageRepository {
  // Map preserva a ordem de inserção, e regravar uma chave não muda a posição dela.
  private readonly byId = new Map<string, Message>();

  async save(message: Message): Promise<void> {
    this.byId.set(message.id, message);
  }

  async findById(id: string): Promise<Message | null> {
    return this.byId.get(id) ?? null;
  }

  async list(filter: MessageFilter): Promise<Message[]> {
    return [...this.byId.values()]
      .filter((m) => m.senderId === filter.senderId)
      .filter((m) => !filter.conversationId || m.conversationId === filter.conversationId)
      .filter((m) => !filter.status || m.status === filter.status)
      .filter((m) => !filter.priority || m.priority === filter.priority);
  }

  async listPending(): Promise<Message[]> {
    return [...this.byId.values()].filter((m) => m.status === 'queued' || m.status === 'processing');
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();

  /** Atômico porque não há `await` entre procurar e gravar. */
  async getOrCreate(candidate: Conversation): Promise<Conversation> {
    for (const c of this.byId.values()) {
      if (c.clientId === candidate.clientId && c.recipientId === candidate.recipientId) return c;
    }
    this.byId.set(candidate.id, candidate);
    return candidate;
  }

  async save(conversation: Conversation): Promise<void> {
    this.byId.set(conversation.id, conversation);
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.byId.get(id) ?? null;
  }

  async listByClient(clientId: string): Promise<Conversation[]> {
    return [...this.byId.values()]
      .filter((c) => c.clientId === clientId)
      .sort((a, b) => (b.lastMessageTime?.getTime() ?? 0) - (a.lastMessageTime?.getTime() ?? 0));
  }
}
