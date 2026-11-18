import { Module } from '@nestjs/common';
import { Database } from '../shared/infra/postgres/database';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY, SESSION_STORE, TRANSACTION_REPOSITORY } from './application/ports';
import { AuthGuard } from './http/auth.guard';
import { AuthController, ClientsController } from './http/clients.controller';
import { InMemoryClientRepository, InMemorySessionStore, InMemoryTransactionRepository } from './infra/memory/repositories';
import { PostgresClientRepository, PostgresTransactionRepository } from './infra/postgres/repositories';

/**
 * Composição do módulo de clientes: o único lugar que liga cada porta a um
 * adaptador. A escolha entre PostgreSQL e memória vem de PERSISTENCE (ADR-007).
 */
@Module({
  controllers: [AuthController, ClientsController],
  providers: [
    ClientsService,
    AuthGuard,
    {
      provide: CLIENT_REPOSITORY,
      inject: [Database],
      useFactory: (db: Database) => (db.enabled ? new PostgresClientRepository(db) : new InMemoryClientRepository()),
    },
    {
      provide: TRANSACTION_REPOSITORY,
      inject: [Database],
      useFactory: (db: Database) => (db.enabled ? new PostgresTransactionRepository(db) : new InMemoryTransactionRepository()),
    },
    // Sessões ficam sempre em memória (ADR-009).
    { provide: SESSION_STORE, useClass: InMemorySessionStore },
  ],
  exports: [ClientsService, AuthGuard],
})
export class ClientsModule {}
