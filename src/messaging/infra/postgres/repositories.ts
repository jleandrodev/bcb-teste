import { Money } from '../../../shared/domain/money';
import { Database } from '../../../shared/infra/postgres/database';
import { ConversationRepository, MessageFilter, MessageRepository } from '../../application/ports';
import { Conversation } from '../../domain/conversation';
import { Message, MessageStatus } from '../../domain/message';
import type { Priority } from '../../queue/priority-message-queue';

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: Date;
  priority: Priority;
  status: MessageStatus;
  cost_cents: string; // BIGINT chega como string no driver
  attempts: number;
  history: { status: MessageStatus; at: string }[];
}

function toMessage(row: MessageRow): Message {
  return new Message({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    content: row.content,
    timestamp: row.created_at,
    priority: row.priority,
    status: row.status,
    cost: Money.fromCents(Number(row.cost_cents)),
    attempts: row.attempts,
    history: row.history.map((change) => ({ status: change.status, at: new Date(change.at) })),
  });
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  /** Insere ou, se a mensagem já existe, atualiza só o que muda ao longo da vida dela. */
  async save(message: Message): Promise<void> {
    await this.db.query(
      `INSERT INTO messaging_message (id, conversation_id, sender_id, recipient_id, content, created_at, priority, status, cost_cents, attempts, history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, history = EXCLUDED.history`,
      [
        message.id,
        message.conversationId,
        message.senderId,
        message.recipientId,
        message.content,
        message.timestamp,
        message.priority,
        message.status,
        message.cost.cents,
        message.attempts,
        JSON.stringify(message.history),
      ],
    );
  }

  async findById(id: string): Promise<Message | null> {
    const rows = await this.db.query<MessageRow>('SELECT * FROM messaging_message WHERE id = $1', [id]);
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async list(filter: MessageFilter): Promise<Message[]> {
    // Filtro ausente vira NULL e a condição correspondente deixa de restringir.
    const rows = await this.db.query<MessageRow>(
      `SELECT * FROM messaging_message
        WHERE sender_id = $1
          AND ($2::text IS NULL OR conversation_id = $2)
          AND ($3::text IS NULL OR status = $3)
          AND ($4::text IS NULL OR priority = $4)
        ORDER BY seq`,
      [filter.senderId, filter.conversationId ?? null, filter.status ?? null, filter.priority ?? null],
    );
    return rows.map(toMessage);
  }

  async listPending(): Promise<Message[]> {
    const rows = await this.db.query<MessageRow>(`SELECT * FROM messaging_message WHERE status IN ('queued', 'processing') ORDER BY seq`);
    return rows.map(toMessage);
  }
}

interface ConversationRow {
  id: string;
  client_id: string;
  recipient_id: string;
  recipient_name: string;
  last_message_content: string | null;
  last_message_time: Date | null;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    clientId: row.client_id,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    lastMessageContent: row.last_message_content,
    lastMessageTime: row.last_message_time,
  };
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  /**
   * A restrição UNIQUE (client_id, recipient_id) decide a corrida: quem perde o
   * INSERT não grava nada e, na leitura seguinte, recebe a conversa de quem ganhou.
   */
  async getOrCreate(candidate: Conversation): Promise<Conversation> {
    await this.db.query(
      `INSERT INTO messaging_conversation (id, client_id, recipient_id, recipient_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, recipient_id) DO NOTHING`,
      [candidate.id, candidate.clientId, candidate.recipientId, candidate.recipientName],
    );
    const rows = await this.db.query<ConversationRow>('SELECT * FROM messaging_conversation WHERE client_id = $1 AND recipient_id = $2', [
      candidate.clientId,
      candidate.recipientId,
    ]);
    return toConversation(rows[0]);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.db.query(
      'UPDATE messaging_conversation SET recipient_name = $2, last_message_content = $3, last_message_time = $4 WHERE id = $1',
      [conversation.id, conversation.recipientName, conversation.lastMessageContent, conversation.lastMessageTime],
    );
  }

  async findById(id: string): Promise<Conversation | null> {
    const rows = await this.db.query<ConversationRow>('SELECT * FROM messaging_conversation WHERE id = $1', [id]);
    return rows[0] ? toConversation(rows[0]) : null;
  }

  async listByClient(clientId: string): Promise<Conversation[]> {
    const rows = await this.db.query<ConversationRow>(
      'SELECT * FROM messaging_conversation WHERE client_id = $1 ORDER BY last_message_time DESC NULLS LAST',
      [clientId],
    );
    return rows.map(toConversation);
  }
}
