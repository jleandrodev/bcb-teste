# Message queue checks

Build: `npm run build`; `npm run lint`
Run unit: `npx jest --selectProjects unit --verbose`
Run pg: `npm run test:pg -- --verbose`
Plan: `.specs/features/message-queue/plan.md`

`Run pg` executa a suíte ponta a ponta e os testes de contrato contra PostgreSQL (`docker compose up -d db`). A mesma suíte roda sem banco com `npm run test:e2e`; só C38 exige o PostgreSQL.

## Intent

43 checks em 5 fatias · 3 portas de mão única · 0 em aberto

## Checks

### S1 - Clientes e autenticação

**C1** - Cadastro válido responde 201 com documento só em dígitos, ativo, e saldo ou limite conforme o plano (AC 1)
Proof: run pg | ✓ cadastra um pré-pago e devolve o documento só com dígitos, ativo, com o saldo inicial
Proof: run pg | ✓ cadastra um pós-pago por CNPJ e devolve o limite (sem saldo)

**C2** - Documento inválido é recusado com 400 `INVALID_DOCUMENT` (AC 2)
Proof: run pg | ✓ recusa documento inválido (dígito verificador errado) com 400 INVALID_DOCUMENT
Proof: run pg | ✓ recusa documento inválido (todos os dígitos iguais) com 400 INVALID_DOCUMENT
Proof: run pg | ✓ recusa documento inválido (tamanho errado) com 400 INVALID_DOCUMENT
Proof: run pg | ✓ recusa documento inválido (CPF válido enviado como CNPJ) com 400 INVALID_DOCUMENT
Proof: run unit | ✓ recusa CNPJ "11222333000180" (dígito verificador errado) com INVALID_DOCUMENT

**C3** - Documento repetido responde 409 `DOCUMENT_ALREADY_REGISTERED`, inclusive em cadastros simultâneos (AC 3)
Proof: run pg | ✓ recusa documento já cadastrado com 409, mesmo escrito com outra máscara
Proof: run pg | ✓ dois cadastros simultâneos do mesmo documento: um entra, o outro recebe 409

**C4** - Corpo inválido responde 400 sem criar cliente (AC 4)
Proof: run pg | ✓ recusa corpo inválido (campo não declarado) com 400 e não cria o cliente
Proof: run pg | ✓ recusa corpo inválido (planType desconhecido) com 400 e não cria o cliente
Proof: run pg | ✓ recusa corpo inválido (documentType desconhecido) com 400 e não cria o cliente
Proof: run pg | ✓ recusa corpo inválido (saldo negativo) com 400 e não cria o cliente
Proof: run pg | ✓ recusa corpo inválido (limite negativo) com 400 e não cria o cliente
Proof: run pg | ✓ recusa corpo inválido (nome só com espaços) com 400 e não cria o cliente

**C5** - `GET /clients/:id/balance` devolve saldo (pré-pago) ou limite, consumo e disponível (pós-pago), em reais (AC 5)
Proof: run pg | ✓ saldo do pré-pago: balance e available em reais
Proof: run pg | ✓ limite do pós-pago: limite 50,00 com consumo 42,50 deixa 7,50 disponíveis

**C6** - Id de cliente inexistente responde 404 `CLIENT_NOT_FOUND` nas cinco rotas (AC 6)
Proof: run pg | ✓ get /clients/nao-existe responde 404 CLIENT_NOT_FOUND
Proof: run pg | ✓ put /clients/nao-existe responde 404 CLIENT_NOT_FOUND
Proof: run pg | ✓ get /clients/nao-existe/balance responde 404 CLIENT_NOT_FOUND
Proof: run pg | ✓ post /clients/nao-existe/credits responde 404 CLIENT_NOT_FOUND
Proof: run pg | ✓ get /clients/nao-existe/transactions responde 404 CLIENT_NOT_FOUND

**C7** - `PUT /clients/:id` atualiza nome, situação e limite; `planType` converte o plano preservando saldo residual e consumo pendente (AC 7)
Proof: run pg | ✓ pré → pós com limite: passa a consumir o limite e o saldo residual é preservado
Proof: run pg | ✓ pré → pós sem limite responde 400 LIMIT_REQUIRED e o cliente continua pré-pago
Proof: run pg | ✓ pós → pré: o consumo pendente do mês continua registrado
Proof: run unit | ✓ estorno de mensagem cobrada antes da conversão não se perde
Proof: run pg | ✓ GET /clients lista na ordem de cadastro e GET /clients/:id devolve um
Proof: run pg | ✓ PUT /clients/:id atualiza nome, situação e limite, preservando o resto

