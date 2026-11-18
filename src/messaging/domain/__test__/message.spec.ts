import { Message, MessageStatus, costOf } from '../message';

const t0 = new Date('2026-03-10T12:00:00.000Z');
const later = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const ALL: MessageStatus[] = ['queued', 'processing', 'sent', 'delivered', 'read', 'failed'];

function queued(priority: 'normal' | 'urgent' = 'normal'): Message {
  return Message.create({ id: 'm1', conversationId: 'cv1', senderId: 'c1', recipientId: 'r1', content: 'Olá', priority, now: t0 });
}

/** Leva uma mensagem nova até o status pedido pelo caminho feliz. */
function messageIn(status: MessageStatus): Message {
  const path: Record<MessageStatus, MessageStatus[]> = {
    queued: [],
    processing: ['processing'],
    sent: ['processing', 'sent'],
    delivered: ['processing', 'sent', 'delivered'],
    read: ['processing', 'sent', 'delivered', 'read'],
    failed: ['processing', 'failed'],
  };
  return path[status].reduce((message, next) => message.transitionTo(next, t0), queued());
}

describe('Message', () => {
  it('custa R$ 0,25 quando normal e R$ 0,50 quando urgente', () => {
    expect(costOf('normal').cents).toBe(25);
    expect(costOf('urgent').cents).toBe(50);
    expect(queued('urgent').cost.cents).toBe(50);
  });

  it('nasce em queued, sem tentativas, com a criação registrada no histórico', () => {
    const message = queued();

    expect(message.status).toBe('queued');
    expect(message.attempts).toBe(0);
    expect(message.timestamp).toEqual(t0);
    expect(message.history).toEqual([{ status: 'queued', at: t0 }]);
  });

  it('percorre queued → processing → sent → delivered → read registrando o horário de cada passo', () => {
    const read = queued()
      .transitionTo('processing', later(1))
      .transitionTo('sent', later(2))
      .transitionTo('delivered', later(3))
      .transitionTo('read', later(4));

    expect(read.status).toBe('read');
    expect(read.history).toEqual([
      { status: 'queued', at: t0 },
      { status: 'processing', at: later(1) },
      { status: 'sent', at: later(2) },
      { status: 'delivered', at: later(3) },
      { status: 'read', at: later(4) },
    ]);
  });

  // A tabela inteira, 6 x 6: toda transição fora das sete permitidas tem de ser recusada.
  const allowed = new Set([
    'queued>processing',
    'processing>sent',
    'processing>failed',
    'processing>queued',
    'sent>delivered',
    'delivered>read',
  ]);
  describe.each(ALL)('a partir de %s', (from) => {
    it.each(ALL)('→ %s', (to) => {
      const message = messageIn(from);

      if (allowed.has(`${from}>${to}`)) {
        expect(message.canTransitionTo(to)).toBe(true);
        expect(message.transitionTo(to, later(9)).status).toBe(to);
      } else {
        expect(message.canTransitionTo(to)).toBe(false);
        expect(() => message.transitionTo(to, later(9))).toThrow(
          expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION', kind: 'conflict' }),
        );
      }
    });
  });

  it('o retry (processing → queued) mantém as tentativas já feitas', () => {
    const retried = queued().transitionTo('processing', later(1)).withAttempt().transitionTo('queued', later(2));

    expect(retried.status).toBe('queued');
    expect(retried.attempts).toBe(1);
  });

  it('é imutável: a transição devolve outra mensagem e a original não muda', () => {
    const original = queued();

    const processing = original.transitionTo('processing', later(1));

    expect(original.status).toBe('queued');
    expect(original.history).toHaveLength(1);
    expect(processing.history).toHaveLength(2);
  });
});
