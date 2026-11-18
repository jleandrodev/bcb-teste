# AGENTS.md

Instruções para agentes de código (e para pessoas) que forem trabalhar neste repositório.

## O que é

API de fila de mensagens com prioridade e cobrança (desafio Big Chat Brasil) em NestJS + TypeScript e PostgreSQL.

## Comandos

| Para | Comando |
|---|---|
| Subir tudo | `docker compose up --build` (API `:3000`, docs `/docs`) |
| Demonstração | `./scripts/demo.sh` |
| API sem banco | `npm run start:dev` (`PERSISTENCE=memory`) |
| Testes unitários | `npm test` |
| Ponta a ponta (memória) | `npm run test:e2e` |
| Ponta a ponta e repositórios (PostgreSQL) | `docker compose up -d db && npm run test:pg` |
| Tudo antes de um commit | `npm run verify` |
| Lint e tipos | `npm run lint && npm run build` |

## Como o trabalho acontece

1. **Especificação antes do código.** Toda mudança de comportamento começa em `.specs/features/<feature>/plan.md`: problema, critérios em EARS com valor concreto, forma, superfície e portas de mão única. O plano só é construído depois de aprovado pelo autor.
2. **Cada critério tem um teste.** `.specs/features/<feature>/checks.md` liga o número do critério ao teste que o prova.
3. **Decisão difícil de reverter vira ADR** em `docs/adr/` (formato MADR, imutável; para mudar, um novo ADR substitui o antigo) e entra no índice `.specs/STATE.md`.

## Regras de arquitetura

- Dependências apontam para o domínio: `http` e `infra` → `application` → `domain`/`queue`.
- `domain/` e `queue/` não importam `@nestjs/*`, `pg`, `class-validator` nem outras camadas.
- `messaging` importa de `clients` somente por `src/clients/index.ts`.
- Regra de negócio fica no domínio. Controller recebe, delega e apresenta. Erro de negócio é `DomainError`; só o filtro conhece status HTTP.
- Dinheiro é `Money` (centavos). Decimal só entra e sai pela borda.
- Mudança de saldo passa por `ClientRepository.mutate`. Nunca ler o cliente, decidir e gravar em passos separados.
- Porta nova só quando existir uma segunda implementação real.

## Regras de teste

- Sem `jest.mock`, `jest.fn` ou `spyOn`. O único substituto é o `FakeMessageGateway`.
- Nome do teste é a regra de negócio, em português.
- Mudou comportamento: muda o critério na spec, o teste e o código, nesta ordem.

## O que ler para cada tarefa

| Tarefa | Leia |
|---|---|
| Mexer na fila ou na regra de prioridade | `docs/adr/004-*`, `src/messaging/queue/` |
| Cobrança, planos, saldo | `docs/adr/005-*`, `docs/adr/006-*`, `src/clients/domain/` |
| Status de mensagem, retry | `docs/adr/008-*`, `src/messaging/domain/message.ts`, `src/messaging/application/message-processor.ts` |
| Persistência | `docs/adr/007-*`, `db/migrations/`, `src/**/infra/postgres/` |
| Novo endpoint | seção Surface do `plan.md`, `docs/architecture.md` §9 |
| Testes | `docs/adr/010-*`, `test/support/` |

Leia só o que a tarefa pede.

## Regras gerais

- Código mínimo que resolve o critério. Nada especulativo, nenhuma abstração de uso único.
- Identificadores em inglês; documentação e nomes de teste em português.
- Commits no padrão Conventional Commits.
