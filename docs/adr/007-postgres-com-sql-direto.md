# ADR-007: PostgreSQL com SQL direto atrás de portas, e adaptador em memória

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: persistência

## Contexto e problema

O enunciado prefere PostgreSQL e aceita memória para casos simples. São quatro tabelas e cerca de quinze consultas, uma delas crítica: o débito com lock de linha (ADR-006). O domínio é imutável e não conhece infraestrutura (ADR-002, ADR-003).

## Direcionadores

- Controle explícito do lock e da transação do débito.
- Nenhuma dependência de persistência dentro do domínio.
- Testes rápidos sem banco e testes reais com banco, exercitando o mesmo contrato.
- Pouco código a explicar.

## Opções consideradas

- Driver `pg` com SQL escrito à mão, atrás de interfaces de repositório
- TypeORM
- Prisma
- Somente memória

## Decisão

**`pg` com SQL direto**, em `src/**/infra/postgres/`, implementando as portas definidas em `application/ports.ts`. Cada repositório tem duas funções de tradução (`toDomain`, `toRow`) e nada mais. O esquema está em `db/migrations/001_init.sql`, aplicado na inicialização por um migrador mínimo que registra o que já rodou em `schema_migrations`.

Ao lado dele existe um **adaptador em memória** para as mesmas portas. A variável `PERSISTENCE` (`memory` por padrão, `postgres` no docker-compose) escolhe o adaptador no módulo, o único lugar que conhece os dois.

Como a fila continua em memória (ADR-004), na inicialização com PostgreSQL as mensagens `queued` e `processing` voltam à fila pela ordem de criação.

### Consequências positivas

- O SQL do débito está visível: `BEGIN`, `SELECT … FOR UPDATE`, `UPDATE`, `COMMIT`.
- A mesma suíte de testes roda contra os dois adaptadores (ADR-010), o que prova que a porta é um contrato de verdade.
- Subir a API sem banco continua possível para desenvolvimento e demonstração rápida.

### Consequências negativas

- O mapeamento coluna ↔ objeto é manual; um campo novo exige mexer no SQL e nas duas funções de tradução.
- O migrador é simples: aplica arquivos em ordem, sem rollback. Para um esquema que evolui em equipe, a escolha seria uma ferramenta de migração.
- Sem query builder, consultas com filtros opcionais montam o `WHERE` à mão (um caso: listagem de mensagens).

## Opções rejeitadas

- **TypeORM / Prisma**: para quatro tabelas acrescentam entidades anotadas ou cliente gerado, e o lock pessimista passa a depender de API específica da ferramenta. Com mais tabelas e relações o balanço muda.
- **Somente memória**: aceito pelo FAQ, mas deixaria sem prova a parte mais delicada (concorrência no débito) e perderia tudo a cada reinício.