**C8** - Crédito maior que zero soma ao saldo e registra transação `credit`; zero ou negativo responde 400 (AC 8)
Proof: run pg | ✓ adicionar créditos soma ao saldo e registra uma transação de crédito
Proof: run pg | ✓ recusa crédito de 0 com 400 e mantém o saldo

**C9** - `POST /auth` devolve token e cliente; não cadastrado 401; documento inválido 400 (AC 9)
Proof: run pg | ✓ POST /auth com o documento de um cliente cadastrado devolve token e cliente
Proof: run pg | ✓ POST /auth com documento válido mas não cadastrado responde 401
Proof: run pg | ✓ POST /auth com documento inválido responde 400

**C10** - Rotas de `/messages` e `/conversations` respondem 401 sem credencial válida e aceitam token ou documento (AC 10)
Proof: run pg | ✓ sem credencial responde 401 UNAUTHORIZED
Proof: run pg | ✓ com token desconhecido responde 401
Proof: run pg | ✓ com documento não cadastrado responde 401
Proof: run pg | ✓ o token devolvido por /auth identifica o cliente nas rotas protegidas
Proof: run pg | ✓ o cabeçalho X-Client-Document identifica o cliente, com ou sem máscara

**C11** - Dinheiro é guardado em centavos inteiros e não acumula erro (AC 11)
Proof: run unit | ✓ soma 0,10 + 0,20 e obtém exatamente 0,30
Proof: run pg | ✓ dinheiro não acumula erro: 0,10 + 0,20 de crédito dá exatamente 0,30
Proof: run pg | ✓ saldo 10,00 menos cinco mensagens normais fica em 8,75

### S2 - Envio com cobrança

**C12** - Envio aceito responde 201 no contrato, debita, registra `debit` com o `messageId` e enfileira (AC 12)
Proof: run pg | ✓ aceita o envio, debita o custo, registra o débito ligado à mensagem e enfileira
Proof: run pg | ✓ saldo e lançamento são uma operação só: se a cobrança é recusada, não há lançamento

**C13** - Normal custa R$ 0,25, urgente R$ 0,50, e prioridade ausente é normal (AC 13)
Proof: run pg | ✓ cobra R$ 0,50 pela urgente e R$ 0,25 quando a prioridade não é informada
Proof: run unit | ✓ custa R$ 0,25 quando normal e R$ 0,50 quando urgente

**C14** - Saldo menor que o custo responde 402 `INSUFFICIENT_BALANCE` sem débito, mensagem ou fila; saldo igual ao custo é aceito (AC 14)
Proof: run pg | ✓ um centavo a menos que o custo: 402 INSUFFICIENT_BALANCE, sem débito, mensagem ou fila
Proof: run pg | ✓ saldo exatamente igual ao custo: aceita e zera
Proof: run pg | ✓ 402 por saldo insuficiente não cria conversa com o destinatário

**C15** - Pós-pago soma ao consumo, não devolve `currentBalance` e responde 402 `LIMIT_EXCEEDED` acima do limite (AC 15)
Proof: run pg | ✓ soma o custo ao consumo do mês e não devolve currentBalance
Proof: run pg | ✓ recusa com 402 LIMIT_EXCEEDED quando o consumo passaria do limite
Proof: run pg | ✓ aceita quando o consumo fica exatamente igual ao limite

**C16** - Na virada do mês (UTC) o consumo do pós-pago recomeça do zero (AC 16)
Proof: run pg | ✓ limite consumido em janeiro volta inteiro em 1º de fevereiro (UTC)
Proof: run unit | ✓ na virada do mês (UTC) o consumo recomeça do zero

**C17** - Cliente inativo recebe 403 `CLIENT_INACTIVE` sem débito (AC 17)
Proof: run pg | ✓ cliente inativo recebe 403 CLIENT_INACTIVE
Proof: run pg | ✓ 403 de cliente inativo não cria conversa com o destinatário

**C18** - Envio inválido responde 400 sem débito; sem conversa e sem destinatário é `RECIPIENT_REQUIRED` (AC 18)
Proof: run pg | ✓ conteúdo vazio: 400 VALIDATION_FAILED
Proof: run pg | ✓ conteúdo só com espaços: 400 VALIDATION_FAILED
Proof: run pg | ✓ destinatário com mais de 120 caracteres: 400 VALIDATION_FAILED
Proof: run pg | ✓ prioridade desconhecida: 400 VALIDATION_FAILED
Proof: run pg | ✓ sem conversa e sem destinatário: 400 RECIPIENT_REQUIRED

