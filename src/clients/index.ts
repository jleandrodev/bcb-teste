/**
 * API pública do módulo de clientes. É o único arquivo de `clients` que outros
 * módulos podem importar (ADR-002); `test/architecture.spec.ts` verifica isso.
 */
export { ClientsModule } from './clients.module';
export { ClientsService } from './application/clients.service';
export { Client } from './domain/client';
export { AuthGuard, CurrentClient } from './http/auth.guard';
