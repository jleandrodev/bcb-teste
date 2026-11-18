# ADR-002: Monolito modular com dois módulos e camadas por módulo

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: arquitetura, modularidade

## Contexto e problema

O sistema tem dois assuntos com vocabulário próprio: quem paga (clientes, planos, saldo, transações) e o que é enviado (mensagens, conversas, fila, entrega). Eles se encontram em um ponto: enviar custa dinheiro. É preciso organizar o código de modo que as regras sejam testáveis sem infraestrutura e que a persistência possa mudar sem tocar nelas.

## Direcionadores

- Regras de negócio e a fila testáveis sem framework nem banco.
- Dois mecanismos de persistência reais (memória e PostgreSQL, ADR-007).
- Tamanho do problema: cerca de 40 arquivos de produção, uma dependência entre módulos.

## Opções consideradas

- Dois módulos (`clients`, `messaging`), cada um com `domain`, `application`, `infra` e `http`
- Uma pasta por agregado, sem camadas (flat-by-aggregate)
- Pastas por tipo técnico na raiz (`controllers/`, `services/`, `repositories/`)
- Um serviço por contexto

## Decisão

**Dois módulos NestJS com camadas internas**, porque as duas exigências que mais pesam aqui (regras puras e troca de persistência) são exatamente o que a separação em camadas com portas resolve.

Regras:

1. As dependências apontam para dentro: `http` e `infra` conhecem `application`; `application` conhece `domain`; `domain` e `queue` não importam framework, driver nem outra camada.
2. `messaging` usa `clients` somente pela API pública exportada em `src/clients/index.ts`. Nenhum módulo acessa repositório ou tabela do outro.
3. Tabelas levam o prefixo do módulo (`clients_*`, `messaging_*`).
4. Um teste de arquitetura (`test/architecture.spec.ts`) verifica as regras 1 e 2 lendo os imports.

### Consequências positivas

- Domínio e fila são testados com `new` e chamadas de método.
- A fronteira entre os módulos tem um único arquivo; extrair um serviço no futuro começaria por ele.

### Consequências negativas

- Mais pastas e uma tradução explícita entre banco, domínio e JSON (funções de mapeamento e presenters).
- Para um CRUD puro essa estrutura seria excesso; aqui ela é paga pelas regras de cobrança, pela fila e pelos dois adaptadores.

## Opções rejeitadas

- **Flat-by-aggregate**: mais enxuto, mas mistura no mesmo nível as regras e o SQL, e a regra "domínio sem infraestrutura" deixaria de ser verificável por caminho de pasta.
- **Pastas por tipo técnico**: espalha cada funcionalidade por quatro lugares e esconde a fronteira entre os dois assuntos.
- **Um serviço por contexto**: acrescenta rede, consistência distribuída e operação a um problema que tem uma única dependência entre contextos.

## O que ficou de fora de propósito

CQRS, classes de caso de uso para operações simples (os services bastam), feature folders, eventos de domínio entre módulos e barramento de eventos. Nenhum desses resolve um problema que este escopo tenha.
