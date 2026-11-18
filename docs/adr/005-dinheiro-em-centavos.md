# ADR-005: Dinheiro em centavos inteiros

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: domínio, dados

## Contexto e problema

O sistema debita R$ 0,25 e R$ 0,50 milhares de vezes e compara o resultado com saldo e limite. Em ponto flutuante binário, `0.1 + 0.2` não é `0.3`; o erro se acumula e, no limite, autoriza ou nega um envio indevidamente. O contrato do enunciado mostra valores decimais no JSON (`0.25`).

## Decisão

Todo valor monetário é um **inteiro de centavos**, encapsulado no value object `Money`:

- construtor privado; `Money.fromCents` rejeita negativo e não inteiro;
- operações devolvem um novo `Money`; subtrair além do valor lança erro;
- a conversão de e para decimal acontece só na borda: `Money.fromDecimal` na entrada, `toDecimal` nos presenters;
- no banco, colunas `*_cents BIGINT`.

### Consequências positivas

- Somas e comparações são exatas até 2⁵³ centavos.
- É impossível existir um `Money` inválido em qualquer ponto do sistema.

### Consequências negativas

- Serve a uma moeda com duas casas. Outra moeda ou taxas com frações de centavo pediriam o par (valor, moeda) e uma biblioteca decimal.
- Esquecer a conversão na borda expõe centavos no JSON; os testes de contrato cobrem os campos monetários.

## Opções rejeitadas

- **`number` em reais**: erro de representação e de acúmulo.
- **Biblioteca decimal**: resolve com generalidade que o escopo não usa e acrescenta uma dependência ao domínio.
- **`NUMERIC` no banco com centavos no domínio**: duas representações do mesmo valor e conversão em toda leitura.
