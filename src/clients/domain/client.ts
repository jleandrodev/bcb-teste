import { InactiveClientError, ValidationError } from '../../shared/domain/errors';
import { Money } from '../../shared/domain/money';
import { Account, PlanType, periodOf, policyFor } from './billing/billing-policy';
import { Document } from './document';

export interface ClientProps {
  id: string;
  name: string;
  document: Document;
  planType: PlanType;
  account: Account;
  active: boolean;
}

/**
 * Entidade Client. Imutável: cada operação devolve um novo Client, o que permite
 * ao repositório aplicar mudanças de forma atômica (ver ClientRepository.mutate).
 */
export class Client {
  readonly id: string;
  readonly name: string;
  readonly document: Document;
  readonly planType: PlanType;
  readonly account: Account;
  readonly active: boolean;

  constructor(props: ClientProps) {
    this.id = props.id;
    this.name = props.name;
    this.document = props.document;
    this.planType = props.planType;
    this.account = props.account;
    this.active = props.active;
  }

  static create(input: {
    id: string;
    name: string;
    document: Document;
    planType: PlanType;
    balance?: Money;
    limit?: Money;
    now: Date;
  }): Client {
    return new Client({
      id: input.id,
      name: input.name,
      document: input.document,
      planType: input.planType,
      active: true,
      account: {
        balance: input.balance ?? Money.zero(),
        limit: input.limit ?? Money.zero(),
        used: Money.zero(),
        usagePeriod: periodOf(input.now),
      },
    });
  }

  private with(changes: Partial<ClientProps>): Client {
    return new Client({ ...this, ...changes });
  }

  /** Cobra o custo de uma mensagem conforme o plano. Lança se inativo ou sem fundos. */
  charge(cost: Money, now: Date): Client {
    if (!this.active) throw new InactiveClientError(this.id);
    return this.with({ account: policyFor(this.planType).charge(this.account, cost, now) });
  }

  refund(cost: Money, now: Date): Client {
    return this.with({ account: policyFor(this.planType).refund(this.account, cost, now) });
  }

  available(now: Date): Money {
    return policyFor(this.planType).available(this.account, now);
  }

  addCredits(amount: Money): Client {
    return this.with({ account: { ...this.account, balance: this.account.balance.add(amount) } });
  }

  used(now: Date): Money {
    return policyFor(this.planType).used(this.account, now);
  }

  update(changes: { name?: string; active?: boolean; limit?: Money }): Client {
    return this.with({
      name: changes.name ?? this.name,
      active: changes.active ?? this.active,
      account: changes.limit ? { ...this.account, limit: changes.limit } : this.account,
    });
  }

  /**
   * Converte o plano sem destruir nada: o saldo residual do pré-pago e o consumo
   * pendente do pós-pago continuam na conta e voltam a valer se o cliente
   * reconverter. Só muda a regra de cobrança aplicada daqui em diante.
   */
  changePlan(planType: PlanType): Client {
    if (planType === 'postpaid' && this.account.limit.cents === 0) {
      throw new ValidationError('LIMIT_REQUIRED', 'Informe o limite mensal para converter o cliente para pós-pago');
    }
    return this.with({ planType });
  }
}
