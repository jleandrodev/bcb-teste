import { Conversation } from '../domain/conversation';
import { Message, MessageStatus } from '../domain/message';
import type { Priority } from '../queue/priority-message-queue';

export interface MessageFilter {
  senderId: string;
  conversationId?: string;
  status?: MessageStatus;
  priority?: Priority;
}

/** O que se sabe de uma conversa olhando as mensagens dela. */
export interface ConversationSummary {
  conversationId: string;
  lastMessageContent: string;
  lastMessageTime: Date;
  /** Mensagens entregues que o destinatário ainda não leu. */
  unreadCount: number;
}

export interface MessageRepository {
  save(message: Message): Promise<void>;
  findById(id: string): Promise<Message | null>;
  /** Mensagens do remetente que atendem aos filtros, na ordem em que foram criadas. */
  list(filter: MessageFilter): Promise<Message[]>;
  /** Mensagens `queued` ou `processing`, na ordem de criação: o que a fila precisa recuperar ao iniciar. */
  listPending(): Promise<Message[]>;
  /**
   * Última mensagem e não lidas de cada conversa do remetente que tem mensagens.
   * É calculado a partir das mensagens: não há contador nem cópia para dessincronizar.
   */
  summarize(senderId: string): Promise<ConversationSummary[]>;
}

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

export interface ConversationRepository {
  /**
   * Devolve a conversa do par (cliente, destinatário); se não existir, grava a candidata.
   * Atômico: dois primeiros envios simultâneos ao mesmo destinatário resultam em uma só conversa.
   */
  getOrCreate(candidate: Conversation): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  /** Conversas do cliente, na ordem em que foram criadas. */
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
  /**
   * async: worker em segundo plano (padrão); sync: processa dentro da requisição;
   * manual: só quando chamado. `manual` existe para os testes controlarem a fila
   * e não é aceito por variável de ambiente.
   */
  mode: QueueMode;
  urgentBurst: number;
  maxAttempts: number;
  retryBackoffMs: number;
  processingDelayMs: number;
}

export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

/**
 * Lê a configuração da fila. Valor inválido interrompe a inicialização com uma
 * mensagem clara: configuração errada corrigida em silêncio vira comportamento
 * que ninguém pediu.
 */
export function queueOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): QueueOptions {
  const integer = (name: string, fallback: number, min: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min)
      throw new Error(`${name} deve ser um inteiro maior ou igual a ${min} (recebido: "${raw}")`);
    return value;
  };
  const mode = env.QUEUE_MODE || 'async';
  if (mode !== 'async' && mode !== 'sync') throw new Error(`QUEUE_MODE deve ser "async" ou "sync" (recebido: "${mode}")`);
  return {
    mode,
    urgentBurst: integer('URGENT_BURST', 3, 1),
    maxAttempts: integer('MAX_ATTEMPTS', 3, 1),
    retryBackoffMs: integer('RETRY_BACKOFF_MS', 200, 0),
    processingDelayMs: integer('PROCESSING_DELAY_MS', 0, 0),
  };
}
