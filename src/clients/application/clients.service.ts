import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK } from '../../shared/domain/clock';
import type { Clock } from '../../shared/domain/clock';
import { NotFoundError, UnauthorizedError } from '../../shared/domain/errors';
import { Money } from '../../shared/domain/money';
import type { PlanType } from '../domain/billing/billing-policy';
import { Client } from '../domain/client';
import { Document } from '../domain/document';
import { CLIENT_REPOSITORY, SESSION_STORE, TRANSACTION_REPOSITORY } from './ports';
import type { ClientRepository, SessionStore, Transaction, TransactionRepository } from './ports';

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
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(input: CreateClientInput): Promise<Client> {
    const document = Document.create(input.documentType, input.documentId);
    const client = Client.create({
      id: randomUUID(),
      name: input.name,
      document,
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
    return this.clients.mutate(id, (client) =>
      client.update({
        name: input.name,
        active: input.active,
        planType: input.planType,
        limit: input.limit !== undefined ? Money.fromDecimal(input.limit) : undefined,
      }),
    );
  }

  async addCredits(id: string, amount: number): Promise<Client> {
    const credits = Money.fromDecimal(amount);
    const client = await this.clients.mutate(id, (c) => c.addCredits(credits));
    await this.record(id, 'credit', credits);
    return client;
  }

  /** Debita o custo de uma mensagem (atômico) e registra a transação. */
  async charge(id: string, cost: Money, messageId: string): Promise<Client> {
    const client = await this.clients.mutate(id, (c) => c.charge(cost, this.clock.now()));
    await this.record(id, 'debit', cost, messageId);
    return client;
  }

  /** Devolve o valor de uma mensagem que falhou definitivamente. */
  async refund(id: string, cost: Money, messageId: string): Promise<Client> {
    const client = await this.clients.mutate(id, (c) => c.refund(cost, this.clock.now()));
    await this.record(id, 'refund', cost, messageId);
    return client;
  }

  transactionsOf(id: string): Promise<Transaction[]> {
    return this.transactions.listByClient(id);
  }

  /** POST /auth: identifica o cliente pelo documento e abre uma sessão. */
  async authenticate(documentType: string, documentId: string): Promise<{ token: string; client: Client }> {
    const document = Document.create(documentType, documentId);
    const client = await this.clients.findByDocument(document.value);
    if (!client || client.document.type !== document.type) throw new UnauthorizedError('Documento não cadastrado');
    return { token: this.sessions.create(client.id), client };
  }

  /** Usado pelo guard: resolve o cliente a partir do token ou do documento no header. */
  async resolve(credentials: { token?: string; document?: string }): Promise<Client> {
    let client: Client | null = null;
    if (credentials.token) {
      const clientId = this.sessions.resolve(credentials.token);
      client = clientId ? await this.clients.findById(clientId) : null;
    } else if (credentials.document) {
      client = await this.clients.findByDocument(Document.normalize(credentials.document));
    }
    if (!client) throw new UnauthorizedError();
    return client;
  }

  private record(clientId: string, type: Transaction['type'], amount: Money, messageId?: string): Promise<void> {
    return this.transactions.append({
      id: randomUUID(),
      clientId,
      type,
      amountCents: amount.cents,
      messageId,
      createdAt: this.clock.now(),
    });
  }
}
