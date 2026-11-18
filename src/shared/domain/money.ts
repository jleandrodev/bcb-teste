import { ValidationError } from './errors';

/**
 * Value object de dinheiro. Guarda centavos inteiros: 0.1 + 0.2 !== 0.3 em ponto
 * flutuante, e um sistema que debita R$0,25 milhares de vezes não pode acumular erro.
 * Imutável: toda operação devolve um novo Money.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents) || cents < 0) {
      throw new ValidationError('INVALID_MONEY', `Valor monetário inválido: ${cents}`);
    }
    return new Money(cents);
  }

  /** Converte um decimal da borda (ex.: 10.5) para centavos, arredondando ao centavo. */
  static fromDecimal(value: number): Money {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('INVALID_MONEY', `Valor monetário inválido: ${value}`);
    }
    return Money.fromCents(Math.round(value * 100));
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  /** Lança se o resultado ficaria negativo: Money nunca representa dívida. */
  subtract(other: Money): Money {
    if (other.cents > this.cents) {
      throw new ValidationError('NEGATIVE_MONEY', 'Subtração resultaria em valor negativo');
    }
    return new Money(this.cents - other.cents);
  }

  gte(other: Money): boolean {
    return this.cents >= other.cents;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** Só para a borda (JSON). Nunca faça contas com o resultado. */
  toDecimal(): number {
    return this.cents / 100;
  }
}