**C19** - Conversa é reutilizada ou criada pelo destinatário; conversa de outro cliente responde 404 sem débito (AC 19)
Proof: run pg | ✓ o primeiro envio a um destinatário cria a conversa; os seguintes a reutilizam
Proof: run pg | ✓ enviar para a conversa de outro cliente responde 404 e não debita

**C20** - Falha ao gravar depois da cobrança estorna o valor com transação `refund` e propaga o erro (AC 20)
Proof: run pg | ✓ se gravar a mensagem falha, o valor cobrado é estornado e o erro aparece

**C21** - Dez envios simultâneos de R$ 0,25 com saldo R$ 1,00: quatro aceitos, seis 402, saldo zero (AC 21)
Proof: run pg | ✓ dez requisições de R$ 0,25 com saldo R$ 1,00: exatamente quatro aceitas, seis recusadas, saldo zero
Proof: run pg | ✓ dez execuções intercaladas do caso de uso: o saldo nunca é gasto duas vezes
Proof: run pg | ✓ é atômico: vinte débitos simultâneos de R$ 0,25 sobre R$ 1,00 gastam exatamente R$ 1,00

**C22** - Mensagem ou conversa de outro cliente responde 404, igual a id inexistente (AC 22)
Proof: run pg | ✓ o que é de outro cliente responde 404, igual a um id que não existe

**C23** - `GET /messages` filtra por status, prioridade e conversa dentro do cliente autenticado; filtro inválido 400 (AC 23)
Proof: run pg | ✓ filtra por status, prioridade e conversa, sempre dentro do cliente autenticado
Proof: run pg | ✓ GET /messages?status=inexistente responde 400

**C24** - `GET /conversations` lista da mais recente para a mais antiga com última mensagem e `unreadCount` (AC 24)
Proof: run pg | ✓ lista da mais recente para a mais antiga, com última mensagem e não lidas
Proof: run pg | ✓ não lidas conta só as entregues ainda não lidas: na fila não conta, lida deixa de contar

**C25** - `PATCH /messages/:id/read` move `delivered` para `read`; repetir responde 409 `INVALID_STATUS_TRANSITION` (AC 25)
Proof: run pg | ✓ PATCH /messages/:id/read move uma mensagem entregue para read; repetir responde 409

### S3 - Fila com prioridade e proteção contra starvation

**C26** - Mensagens do mesmo nível saem na ordem de chegada (AC 26)
Proof: run unit | ✓ dentro de cada nível vale a ordem de chegada
Proof: run unit | ✓ nada se perde, nada se duplica, cada nível sai em FIFO e nenhuma rajada passa do limite

**C27** - Urgentes saem antes das normais (AC 27)
Proof: run unit | ✓ urgentes saem antes das normais
Proof: run pg | ✓ urgentes são entregues antes das normais

**C28** - Com normal esperando, saem no máximo `URGENT_BURST` urgentes seguidas; a rajada só conta com normal esperando (AC 28)
Proof: run unit | ✓ com o padrão (3), a cada três urgentes sai uma normal
Proof: run unit | ✓ com urgentBurst=2, a cada duas urgentes sai uma normal
Proof: run unit | ✓ a rajada só conta enquanto há normal esperando
Proof: run unit | ✓ sob produção contínua de urgentes, uma normal espera no máximo urgentBurst atendimentos
Proof: run pg | ✓ com o padrão de três urgentes por rajada, as normais não esperam para sempre

**C29** - Fila vazia devolve "nada" sem lançar e continua aceitando itens (AC 29)
Proof: run unit | ✓ vazia devolve undefined e continua aceitando itens

**C30** - Enfileirar e desenfileirar em tempo constante: muito mais rápida do que array com `shift()` na mesma execução (AC 30)
Proof: run unit | ✓ com 100.000 itens é pelo menos cinco vezes mais rápida do que a mesma fila feita com array e shift()

**C31** - `URGENT_BURST` que não é inteiro maior ou igual a 1 é recusado com `RangeError` (AC 31)
Proof: run unit | ✓ recusa urgentBurst=0 com RangeError
Proof: run unit | ✓ recusa urgentBurst=1.5 com RangeError
Proof: run unit | ✓ recusa URGENT_BURST="0" na inicialização, dizendo qual variável está errada
Proof: run unit | ✓ recusa QUEUE_MODE="manual": só async e sync são modos de produção

### S4 - Processamento, falhas e reinício

**C32** - Em modo `async`, o envio responde `queued` e a mensagem chega a `delivered` sem nova requisição (AC 32)
Proof: run pg | ✓ async: responde "queued" na hora e entrega em segundo plano, sem nova requisição

