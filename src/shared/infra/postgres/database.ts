import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Readiness } from '../../application/readiness';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');
/** Chave arbitrária do advisory lock que impede duas instâncias de migrarem ao mesmo tempo. */
const MIGRATION_LOCK = 72811;
/** Um banco que não responde neste prazo é tratado como fora do ar pela checagem de saúde. */
const PING_TIMEOUT_MS = 2000;

/**
 * Acesso ao PostgreSQL. Só existe conexão quando PERSISTENCE=postgres; no modo
 * memória `enabled` é falso e os módulos usam os adaptadores em memória.
 */
@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy, Readiness {
  private readonly logger = new Logger(Database.name);
  private readonly pool: Pool | null =
    process.env.PERSISTENCE === 'postgres' ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

  get enabled(): boolean {
    return this.pool !== null;
  }

  get persistence(): 'memory' | 'postgres' {
    return this.pool ? 'postgres' : 'memory';
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool) return;
    // Sem este handler, a queda de uma conexão ociosa derrubaria o processo.
    this.pool.on('error', (error) => this.logger.error(`conexão ociosa com o PostgreSQL falhou: ${error.message}`));
    await this.migrate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async query<Row extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.connected().query<Row>(sql, params)).rows;
  }

  /** Em memória, sempre pronto; com PostgreSQL, só se o banco responde a uma consulta trivial dentro do prazo. */
  async isReady(): Promise<boolean> {
    if (!this.pool) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('sem resposta do PostgreSQL')), PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.query('SELECT 1'), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Executa `work` em uma transação: COMMIT se terminar, ROLLBACK se lançar. */
  async transaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.connected().connect();
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }

  /** Aplica, em ordem, os arquivos de db/migrations que ainda não rodaram. Sem rollback (ADR-007). */
  private async migrate(): Promise<void> {
    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      const applied = new Set((await tx.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
      for (const file of readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort()) {
        if (applied.has(file)) continue;
        await tx.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        this.logger.log(`migração aplicada: ${file}`);
      }
    });
  }

  private connected(): Pool {
    if (!this.pool) throw new Error('PostgreSQL não configurado: defina PERSISTENCE=postgres e DATABASE_URL');
    return this.pool;
  }
}
