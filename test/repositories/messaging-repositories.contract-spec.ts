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
  return { id, clientId, recipientId, recipientName: `Nome de ${recipientId}`, lastMessageContent: null, lastMessageTime: null };
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
    overrides: { conversationId?: string; senderId?: string; priority?: 'normal' | 'urgent'; now?: Date } = {},
  ): Message {
    return Message.create({
      id,
      conversationId: overrides.conversationId ?? 'cv-1',
      senderId: overrides.senderId ?? 'c-1',
      recipientId: 'r-1',
      content: `conteúdo de ${id}`,
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

    it('save atualiza a última mensagem', async () => {
      await conversations.save({ ...conversation('cv-1', 'c-1', 'r-1'), lastMessageContent: 'Olá', lastMessageTime: later(5) });

      expect(await conversations.findById('cv-1')).toEqual({
        ...conversation('cv-1', 'c-1', 'r-1'),
        lastMessageContent: 'Olá',
        lastMessageTime: later(5),
      });
    });

    it('lista as conversas do cliente da mais recente para a mais antiga; sem mensagem fica por último', async () => {
      await conversations.getOrCreate(conversation('cv-4', 'c-1', 'r-4'));
      await conversations.save({ ...conversation('cv-1', 'c-1', 'r-1'), lastMessageContent: 'antiga', lastMessageTime: later(1) });
      await conversations.save({ ...conversation('cv-2', 'c-1', 'r-2'), lastMessageContent: 'recente', lastMessageTime: later(9) });

      expect((await conversations.listByClient('c-1')).map((c) => c.id)).toEqual(['cv-2', 'cv-1', 'cv-4']);
    });

    it('devolve null para conversa desconhecida', async () => {
      expect(await conversations.findById('nao-existe')).toBeNull();
    });
  });
});