**C33** - Em modo `sync`, o processamento termina antes da resposta (AC 33)
Proof: run pg | ✓ sync: só responde depois de processar
Proof: run pg | ✓ uma falha de infraestrutura durante o processamento não derruba a resposta de um envio já cobrado

**C34** - O status só muda pelas transições permitidas, e cada mudança fica no histórico com horário (AC 34)
Proof: run unit | ✓ percorre queued → processing → sent → delivered → read registrando o horário de cada passo
Proof: run unit | ✓ → failed
Proof: run pg | ✓ uma entrega bem-sucedida registra queued, processing, sent e delivered, com horários em ordem

**C35** - Falha com tentativas restantes devolve a mensagem a `queued`, no fim do nível, após o backoff (AC 35)
Proof: run pg | ✓ provedor falha duas vezes e aceita na terceira: entregue com três tentativas
Proof: run pg | ✓ a mensagem que falhou volta para o fim do seu nível: as outras não ficam presas atrás dela
Proof: run pg | ✓ com backoff, a nova tentativa espera RETRY_BACKOFF_MS e depois acontece sozinha

**C36** - Falha na última tentativa move para `failed` e estorna com transação `refund` ligada à mensagem (AC 36)
Proof: run pg | ✓ pré-pago: esgotadas as tentativas, a mensagem vira failed e o valor volta ao saldo
Proof: run pg | ✓ pós-pago: o estorno abate do consumo do mês
Proof: run pg | ✓ o estorno da falha definitiva acontece antes de a mensagem ser marcada como failed, e nunca duas vezes
Proof: run pg | ✓ dois estornos simultâneos da mesma mensagem: só um vale

**C37** - Disparos simultâneos do consumo entregam cada mensagem uma vez, na ordem da fila (AC 37)
Proof: run pg | ✓ disparos simultâneos entregam cada mensagem uma vez só, uma por vez, na ordem da fila
Proof: run pg | ✓ mensagens que chegam durante o consumo entram no mesmo laço
Proof: run pg | ✓ se o banco falha depois de o provedor aceitar, a mensagem não é estornada nem marcada como failed
Proof: run pg | ✓ se o banco falha depois de o provedor aceitar, o provedor não recebe a mensagem de novo

**C38** - Ao iniciar com PostgreSQL, mensagens `queued` e `processing` voltam à fila na ordem de criação (AC 38)
Proof: run pg | ✓ as mensagens pendentes voltam à fila na ordem de criação, e a que estava em processamento é reprocessada
Proof: run pg | ✓ com o worker assíncrono, a entrega das pendentes recomeça sozinha ao iniciar
Proof: run pg | ✓ pendentes: só queued e processing, de todos os clientes, na ordem de criação

### S5 - Operação e demonstração

**C39** - `GET /queue/status` devolve tamanhos por nível, contadores, anti-starvation e estado do worker (AC 39)
Proof: run pg | ✓ GET /queue/status mostra tamanhos por nível antes e contadores depois do processamento
Proof: run pg | ✓ GET /health responde ok

**C40** - Toda resposta de erro sai no corpo `{ statusCode, code, message, details? }` (AC 40)
Proof: run pg | ✓ erro de negócio
Proof: run pg | ✓ erro de formato, com os campos recusados em details
Proof: run pg | ✓ rota inexistente
Proof: run pg | ✓ JSON malformado
Proof: run pg | ✓ corpo maior que o aceito pelo servidor

**C41** - `/docs` serve a documentação OpenAPI com todas as rotas da seção Surface (AC 41)
Proof: run pg | ✓ a documentação OpenAPI lista todas as rotas da seção Surface da especificação
Proof: run pg | ✓ a página /docs é servida
Proof: run pg | ✓ a documentação descreve o corpo das respostas e os erros de cada rota

**C42** - `scripts/demo.sh` imprime a ordem de entrega `u1 u2 u3 n1 u4 u5 n2` e termina com um 402 `INSUFFICIENT_BALANCE` (AC 42)
Proof: `bash -c 'out="$(./scripts/demo.sh)" && grep -q "entrega: u1 u2 u3 n1 u4 u5 n2" <<<"$out" && grep -q "HTTP 402" <<<"$out" && grep -q INSUFFICIENT_BALANCE <<<"$out"'`

C42 exige a API no ar com entrega simulada lenta (`docker compose up --build -d`).

