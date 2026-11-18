import { TestApp, startApp } from '../support/app';

describe('Operação (S5)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });

  afterAll(() => t.close());

  it('GET /health responde ok', async () => {
    const response = await t.api.get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('a documentação OpenAPI lista todas as rotas da seção Surface da especificação', async () => {
    const response = await t.api.get('/docs-json');
    const paths = (response.body as { paths: Record<string, Record<string, unknown>> }).paths;
    const routes = Object.entries(paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`))
      .sort();

    expect(response.status).toBe(200);
    expect(routes).toEqual(
      [
        'POST /auth',
        'GET /clients',
        'POST /clients',
        'GET /clients/{id}',
        'PUT /clients/{id}',
        'GET /clients/{id}/balance',
        'POST /clients/{id}/credits',
        'GET /clients/{id}/transactions',
        'GET /conversations',
        'GET /conversations/{id}',
        'GET /conversations/{id}/messages',
        'POST /messages',
        'GET /messages',
        'GET /messages/{id}',
        'GET /messages/{id}/status',
        'PATCH /messages/{id}/read',
        'GET /queue/status',
        'GET /health',
      ].sort(),
    );
  });

  it('a página /docs é servida', async () => {
    const response = await t.api.get('/docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });

  it('a documentação descreve o corpo das respostas e os erros de cada rota', async () => {
    const spec = (await t.api.get('/docs-json')).body;
    const send = spec.paths['/messages'].post.responses;

    expect(Object.keys(send).sort()).toEqual(['201', '400', '401', '402', '403', '404']);
    expect(send['201'].content['application/json'].schema.$ref).toBe('#/components/schemas/SendMessageResponse');
    expect(send['402'].content['application/json'].schema.$ref).toBe('#/components/schemas/ErrorResponse');
    expect(Object.keys(spec.components.schemas.SendMessageResponse.properties).sort()).toEqual(
      ['conversationId', 'cost', 'currentBalance', 'estimatedDelivery', 'id', 'status'].sort(),
    );
    expect(Object.keys(spec.components.schemas.ErrorResponse.properties).sort()).toEqual(['code', 'details', 'message', 'statusCode']);
    expect(Object.keys(spec.paths['/messages/{id}/read'].patch.responses).sort()).toEqual(['200', '401', '404', '409']);
    expect(Object.keys(spec.paths['/clients'].post.responses).sort()).toEqual(['201', '400', '409']);
  });

  describe('toda resposta de erro tem statusCode, code e message', () => {
    it('erro de negócio', async () => {
      const response = await t.api.get('/clients/nao-existe');

      expect(response.body).toEqual({ statusCode: 404, code: 'CLIENT_NOT_FOUND', message: expect.any(String) });
    });

    it('erro de formato, com os campos recusados em details', async () => {
      const response = await t.api.post('/clients').send({});

      expect(response.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        details: { fields: expect.arrayContaining([expect.objectContaining({ field: 'name', problems: expect.any(Array) })]) },
      });
    });

    it('rota inexistente', async () => {
      const response = await t.api.get('/nao-existe');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: expect.any(String) });
    });

    it('JSON malformado', async () => {
      const response = await t.api.post('/clients').set('Content-Type', 'application/json').send('{ "name": ');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ statusCode: 400, code: 'BAD_REQUEST', message: expect.any(String) });
    });
  });
});
