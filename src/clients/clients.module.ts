import { Module } from '@nestjs/common';
import { Database } from '../shared/infra/postgres/database';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY, TRANSACTION_REPOSITORY } from './application/ports';
import type { TransactionRepository } from './application/ports';
import { Sessions } from './application/sessions';
import { AuthGuard } from './http/auth.guard';
import { AuthController, ClientsController } from './http/clients.controller';
import { InMemoryClientRepository, InMemoryTransactionRepository } from './infra/memory/repositories';
import { PostgresClientRepository, PostgresTransactionRepository } from './infra/postgres/repositories';

/**
 * Composição do módulo de clientes: o único lugar que liga cada porta a um
 * adaptador. A escolha entre PostgreSQL e memória vem de PERSISTENCE (ADR-007).
 */
@Module({
  controllers: [AuthController, ClientsController],
  providers: [
    ClientsService,
    Sessions,
    AuthGuard,
    {
      provide: TRANSACTION_REPOSITORY,
      inject: [Database],
      useFactory: (db: Database) => (db.enabled ? new PostgresTransactionRepository(db) : new InMemoryTransactionRepository()),
    },
    {
      provide: CLIENT_REPOSITORY,
      inject: [Database, TRANSACTION_REPOSITORY],
      // Em memória, saldo e extrato compartilham a mesma instância para o `mutate` gravar os dois juntos.
      useFactory: (db: Database, transactions: TransactionRepository) =>
        db.enabled ? new PostgresClientRepository(db) : new InMemoryClientRepository(transactions as InMemoryTransactionRepository),
    },
  ],
  exports: [ClientsService, AuthGuard],
})
export class ClientsModule {}
