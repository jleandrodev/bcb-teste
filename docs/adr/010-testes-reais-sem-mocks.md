# ADR-010: Testes com implementações reais, sem bibliotecas de mock

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: testes, qualidade

## Contexto e problema

A suíte precisa cumprir dois papéis: provar que cada critério da especificação vale, e servir de rede de segurança quando o código for alterado, inclusive ao vivo. Testes baseados em mocks verificam que o código chama o que o teste mandou chamar; passam mesmo quando o comportamento real quebrou, e quebram quando a implementação muda sem que o comportamento mude.

## Direcionadores

- Um teste vermelho deve significar comportamento quebrado.
- Um teste verde deve sobreviver a uma refatoração interna.
- A parte mais arriscada (débito concorrente) precisa ser provada contra o banco real.
- A suíte inteira deve rodar em segundos.

## Decisão

1. **Nenhum `jest.mock`, `jest.fn` ou `spyOn`.** Os testes exercitam objetos reais e verificam resultados observáveis: valor de retorno, estado, resposta HTTP, linhas no banco.
2. **Três níveis:**

   | Nível | O que roda | Onde |
   |---|---|---|
   | Unitário | domínio e fila, só com `new` | `src/**/__test__/*.spec.ts` |
   | Contrato de repositório | a mesma bateria contra o adaptador em memória e o PostgreSQL | `test/repositories/` |
   | Ponta a ponta | a aplicação real (`AppModule` + `configureApp`) via HTTP | `test/e2e/` |

3. **A mesma suíte ponta a ponta roda nos dois adaptadores** (`PERSISTENCE=memory` e `PERSISTENCE=postgres`). Em memória ela leva segundos; contra o PostgreSQL ela prova o SQL e o lock.
4. **Um único substituto, escrito à mão:** o `FakeMessageGateway`, que registra a ordem das entregas e falha quando o teste manda. Ele ocupa o lugar do provedor externo de mensagens, que não existe no desafio; a implementação "de produção" dessa porta já é um simulador. O relógio também é injetado onde o tempo decide o resultado (virada de mês).
5. **Nome do teste é a regra de negócio**, em português, e cada critério da especificação aponta para o seu teste em `.specs/features/message-queue/checks.md`.
6. **Invariantes além de exemplos:** a fila tem um teste de propriedade (sequências geradas com semente fixa) e um teste de tempo que quebra se a remoção deixar de ser O(1).
7. **Arquitetura como teste:** `test/architecture.spec.ts` falha se o domínio importar framework ou se um módulo importar o interior do outro.

### Consequências positivas

- Uma alteração ao vivo tem resposta em um comando: `npm test && npm run test:e2e`.
- Refatorar por dentro não quebra teste algum.

### Consequências negativas

- Os testes contra o PostgreSQL exigem o banco no ar (`docker compose up -d db`); a CI sobe um serviço para isso.
- Testes ponta a ponta localizam a falha com menos precisão que um unitário; por isso as regras também têm teste unitário próprio.
- Sem mocks, simular uma falha do banco no meio de uma operação exige um adaptador que falhe de verdade; há um caso assim, para a compensação do ADR-006.

## Opções rejeitadas

- **Mocks dos repositórios nos testes de aplicação**: rápidos, mas não detectariam um SQL errado nem o `await` que quebra a atomicidade do débito.
- **Somente ponta a ponta**: lentos para as dezenas de casos de fronteira do domínio e da fila.
- **Testcontainers**: isola melhor que o banco do compose, ao custo de tempo de subida a cada execução e de mais uma dependência.
