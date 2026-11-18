import { Conversation } from '../domain/conversation';
import { Message, MessageStatus } from '../domain/message';
import type { Priority } from '../queue/priority-message-queue';

export interface MessageFilter {
  senderId: string;
  conversationId?: string;
  status?: MessageStatus;
  priority?: Priority;
}

export interface MessageRepository {
  save(message: Message): Promise<void>;
  findById(id: string): Promise<Message | null>;
  /** Mensagens do remetente que atendem aos filtros, na ordem em que foram criadas. */
  list(filter: MessageFilter): Promise<Message[]>;
  /** Mensagens `queued` ou `processing`, na ordem de criação: o que a fila precisa recuperar ao iniciar. */
  listPending(): Promise<Message[]>;
}

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface ConversationRepository {
  /**
   * Devolve a conversa do par (cliente, destinatário); se não existir, grava a candidata.
   * Atômico: dois primeiros envios simultâneos ao mesmo destinatário resultam em uma só conversa.
   */
  getOrCreate(candidate: Conversation): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
  findById(id: string): Promise<Conversation | null>;
  /** Conversas do cliente, da mais recente para a mais antiga. */
  listByClient(clientId: string): Promise<Conversation[]>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');

/** Porta de saída para o "mundo externo": quem de fato entrega a mensagem. Aqui é simulado. */
export interface MessageGateway {
  deliver(message: Message): Promise<void>;
}

export const MESSAGE_GATEWAY = Symbol('MESSAGE_GATEWAY');

/** O que trafega na fila: só a referência e metadados, não a mensagem inteira. */
export interface QueueItem {
  messageId: string;
  priority: Priority;
  enqueuedAt: number;
}

export const MESSAGE_QUEUE = Symbol('MESSAGE_QUEUE');

export type QueueMode = 'sync' | 'async' | 'manual';

export interface QueueOptions {
  /** sync: processa dentro do request (Parte 1); async: worker em background (Parte 3); manual: só quando chamado (testes). */
  mode: QueueMode;
  urgentBurst: number;
  maxAttempts: number;
  retryBackoffMs: number;
  processingDelayMs: number;
}

export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

export function queueOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): QueueOptions {
  const int = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const mode = env.QUEUE_MODE === 'sync' || env.QUEUE_MODE === 'manual' ? env.QUEUE_MODE : 'async';
  return {
    mode,
    urgentBurst: Math.max(1, int(env.URGENT_BURST, 3)),
    maxAttempts: Math.max(1, int(env.MAX_ATTEMPTS, 3)),
    retryBackoffMs: int(env.RETRY_BACKOFF_MS, 200),
    processingDelayMs: int(env.PROCESSING_DELAY_MS, 0),
  };
}
