import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from './shared/domain/errors';
import { DomainExceptionFilter } from './shared/http/domain-exception.filter';

/**
 * Configuração global da aplicação, compartilhada entre `main.ts` e os testes e2e.
 * Se cada um configurasse por conta própria, os testes exercitariam um app
 * diferente do que roda em produção.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Erro de formato sai no mesmo corpo dos erros de negócio: { statusCode, code, message, details }.
      exceptionFactory: (errors) =>
        new ValidationError('VALIDATION_FAILED', 'Requisição inválida', {
          fields: errors.map((error) => ({ field: error.property, problems: Object.values(error.constraints ?? {}) })),
        }),
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors();

  const openapi = new DocumentBuilder()
    .setTitle('Big Chat Brasil')
    .setDescription('Fila de mensagens com prioridade, cobrança pré/pós-paga e proteção contra starvation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openapi));
  return app;
}
