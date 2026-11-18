import { MutableClock, TestApp, startApp } from '../support/app';
import { CPF, SendJson, balanceOf, createPostpaid, createPrepaid, get, send, sendTo, transactionsOf } from '../support/fixtures';

describe('Envio com cobrança (S2)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await startApp();
  });

  afterEach(() => t.close());

  /** Nada foi cobrado, gravado nem enfileirado. */
  async function expectNoSideEffects(client: Parameters<typeof balanceOf>[1], available: number): Promise<void> {
    expect((await balanceOf(t, client)).available).toBe(available);
    expect(await transactionsOf(t, client)).toEqual([]);
    expect((await get(t, client, '/messages')).body).toEqual([]);
    expect((await get(t, client, '/conversations')).body).toEqual([]);
    expect((await t.api.get('/queue/status')).body).toMatchObject({ size: { total: 0 }, enqueued: 0 });
  }

  describe('pré-pago', () => {
    it('aceita o envio, debita o custo, registra o débito ligado à mensagem e enfileira', async () => {
      const ana = await createPrepaid(t, 1);

      const response = await sendTo(t, ana, 'Olá');

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String),
        conversationId: expect.any(String),
        status: 'queued',
        estimatedDelivery: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        cost: 0.25,
        currentBalance: 0.75,
      });
      const sent = response.body as SendJson;
      expect((await balanceOf(t, ana)).balance).toBe(0.75);
      expect(await transactionsOf(t, ana)).toEqual([expect.objectContaining({ type: 'debit', amount: 0.25, messageId: sent.id })]);
      expect((await t.api.get('/queue/status')).body).toMatchObject({ size: { normal: 1, urgent: 0, total: 1 } });
    });

    it('cobra R$ 0,50 pela urgente e R$ 0,25 quando a prioridade não é informada', async () => {
      const ana = await createPrepaid(t, 1);

      const urgent = await sendTo(t, ana, 'u', 'urgent');
      const implicit = await send(t, ana, { recipientId: 'dest-1', content: 'sem prioridade' });

      expect(urgent.body).toMatchObject({ cost: 0.5, currentBalance: 0.5 });
      expect(implicit.body).toMatchObject({ cost: 0.25, currentBalance: 0.25 });
      expect((await get(t, ana, `/messages/${(implicit.body as SendJson).id}`)).body).toMatchObject({ priority: 'normal' });
    });

    it('saldo exatamente igual ao custo: aceita e zera', async () => {
      const ana = await createPrepaid(t, 0.25);

      const response = await sendTo(t, ana, 'última');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ currentBalance: 0 });
    });

    it('um centavo a menos que o custo: 402 INSUFFICIENT_BALANCE, sem débito, mensagem ou fila', async () => {
      const ana = await createPrepaid(t, 0.24);

      const response = await sendTo(t, ana, 'não vai');

      expect(response.status).toBe(402);
      expect(response.body).toEqual({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: expect.any(String),
        details: { balance: 0.24, cost: 0.25 },
      });
      await expectNoSideEffects(ana, 0.24);
    });

    it('saldo que paga a normal mas não a urgente recusa só a urgente', async () => {
      const ana = await createPrepaid(t, 0.3);

      expect((await sendTo(t, ana, 'u', 'urgent')).status).toBe(402);
      expect((await sendTo(t, ana, 'n', 'normal')).status).toBe(201);
    });
  });

  describe('pós-pago', () => {
    it('soma o custo ao consumo do mês e não devolve currentBalance', async () => {
      const loja = await createPostpaid(t, 0.6);

      const response = await sendTo(t, loja, 'u', 'urgent');

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('currentBalance');
      expect(await balanceOf(t, loja)).toMatchObject({ limit: 0.6, used: 0.5, available: 0.1 });
    });

    it('recusa com 402 LIMIT_EXCEEDED quando o consumo passaria do limite', async () => {
      const loja = await createPostpaid(t, 0.6);
      await sendTo(t, loja, 'u', 'urgent');

      const response = await sendTo(t, loja, 'n', 'normal');

      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({ statusCode: 402, code: 'LIMIT_EXCEEDED', details: { limit: 0.6, used: 0.5, cost: 0.25 } });
      expect((await balanceOf(t, loja)).used).toBe(0.5);
    });

    it('aceita quando o consumo fica exatamente igual ao limite', async () => {
      const loja = await createPostpaid(t, 0.5);

      expect((await sendTo(t, loja, 'u', 'urgent')).status).toBe(201);
      expect(await balanceOf(t, loja)).toMatchObject({ used: 0.5, available: 0 });
    });
  });

  describe('virada do mês', () => {
    it('limite consumido em janeiro volta inteiro em 1º de fevereiro (UTC)', async () => {
      await t.close();
      const clock = new MutableClock(new Date('2026-01-31T23:59:00.000Z'));
      t = await startApp({ clock });
      const loja = await createPostpaid(t, 0.5);
      await sendTo(t, loja, 'janeiro', 'urgent');
      expect((await sendTo(t, loja, 'estourou')).status).toBe(402);

      clock.set(new Date('2026-02-01T00:00:00.000Z'));

      expect(await balanceOf(t, loja)).toMatchObject({ limit: 0.5, used: 0, available: 0.5 });
      expect((await sendTo(t, loja, 'fevereiro', 'urgent')).status).toBe(201);
      expect(await balanceOf(t, loja)).toMatchObject({ used: 0.5, available: 0 });
    });
  });

  describe('recusas sem cobrança', () => {
    it('cliente inativo recebe 403 CLIENT_INACTIVE', async () => {
      const ana = await createPrepaid(t, 5);
      await t.api.put(`/clients/${ana.id}`).send({ active: false });

      const response = await sendTo(t, ana, 'bloqueada');

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ statusCode: 403, code: 'CLIENT_INACTIVE' });
      expect((await balanceOf(t, ana)).balance).toBe(5);
      expect(await transactionsOf(t, ana)).toEqual([]);
    });

    it.each([
      ['conteúdo vazio', 'VALIDATION_FAILED', { recipientId: 'd', content: '' }],
      ['conteúdo só com espaços', 'VALIDATION_FAILED', { recipientId: 'd', content: '   ' }],
      ['conteúdo ausente', 'VALIDATION_FAILED', { recipientId: 'd' }],
      ['conteúdo acima de 1000 caracteres', 'VALIDATION_FAILED', { recipientId: 'd', content: 'x'.repeat(1001) }],
      ['prioridade desconhecida', 'VALIDATION_FAILED', { recipientId: 'd', content: 'oi', priority: 'altíssima' }],
      ['campo não declarado', 'VALIDATION_FAILED', { recipientId: 'd', content: 'oi', cost: 0 }],
      ['destinatário com mais de 120 caracteres', 'VALIDATION_FAILED', { recipientId: 'r'.repeat(121), content: 'oi' }],
      ['destinatário só com espaços', 'VALIDATION_FAILED', { recipientId: '   ', content: 'oi' }],
      ['nome do destinatário só com espaços', 'VALIDATION_FAILED', { recipientId: 'd', recipientName: '   ', content: 'oi' }],
      ['sem conversa e sem destinatário', 'RECIPIENT_REQUIRED', { content: 'oi' }],
    ])('%s: 400 %s', async (_caso, code, body) => {
      const ana = await createPrepaid(t, 5);

      const response = await send(t, ana, body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code });
      await expectNoSideEffects(ana, 5);
    });
  });

  describe('conteúdo', () => {
    it('espaços nas pontas do conteúdo são removidos antes de gravar', async () => {
      const ana = await createPrepaid(t, 5);

      const sent = (await send(t, ana, { recipientId: 'dest-1', content: '  Olá, mundo  ' })).body as SendJson;

      expect((await get(t, ana, `/messages/${sent.id}`)).body).toMatchObject({ content: 'Olá, mundo' });
    });
  });

  describe('conversas', () => {
    it('o primeiro envio a um destinatário cria a conversa; os seguintes a reutilizam', async () => {
      const ana = await createPrepaid(t, 5);

      const first = (await send(t, ana, { recipientId: 'dest-1', recipientName: 'Zé', content: 'um' })).body as SendJson;
      const second = (await send(t, ana, { recipientId: 'dest-1', content: 'dois' })).body as SendJson;
      const other = (await send(t, ana, { recipientId: 'dest-2', content: 'três' })).body as SendJson;

      expect(second.conversationId).toBe(first.conversationId);
      expect(other.conversationId).not.toBe(first.conversationId);
      expect((await get(t, ana, '/conversations')).body).toHaveLength(2);
    });

    it('envio com conversationId usa a conversa e o destinatário dela', async () => {
      const ana = await createPrepaid(t, 5);
      const first = (await sendTo(t, ana, 'um')).body as SendJson;

      const response = await send(t, ana, { conversationId: first.conversationId, content: 'dois' });

      expect(response.status).toBe(201);
      expect((await get(t, ana, `/messages/${(response.body as SendJson).id}`)).body).toMatchObject({
        conversationId: first.conversationId,
        recipientId: 'dest-1',
        senderId: ana.id,
      });
    });

    it('envio para conversa inexistente responde 404 sem debitar', async () => {
      const ana = await createPrepaid(t, 5);

      const response = await send(t, ana, { conversationId: 'nao-existe', content: 'oi' });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
      await expectNoSideEffects(ana, 5);
    });

    it('lista da mais recente para a mais antiga, com última mensagem e não lidas', async () => {
      await t.close();
      const clock = new MutableClock(new Date('2026-03-10T12:00:00.000Z'));
      t = await startApp({ clock });
      const ana = await createPrepaid(t, 5);
      await send(t, ana, { recipientId: 'dest-1', recipientName: 'Zé', content: 'primeira para o Zé' });
      clock.set(new Date('2026-03-10T12:01:00.000Z'));
      await send(t, ana, { recipientId: 'dest-2', recipientName: 'Lia', content: 'para a Lia' });
      clock.set(new Date('2026-03-10T12:02:00.000Z'));
      await send(t, ana, { recipientId: 'dest-1', content: 'segunda para o Zé' });
      await t.processor.drain();

      const response = await get(t, ana, '/conversations');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: expect.any(String),
          clientId: ana.id,
          recipientId: 'dest-1',
          recipientName: 'Zé',
          lastMessageContent: 'segunda para o Zé',
          lastMessageTime: '2026-03-10T12:02:00.000Z',
          unreadCount: 2,
        },
        expect.objectContaining({
          recipientName: 'Lia',
          lastMessageContent: 'para a Lia',
          lastMessageTime: '2026-03-10T12:01:00.000Z',
          unreadCount: 1,
        }),
      ]);
    });

    it('não lidas conta só as entregues ainda não lidas: na fila não conta, lida deixa de contar', async () => {
      const ana = await createPrepaid(t, 5);
      const first = (await sendTo(t, ana, 'um')).body as SendJson;
      const unread = async () =>
        ((await get(t, ana, `/conversations/${first.conversationId}`)).body as { unreadCount: number }).unreadCount;

      expect(await unread()).toBe(0); // ainda na fila

      await t.processor.drain();
      expect(await unread()).toBe(1);

      await t.api.patch(`/messages/${first.id}/read`).set('X-Client-Document', ana.documentId);
      expect(await unread()).toBe(0);
    });

    it('GET /conversations/:id/messages devolve as mensagens da conversa em ordem cronológica', async () => {
      const ana = await createPrepaid(t, 5);
      const first = (await sendTo(t, ana, 'um')).body as SendJson;
      await sendTo(t, ana, 'dois', 'urgent');
      await send(t, ana, { recipientId: 'dest-2', content: 'outra conversa' });

      const response = await get(t, ana, `/conversations/${first.conversationId}/messages`);

      expect((response.body as { content: string }[]).map((m) => m.content)).toEqual(['um', 'dois']);
    });
  });

  describe('consulta de mensagens', () => {
    it('GET /messages/:id devolve a mensagem no contrato do enunciado', async () => {
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'Olá', 'urgent')).body as SendJson;

      const response = await get(t, ana, `/messages/${sent.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: sent.id,
        conversationId: sent.conversationId,
        senderId: ana.id,
        recipientId: 'dest-1',
        content: 'Olá',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        priority: 'urgent',
        status: 'queued',
        cost: 0.5,
      });
    });

    it('filtra por status, prioridade e conversa, sempre dentro do cliente autenticado', async () => {
      const ana = await createPrepaid(t, 5, CPF.ana);
      const bruno = await createPrepaid(t, 5, CPF.bruno);
      const n1 = (await sendTo(t, ana, 'n1')).body as SendJson;
      await sendTo(t, ana, 'u1', 'urgent');
      await t.processor.drain();
      await send(t, ana, { recipientId: 'dest-2', content: 'n2' });
      await sendTo(t, bruno, 'do bruno', 'urgent');
      const contents = async (query: string) =>
        ((await get(t, ana, `/messages${query}`)).body as { content: string }[]).map((m) => m.content);

      expect(await contents('')).toEqual(['n1', 'u1', 'n2']);
      expect(await contents('?status=delivered')).toEqual(['n1', 'u1']);
      expect(await contents('?status=queued')).toEqual(['n2']);
      expect(await contents('?priority=urgent')).toEqual(['u1']);
      expect(await contents(`?conversationId=${n1.conversationId}`)).toEqual(['n1', 'u1']);
      expect(await contents(`?conversationId=${n1.conversationId}&priority=normal&status=delivered`)).toEqual(['n1']);
    });

    it.each([['?status=inexistente'], ['?priority=altíssima'], ['?pagina=2']])('GET /messages%s responde 400', async (query) => {
      const ana = await createPrepaid(t, 5);

      expect((await get(t, ana, `/messages${encodeURI(query)}`)).status).toBe(400);
    });
  });

  describe('leitura', () => {
    it('PATCH /messages/:id/read move uma mensagem entregue para read; repetir responde 409', async () => {
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'Olá')).body as SendJson;
      await t.processor.drain();

      const first = await t.api.patch(`/messages/${sent.id}/read`).set('X-Client-Document', ana.documentId);
      const again = await t.api.patch(`/messages/${sent.id}/read`).set('X-Client-Document', ana.documentId);

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ id: sent.id, status: 'read' });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' });
    });

    it('mensagem ainda na fila não pode ser marcada como lida: 409', async () => {
      const ana = await createPrepaid(t, 5);
      const sent = (await sendTo(t, ana, 'Olá')).body as SendJson;

      const response = await t.api.patch(`/messages/${sent.id}/read`).set('X-Client-Document', ana.documentId);

      expect(response.status).toBe(409);
      expect((await get(t, ana, `/messages/${sent.id}`)).body).toMatchObject({ status: 'queued' });
    });
  });

  describe('isolamento entre clientes', () => {
    it('o que é de outro cliente responde 404, igual a um id que não existe', async () => {
      const ana = await createPrepaid(t, 5, CPF.ana);
      const bruno = await createPrepaid(t, 5, CPF.bruno);
      const sent = (await sendTo(t, ana, 'segredo da Ana')).body as SendJson;
      await t.processor.drain();

      const attempts = [
        await get(t, bruno, `/messages/${sent.id}`),
        await get(t, bruno, `/messages/${sent.id}/status`),
        await t.api.patch(`/messages/${sent.id}/read`).set('X-Client-Document', bruno.documentId),
        await get(t, bruno, `/conversations/${sent.conversationId}`),
        await get(t, bruno, `/conversations/${sent.conversationId}/messages`),
      ];
      const missing = await get(t, bruno, '/messages/nao-existe');

      for (const response of attempts) expect(response.status).toBe(404);
      expect(attempts[0].body).toMatchObject({ code: missing.body.code as string, statusCode: 404 });
      expect((await get(t, bruno, '/messages')).body).toEqual([]);
      expect((await get(t, bruno, '/conversations')).body).toEqual([]);
      expect((await get(t, ana, `/messages/${sent.id}`)).body).toMatchObject({ status: 'delivered' }); // o PATCH do Bruno não leu
    });

    it('enviar para a conversa de outro cliente responde 404 e não debita', async () => {
      const ana = await createPrepaid(t, 5, CPF.ana);
      const bruno = await createPrepaid(t, 5, CPF.bruno);
      const sent = (await sendTo(t, ana, 'da Ana')).body as SendJson;

      const response = await send(t, bruno, { conversationId: sent.conversationId, content: 'intruso' });

      expect(response.status).toBe(404);
      expect((await balanceOf(t, bruno)).balance).toBe(5);
      expect((await get(t, ana, `/conversations/${sent.conversationId}/messages`)).body).toHaveLength(1);
    });

    it('cada cliente tem a própria conversa com o mesmo destinatário', async () => {
      const ana = await createPrepaid(t, 5, CPF.ana);
      const bruno = await createPrepaid(t, 5, CPF.bruno);

      const fromAna = (await sendTo(t, ana, 'da Ana')).body as SendJson;
      const fromBruno = (await sendTo(t, bruno, 'do Bruno')).body as SendJson;

      expect(fromBruno.conversationId).not.toBe(fromAna.conversationId);
    });
  });
});
