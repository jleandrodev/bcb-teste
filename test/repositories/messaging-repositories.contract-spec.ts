import { ConversationRepository, MessageRepository } from '../../src/messaging/application/ports';
import { Conversation } from '../../src/messaging/domain/conversation';
import { Message } from '../../src/messaging/domain/message';
import { InMemoryConversationRepository, InMemoryMessageRepository } from '../../src/messaging/infra/memory/repositories';
import { PostgresConversationRepository, PostgresMessageRepository } from '../../src/messaging/infra/postgres/repositories';
import { Database } from '../../src/shared/infra/postgres/database';
import { resetDatabase, usingPostgres } from '../support/database';

const adapters: [string, (db: Database) => { messages: MessageRepository; conversations: ConversationRepository }][] = [
  ['memória', () => ({ messages: new InMemoryMessageRepository(), conversations: new InMemoryConversationRepository() })],
];
if (usingPostgres) {
  adapters.push([
    'PostgreSQL',
    (db) => ({ messages: new PostgresMessageRepository(db), conversations: new PostgresConversationRepository(db) }),
  ]);
}

const t0 = new Date('2026-03-10T12:00:00.000Z');
const later = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

function conversation(id: string, clientId: string, recipientId: string): Conversation {
  return { id, clientId, recipientId, recipientName: `Nome de ${recipientId}` };
}

