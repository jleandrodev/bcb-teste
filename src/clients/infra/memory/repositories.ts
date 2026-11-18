import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { ClientRepository, SessionStore, Transaction, TransactionRepository } from '../../application/ports';
import { Client } from '../../domain/client';

export class InMemoryClientRepository implements ClientRepository {
  private readonly byId = new Map<string, Client>();

  /** Sem `await` entre conferir e gravar: dois cadastros simultâneos não passam os dois pela conferência. */
  async save(client: Client): Promise<void> {
    if (this.withDocument(client.document.value)) {
      throw new ConflictError('DOCUMENT_ALREADY_REGISTERED', 'Já existe um cliente com este documento');
    }
    this.byId.set(client.id, client);
  }

  async findById(id: string): Promise<Client | null> {
    return this.byId.get(id) ?? null;
  }

  async findByDocument(documentValue: string): Promise<Client | null> {
    return this.withDocument(documentValue);
  }

  async list(): Promise<Client[]> {
    return [...this.byId.values()];
  }

  private withDocument(documentValue: string): Client | null {
    for (const client of this.byId.values()) {
      if (client.document.value === documentValue) return client;
    }
    return null;
  }

  /**
   * Atômico porque não há `await` entre ler e gravar: o event loop do Node não
   * intercala outra tarefa no meio de um trecho síncrono.
   */
  async mutate(id: string, fn: (client: Client) => Client): Promise<Client> {
    const current = this.byId.get(id);
    if (!current) throw new NotFoundError('Client', id);
    const next = fn(current);
    this.byId.set(id, next);
    return next;
  }
}

export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly items: Transaction[] = [];

  async append(transaction: Transaction): Promise<void> {
    this.items.push(transaction);
  }

  async listByClient(clientId: string): Promise<Transaction[]> {
    return this.items.filter((t) => t.clientId === clientId);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly tokens = new Map<string, string>();

  create(clientId: string): string {
    const token = randomUUID();
    this.tokens.set(token, clientId);
    return token;
  }

  resolve(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }
}
