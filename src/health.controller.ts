import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from './shared/http/api-errors';
import { READINESS } from './shared/application/readiness';
import type { Readiness } from './shared/application/readiness';

class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ enum: ['memory', 'postgres'], description: 'Onde os dados estão sendo gravados' })
  persistence!: 'memory' | 'postgres';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS) private readonly readiness: Readiness) {}

  /** Pronta para atender: com PostgreSQL, só responde 200 se o banco responde. */
  @Get()
  @ApiOperation({ summary: 'A API está pronta para atender?' })
  @ApiOkResponse({ type: HealthResponse })
  @ApiErrors(503)
  async check(): Promise<HealthResponse> {
    if (!(await this.readiness.isReady())) throw new ServiceUnavailableException('Banco de dados indisponível');
    return { status: 'ok', persistence: this.readiness.persistence };
  }
}
