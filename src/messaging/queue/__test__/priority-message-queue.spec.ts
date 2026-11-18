import { Priority, PriorityMessageQueue } from '../priority-message-queue';

/** `u1` é urgente, `n1` é normal: os cenários ficam legíveis como no enunciado. */
function fill(queue: PriorityMessageQueue<string>, ...items: string[]): void {
  for (const item of items) queue.enqueue(item, item.startsWith('u') ? 'urgent' : 'normal');
}

function drain(queue: PriorityMessageQueue<string>): string[] {
  const out: string[] = [];
  for (let item = queue.dequeue(); item !== undefined; item = queue.dequeue()) out.push(item);
  return out;
}

describe('PriorityMessageQueue', () => {
  describe('prioridade', () => {
    it('urgentes saem antes das normais', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 10 });
      fill(queue, 'n1', 'u1', 'n2', 'u2');

      expect(drain(queue)).toEqual(['u1', 'u2', 'n1', 'n2']);
    });

    it('dentro de cada nível vale a ordem de chegada', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 10 });
      fill(queue, 'n1', 'n2', 'n3', 'u1', 'u2', 'u3');

      expect(drain(queue)).toEqual(['u1', 'u2', 'u3', 'n1', 'n2', 'n3']);
    });

    it('só normais: FIFO simples', () => {
      const queue = new PriorityMessageQueue<string>();
      fill(queue, 'n1', 'n2', 'n3');

      expect(drain(queue)).toEqual(['n1', 'n2', 'n3']);
    });
  });

  describe('proteção contra starvation', () => {
    it('com o padrão (3), a cada três urgentes sai uma normal', () => {
      const queue = new PriorityMessageQueue<string>();
      fill(queue, 'n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5');

      expect(drain(queue)).toEqual(['u1', 'u2', 'u3', 'n1', 'u4', 'u5', 'n2']);
    });

    it('com urgentBurst=2, a cada duas urgentes sai uma normal', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 2 });
      fill(queue, 'n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5');

      expect(drain(queue)).toEqual(['u1', 'u2', 'n1', 'u3', 'u4', 'n2', 'u5']);
    });

    it('com urgentBurst=1, alterna urgente e normal', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 1 });
      fill(queue, 'n1', 'n2', 'u1', 'u2', 'u3');

      expect(drain(queue)).toEqual(['u1', 'n1', 'u2', 'n2', 'u3']);
    });

    it('a rajada só conta enquanto há normal esperando: urgentes atendidas com a fila normal vazia não geram "dívida"', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 2 });
      fill(queue, 'u1', 'u2', 'u3');
      expect([queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual(['u1', 'u2', 'u3']);

      fill(queue, 'n1', 'u4', 'u5', 'u6');

      // Se as três primeiras contassem, n1 sairia na frente de u4.
      expect(drain(queue)).toEqual(['u4', 'u5', 'n1', 'u6']);
    });

    it('conta as vezes em que uma normal passou na frente de urgentes', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 2 });
      fill(queue, 'n1', 'n2', 'u1', 'u2', 'u3', 'u4', 'u5');
      drain(queue);

      expect(queue.snapshot().starvationPreventions).toBe(2);
    });

    it('normal atendida com a fila urgente vazia não conta como prevenção', () => {
      const queue = new PriorityMessageQueue<string>();
      fill(queue, 'n1', 'n2');
      drain(queue);

      expect(queue.snapshot().starvationPreventions).toBe(0);
    });

    it('sob produção contínua de urgentes, uma normal espera no máximo urgentBurst atendimentos', () => {
      const burst = 4;
      const queue = new PriorityMessageQueue<string>({ urgentBurst: burst });
      fill(queue, 'n1');
      let served = 0;

      // Um produtor que nunca para: a cada atendimento chegam mais duas urgentes.
      for (let i = 0; i < 1000; i += 1) {
        fill(queue, `u${i}a`, `u${i}b`);
        served += 1;
        if (queue.dequeue() === 'n1') break;
      }

      expect(served).toBe(burst + 1);
    });
  });

  describe('propriedades (1.000 sequências geradas com semente fixa)', () => {
    /** Gerador determinístico (mulberry32): a falha, se houver, é sempre reproduzível. */
    function random(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('nada se perde, nada se duplica, cada nível sai em FIFO e nenhuma rajada passa do limite', () => {
      for (let seed = 1; seed <= 1000; seed += 1) {
        const next = random(seed);
        const burst = 1 + Math.floor(next() * 5);
        const queue = new PriorityMessageQueue<{ id: number; priority: Priority }>({ urgentBurst: burst });
        const output: { id: number; priority: Priority }[] = [];
        let id = 0;
        let run = 0; // urgentes seguidas atendidas enquanto havia normal esperando

        const take = () => {
          const normalWaiting = queue.snapshot().normal > 0;
          const item = queue.dequeue();
          if (!item) return;
          output.push(item);
          run = item.priority === 'urgent' && normalWaiting ? run + 1 : 0;
          if (run > burst) throw new Error(`semente ${seed}: ${run} urgentes seguidas com normal esperando (limite ${burst})`);
        };

        for (let step = 0; step < 200; step += 1) {
          if (next() < 0.6) {
            const priority: Priority = next() < 0.7 ? 'urgent' : 'normal';
            queue.enqueue({ id: (id += 1), priority }, priority);
          } else {
            take();
          }
        }
        while (!queue.isEmpty()) take();

        const ids = (priority: Priority) => output.filter((item) => item.priority === priority).map((item) => item.id);
        expect(output).toHaveLength(id);
        expect(new Set(output.map((item) => item.id)).size).toBe(id);
        expect(ids('urgent')).toEqual([...ids('urgent')].sort((a, b) => a - b));
        expect(ids('normal')).toEqual([...ids('normal')].sort((a, b) => a - b));
      }
    });
  });

  describe('bordas', () => {
    it('vazia devolve undefined e continua aceitando itens', () => {
      const queue = new PriorityMessageQueue<string>();

      expect(queue.dequeue()).toBeUndefined();
      expect(queue.isEmpty()).toBe(true);

      fill(queue, 'n1');
      expect(queue.dequeue()).toBe('n1');
    });

    it.each([[0], [-1], [1.5], [Number.NaN]])('recusa urgentBurst=%p com RangeError', (urgentBurst) => {
      expect(() => new PriorityMessageQueue({ urgentBurst })).toThrow(RangeError);
    });

    it('o retrato da fila mostra tamanhos por nível e totais de entrada e saída', () => {
      const queue = new PriorityMessageQueue<string>({ urgentBurst: 2 });
      fill(queue, 'n1', 'u1', 'u2');
      queue.dequeue();

      expect(queue.snapshot()).toEqual({
        urgent: 1,
        normal: 1,
        total: 2,
        enqueued: 3,
        dequeued: 1,
        starvationPreventions: 0,
        urgentBurst: 2,
      });
      expect(queue.size).toBe(2);
    });

    it('200.000 itens entram e saem em menos de 1,5 s', () => {
      const queue = new PriorityMessageQueue<number>();
      const total = 200_000;
      const started = performance.now();

      for (let i = 0; i < total; i += 1) queue.enqueue(i, i % 3 === 0 ? 'normal' : 'urgent');
      let count = 0;
      while (queue.dequeue() !== undefined) count += 1;

      expect(performance.now() - started).toBeLessThan(1500);
      expect(count).toBe(total);
    });
  });
});
