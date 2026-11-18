import { Money } from '../../../shared/domain/money';
import { Account, PostpaidPolicy, PrepaidPolicy, periodOf, policyFor } from '../billing/billing-policy';

const cents = (value: number) => Money.fromCents(value);
const january = new Date('2026-01-31T23:59:59.000Z');
const february = new Date('2026-02-01T00:00:00.000Z');

function account(overrides: Partial<Account> = {}): Account {
  return { balance: Money.zero(), limit: Money.zero(), used: Money.zero(), usagePeriod: periodOf(january), ...overrides };
}

describe('PrepaidPolicy', () => {
  const policy = new PrepaidPolicy();

  it('debita o custo do saldo', () => {
    const charged = policy.charge(account({ balance: cents(100) }), cents(25));

    expect(charged.balance.cents).toBe(75);
  });

  it('aceita quando o saldo é exatamente o custo e termina zerado', () => {
    const charged = policy.charge(account({ balance: cents(25) }), cents(25));

    expect(charged.balance.cents).toBe(0);
  });

  it('recusa com INSUFFICIENT_BALANCE quando falta um centavo, informando saldo e custo', () => {
    expect(() => policy.charge(account({ balance: cents(24) }), cents(25))).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_BALANCE', kind: 'payment_required', details: { balance: 0.24, cost: 0.25 } }),
    );
  });

  it('estornar devolve o valor ao saldo', () => {
    expect(policy.refund(account({ balance: cents(50) }), cents(50)).balance.cents).toBe(100);
  });

  it('o disponível é o próprio saldo, e não há consumo a informar', () => {
    expect(policy.available(account({ balance: cents(875) })).cents).toBe(875);
    expect(policy.used().cents).toBe(0);
  });
});

describe('PostpaidPolicy', () => {
  const policy = new PostpaidPolicy();

  it('soma o custo ao consumo do mês', () => {
    const charged = policy.charge(account({ limit: cents(5000), used: cents(4250) }), cents(50), january);

    expect(charged.used.cents).toBe(4300);
    expect(policy.available(charged, january).cents).toBe(700);
  });

  it('aceita quando o consumo fica exatamente igual ao limite', () => {
    const charged = policy.charge(account({ limit: cents(50), used: cents(25) }), cents(25), january);

    expect(charged.used.cents).toBe(50);
    expect(policy.available(charged, january).cents).toBe(0);
  });

  it('recusa com LIMIT_EXCEEDED quando o consumo passaria do limite', () => {
    expect(() => policy.charge(account({ limit: cents(60), used: cents(50) }), cents(25), january)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED', kind: 'payment_required', details: { limit: 0.6, used: 0.5, cost: 0.25 } }),
    );
  });

  it('na virada do mês (UTC) o consumo recomeça do zero', () => {
    const exhausted = account({ limit: cents(50), used: cents(50) });

    expect(policy.available(exhausted, january).cents).toBe(0);
    expect(policy.available(exhausted, february).cents).toBe(50);

    const charged = policy.charge(exhausted, cents(25), february);
    expect(charged.used.cents).toBe(25);
    expect(charged.usagePeriod).toBe('2026-02');
  });

  it('estornar abate do consumo do mês corrente', () => {
    const refunded = policy.refund(account({ limit: cents(100), used: cents(75) }), cents(50), january);

    expect(refunded.used.cents).toBe(25);
  });

  it('estorno de cobrança de um mês já fechado não some: vira crédito, sem gerar consumo negativo', () => {
    const refunded = policy.refund(account({ limit: cents(100), used: cents(75) }), cents(50), february);

    expect(refunded.used.cents).toBe(0);
    expect(refunded.balance.cents).toBe(50);
    expect(refunded.usagePeriod).toBe('2026-02');
  });

  it('estorno maior que o consumo do mês abate o que há e credita o restante', () => {
    const refunded = policy.refund(account({ limit: cents(100), used: cents(25) }), cents(50), january);

    expect(refunded.used.cents).toBe(0);
    expect(refunded.balance.cents).toBe(25);
  });

  it('informa o consumo do mês corrente, zerado depois da virada', () => {
    const consumed = account({ limit: cents(100), used: cents(75) });

    expect(policy.used(consumed, january).cents).toBe(75);
    expect(policy.used(consumed, february).cents).toBe(0);
  });

  it('o disponível nunca é negativo, mesmo se o limite for reduzido abaixo do consumo', () => {
    expect(policy.available(account({ limit: cents(10), used: cents(40) }), january).cents).toBe(0);
  });
});

describe('policyFor', () => {
  it('entrega a política do plano', () => {
    expect(policyFor('prepaid')).toBeInstanceOf(PrepaidPolicy);
    expect(policyFor('postpaid')).toBeInstanceOf(PostpaidPolicy);
  });
});
