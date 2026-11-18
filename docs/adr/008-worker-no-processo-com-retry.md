# ADR-008: Worker no mesmo processo, com retry limitado e estorno

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: processamento, falhas

## Contexto e problema

A Parte 1 do desafio pede processamento síncrono; a Parte 3, um worker assíncrono com tratamento de falhas. O FAQ aceita "um loop em background" e pede que o envio seja simulado. A fila está na memória do processo da API (ADR-004), então só esse processo a enxerga.

## Decisão

Um único `MessageProcessor` atende às duas partes, com o modo escolhido por `QUEUE_MODE`:

| Modo | Quando o consumo acontece | Uso |
|---|---|---|
| `sync` | dentro da requisição | Parte 1 |
| `async` (padrão) | em seguida, fora da requisição (`setImmediate`) | Parte 3 |
| `manual` | só quando chamado | testes determinísticos |

Regras do processamento:

- **Um laço por vez.** Chamadas concorrentes a `drain()` compartilham a mesma execução; assim a ordem que a fila decide é a ordem de entrega.
- **Consumo idempotente.** O item só é processado se a mensagem ainda estiver `queued`.
- **Retry limitado.** Falhou com tentativas restantes: volta a `queued` e ao fim do seu nível após `RETRY_BACKOFF_MS × 2^(tentativa−1)`. `MAX_ATTEMPTS` padrão: 3.
- **Falha definitiva.** Na última tentativa o custo é estornado e a mensagem vai para `failed`, nesta ordem (ADR-006).
- **Falha de entrega não é falha de registro.** Só o erro do provedor aciona retry ou estorno. Um erro ao gravar o resultado de uma entrega bem-sucedida interrompe o laço e vai para o log; a mensagem não é reenviada nem estornada.
- **Encerramento.** Ao desligar, o laço para de pegar itens, espera a entrega em andamento terminar e cancela os timers de retry.

A entrega passa pela porta `MessageGateway`; a implementação entregue simula o provedor com atraso configurável e log.

### Consequências positivas

- O caso de uso de envio não sabe em que modo o processamento roda.
- A garantia é *at-least-once* dentro do processo, com limite, e sem mensagem "presa" bloqueando as demais.

### Consequências negativas

- Não é paralelismo: é um laço assíncrono na mesma thread. O enunciado fala em "thread/processo separado para processar a fila em background"; o que ele exige de fato, execução contínua e independente da requisição HTTP, está atendido, e uma thread separada não traria ganho porque o trabalho é espera de I/O, não CPU. Separar em outro processo é o passo descrito em `docs/architecture.md` quando houver um broker.
- Uma entrega pode se repetir se o provedor aceitar e a confirmação se perder. A defesa seria enviar o `id` da mensagem como chave de idempotência ao provedor real.
- Todo erro é tratado como passageiro. Distinguir erro permanente (destino inválido) evitaria tentativas inúteis.
- O retry no fim do nível perde a posição original da mensagem.

## Opções rejeitadas

- **Processo worker separado**: exige fila fora do processo, que o ADR-004 descarta.
- **`worker_threads`**: resolve trabalho de CPU, que não existe aqui.
- **Retry imediato e sem limite**: insiste no ritmo que acabou de falhar e deixa uma mensagem ruim ocupar o worker indefinidamente.
- **Retry no início da fila**: preserva a ordem e bloqueia todas as outras enquanto o provedor estiver fora.
