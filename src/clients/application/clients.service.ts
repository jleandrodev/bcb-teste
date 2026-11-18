import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { DomainError, NotFoundError, UnauthorizedError } from '../../shared/domain/errors';
import { Money } from '../../shared/domain/money';
import type { PlanType } from '../domain/billing/billing-policy';
import { Client } from '../domain/client';
import { Document } from '../domain/document';
import { CLIENT_REPOSITORY, TRANSACTION_REPOSITORY } from './ports';
import type { ClientRepository, Transaction, TransactionRepository, TransactionType } from './ports';
import { Sessions } from './sessions';

export interface CreateClientInput {
  name: string;
  documentId: string;
  documentType: string;
  planType: PlanType;
  balance?: number;
  limit?: number;
}

export interface UpdateClientInput {
  name?: string;
  active?: boolean;
  limit?: number;
  planType?: PlanType;
}

/** Casos de uso de clientes: orquestram domínio + portas, sem regra de negócio própria. */
@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactions: TransactionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: Sessions,
  ) {}

  async create(input: CreateClientInput): Promise<Client> {
    const client = Client.create({
      id: randomUUID(),
      name: input.name,
      document: Document.create(input.documentType, input.documentId),
      planType: input.planType,
      balance: input.balance !== undefined ? Money.fromDecimal(input.balance) : undefined,
      limit: input.limit !== undefined ? Money.fromDecimal(input.limit) : undefined,
      now: this.clock.now(),
    });
    await this.clients.save(client);
    return client;
  }

  list(): Promise<Client[]> {
    return this.clients.list();
  }

  async get(id: string): Promise<Client> {
    const client = await this.clients.findById(id);
    if (!client) throw new NotFoundError('Client', id);
    return client;
  }

  update(id: string, input: UpdateClientInput): Promise<Client> {
    return this.clients.mutate(id, (client) => {
      const updated = client.update({
        name: input.name,
        active: input.active,
        limit: input.limit !== undefined ? Money.fromDecimal(input.limit) : undefined,
      });
      return input.planType && input.planType !== updated.planType ? updated.changePlan(input.planType) : updated;
    });
  }

  addCredits(id: string, amount: number): Promise<Client> {
    const credits = Money.fromDecimal(amount);
    return this.clients.mutate(id, (client) => client.addCredits(credits), this.entry(id, 'credit', credits));
  }

  /** Debita o custo de uma mensagem e registra o débito, na mesma operação atômica. */
  charge(id: string, cost: Money, messageId: string): Promise<Client> {
    return this.clients.mutate(id, (client) => client.charge(cost, this.clock.now()), this.entry(id, 'debit', cost, messageId));
  }

  /**
   * Devolve o valor de uma mensagem que não será entregue. Idempotente por
   * mensagem: chamar de novo (ex.: depois de uma queda no meio do tratamento da
   * falha) não devolve o valor duas vezes.
   */
  async refund(id: string, cost: Money, messageId: string): Promise<Client> {
    try {
      return await this.clients.mutate(id, (client) => client.refund(cost, this.clock.now()), this.entry(id, 'refund', cost, messageId));
    } catch (error) {
      if (error instanceof DomainError && error.code === 'REFUND_ALREADY_RECORDED') return this.get(id);
      throw error;
    }
  }

  transactionsOf(id: string): Promise<Transaction[]> {
    return this.transactions.listByClient(id);
  }

  /** POST /auth: identifica o cliente pelo documento e abre uma sessão. */
  async authenticate(documentType: string, documentId: string): Promise<{ token: string; client: Client }> {
    const document = Document.create(documentType, documentId);
    const client = await this.clients.findByDocument(document.value);
    if (!client || client.document.type !== document.type) throw new UnauthorizedError('Documento não cadastrado');
    return { token: this.sessions.open(client.id), client };
  }

  /** Usado pelo guard: resolve o cliente a partir do token ou do documento no header. */
  async resolve(credentials: { token?: string; document?: string }): Promise<Client> {
    let client: Client | null = null;
    if (credentials.token) {
      const clientId = this.sessions.clientOf(credentials.token);
      client = clientId ? await this.clients.findById(clientId) : null;
    } else if (credentials.document) {
      client = await this.clients.findByDocument(Document.normalize(credentials.document));
    }
    if (!client) throw new UnauthorizedError();
    return client;
  }

  private entry(clientId: string, type: TransactionType, amount: Money, messageId?: string): Transaction {
    return { id: randomUUID(), clientId, type, amountCents: amount.cents, messageId, createdAt: this.clock.now() };
  }
}
