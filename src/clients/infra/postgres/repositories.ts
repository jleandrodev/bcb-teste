import { ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import { Database } from '../../../shared/infra/postgres/database';
import { ClientRepository, Transaction, TransactionRepository } from '../../application/ports';
import type { PlanType } from '../../domain/billing/billing-policy';
import { Client } from '../../domain/client';
import { Document } from '../../domain/document';

interface ClientRow {
  id: string;
  name: string;
  document_type: string;
  document: string;
  plan_type: PlanType;
  balance_cents: string; // BIGINT chega como string no driver
  limit_cents: string;
  used_cents: string;
  usage_period: string;
  active: boolean;
}

const UNIQUE_VIOLATION = '23505';

function toDomain(row: ClientRow): Client {
  return new Client({
    id: row.id,
    name: row.name,
    document: Document.create(row.document_type, row.document),
    planType: row.plan_type,
    active: row.active,
    account: {
      balance: Money.fromCents(Number(row.balance_cents)),
      limit: Money.fromCents(Number(row.limit_cents)),
      used: Money.fromCents(Number(row.used_cents)),
      usagePeriod: row.usage_period,
    },
  });
}

/** Valores na ordem das colunas usadas em INSERT e UPDATE. */
function toRow(client: Client): unknown[] {
  return [
    client.id,
    client.name,
    client.document.type,
    client.document.value,
    client.planType,
    client.account.balance.cents,
    client.account.limit.cents,
    client.account.used.cents,
    client.account.usagePeriod,
    client.active,
  ];
}

const UPDATE_CLIENT = `
  UPDATE clients_client
     SET name = $2, document_type = $3, document = $4, plan_type = $5,
         balance_cents = $6, limit_cents = $7, used_cents = $8, usage_period = $9, active = $10
   WHERE id = $1`;

export class PostgresClientRepository implements ClientRepository {
  constructor(private readonly db: Database) {}

  async save(client: Client): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO clients_client (id, name, document_type, document, plan_type, balance_cents, limit_cents, used_cents, usage_period, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        toRow(client),
      );
    } catch (error) {
      // Dois cadastros simultâneos do mesmo documento: quem decide é a restrição UNIQUE.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictError('DOCUMENT_ALREADY_REGISTERED', 'Já existe um cliente com este documento');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Client | null> {
    const rows = await this.db.query<ClientRow>('SELECT * FROM clients_client WHERE id = $1', [id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByDocument(documentValue: string): Promise<Client | null> {
    const rows = await this.db.query<ClientRow>('SELECT * FROM clients_client WHERE document = $1', [documentValue]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(): Promise<Client[]> {
    return (await this.db.query<ClientRow>('SELECT * FROM clients_client ORDER BY seq')).map(toDomain);
  }

  /**
   * Lê, decide e grava dentro de uma transação, com a linha do cliente travada
   * (FOR UPDATE). Um segundo envio simultâneo espera o COMMIT e então lê o saldo
   * já debitado. Se `fn` lançar (saldo insuficiente), a transação é desfeita.
   */
  async mutate(id: string, fn: (client: Client) => Client): Promise<Client> {
    return this.db.transaction(async (tx) => {
      const found = await tx.query<ClientRow>('SELECT * FROM clients_client WHERE id = $1 FOR UPDATE', [id]);
      if (!found.rows[0]) throw new NotFoundError('Client', id);
      const next = fn(toDomain(found.rows[0]));
      await tx.query(UPDATE_CLIENT, toRow(next));
      return next;
    });
  }
}

interface TransactionRow {
  id: string;
  client_id: string;
  type: Transaction['type'];
  amount_cents: string;
  message_id: string | null;
  created_at: Date;
}

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly db: Database) {}

  async append(transaction: Transaction): Promise<void> {
    await this.db.query(
      `INSERT INTO clients_transaction (id, client_id, type, amount_cents, message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        transaction.id,
        transaction.clientId,
        transaction.type,
        transaction.amountCents,
        transaction.messageId ?? null,
        transaction.createdAt,
      ],
    );
  }

  async listByClient(clientId: string): Promise<Transaction[]> {
    const rows = await this.db.query<TransactionRow>('SELECT * FROM clients_transaction WHERE client_id = $1 ORDER BY seq', [clientId]);
    return rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      type: row.type,
      amountCents: Number(row.amount_cents),
      messageId: row.message_id ?? undefined,
      createdAt: row.created_at,
    }));
  }
}
