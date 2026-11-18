import { LinkedQueue } from '../linked-queue';

describe('LinkedQueue', () => {
  it('entrega na ordem de chegada (FIFO)', () => {
    const queue = new LinkedQueue<string>();
    ['a', 'b', 'c'].forEach((item) => queue.enqueue(item));

    expect([queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual(['a', 'b', 'c']);
  });

  it('vazia devolve undefined em vez de lançar, e continua utilizável', () => {
    const queue = new LinkedQueue<number>();

    expect(queue.dequeue()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
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

    expect(queue.toArray()).toEqual([2, 3]);
    expect(queue.size).toBe(2);
  });

  it('peek mostra o próximo sem remover', () => {
    const queue = new LinkedQueue<string>();
    queue.enqueue('primeiro');
    queue.enqueue('segundo');

    expect(queue.peek()).toBe('primeiro');
    expect(queue.size).toBe(2);
  });

  it('size acompanha entradas e saídas intercaladas', () => {
    const queue = new LinkedQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.dequeue();
    queue.enqueue(3);

    expect(queue.size).toBe(2);
    expect(queue.toArray()).toEqual([2, 3]);
  });

  it('enfileira e desenfileira 200.000 itens em tempo linear (O(1) por operação)', () => {
    const queue = new LinkedQueue<number>();
    const total = 200_000;
    const started = performance.now();

    for (let i = 0; i < total; i += 1) queue.enqueue(i);
    let sum = 0;
    for (let i = 0; i < total; i += 1) sum += queue.dequeue() as number;

    // Com array + shift() este laço é quadrático e leva vários segundos; o teto tem folga de sobra para máquinas lentas.
    expect(performance.now() - started).toBeLessThan(1500);
    expect(sum).toBe((total * (total - 1)) / 2);
    expect(queue.isEmpty()).toBe(true);
  });
});
