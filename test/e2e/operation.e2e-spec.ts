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

  it('erro de negócio e erro de formato saem no mesmo corpo: statusCode, code, message e details', async () => {
    const business = await t.api.get('/clients/nao-existe');
    const format = await t.api.post('/clients').send({});

    expect(business.body).toEqual({ statusCode: 404, code: 'CLIENT_NOT_FOUND', message: expect.any(String) });
    expect(format.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: expect.any(String),
      details: { fields: expect.arrayContaining([expect.objectContaining({ field: 'name', problems: expect.any(Array) })]) },
    });
  });
});
