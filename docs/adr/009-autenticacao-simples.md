# ADR-009: Autenticação simples por token opaco ou documento no cabeçalho

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: segurança, API

## Contexto e problema

O enunciado lista `POST /auth` e, na Parte 2, "autenticação por CPF/CNPJ no header". O FAQ afirma que JWT e OAuth não são necessários. As rotas de mensagens e conversas precisam saber qual cliente está chamando para cobrar e para isolar os dados.

## Decisão

- `POST /auth` recebe documento e tipo e devolve um **token opaco** (UUID) associado ao cliente, guardado em memória.
- As rotas protegidas aceitam `Authorization: Bearer <token>` **ou** `X-Client-Document: <CPF/CNPJ>`.
- O `AuthGuard` resolve o cliente e o entrega ao handler; recurso de outro cliente responde `404`, não `403`, para não confirmar que o identificador existe.
- O CRUD de `/clients` é tratado como API administrativa e não exige autenticação.

### Consequências positivas

- Cumpre literalmente as Partes 1 e 2 com o mínimo de código e de superfície para erro.
- O isolamento entre clientes está no tipo: o filtro de consulta exige o identificador do remetente.

### Consequências negativas

- **Não é seguro para produção.** Documento não é segredo: quem conhece o CPF se passa pelo cliente. O cabeçalho só seria aceitável em rede interna.
- Tokens somem a cada reinício e não funcionam com mais de uma instância.
- A API administrativa aberta permite a qualquer um criar clientes e adicionar créditos.

## Evolução prevista

Token assinado (JWT) ou sessão em armazenamento compartilhado, remoção do cabeçalho de documento, papel de administrador para `/clients`, HTTPS e limite de taxa.

## Opções rejeitadas

- **JWT/OAuth agora**: dispensado pelo FAQ; acrescentaria gestão de chaves e expiração sem ser avaliado.
- **Somente o cabeçalho de documento**: deixaria sem uso o `POST /auth` listado no enunciado.
