import { Global, Module } from '@nestjs/common';
import { READINESS } from './application/readiness';
import { CLOCK, SystemClock } from './domain/clock';
import { Database } from './infra/postgres/database';

/** O que os dois módulos de negócio usam e nenhum deles possui: relógio, conexão com o banco e a prontidão dela. */
@Global()
@Module({
  providers: [Database, { provide: CLOCK, useClass: SystemClock }, { provide: READINESS, useExisting: Database }],
  exports: [Database, CLOCK, READINESS],
})
export class SharedModule {}
