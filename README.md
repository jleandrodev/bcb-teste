# Big Chat Brasil

Solução do [desafio backend da Irrah](https://github.com/irrahgroup/irrah-tech-challenges/blob/main/docs/backend.md): uma API em que empresas enviam mensagens pagas (pré ou pós-pago), e uma fila com prioridade decide a ordem de entrega sem deixar nenhuma mensagem esperando para sempre.

NestJS + TypeScript, PostgreSQL, fila própria em memória. Sem ORM, sem broker, sem biblioteca de fila.

## Como rodar

```bash
docker compose up --build        # API em http://localhost:3000, documentação em /docs
./scripts/demo.sh                # em outro terminal: o cenário completo em 15 segundos
```

Se a porta 5432 já estiver em uso por um PostgreSQL local: `DB_PORT=5433 docker compose up --build`.

Sem Docker (tudo em memória, nada para instalar além do Node 22):

```bash
npm ci
npm run start:dev
```

## Demonstração

`scripts/demo.sh` usa só `bash` e `curl`. Ele cadastra um cliente pré-pago com R$ 3,25, envia duas mensagens normais e cinco urgentes enquanto o worker está ocupado, e mostra:

```text
== 3. Fila logo após os envios (GET /queue/status)
{"size":{"urgent":5,"normal":2,"total":7}, ... "antiStarvation":{"urgentBurst":3,"preventions":0}, "worker":{"mode":"async","running":true}}

== 5. Ordem de entrega (pelo horário de 'delivered' no histórico de cada mensagem)
  chegada: n1 n2 u1 u2 u3 u4 u5
  entrega: u1 u2 u3 n1 u4 u5 n2

== 7. Saldo zerado: o próximo envio é recusado antes de entrar na fila
  HTTP 402
  {"statusCode":402,"code":"INSUFFICIENT_BALANCE","message":"Saldo insuficiente para enviar a mensagem","details":{"balance":0,"cost":0.25}}
```

Para explorar à mão: Swagger em [`/docs`](http://localhost:3000/docs) ou o arquivo [`requests.http`](requests.http).

## O que foi implementado

| Parte do desafio | Entregue | Onde olhar |
|---|---|---|
| 1. Clientes, mensagens e cobrança | cadastro com validação de CPF/CNPJ, saldo e limite, envio que só entra na fila depois de pago, R$ 0,25 normal e R$ 0,50 urgente, 402 sem saldo | [`src/clients/domain`](src/clients/domain), [`send-message.use-case.ts`](src/messaging/application/send-message.use-case.ts) |
| 2. Autenticação e fila com prioridade | `POST /auth` e identificação por documento; fila de dois níveis, FIFO em cada nível, com limite de urgentes seguidas | [`src/messaging/queue`](src/messaging/queue) |
| 3. Processamento assíncrono | worker em segundo plano, estados `queued → processing → sent → delivered → read`, retry com backoff exponencial, `failed` com estorno, `GET /queue/status` | [`message-processor.ts`](src/messaging/application/message-processor.ts) |
| Diferenciais | PostgreSQL, Docker, OpenAPI, testes (99% de linhas), CI, fila reconstruída ao reiniciar, débito seguro sob concorrência | abaixo |

As 18 rotas estão na seção *Surface* da [especificação](.specs/features/message-queue/plan.md).

## Como a fila funciona

Duas listas ligadas, uma por prioridade, com entrada e saída em O(1). Urgentes saem primeiro. A proteção contra *starvation* é uma regra com limite que se pode demonstrar:

> Enquanto houver mensagem normal esperando, saem no máximo `URGENT_BURST` (padrão 3) urgentes seguidas; a próxima é uma normal.

Com isso uma normal na frente da fila espera no máximo três entregas, não importa quantas urgentes cheguem. A contagem só vale enquanto há normal esperando: urgentes atendidas com a fila normal vazia não geram "dívida". Alternativas consideradas (heap, *aging*, pesos) e o motivo da escolha estão no [ADR-004](docs/adr/004-fila-em-memoria-com-anti-starvation.md).

## Arquitetura

Monolito modular com dois módulos e dependências apontando para o domínio:

```text
src/
  clients/      quem paga: Client, Document, políticas de cobrança
    index.ts    API pública do módulo (o único arquivo que messaging importa)
  messaging/    o que é enviado: Message, Conversation, fila, worker
  shared/       Money, erros de domínio, relógio, conexão com o banco
  (em cada módulo)  domain/ → application/ → infra/{memory,postgres}/ e http/
```

- O domínio não importa NestJS nem `pg`. Regra de negócio fica em `Client`, `Message`, `Money` e nas políticas; services orquestram.
- A cobrança lê, decide e grava sob lock da linha do cliente (`SELECT … FOR UPDATE`): dez envios simultâneos com saldo para quatro resultam em quatro aceitos.
- Cobrança e gravação da mensagem pertencem a módulos diferentes; se a segunda falha, a primeira é estornada.
- Essas regras são verificadas por [`test/architecture.spec.ts`](test/architecture.spec.ts), não só descritas.

Diagramas (contexto, camadas, sequência do envio, estados, dados) em [`docs/architecture.md`](docs/architecture.md).

## Decisões

| ADR | Decisão |
|---|---|
| [001](docs/adr/001-nestjs-com-typescript.md) | NestJS com TypeScript |
| [002](docs/adr/002-monolito-modular-em-camadas.md) | Monolito modular com dois módulos e camadas |
| [003](docs/adr/003-ddd-tatico-seletivo.md) | DDD tático só onde há invariante |
| [004](docs/adr/004-fila-em-memoria-com-anti-starvation.md) | Fila em memória com limite de urgentes seguidas |
| [005](docs/adr/005-dinheiro-em-centavos.md) | Dinheiro em centavos inteiros |
| [006](docs/adr/006-cobrar-antes-de-enfileirar.md) | Cobrar antes de enfileirar, com débito atômico e compensação |
| [007](docs/adr/007-postgres-com-sql-direto.md) | PostgreSQL com SQL direto, sem ORM |
| [008](docs/adr/008-worker-no-processo-com-retry.md) | Worker no mesmo processo, com retry e estorno |
| [009](docs/adr/009-autenticacao-simples.md) | Autenticação simples por token ou documento |
| [010](docs/adr/010-testes-reais-sem-mocks.md) | Testes reais, sem mocks |

## Testes

```bash
npm test                               # unitários e regras de arquitetura (sem dependências)
npm run test:e2e                       # ponta a ponta, adaptadores em memória
docker compose up -d db && npm run test:pg   # a mesma suíte + contrato dos repositórios, em PostgreSQL
npm run verify                         # lint, build e cobertura: rode antes de qualquer commit
```

359 testes com PostgreSQL (152 unitários e de arquitetura, 207 ponta a ponta e de contrato); 99% de linhas e 87% de ramos.

- **Sem `jest.mock`, `jest.fn` ou `spyOn`.** Os testes sobem a aplicação real e falam HTTP. O único dublê é o [`FakeMessageGateway`](test/support/fake-message-gateway.ts), no lugar do provedor externo que o desafio não fornece.
- **A mesma suíte roda em memória e em PostgreSQL.** Os [testes de contrato](test/repositories) aplicam as mesmas expectativas aos dois adaptadores de cada repositório, inclusive concorrência.
- **O nome do teste é a regra de negócio.** `npx jest --verbose` lê como a especificação.
- **Cada critério da especificação tem um teste**, listado em [`checks.md`](.specs/features/message-queue/checks.md).
- Além de exemplos: 1.000 sequências geradas com semente fixa verificam as propriedades da fila, e a tabela de transições de status é testada nos 36 pares.

## Configuração

Todas as variáveis são opcionais e lidas do ambiente do processo (o `docker-compose.yml` define as do contêiner; [`.env.example`](.env.example) lista todas). Valor inválido interrompe a inicialização com uma mensagem que nomeia a variável.

| Variável | Padrão | Efeito |
|---|---|---|
| `PERSISTENCE` | `memory` | `postgres` usa o banco em `DATABASE_URL` |
| `QUEUE_MODE` | `async` | `sync` processa dentro da requisição |
| `URGENT_BURST` | `3` | urgentes seguidas permitidas com normal esperando |
| `MAX_ATTEMPTS` | `3` | tentativas antes de `failed` e estorno |
| `RETRY_BACKOFF_MS` | `200` | espera antes da nova tentativa; dobra a cada uma |
| `PROCESSING_DELAY_MS` | `0` | duração da entrega simulada (o compose usa 800 para a fila ficar visível) |

## Premissas e limitações

- **A entrega é simulada.** O desafio não define provedor; o gateway espera e confirma. Em produção `delivered` e `read` viriam por webhook.
- **A fila vive na memória de um processo.** O estado das mensagens está no banco, e a fila é reconstruída na inicialização, mas duas instâncias da API teriam duas filas. Escalar horizontalmente pede um broker; o caminho está em [`docs/architecture.md`](docs/architecture.md) e no ADR-008.
- **Entrega at-least-once.** Uma mensagem pega em `processing` por uma queda é reprocessada ao reiniciar.
- **Autenticação identifica, não protege.** Token opaco em memória ou documento no cabeçalho, como pede o enunciado; as rotas de `/clients` são abertas. Não é um desenho para produção (ADR-009).
- **Sem idempotência no envio.** Repetir o mesmo `POST /messages` (por timeout do cliente, por exemplo) cobra e envia duas vezes; a correção é uma `Idempotency-Key`. O estorno, esse sim, é idempotente por mensagem.
- **Sem paginação.** As listagens devolvem tudo; para o volume do desafio basta, em produção pediria cursor.
- **Cobrança e mensagem não são uma transação só.** São módulos diferentes: se gravar a mensagem falha, o valor é estornado; se o processo cair exatamente entre as duas, sobra um débito sem mensagem, localizável pelo extrato (ADR-006).
- **O limite do pós-pago reinicia na virada do mês em UTC.** Converter de plano preserva saldo residual e consumo pendente.
- O que acrescentei ou interpretei em relação ao enunciado está na seção *Differences from the source* da especificação.

## Como este projeto foi construído

Especificação antes do código: [`plan.md`](.specs/features/message-queue/plan.md) traz o problema, 42 critérios de aceitação com valores concretos e as decisões difíceis de reverter; os ADRs registram o porquê de cada escolha; [`checks.md`](.specs/features/message-queue/checks.md) liga cada critério ao teste que o prova. Usei assistência de IA (Claude Code) na implementação, com essas especificações como contrato e a suíte de testes como verificação; as decisões e a revisão são minhas. [`AGENTS.md`](AGENTS.md) descreve as regras que valem para qualquer pessoa ou agente que mexa neste repositório.
