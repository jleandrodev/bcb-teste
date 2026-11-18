import { Money } from '../../../shared/domain/money';
import { Client } from '../client';
import { Document } from '../document';

const now = new Date('2026-03-10T12:00:00.000Z');
const cents = (value: number) => Money.fromCents(value);

function prepaid(balanceCents: number): Client {
  return Client.create({
    id: 'c1',
    name: 'Loja',
    document: Document.create('CPF', '52998224725'),
    planType: 'prepaid',
    balance: cents(balanceCents),
    now,
  });
}

function postpaid(limitCents: number): Client {
  return Client.create({
    id: 'c2',
    name: 'Rede',
    document: Document.create('CNPJ', '11222333000181'),
    planType: 'postpaid',
    limit: cents(limitCents),
    now,
  });
}

describe('Client', () => {
  it('nasce ativo, com consumo zerado no mês de criação', () => {
    const client = postpaid(5000);

    expect(client.active).toBe(true);
    expect(client.account.used.cents).toBe(0);
    expect(client.account.usagePeriod).toBe('2026-03');
    expect(client.available(now).cents).toBe(5000);
  });

  it('sem saldo ou limite informado, começa com zero', () => {
    const client = Client.create({ id: 'c3', name: 'Nova', document: Document.create('CPF', '11144477735'), planType: 'prepaid', now });

    expect(client.available(now).cents).toBe(0);
  });

  it('cobrar um pré-pago reduz o saldo; cobrar um pós-pago aumenta o consumo', () => {
    expect(prepaid(100).charge(cents(25), now).account.balance.cents).toBe(75);
    expect(postpaid(100).charge(cents(25), now).account.used.cents).toBe(25);
  });

  it('é imutável: cobrar devolve outro cliente e o original mantém o saldo', () => {
    const before = prepaid(100);

    const after = before.charge(cents(50), now);

    expect(before.account.balance.cents).toBe(100);
    expect(after).not.toBe(before);
  });

  it('cliente inativo não é cobrado, mesmo com saldo: CLIENT_INACTIVE', () => {
    const inactive = prepaid(1000).update({ active: false });

    expect(() => inactive.charge(cents(25), now)).toThrow(expect.objectContaining({ code: 'CLIENT_INACTIVE', kind: 'forbidden' }));
  });

  it('cliente inativo ainda pode ser estornado (o dinheiro é dele)', () => {
    const inactive = prepaid(50).update({ active: false });

    expect(inactive.refund(cents(50), now).account.balance.cents).toBe(100);
  });

  it('sem fundos, a cobrança lança e nada muda', () => {
    const client = prepaid(24);

    expect(() => client.charge(cents(25), now)).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }));
    expect(client.account.balance.cents).toBe(24);
  });

  it('adicionar créditos soma ao saldo', () => {
    expect(prepaid(1000).addCredits(cents(550)).account.balance.cents).toBe(1550);
  });

  it('atualizar muda só os campos informados', () => {
    const client = postpaid(5000);

    const renamed = client.update({ name: 'Rede Sul' });
    const raised = client.update({ limit: cents(9000) });

    expect(renamed.name).toBe('Rede Sul');
    expect(renamed.account.limit.cents).toBe(5000);
    expect(renamed.active).toBe(true);
    expect(raised.name).toBe('Rede');
    expect(raised.account.limit.cents).toBe(9000);
  });

  it('trocar de plano muda a regra de cobrança aplicada', () => {
    const migrated = prepaid(0).update({ planType: 'postpaid', limit: cents(100) });

    expect(migrated.charge(cents(50), now).account.used.cents).toBe(50);
  });
});
