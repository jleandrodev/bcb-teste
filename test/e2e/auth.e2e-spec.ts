import { TestApp, startApp } from '../support/app';
import { CPF, createPrepaid } from '../support/fixtures';

describe('Autenticação (S1)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await startApp();
  });

  afterEach(() => t.close());

  it('POST /auth com o documento de um cliente cadastrado devolve token e cliente', async () => {
    const ana = await createPrepaid(t, 10);

    const response = await t.api.post('/auth').send({ documentId: '529.982.247-25', documentType: 'CPF' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ token: expect.any(String), client: ana });
  });

  it('POST /auth com documento válido mas não cadastrado responde 401', async () => {
    const response = await t.api.post('/auth').send({ documentId: CPF.bruno, documentType: 'CPF' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('POST /auth com documento inválido responde 400', async () => {
    const response = await t.api.post('/auth').send({ documentId: '52998224724', documentType: 'CPF' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_DOCUMENT' });
  });

  it('o token devolvido por /auth identifica o cliente nas rotas protegidas', async () => {
    await createPrepaid(t, 10);
    const { token } = (await t.api.post('/auth').send({ documentId: CPF.ana, documentType: 'CPF' })).body as { token: string };

    const response = await t.api.get('/conversations').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('o cabeçalho X-Client-Document identifica o cliente, com ou sem máscara', async () => {
    await createPrepaid(t, 10);

    const response = await t.api.get('/messages').set('X-Client-Document', '529.982.247-25');

    expect(response.status).toBe(200);
  });

  describe.each([
    ['get', '/messages'],
    ['post', '/messages'],
    ['get', '/messages/qualquer'],
    ['get', '/messages/qualquer/status'],
    ['patch', '/messages/qualquer/read'],
    ['get', '/conversations'],
    ['get', '/conversations/qualquer'],
    ['get', '/conversations/qualquer/messages'],
  ] as const)('%s %s', (method, path) => {
    it('sem credencial responde 401 UNAUTHORIZED', async () => {
      const response = await t.api[method](path);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    });

    it('com token desconhecido responde 401', async () => {
      const response = await t.api[method](path).set('Authorization', 'Bearer token-inventado');

      expect(response.status).toBe(401);
    });

    it('com documento não cadastrado responde 401', async () => {
      const response = await t.api[method](path).set('X-Client-Document', CPF.carla);

      expect(response.status).toBe(401);
    });
  });
});
