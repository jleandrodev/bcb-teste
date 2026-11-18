import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from './domain/clock';
import { Database } from './infra/postgres/database';

/** O que os dois módulos de negócio usam e nenhum deles possui: relógio e conexão com o banco. */
@Global()
@Module({
  providers: [Database, { provide: CLOCK, useClass: SystemClock }],
  exports: [Database, CLOCK],
})
export class SharedModule {}
