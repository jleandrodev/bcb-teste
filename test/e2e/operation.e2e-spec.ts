import { TestApp, startApp } from '../support/app';
import { describePostgres, usingPostgres, withDatabaseOffline } from '../support/database';

describe('Operação (S5)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });

  afterAll(() => t.close());

  describe('GET /health', () => {
    it('responde 200 e diz qual persistência está em uso', async () => {
      const response = await t.api.get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', persistence: usingPostgres ? 'postgres' : 'memory' });
    });

    describePostgres('com PostgreSQL', () => {
      it('responde 503 SERVICE_UNAVAILABLE enquanto o banco está fora do ar e volta a 200 quando ele retorna', async () => {
        const during = await withDatabaseOffline(() => t.api.get('/health'));
        const after = await t.api.get('/health');

        expect(during.status).toBe(503);
        expect(during.body).toEqual({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'Banco de dados indisponível' });
        expect(after.status).toBe(200);
      });
    });

    it('a documentação declara o 200 e o 503', async () => {
      const responses = (await t.api.get('/docs-json')).body.paths['/health'].get.responses;

      expect(Object.keys(responses).sort()).toEqual(['200', '503']);
      expect(responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/HealthResponse');
    });
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

    it('corpo maior que o aceito pelo servidor', async () => {
      const response = await t.api.post('/clients').send({ name: 'x'.repeat(200_000) });

      expect(response.status).toBe(413);
      expect(response.body).toEqual({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) });
    });

    it('JSON malformado', async () => {
      const response = await t.api.post('/clients').set('Content-Type', 'application/json').send('{ "name": ');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ statusCode: 400, code: 'BAD_REQUEST', message: expect.any(String) });
    });
  });
});
