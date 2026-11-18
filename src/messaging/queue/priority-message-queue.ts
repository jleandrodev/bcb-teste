import { LinkedQueue } from './linked-queue';

export type Priority = 'normal' | 'urgent';

export interface QueueSnapshot {
  urgent: number;
  normal: number;
  total: number;
  enqueued: number;
  starvationPreventions: number;
  urgentBurst: number;
}

/**
 * Fila de dois níveis com proteção contra starvation.
 *
 * Regra: urgentes saem antes das normais, mas depois de `urgentBurst` urgentes
 * seguidas COM normais esperando, a próxima a sair é uma normal. Assim uma
 * enxurrada de urgentes atrasa as normais, mas nunca as trava para sempre:
 * a espera máxima de uma normal na frente da fila é de `urgentBurst` itens.
 *
 * Dentro de cada nível a ordem é FIFO. Todas as operações são O(1).
 */
export class PriorityMessageQueue<T> {
  private readonly urgent = new LinkedQueue<T>();
  private readonly normal = new LinkedQueue<T>();
  private readonly urgentBurst: number;
  private consecutiveUrgent = 0;
  private enqueued = 0;
  private starvationPreventions = 0;

  constructor(options: { urgentBurst?: number } = {}) {
    const burst = options.urgentBurst ?? 3;
    if (!Number.isInteger(burst) || burst < 1) {
      throw new RangeError('urgentBurst deve ser um inteiro >= 1');
    }
    this.urgentBurst = burst;
  }

  enqueue(item: T, priority: Priority): void {
    (priority === 'urgent' ? this.urgent : this.normal).enqueue(item);
    this.enqueued += 1;
  }

  dequeue(): T | undefined {
    const normalWaiting = !this.normal.isEmpty();
    const urgentWaiting = !this.urgent.isEmpty();
    if (!normalWaiting && !urgentWaiting) return undefined;

    const mustServeNormal = normalWaiting && this.consecutiveUrgent >= this.urgentBurst;
    if (urgentWaiting && !mustServeNormal) {
      // Só conta a rajada quando há normal esperando: sem ninguém para "passar fome", não há o que proteger.
      this.consecutiveUrgent = normalWaiting ? this.consecutiveUrgent + 1 : 0;
      return this.urgent.dequeue();
    }

    if (urgentWaiting) this.starvationPreventions += 1;
    this.consecutiveUrgent = 0;
    return this.normal.dequeue();
  }

  get size(): number {
    return this.urgent.size + this.normal.size;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  snapshot(): QueueSnapshot {
    return {
      urgent: this.urgent.size,
      normal: this.normal.size,
      total: this.size,
      enqueued: this.enqueued,
      starvationPreventions: this.starvationPreventions,
      urgentBurst: this.urgentBurst,
    };
  }
}
