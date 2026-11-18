interface Node<T> {
  value: T;
  next: Node<T> | null;
}

/**
 * Fila FIFO sobre lista ligada: enqueue e dequeue em O(1).
 * Um array com `shift()` custa O(n) por remoção (reindexa todos os elementos),
 * o que vira O(n²) para esvaziar uma fila grande.
 */
export class LinkedQueue<T> {
  private head: Node<T> | null = null;
  private tail: Node<T> | null = null;
  private length = 0;

  enqueue(value: T): void {
    const node: Node<T> = { value, next: null };
    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }
    this.tail = node;
    this.length += 1;
  }

  dequeue(): T | undefined {
    const node = this.head;
    if (!node) return undefined;
    this.head = node.next;
    if (!this.head) this.tail = null;
    this.length -= 1;
    return node.value;
  }

  peek(): T | undefined {
    return this.head?.value;
  }

  get size(): number {
    return this.length;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let node = this.head; node; node = node.next) out.push(node.value);
    return out;
  }
}