**C43** - As regras de dependência valem no código: domínio e fila sem framework, `messaging` usa `clients` só pela API pública, `pg` só em `infra/postgres` (Landing 3)
Proof: run unit | ✓ domínio e fila não importam framework, driver de banco nem biblioteca de validação
Proof: run unit | ✓ messaging só enxerga clients pela API pública (src/clients/index.ts)
Proof: run unit | ✓ o driver pg só aparece em infra/postgres

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `POST /auth` statuses (3) | 200 C9 · 400 C9 · 401 C9 | - |
| `GET /clients` statuses (1) | 200 C7 | - |
| `POST /clients` statuses (3) | 201 C1 · 400 C2, C4 · 409 C3 | - |
| `GET /clients/:id` statuses (2) | 200 C7 · 404 C6 | - |
| `PUT /clients/:id` statuses (3) | 200 C7 · 400 C7 · 404 C6 | - |
| `GET /clients/:id/balance` statuses (2) | 200 C5 · 404 C6 | - |
| `POST /clients/:id/credits` statuses (3) | 201 C8 · 400 C8 · 404 C6 | - |
| `GET /clients/:id/transactions` statuses (2) | 200 C8 · 404 C6 | - |
| `GET /conversations` statuses (2) | 200 C24 · 401 C10 | - |
| `GET /conversations/:id` statuses (3) | 200 C24 · 401 C10 · 404 C22 | - |
| `GET /conversations/:id/messages` statuses (3) | 200 C24 · 401 C10 · 404 C22 | - |
| `POST /messages` statuses (6) | 201 C12 · 400 C18 · 401 C10 · 402 C14, C15 · 403 C17 · 404 C19 | - |
| `GET /messages` statuses (3) | 200 C23 · 400 C23 · 401 C10 | - |
| `GET /messages/:id` statuses (3) | 200 C12 · 401 C10 · 404 C22 | - |
| `GET /messages/:id/status` statuses (3) | 200 C34 · 401 C10 · 404 C22 | - |
| `PATCH /messages/:id/read` statuses (4) | 200 C25 · 401 C10 · 404 C22 · 409 C25 | - |
| `GET /queue/status` statuses (1) | 200 C39 | - |
| `GET /health` statuses (1) | 200 C39 | - |
| Landing 1: tabelas persistidas (4) | `clients_client` C21 · `clients_transaction` C8 · `messaging_conversation` C19 · `messaging_message` C38 | - |
| Landing 2: origens de erro fora do domínio (5) | formato C40 · rota inexistente C40 · JSON malformado C40 · corpo grande demais C40 · inesperado C20 | - |
| Landing 2: categorias de erro (6) | validation C2 · unauthorized C10 · payment_required C14 · forbidden C17 · not_found C6 · conflict C3 | - |
| Landing 3: `pg` restrito a `infra/postgres` (1) | C43 | - |
| Transições de status (36) | C34, table-driven over all 36 (`message.spec.ts`, tabela 6 × 6) | - |
| Planos de cobrança (2) | prepaid C14 · postpaid C15 | - |
| Modos do worker (3) | async C32 · sync C33 · manual C37 | - |
| Regra anti-starvation, AC 28 (3 exemplos) | burst 2 C28 · padrão 3 C28 · rajada sem normal esperando C28 | - |
| Adaptadores de cada porta de repositório (2) | memória C21 · PostgreSQL C21, C38 | - |
| Configuração de inicialização (2 montagens) | `main.ts` C42 · testes (`test/support/app.ts`, mesmo `configureApp`) C40 | - |

## Swept

- validation: C2, C4, C18
- failure modes: C20, C36, C37 - falha ao gravar depois da cobrança, falha definitiva de entrega e falha de persistência depois de o provedor aceitar
- idempotency: C36, C37 - o estorno é idempotente por mensagem e cada mensagem é entregue uma vez dentro do processo; entre reinícios a garantia é at-least-once (C38, ADR-008)
- authorization: C10, C22
- concurrency: C3, C21, C37
- data lifecycle: C38 - o que foi gravado volta igual depois de reiniciar; sem TTL nem exclusão no escopo
- dependency failure: C35, C36
- state transitions: C34, C25
- observability: C39

## Handoff

- **Settled mid-build:** corpo de erro único para toda falha (porta 2 do Landing); após code review independente: extrato atômico com o saldo, estorno idempotente e anterior ao `failed`, nenhuma gravação antes da cobrança, resumo da conversa derivado das mensagens, conversão de plano (AD-013) e mensagem sem campo de tipo (AD-014), decisões aprovadas pelo autor
- **Dispatched:** none
- **Boundary:** C1-C43 fechados no commit que adiciona este arquivo
- **Abandoned:** front de demonstração, por decisão do autor (AD-012)
- **Walked:** `scripts/demo.sh` executado contra a API com PostgreSQL: ordem `u1 u2 u3 n1 u4 u5 n2`, 402 ao final
