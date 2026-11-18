import { LinkedQueue } from '../linked-queue';

function drain<T>(queue: LinkedQueue<T>): T[] {
  const out: T[] = [];
  while (!queue.isEmpty()) out.push(queue.dequeue() as T);
  return out;
}

interface Fifo {
  enqueue(value: number): void;
  dequeue(): number | undefined;
}

/** A alternativa ingênua: array com shift(), que reindexa todos os elementos a cada remoção. */
class ArrayShiftQueue implements Fifo {
  private readonly items: number[] = [];

  enqueue(value: number): void {
    this.items.push(value);
  }

  dequeue(): number | undefined {
    return this.items.shift();
  }
}

/** Tempo, em ms, para enfileirar e depois desenfileirar `n` itens. */
function timeToCycle(queue: Fifo, n: number): number {
  const started = performance.now();
  for (let i = 0; i < n; i += 1) queue.enqueue(i);
  for (let i = 0; i < n; i += 1) queue.dequeue();
  return performance.now() - started;
}

describe('LinkedQueue', () => {
  it('entrega na ordem de chegada (FIFO)', () => {
    const queue = new LinkedQueue<string>();
    ['a', 'b', 'c'].forEach((item) => queue.enqueue(item));

    expect(drain(queue)).toEqual(['a', 'b', 'c']);
  });

  it('vazia devolve undefined em vez de lançar, e continua utilizável', () => {
    const queue = new LinkedQueue<number>();

    expect(queue.dequeue()).toBeUndefined();
    expect(queue.isEmpty()).toBe(true);

    queue.enqueue(1);
    expect(queue.dequeue()).toBe(1);
  });

  it('esvaziar e voltar a encher não perde itens (o ponteiro do fim é refeito)', () => {
    const queue = new LinkedQueue<number>();
    queue.enqueue(1);
    queue.dequeue();

    queue.enqueue(2);
    queue.enqueue(3);

    expect(queue.size).toBe(2);
    expect([queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual([2, 3, undefined]);
  });

  it('size acompanha entradas e saídas intercaladas', () => {
    const queue = new LinkedQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.dequeue();
    queue.enqueue(3);

    expect(queue.size).toBe(2);
    expect(drain(queue)).toEqual([2, 3]);
    expect(queue.size).toBe(0);
  });

  it('com 100.000 itens é pelo menos cinco vezes mais rápida do que a mesma fila feita com array e shift()', () => {
    const items = 100_000;

    const linked = timeToCycle(new LinkedQueue<number>(), items);
    const shifting = timeToCycle(new ArrayShiftQueue(), items);

    // Comparação na mesma máquina e na mesma execução: não depende de um tempo absoluto.
    // O(1) por operação contra O(n): na prática a diferença passa de cem vezes.
    expect(linked * 5).toBeLessThan(shifting);
  });
});
