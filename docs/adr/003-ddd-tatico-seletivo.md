# ADR-003: DDD tático somente onde há invariante

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: domínio, modelagem

## Contexto e problema

Parte do sistema protege regras que não podem ser violadas (não gastar saldo que não existe, não entregar mensagem que falhou). Outra parte só guarda e devolve dados (conversas, listagens). Aplicar o mesmo peso de modelagem às duas produz ou um modelo anêmico com regras espalhadas em services, ou cerimônia sem função.

## Direcionadores

- Cada invariante em um único lugar, impossível de contornar.
- Linguagem do negócio no código (`charge`, `refund`, `transitionTo`), sem setters.
- Não criar bloco tático que não proteja nada.

## Decisão

Modelo rico **apenas onde existe invariante**:

| Bloco | Onde | Invariante que protege |
|---|---|---|
| Aggregate `Client` | `clients/domain/client.ts` | cliente inativo não é cobrado; a cobrança respeita o plano |
| Value object `Money` | `shared/domain/money.ts` | valor nunca negativo nem fracionário em centavos |
| Value object `Document` | `clients/domain/document.ts` | CPF/CNPJ sempre válido e normalizado |
| Strategy `BillingPolicy` | `clients/domain/billing/` | regra de cada plano (saldo; limite mensal com virada de mês) |
| Aggregate `Message` | `messaging/domain/message.ts` | só transições de status permitidas; custo fixado na criação |
| Estrutura `PriorityMessageQueue` | `messaging/queue/` | ordem FIFO por nível e limite de espera das normais |

Aggregates são pequenos, imutáveis (cada operação devolve uma nova instância) e se referenciam por identidade. Cada operação altera **um** aggregate; a consistência entre `Client` e `Message` é tratada no ADR-006.

`Conversation` é uma estrutura de dados simples: não tem regra própria.

### Consequências positivas

- Para mudar uma regra há um arquivo a abrir, e o teste dele roda em milissegundos.
- Aggregates imutáveis permitem ao repositório aplicar a mudança de forma atômica (`mutate(id, fn)`).

### Consequências negativas

- Criar uma instância nova a cada operação custa alocação; irrelevante neste volume.
- Quem lê precisa saber que parte do modelo é rica e parte é dado puro. A tabela acima é o mapa.

## Opções rejeitadas

- **Modelo anêmico com regras em services**: o `if` de plano apareceria em cobrar, estornar e consultar saldo, e nada impediria gravar um saldo negativo.
- **DDD tático completo** (eventos de domínio, factories, domain services, entidade de domínio separada de entidade ORM com mapper): não há ORM (ADR-007), não há segundo consumidor para eventos, e nenhuma regra atravessa aggregates a ponto de pedir um domain service.
