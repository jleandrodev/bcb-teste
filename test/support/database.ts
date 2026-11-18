import { Client } from 'pg';

/** A suíte e2e roda igual nos dois modos; `npm run test:pg` liga o PostgreSQL. */
export const usingPostgres = process.env.PERSISTENCE === 'postgres';

/** Para cenários que só existem com banco de verdade (ex.: reinício do processo). */
export const describePostgres = usingPostgres ? describe : describe.skip;

/**
 * Esvazia as tabelas antes de cada teste. Só aceita um banco cujo nome termina
 * em `_test`, para nunca apagar dados de quem está demonstrando a aplicação.
 */
export async function resetDatabase(): Promise<void> {
  if (!usingPostgres) return;
  const url = process.env.DATABASE_URL ?? '';
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`Os testes só rodam em um banco terminado em "_test" (recebido: ${url})`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const migrated = await client.query<{ present: string | null }>(`SELECT to_regclass('clients_client') AS present`);
    if (migrated.rows[0].present) {
      await client.query('TRUNCATE clients_client, clients_transaction, messaging_conversation, messaging_message');
    }
  } finally {
    await client.end();
  }
}
