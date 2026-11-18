# STATE

Registro das decisões que restringem as próximas especificações. O conteúdo de cada decisão
está no ADR correspondente; esta tabela é o índice. Uma decisão ativa só muda com outra que a
substitua, e a antiga passa a `superseded by AD-NNN`.

## Decisions

| ID | Decisão | Onde está | Status | Data |
| --- | --- | --- | --- | --- |
| AD-001 | Backend em NestJS com TypeScript | [ADR-001](../docs/adr/001-nestjs-com-typescript.md) | active | 2026-11-18 |
| AD-002 | Monolito modular: `clients` e `messaging`, camadas por módulo, fronteira por `index.ts` | [ADR-002](../docs/adr/002-monolito-modular-em-camadas.md) | active | 2026-11-18 |
| AD-003 | DDD tático somente onde há invariante | [ADR-003](../docs/adr/003-ddd-tatico-seletivo.md) | active | 2026-11-18 |
| AD-004 | Fila em memória, dois níveis, rajada de 3 urgentes para 1 normal | [ADR-004](../docs/adr/004-fila-em-memoria-com-anti-starvation.md) | active | 2026-11-18 |
| AD-005 | Dinheiro em centavos inteiros | [ADR-005](../docs/adr/005-dinheiro-em-centavos.md) | active | 2026-11-18 |
| AD-006 | Cobrar antes de enfileirar; débito atômico; estorno como compensação e em falha definitiva | [ADR-006](../docs/adr/006-cobrar-antes-de-enfileirar.md) | active | 2026-11-18 |
| AD-007 | PostgreSQL com SQL direto atrás de portas; adaptador em memória | [ADR-007](../docs/adr/007-postgres-com-sql-direto.md) | active | 2026-11-18 |
| AD-008 | Worker no mesmo processo; seis estados; retry limitado com backoff | [ADR-008](../docs/adr/008-worker-no-processo-com-retry.md) | active | 2026-11-18 |
| AD-009 | Autenticação por token opaco ou documento no cabeçalho | [ADR-009](../docs/adr/009-autenticacao-simples.md) | active | 2026-11-18 |
| AD-010 | Testes com implementações reais, sem bibliotecas de mock | [ADR-010](../docs/adr/010-testes-reais-sem-mocks.md) | active | 2026-11-18 |
| AD-011 | Extensões do contrato: créditos, histórico financeiro, leitura e health | [plan.md](features/message-queue/plan.md#differences-from-the-source) | active | 2026-11-18 |
| AD-012 | Sem front: demonstração por Swagger e `scripts/demo.sh` | [plan.md](features/message-queue/plan.md#out-of-scope) | active | 2026-11-18 |
| AD-013 | Conversão de plano preserva saldo residual e consumo pendente; estorno sem consumo a abater vira crédito | [plan.md](features/message-queue/plan.md#differences-from-the-source) | active | 2026-11-18 |
| AD-014 | Mensagem sem campo de tipo (SMS/WhatsApp): o contrato segue a entidade do `backend.md` | [plan.md](features/message-queue/plan.md#differences-from-the-source) | active | 2026-11-18 |
