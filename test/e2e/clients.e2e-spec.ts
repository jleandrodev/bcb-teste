import { TestApp, startApp } from '../support/app';
import { CNPJ, CPF, balanceOf, createPostpaid, createPrepaid, sendTo, transactionsOf } from '../support/fixtures';

describe('Clientes (S1)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await startApp();
  });

  afterEach(() => t.close());

  describe('POST /clients', () => {
    it('cadastra um pré-pago e devolve o documento só com dígitos, ativo, com o saldo inicial', async () => {
      const response = await t.api
        .post('/clients')
        .send({ name: 'Ana', documentId: '529.982.247-25', documentType: 'CPF', planType: 'prepaid', balance: 10 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'Ana',
        documentId: '52998224725',
        documentType: 'CPF',
        planType: 'prepaid',
        balance: 10,
        active: true,
      });
    });

    it('cadastra um pós-pago por CNPJ e devolve o limite (sem saldo)', async () => {
      const response = await t.api
        .post('/clients')
        .send({ name: 'Loja', documentId: '11.222.333/0001-81', documentType: 'CNPJ', planType: 'postpaid', limit: 50 });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ documentId: '11222333000181', planType: 'postpaid', limit: 50, active: true });
      expect(response.body).not.toHaveProperty('balance');
    });

    it.each([
      ['dígito verificador errado', '52998224724', 'CPF'],
      ['todos os dígitos iguais', '11111111111', 'CPF'],
      ['tamanho errado', '5299822472', 'CPF'],
      ['CPF válido enviado como CNPJ', CPF.ana, 'CNPJ'],
    ])('recusa documento inválido (%s) com 400 INVALID_DOCUMENT', async (_caso, documentId, documentType) => {
      const response = await t.api.post('/clients').send({ name: 'X', documentId, documentType, planType: 'prepaid' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'INVALID_DOCUMENT' });
      expect((await t.api.get('/clients')).body).toEqual([]);
    });

    it('recusa documento já cadastrado com 409, mesmo escrito com outra máscara', async () => {
      await createPrepaid(t, 10, CPF.ana);

      const response = await t.api
        .post('/clients')
        .send({ name: 'Outra', documentId: '529.982.247-25', documentType: 'CPF', planType: 'postpaid' });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ statusCode: 409, code: 'DOCUMENT_ALREADY_REGISTERED' });
      expect((await t.api.get('/clients')).body).toHaveLength(1);
    });

    it('dois cadastros simultâneos do mesmo documento: um entra, o outro recebe 409', async () => {
      const body = { name: 'Ana', documentId: CPF.ana, documentType: 'CPF', planType: 'prepaid' };

      const responses = await Promise.all([t.api.post('/clients').send(body), t.api.post('/clients').send(body)]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await t.api.get('/clients')).body).toHaveLength(1);
    });

    it.each([
      ['campo não declarado', { admin: true }],
      ['planType desconhecido', { planType: 'gold' }],
      ['documentType desconhecido', { documentType: 'RG' }],
      ['saldo negativo', { balance: -1 }],
      ['limite negativo', { limit: -0.01 }],
      ['saldo com três casas decimais', { balance: 1.005 }],
      ['saldo acima do teto aceito', { balance: 1e17 }],
      ['nome vazio', { name: '' }],
    ])('recusa corpo inválido (%s) com 400 e não cria o cliente', async (_caso, override) => {
      const response = await t.api
        .post('/clients')
        .send({ name: 'Ana', documentId: CPF.ana, documentType: 'CPF', planType: 'prepaid', ...override });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
      expect((await t.api.get('/clients')).body).toEqual([]);
    });
  });

  describe('consulta e atualização', () => {
    it('GET /clients lista na ordem de cadastro e GET /clients/:id devolve um', async () => {
      const ana = await createPrepaid(t, 10, CPF.ana);
      const loja = await createPostpaid(t, 50, CNPJ.loja);

      const list = (await t.api.get('/clients')).body as { id: string }[];
      const one = await t.api.get(`/clients/${loja.id}`);

      expect(list.map((c) => c.id)).toEqual([ana.id, loja.id]);
      expect(one.status).toBe(200);
      expect(one.body).toEqual(loja);
    });

    it('PUT /clients/:id atualiza nome, situação e limite, preservando o resto', async () => {
      const loja = await createPostpaid(t, 50);

      const response = await t.api.put(`/clients/${loja.id}`).send({ name: 'Loja Sul', active: false, limit: 80 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ...loja, name: 'Loja Sul', active: false, limit: 80 });
      expect((await t.api.get(`/clients/${loja.id}`)).body).toEqual(response.body);
    });

    it('PUT com campo desconhecido responde 400', async () => {
      const ana = await createPrepaid(t, 10);

      const response = await t.api.put(`/clients/${ana.id}`).send({ balance: 999 });

      expect(response.status).toBe(400);
      expect((await balanceOf(t, ana)).balance).toBe(10);
    });

    it.each([
      ['get', '/clients/nao-existe', undefined],
      ['put', '/clients/nao-existe', { name: 'X' }],
      ['get', '/clients/nao-existe/balance', undefined],
      ['post', '/clients/nao-existe/credits', { amount: 1 }],
      ['get', '/clients/nao-existe/transactions', undefined],
    ] as const)('%s %s responde 404 CLIENT_NOT_FOUND', async (method, path, body) => {
      const response = await t.api[method](path).send(body);

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ statusCode: 404, code: 'CLIENT_NOT_FOUND' });
    });
  });

  describe('conversão de plano', () => {
    it('pré → pós com limite: passa a consumir o limite e o saldo residual é preservado', async () => {
      const ana = await createPrepaid(t, 3);

      const response = await t.api.put(`/clients/${ana.id}`).send({ planType: 'postpaid', limit: 10 });
      await sendTo(t, ana, 'já no pós-pago', 'urgent');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ planType: 'postpaid', limit: 10 });
      expect(await balanceOf(t, ana)).toMatchObject({ planType: 'postpaid', limit: 10, used: 0.5, available: 9.5 });

      const back = await t.api.put(`/clients/${ana.id}`).send({ planType: 'prepaid' });
      expect(back.body).toMatchObject({ planType: 'prepaid', balance: 3 }); // o saldo residual voltou a valer
    });

    it('pré → pós sem limite responde 400 LIMIT_REQUIRED e o cliente continua pré-pago', async () => {
      const ana = await createPrepaid(t, 3);

      const response = await t.api.put(`/clients/${ana.id}`).send({ planType: 'postpaid' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'LIMIT_REQUIRED' });
      expect((await t.api.get(`/clients/${ana.id}`)).body).toMatchObject({ planType: 'prepaid', balance: 3 });
    });

    it('pós → pré: o consumo pendente do mês continua registrado', async () => {
      const loja = await createPostpaid(t, 10);
      await sendTo(t, loja, 'consumo', 'urgent');

      await t.api.put(`/clients/${loja.id}`).send({ planType: 'prepaid' });
      await t.api.put(`/clients/${loja.id}`).send({ planType: 'postpaid' });

      expect(await balanceOf(t, loja)).toMatchObject({ used: 0.5, available: 9.5 });
    });
  });

  describe('saldo, limite e créditos', () => {
    it('saldo do pré-pago: balance e available em reais', async () => {
      const ana = await createPrepaid(t, 10);

      const response = await t.api.get(`/clients/${ana.id}/balance`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ clientId: ana.id, planType: 'prepaid', balance: 10, available: 10 });
    });

    it('limite do pós-pago: limite 50,00 com consumo 42,50 deixa 7,50 disponíveis', async () => {
      const loja = await createPostpaid(t, 50);
      for (let i = 0; i < 85; i += 1) expect((await sendTo(t, loja, `m${i}`, 'urgent')).status).toBe(201);

      expect(await balanceOf(t, loja)).toEqual({ clientId: loja.id, planType: 'postpaid', limit: 50, used: 42.5, available: 7.5 });
    });

    it('adicionar créditos soma ao saldo e registra uma transação de crédito', async () => {
      const ana = await createPrepaid(t, 10);

      const response = await t.api.post(`/clients/${ana.id}/credits`).send({ amount: 5.5 });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ balance: 15.5, available: 15.5 });
      expect(await transactionsOf(t, ana)).toEqual([expect.objectContaining({ type: 'credit', amount: 5.5 })]);
    });

    it('reduzir o limite abaixo do consumo mostra o consumo real e nada disponível', async () => {
      const loja = await createPostpaid(t, 5);
      for (let i = 0; i < 4; i += 1) await sendTo(t, loja, `m${i}`, 'urgent');

      await t.api.put(`/clients/${loja.id}`).send({ limit: 1 });

      expect(await balanceOf(t, loja)).toMatchObject({ limit: 1, used: 2, available: 0 });
    });

    it.each([[0], [-5], [0.001], ['10'], [1e17]])('recusa crédito de %p com 400 e mantém o saldo', async (amount) => {
      const ana = await createPrepaid(t, 10);

      const response = await t.api.post(`/clients/${ana.id}/credits`).send({ amount });

      expect(response.status).toBe(400);
      expect((await balanceOf(t, ana)).balance).toBe(10);
    });

    it('dinheiro não acumula erro: 0,10 + 0,20 de crédito dá exatamente 0,30', async () => {
      const ana = await createPrepaid(t, 0);

      await t.api.post(`/clients/${ana.id}/credits`).send({ amount: 0.1 });
      await t.api.post(`/clients/${ana.id}/credits`).send({ amount: 0.2 });

      expect((await balanceOf(t, ana)).balance).toBe(0.3);
    });

    it('saldo 10,00 menos cinco mensagens normais fica em 8,75', async () => {
      const ana = await createPrepaid(t, 10);

      for (let i = 0; i < 5; i += 1) await sendTo(t, ana, `m${i}`);

      expect((await balanceOf(t, ana)).balance).toBe(8.75);
    });
  });
});