describe.each(adapters)('MessageRepository e ConversationRepository (%s)', (_name, create) => {
  const db = new Database();
  let messages: MessageRepository;
  let conversations: ConversationRepository;

  beforeAll(() => db.onModuleInit());
  afterAll(() => db.onModuleDestroy());

  beforeEach(async () => {
    await resetDatabase();
    ({ messages, conversations } = create(db));
    await conversations.getOrCreate(conversation('cv-1', 'c-1', 'r-1'));
    await conversations.getOrCreate(conversation('cv-2', 'c-1', 'r-2'));
    await conversations.getOrCreate(conversation('cv-3', 'c-2', 'r-1'));
  });

  function message(
    id: string,
    overrides: { conversationId?: string; senderId?: string; priority?: 'normal' | 'urgent'; now?: Date; content?: string } = {},
  ): Message {
    return Message.create({
      id,
      conversationId: overrides.conversationId ?? 'cv-1',
      senderId: overrides.senderId ?? 'c-1',
      recipientId: 'r-1',
      content: overrides.content ?? `conteúdo de ${id}`,
      priority: overrides.priority ?? 'normal',
      now: overrides.now ?? t0,
    });
  }

  describe('mensagens', () => {
    it('devolve a mensagem gravada com todos os campos, inclusive o histórico com datas', async () => {
      const delivered = message('m-1', { priority: 'urgent' })
        .transitionTo('processing', later(1))
        .withAttempt()
        .transitionTo('sent', later(2))
        .transitionTo('delivered', later(3));
      await messages.save(delivered);

      const found = await messages.findById('m-1');

      expect(found).toEqual(delivered);
      expect(found?.history[3]).toEqual({ status: 'delivered', at: later(3) });
      expect(found?.cost.cents).toBe(50);
    });

    it('devolve null para id desconhecido', async () => {
      expect(await messages.findById('nao-existe')).toBeNull();
    });

    it('gravar de novo atualiza status, tentativas e histórico sem duplicar a mensagem', async () => {
      const queued = message('m-1');
      await messages.save(queued);

      await messages.save(queued.transitionTo('processing', later(1)).withAttempt());

      expect(await messages.list({ senderId: 'c-1' })).toHaveLength(1);
      expect(await messages.findById('m-1')).toMatchObject({ status: 'processing', attempts: 1 });
    });

    it('a mensagem devolvida continua sendo um agregado: aceita a próxima transição', async () => {
      await messages.save(message('m-1'));

      const found = await messages.findById('m-1');

      expect(found?.transitionTo('processing', later(1)).status).toBe('processing');
    });

    it('lista só as mensagens do remetente, na ordem de criação, mesmo depois de atualizadas', async () => {
      await messages.save(message('m-1'));
      await messages.save(message('m-2'));
      await messages.save(message('m-3', { senderId: 'c-2', conversationId: 'cv-3' }));
      await messages.save(message('m-1').transitionTo('processing', later(1))); // atualizar não muda a posição

      expect((await messages.list({ senderId: 'c-1' })).map((m) => m.id)).toEqual(['m-1', 'm-2']);
    });

    it('filtra por conversa, status e prioridade, isolados e combinados', async () => {
      await messages.save(message('m-1'));
      await messages.save(message('m-2', { priority: 'urgent' }));
      await messages.save(message('m-3', { conversationId: 'cv-2' }));
      await messages.save(message('m-4', { priority: 'urgent' }).transitionTo('processing', later(1)));
      const ids = async (filter: Parameters<MessageRepository['list']>[0]) => (await messages.list(filter)).map((m) => m.id);

      expect(await ids({ senderId: 'c-1', conversationId: 'cv-2' })).toEqual(['m-3']);
      expect(await ids({ senderId: 'c-1', status: 'processing' })).toEqual(['m-4']);
      expect(await ids({ senderId: 'c-1', priority: 'urgent' })).toEqual(['m-2', 'm-4']);
      expect(await ids({ senderId: 'c-1', priority: 'urgent', status: 'queued', conversationId: 'cv-1' })).toEqual(['m-2']);
      expect(await ids({ senderId: 'c-1', status: 'failed' })).toEqual([]);
    });

    it('pendentes: só queued e processing, de todos os clientes, na ordem de criação', async () => {
      await messages.save(message('m-1'));
      await messages.save(message('m-2', { priority: 'urgent' }));
      await messages.save(message('m-3', { senderId: 'c-2', conversationId: 'cv-3' }));
      await messages.save(message('m-4'));
      await messages.save(message('m-2', { priority: 'urgent' }).transitionTo('processing', later(1)));
      await messages.save(message('m-4').transitionTo('processing', later(1)).transitionTo('sent', later(2)));

      const pending = await messages.listPending();

      expect(pending.map((m) => [m.id, m.status])).toEqual([
        ['m-1', 'queued'],
        ['m-2', 'processing'],
        ['m-3', 'queued'],
      ]);
    });
  });

  describe('resumo das conversas (derivado das mensagens)', () => {
    it('traz a última mensagem e as não lidas de cada conversa, em uma consulta', async () => {
      await messages.save(message('m-1', { content: 'primeira', now: later(1) }));
      await messages.save(message('m-2', { content: 'segunda', now: later(2) }));
      await messages.save(message('m-3', { conversationId: 'cv-2', content: 'outra conversa', now: later(3) }));

      const byConversation = new Map((await messages.summarize('c-1')).map((s) => [s.conversationId, s]));

      expect(byConversation).toEqual(
        new Map([
          ['cv-1', { conversationId: 'cv-1', lastMessageContent: 'segunda', lastMessageTime: later(2), unreadCount: 0 }],
          ['cv-2', { conversationId: 'cv-2', lastMessageContent: 'outra conversa', lastMessageTime: later(3), unreadCount: 0 }],
        ]),
      );
    });

    it('não lidas conta só as entregues: na fila, enviada, lida e falha ficam de fora', async () => {
      const delivered = (id: string) =>
        message(id).transitionTo('processing', later(1)).transitionTo('sent', later(2)).transitionTo('delivered', later(3));
      await messages.save(delivered('m-1'));
      await messages.save(delivered('m-2'));
      await messages.save(delivered('m-3').transitionTo('read', later(4)));
      await messages.save(message('m-4'));
      await messages.save(message('m-5').transitionTo('processing', later(1)).transitionTo('failed', later(2)));
      await messages.save(message('m-6').transitionTo('processing', later(1)).transitionTo('sent', later(2)));

      const [summary] = await messages.summarize('c-1');

      expect(summary).toMatchObject({ conversationId: 'cv-1', unreadCount: 2, lastMessageContent: 'conteúdo de m-6' });
    });

    it('atualizar o status de uma mensagem antiga não a torna a "última"', async () => {
      await messages.save(message('m-1', { content: 'antiga' }));
      await messages.save(message('m-2', { content: 'recente' }));
      await messages.save(message('m-1', { content: 'antiga' }).transitionTo('processing', later(9)));

      expect((await messages.summarize('c-1'))[0].lastMessageContent).toBe('recente');
    });

    it('não mistura clientes, e conversa sem mensagem não aparece no resumo', async () => {
      await messages.save(message('m-1', { senderId: 'c-2', conversationId: 'cv-3' }));

      expect(await messages.summarize('c-1')).toEqual([]);
      expect(await messages.summarize('c-2')).toHaveLength(1);
    });
  });

  describe('conversas', () => {
    it('getOrCreate devolve a conversa existente do par cliente e destinatário, ignorando a candidata', async () => {
      const found = await conversations.getOrCreate({ ...conversation('cv-outra', 'c-1', 'r-1'), recipientName: 'Outro nome' });

      expect(found).toEqual(conversation('cv-1', 'c-1', 'r-1'));
      expect(await conversations.findById('cv-outra')).toBeNull();
    });

    it('getOrCreate é atômico: dez criações simultâneas para o mesmo par resultam em uma conversa', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => conversations.getOrCreate(conversation(`cv-nova-${i}`, 'c-9', 'r-9'))),
      );

      expect(new Set(results.map((c) => c.id)).size).toBe(1);
      expect(await conversations.listByClient('c-9')).toHaveLength(1);
    });

    it('o mesmo destinatário tem conversas separadas para clientes diferentes', async () => {
      expect((await conversations.listByClient('c-2')).map((c) => c.id)).toEqual(['cv-3']);
    });

    it('lista as conversas do cliente na ordem em que foram criadas', async () => {
      await conversations.getOrCreate(conversation('cv-4', 'c-1', 'r-4'));

      expect((await conversations.listByClient('c-1')).map((c) => c.id)).toEqual(['cv-1', 'cv-2', 'cv-4']);
    });

    it('devolve null para conversa desconhecida', async () => {
      expect(await conversations.findById('nao-existe')).toBeNull();
    });
  });
});
