# ADR-006: Cobrar antes de enfileirar, com débito atômico e compensação

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: consistência, concorrência, regras de negócio

## Contexto e problema

Enviar uma mensagem altera dois aggregates de módulos diferentes: o `Client` (saldo ou consumo) e a `Message`. As regras de negócio fixam a ordem: verificar, debitar, registrar a transação, enfileirar. Dois riscos precisam de resposta: dois envios simultâneos gastarem o mesmo saldo, e uma falha entre a cobrança e a gravação deixar o cliente cobrado sem mensagem.

## Direcionadores

- Saldo nunca negativo, sob qualquer concorrência.
- Nada entra na fila sem estar pago.
- Um aggregate por transação; `messaging` não participa da transação de `clients` (ADR-002, ADR-003).

## Opções consideradas

- Débito atômico em `clients`, depois gravação em `messaging`, com estorno se a segunda falhar
- Uma transação de banco cobrindo os dois módulos
- Reservar o valor e confirmar só na entrega

## Decisão

**Cobrar primeiro, de forma atômica, e compensar em caso de falha.**

1. *Atomicidade do débito*: o caso de uso não lê o saldo. Ele chama `ClientRepository.mutate(id, fn)`, que lê, aplica a função pura `client.charge(cost)` e grava como uma única operação. Em PostgreSQL é uma transação com `SELECT … FOR UPDATE`; em memória é um trecho sem `await` entre ler e gravar.
2. *Compensação*: se gravar a mensagem ou enfileirar falhar depois da cobrança, o caso de uso estorna o valor (transação `refund`) e propaga o erro.
3. *Falha definitiva de entrega*: o worker estorna o custo guardado na própria mensagem (ADR-008).

Validações que não custam dinheiro (corpo, conversa de outro cliente) acontecem antes da cobrança.

### Consequências positivas

- Dez envios simultâneos com saldo para quatro resultam em exatamente quatro aceitos; há teste disso contra o PostgreSQL real.
- Toda movimentação fica em `clients_transaction` ligada ao `messageId`, o que permite auditoria e reconciliação.

### Consequências negativas

- Se o **processo cair** entre a cobrança e a gravação da mensagem, o cliente fica debitado sem mensagem: a compensação cobre exceções, não quedas. O débito órfão é localizável (transação `debit` cujo `messageId` não existe em `messaging_message`). A correção definitiva é a transação única com outbox.
- O estorno também pode falhar; nesse caso o erro é registrado em log e a reconciliação acima se aplica.
- Reenvio do mesmo `POST` por timeout do cliente cobra duas vezes: não há chave de idempotência (fora de escopo, registrado).

## Opções rejeitadas

- **Transação única entre módulos**: exigiria uma unidade de trabalho compartilhada atravessando a fronteira de `clients`, acoplando os dois módulos ao mesmo mecanismo transacional.
- **Reservar e confirmar na entrega**: mais justo com o cliente, mas cria um segundo estado de saldo e uma rotina para reservas órfãs. Vale a troca se falhas de entrega forem frequentes.
