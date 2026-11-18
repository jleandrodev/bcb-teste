import { InsufficientFundsError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';

export type PlanType = 'prepaid' | 'postpaid';

/** Estado financeiro de um cliente. Imutável: as políticas devolvem um novo Account. */
export interface Account {
  readonly balance: Money; // pré-pago: créditos disponíveis
  readonly limit: Money; // pós-pago: limite mensal
  readonly used: Money; // pós-pago: consumo no período
  readonly usagePeriod: string; // pós-pago: 'YYYY-MM' do consumo acumulado
}

export const periodOf = (date: Date): string => date.toISOString().slice(0, 7);

/**
 * Strategy: cada plano sabe cobrar, estornar e dizer quanto ainda pode gastar.
 * Adicionar um plano novo é criar outra classe e registrá-la (OCP), sem tocar
 * em quem envia mensagens.
 */
export interface BillingPolicy {
  readonly planType: PlanType;
  charge(account: Account, cost: Money, now: Date): Account;
  refund(account: Account, cost: Money, now: Date): Account;
  available(account: Account, now: Date): Money;
  /** Consumo do período corrente (sempre zero no pré-pago). */
  used(account: Account, now: Date): Money;
}

export class PrepaidPolicy implements BillingPolicy {
  readonly planType = 'prepaid' as const;

  charge(account: Account, cost: Money): Account {
    if (!account.balance.gte(cost)) {
      throw new InsufficientFundsError('INSUFFICIENT_BALANCE', 'Saldo insuficiente para enviar a mensagem', {
        balance: account.balance.toDecimal(),
        cost: cost.toDecimal(),
      });
    }
    return { ...account, balance: account.balance.subtract(cost) };
  }

  refund(account: Account, cost: Money): Account {
    return { ...account, balance: account.balance.add(cost) };
  }

  available(account: Account): Money {
    return account.balance;
  }

  used(): Money {
    return Money.zero();
  }
}

export class PostpaidPolicy implements BillingPolicy {
  readonly planType = 'postpaid' as const;

  /** O consumo zera na virada do mês: se o período mudou, parte de zero. */
  private currentUsage(account: Account, now: Date): Money {
    return account.usagePeriod === periodOf(now) ? account.used : Money.zero();
  }

  charge(account: Account, cost: Money, now: Date): Account {
    const used = this.currentUsage(account, now).add(cost);
    if (!account.limit.gte(used)) {
      throw new InsufficientFundsError('LIMIT_EXCEEDED', 'Limite mensal excedido', {
        limit: account.limit.toDecimal(),
        used: this.currentUsage(account, now).toDecimal(),
        cost: cost.toDecimal(),
      });
    }
    return { ...account, used, usagePeriod: periodOf(now) };
  }

  /**
   * Abate do consumo do mês. O que não houver para abater (cobrança de um mês já
   * fechado, ou feita quando o cliente era pré-pago) vira crédito em `balance`:
   * um estorno nunca desaparece.
   */
  refund(account: Account, cost: Money, now: Date): Account {
    const used = this.currentUsage(account, now);
    const abated = used.gte(cost) ? cost : used;
    return {
      ...account,
      used: used.subtract(abated),
      balance: account.balance.add(cost.subtract(abated)),
      usagePeriod: periodOf(now),
    };
  }

  available(account: Account, now: Date): Money {
    const used = this.currentUsage(account, now);
    return account.limit.gte(used) ? account.limit.subtract(used) : Money.zero();
  }

  used(account: Account, now: Date): Money {
    return this.currentUsage(account, now);
  }
}

const POLICIES: Record<PlanType, BillingPolicy> = {
  prepaid: new PrepaidPolicy(),
  postpaid: new PostpaidPolicy(),
};

export function policyFor(planType: PlanType): BillingPolicy {
  return POLICIES[planType];
}
