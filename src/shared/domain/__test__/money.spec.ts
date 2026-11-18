import { ValidationError } from '../errors';
import { Money } from '../money';

describe('Money', () => {
  it('soma 0,10 + 0,20 e obtém exatamente 0,30 (em ponto flutuante daria 0,30000000000000004)', () => {
    const total = Money.fromDecimal(0.1).add(Money.fromDecimal(0.2));

    expect(total.cents).toBe(30);
    expect(total.toDecimal()).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // o motivo de existir esta classe
  });

  it('debita R$ 0,25 mil vezes sem acumular erro de arredondamento', () => {
    let balance = Money.fromDecimal(250);

    for (let i = 0; i < 1000; i += 1) balance = balance.subtract(Money.fromCents(25));

    expect(balance.cents).toBe(0);
  });

  it.each([
    [10.5, 1050],
    [0.25, 25],
    [0, 0],
    [19.99, 1999],
    [1.005, 100], // 1.005 * 100 = 100.49999… em binário: arredonda para o centavo mais próximo
  ])('converte %p reais em %p centavos', (decimal, cents) => {
    expect(Money.fromDecimal(decimal).cents).toBe(cents);
  });

  it.each([[-1], [0.5], [Number.NaN], [Number.POSITIVE_INFINITY]])('recusa %p como quantidade de centavos', (cents) => {
    expect(() => Money.fromCents(cents)).toThrow(ValidationError);
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [-0.01], ['10' as unknown as number]])('recusa %p como valor em reais', (value) => {
    expect(() => Money.fromDecimal(value)).toThrow(ValidationError);
  });

  it('nunca representa dívida: subtrair mais do que tem lança NEGATIVE_MONEY', () => {
    expect(() => Money.fromCents(24).subtract(Money.fromCents(25))).toThrow(expect.objectContaining({ code: 'NEGATIVE_MONEY' }));
  });

  it('é imutável: operar devolve um novo valor e preserva os operandos', () => {
    const ten = Money.fromCents(1000);

    const result = ten.subtract(Money.fromCents(25));

    expect(ten.cents).toBe(1000);
    expect(result.cents).toBe(975);
  });

  it('compara por valor', () => {
    expect(Money.fromCents(50).equals(Money.fromDecimal(0.5))).toBe(true);
    expect(Money.fromCents(50).gte(Money.fromCents(50))).toBe(true);
    expect(Money.fromCents(49).gte(Money.fromCents(50))).toBe(false);
    expect(Money.zero().cents).toBe(0);
  });
});
