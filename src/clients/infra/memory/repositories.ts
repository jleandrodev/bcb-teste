import { ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { ClientRepository, Transaction, TransactionRepository } from '../../application/ports';
import { Client } from '../../domain/client';

export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly items: Transaction[] = [];

  /** Chamado só pelo repositório de clientes, dentro do `mutate`. */
  record(entry: Transaction): void {
    this.items.push(entry);
  }

  hasRefundFor(messageId: string): boolean {
    return this.items.some((item) => item.type === 'refund' && item.messageId === messageId);
  }

  async listByClient(clientId: string): Promise<Transaction[]> {
    return this.items.filter((item) => item.clientId === clientId);
  }
}

export class InMemoryClientRepository implements ClientRepository {
  private readonly byId = new Map<string, Client>();

  constructor(private readonly transactions: InMemoryTransactionRepository) {}

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

  /**
   * Atômico porque não há `await` entre ler, decidir e gravar (saldo e lançamento):
   * o event loop do Node não intercala outra tarefa no meio de um trecho síncrono.
   */
  async mutate(id: string, change: (client: Client) => Client, entry?: Transaction): Promise<Client> {
    const current = this.byId.get(id);
    if (!current) throw new NotFoundError('Client', id);
    const next = change(current);
    if (entry?.type === 'refund' && entry.messageId && this.transactions.hasRefundFor(entry.messageId)) {
      throw new ConflictError('REFUND_ALREADY_RECORDED', 'Esta mensagem já foi estornada');
    }
    this.byId.set(id, next);
    if (entry) this.transactions.record(entry);
    return next;
  }

  private withDocument(documentValue: string): Client | null {
    for (const client of this.byId.values()) {
      if (client.document.value === documentValue) return client;
    }
    return null;
  }
}
