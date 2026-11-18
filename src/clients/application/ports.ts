import { Client } from '../domain/client';

export type TransactionType = 'credit' | 'debit' | 'refund';

/** Lançamento do extrato financeiro de um cliente. */
export interface Transaction {
  id: string;
  clientId: string;
  type: TransactionType;
  amountCents: number;
  messageId?: string;
  createdAt: Date;
}

/**
 * Portas (interfaces) que a aplicação exige da infraestrutura. Quem implementa
 * (memória, PostgreSQL) é detalhe: os casos de uso dependem só destas abstrações (DIP).
 */
export interface ClientRepository {
  /** Grava um cliente novo. Lança ConflictError(DOCUMENT_ALREADY_REGISTERED) se o documento já existe. */
  save(client: Client): Promise<void>;
  findById(id: string): Promise<Client | null>;
  findByDocument(documentValue: string): Promise<Client | null>;
  list(): Promise<Client[]>;
  /**
   * Lê, aplica `change` e grava de forma ATÔMICA, junto com o lançamento `entry`
   * no extrato quando informado: ou o saldo muda e o lançamento existe, ou nada
   * acontece. É o que impede dois envios simultâneos de gastarem o mesmo saldo
   * e um débito de ficar sem registro.
   *
   * Um segundo `refund` para a mesma mensagem lança ConflictError(REFUND_ALREADY_RECORDED)
   * sem alterar o saldo.
   */
  mutate(id: string, change: (client: Client) => Client, entry?: Transaction): Promise<Client>;
}

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

/** Leitura do extrato. A escrita acontece só por `ClientRepository.mutate`. */
export interface TransactionRepository {
  listByClient(clientId: string): Promise<Transaction[]>;
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');
