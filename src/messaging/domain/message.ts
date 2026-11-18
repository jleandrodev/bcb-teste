import { ConflictError } from '../../shared/domain/errors';
import { Money } from '../../shared/domain/money';
import type { Priority } from '../queue/priority-message-queue';

export type MessageStatus = 'queued' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Máquina de estados da mensagem. A tabela é a única fonte de verdade sobre
 * quais transições existem; `processing → queued` é o caminho do retry.
 */
const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  queued: ['processing'],
  processing: ['sent', 'failed', 'queued'],
  sent: ['delivered'],
  delivered: ['read'],
  read: [],
  failed: [],
};

const COST_CENTS: Record<Priority, number> = { normal: 25, urgent: 50 };

export function costOf(priority: Priority): Money {
  return Money.fromCents(COST_CENTS[priority]);
}

export interface StatusChange {
  status: MessageStatus;
  at: Date;
}

export interface MessageProps {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: Date;
  priority: Priority;
  status: MessageStatus;
  cost: Money;
  attempts: number;
  history: readonly StatusChange[];
}

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly content: string;
  readonly timestamp: Date;
  readonly priority: Priority;
  readonly status: MessageStatus;
  readonly cost: Money;
  readonly attempts: number;
  readonly history: readonly StatusChange[];

  constructor(props: MessageProps) {
    this.id = props.id;
    this.conversationId = props.conversationId;
    this.senderId = props.senderId;
    this.recipientId = props.recipientId;
    this.content = props.content;
    this.timestamp = props.timestamp;
    this.priority = props.priority;
    this.status = props.status;
    this.cost = props.cost;
    this.attempts = props.attempts;
    this.history = props.history;
  }

  static create(input: {
    id: string;
    conversationId: string;
    senderId: string;
    recipientId: string;
    content: string;
    priority: Priority;
    now: Date;
  }): Message {
    return new Message({
      ...input,
      timestamp: input.now,
      status: 'queued',
      cost: costOf(input.priority),
      attempts: 0,
      history: [{ status: 'queued', at: input.now }],
    });
  }

  canTransitionTo(next: MessageStatus): boolean {
    return TRANSITIONS[this.status].includes(next);
  }

  transitionTo(next: MessageStatus, at: Date): Message {
    if (!this.canTransitionTo(next)) {
      throw new ConflictError('INVALID_STATUS_TRANSITION', `Transição inválida: ${this.status} → ${next}`);
    }
    return new Message({ ...this, status: next, history: [...this.history, { status: next, at }] });
  }

  withAttempt(): Message {
    return new Message({ ...this, attempts: this.attempts + 1 });
  }
}
