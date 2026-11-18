import { Client } from '../domain/client';

/**
 * Portas (interfaces) que a aplicação exige da infraestrutura. Quem implementa
 * (memória, Postgres) é detalhe: os casos de uso dependem só destas abstrações (DIP).
 */
export interface ClientRepository {
  /** Grava um cliente novo. Lança ConflictError(DOCUMENT_ALREADY_REGISTERED) se o documento já existe. */
  save(client: Client): Promise<void>;
  findById(id: string): Promise<Client | null>;
  findByDocument(documentValue: string): Promise<Client | null>;
  list(): Promise<Client[]>;
  /**
   * Lê, aplica `fn` e grava de forma ATÔMICA. É o que impede dois envios
   * simultâneos de gastarem o mesmo saldo (em SQL: transação com lock da linha
   * ou UPDATE condicional). Se `fn` lançar, nada é gravado.
   */
  mutate(id: string, fn: (client: Client) => Client): Promise<Client>;
}

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

export type TransactionType = 'credit' | 'debit' | 'refund';

export interface Transaction {
  id: string;
  clientId: string;
  type: TransactionType;
  amountCents: number;
  messageId?: string;
  createdAt: Date;
}

export interface TransactionRepository {
  append(transaction: Transaction): Promise<void>;
  listByClient(clientId: string): Promise<Transaction[]>;
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

/** Sessões de autenticação simples: token opaco → cliente. */
export interface SessionStore {
  create(clientId: string): string;
  resolve(token: string): string | null;
}

export const SESSION_STORE = Symbol('SESSION_STORE');
