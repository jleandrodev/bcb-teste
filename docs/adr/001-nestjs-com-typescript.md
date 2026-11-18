# ADR-001: NestJS com TypeScript como stack do backend

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: stack

## Contexto e problema

O enunciado sugere Java (Spring Boot), Node.js (NestJS ou Express) ou Go. A avaliação pesa estrutura de dados, validações de API, regras de negócio e organização do código, e inclui uma etapa em que o código é modificado ao vivo. É preciso uma base que deixe a organização explícita e torne mudanças baratas.

## Direcionadores

- Estar entre as linguagens do enunciado.
- Injeção de dependência e validação de entrada sem código próprio.
- Tipagem estática que aponte, na compilação, o que uma mudança esqueceu.
- Testes que sobem a aplicação real com pouco esforço.

## Opções consideradas

- NestJS com TypeScript
- Express com TypeScript
- Go com Gin

## Decisão

**NestJS com TypeScript em modo estrito**, porque módulos e injeção de dependência dão suporte direto à separação entre regras e infraestrutura (ADR-002), o `ValidationPipe` cobre as validações de borda, e o módulo de testes sobe a aplicação inteira trocando apenas o que o teste precisa.

### Consequências positivas

- Uniões de literais e `Record` exaustivo fazem o compilador cobrar um status, plano ou prioridade novo em todos os pontos de uso.
- Trocar um adaptador (memória por PostgreSQL) é alterar um provider.

### Consequências negativas

- Mais cerimônia (decorators, módulos) do que o problema exigiria sozinho.
- A camada de aplicação usa `@Injectable` e `@Inject`: o framework não fica totalmente fora dela. O domínio e a fila permanecem sem nenhuma dependência, e um teste de arquitetura garante isso.

## Opções rejeitadas

- **Express**: obrigaria a escrever à mão a composição de dependências e a validação, que não são o foco do desafio.
- **Go**: desempenho e simplicidade de sobra, mas menor fluência do autor, o que pesa em uma etapa de modificação ao vivo.
