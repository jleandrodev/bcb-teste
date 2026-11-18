import { ClientRepository, Transaction, TransactionRepository } from '../../src/clients/application/ports';
import { Client } from '../../src/clients/domain/client';
import { Document } from '../../src/clients/domain/document';
import { InMemoryClientRepository, InMemoryTransactionRepository } from '../../src/clients/infra/memory/repositories';
import { PostgresClientRepository, PostgresTransactionRepository } from '../../src/clients/infra/postgres/repositories';
import { Money } from '../../src/shared/domain/money';
import { Database } from '../../src/shared/infra/postgres/database';
import { resetDatabase, usingPostgres } from '../support/database';
import { CNPJ, CPF } from '../support/fixtures';

/*
 * Teste de contrato: as mesmas expectativas rodam contra cada adaptador da porta.
 * É o que autoriza usar o adaptador em memória nos testes rápidos: ele se comporta
 * como o de produção nas regras que importam. O PostgreSQL entra com `npm run test:pg`.
 */
const adapters: [string, (db: Database) => { clients: ClientRepository; transactions: TransactionRepository }][] = [
  [
    'memória',
    () => {
      const transactions = new InMemoryTransactionRepository();
      return { clients: new InMemoryClientRepository(transactions), transactions };
    },
  ],
];
if (usingPostgres) {
  adapters.push([
    'PostgreSQL',
    (db) => ({ clients: new PostgresClientRepository(db), transactions: new PostgresTransactionRepository(db) }),
  ]);
}

const now = new Date('2026-03-10T12:00:00.000Z');
const cents = (value: number) => Money.fromCents(value);

function prepaid(id: string, documentId: string, balanceCents: number): Client {
  return Client.create({
    id,
    name: `Cliente ${id}`,
    document: Document.create('CPF', documentId),
    planType: 'prepaid',
    balance: cents(balanceCents),
    now,
  });
}

describe.each(adapters)('ClientRepository e extrato (%s)', (_name, create) => {
  const db = new Database();
  let clients: ClientRepository;
  let transactions: TransactionRepository;

  beforeAll(() => db.onModuleInit());
  afterAll(() => db.onModuleDestroy());

  beforeEach(async () => {
    await resetDatabase();
    ({ clients, transactions } = create(db));
  });

  describe('gravação e leitura', () => {
    it('devolve o cliente gravado com todos os campos, por id e por documento', async () => {
      const loja = Client.create({
        id: 'c-loja',
        name: 'Loja',
        document: Document.create('CNPJ', CNPJ.loja),
        planType: 'postpaid',
        limit: cents(5000),
        now,
      }).charge(cents(4250), now);
      await clients.save(loja);

      expect(await clients.findById('c-loja')).toEqual(loja);
      expect(await clients.findByDocument(CNPJ.loja)).toEqual(loja);
    });

    it('devolve null para id ou documento desconhecido', async () => {
      expect(await clients.findById('nao-existe')).toBeNull();
      expect(await clients.findByDocument(CPF.ana)).toBeNull();
    });

    it('lista na ordem de cadastro', async () => {
      await clients.save(prepaid('c-2', CPF.bruno, 0));
      await clients.save(prepaid('c-1', CPF.ana, 0));

      expect((await clients.list()).map((c) => c.id)).toEqual(['c-2', 'c-1']);
    });

    it('recusa um segundo cliente com o mesmo documento', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 0));

      await expect(clients.save(prepaid('c-2', CPF.ana, 0))).rejects.toMatchObject({ code: 'DOCUMENT_ALREADY_REGISTERED' });
      expect(await clients.list()).toHaveLength(1);
    });

    it('guarda valores acima de 2³¹ centavos sem perder precisão', async () => {
      const rich = prepaid('c-1', CPF.ana, 9_000_000_000_00);
      await clients.save(rich);

      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(9_000_000_000_00);
    });
  });

  describe('mutate', () => {
    it('aplica a função e grava o resultado', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 100));

      const returned = await clients.mutate('c-1', (client) => client.charge(cents(25), now));

      expect(returned.account.balance.cents).toBe(75);
      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(75);
    });

    it('se a função lança, nada é gravado e o erro chega a quem chamou', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 24));

      await expect(clients.mutate('c-1', (client) => client.charge(cents(25), now))).rejects.toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
      });
      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(24);
    });

    it('lança CLIENT_NOT_FOUND para id desconhecido, sem chamar a função', async () => {
      let called = false;

      await expect(
        clients.mutate('nao-existe', (client) => {
          called = true;
          return client;
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
      expect(called).toBe(false);
    });

    it('é atômico: vinte débitos simultâneos de R$ 0,25 sobre R$ 1,00 gastam exatamente R$ 1,00', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 100));

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => clients.mutate('c-1', (client) => client.charge(cents(25), now))),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(0);
    });

    it('nenhuma atualização simultânea se perde: cinquenta créditos de R$ 0,01 somam R$ 0,50', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 0));

      await Promise.all(Array.from({ length: 50 }, () => clients.mutate('c-1', (client) => client.addCredits(cents(1)))));

      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(50);
    });

    it('travar um cliente não bloqueia a alteração de outro', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 100));
      await clients.save(prepaid('c-2', CPF.bruno, 100));

      await Promise.all([
        clients.mutate('c-1', (client) => client.charge(cents(25), now)),
        clients.mutate('c-2', (client) => client.charge(cents(50), now)),
      ]);

      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(75);
      expect((await clients.findById('c-2'))?.account.balance.cents).toBe(50);
    });
  });

  describe('extrato', () => {
    const entry = (id: string, clientId: string, type: Transaction['type'], amountCents: number, messageId?: string): Transaction => ({
      id,
      clientId,
      type,
      amountCents,
      messageId,
      createdAt: now,
    });
    const credit = (client: Client) => client.addCredits(cents(100));

    it('lista os lançamentos do cliente na ordem em que foram registrados', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 0));
      await clients.save(prepaid('c-2', CPF.bruno, 0));
      await clients.mutate('c-1', credit, entry('t-1', 'c-1', 'credit', 100));
      await clients.mutate('c-2', credit, entry('t-2', 'c-2', 'credit', 100));
      await clients.mutate('c-1', (client) => client.charge(cents(50), now), entry('t-3', 'c-1', 'debit', 50, 'm-1'));
      await clients.mutate('c-1', (client) => client.refund(cents(50), now), entry('t-4', 'c-1', 'refund', 50, 'm-1'));

      expect(await transactions.listByClient('c-1')).toEqual([
        entry('t-1', 'c-1', 'credit', 100),
        entry('t-3', 'c-1', 'debit', 50, 'm-1'),
        entry('t-4', 'c-1', 'refund', 50, 'm-1'),
      ]);
    });

    it('cliente sem movimentação tem extrato vazio; alteração sem lançamento não cria linha', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 0));
      await clients.mutate('c-1', (client) => client.update({ name: 'Novo nome' }));

      expect(await transactions.listByClient('c-1')).toEqual([]);
    });

    it('saldo e lançamento são uma operação só: se a cobrança é recusada, não há lançamento', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 24));

      await expect(
        clients.mutate('c-1', (client) => client.charge(cents(25), now), entry('t-1', 'c-1', 'debit', 25, 'm-1')),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

      expect(await transactions.listByClient('c-1')).toEqual([]);
    });

    it('um segundo estorno da mesma mensagem é recusado e o saldo não muda', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 50));
      const refund = (client: Client) => client.refund(cents(50), now);
      await clients.mutate('c-1', refund, entry('t-1', 'c-1', 'refund', 50, 'm-1'));

      await expect(clients.mutate('c-1', refund, entry('t-2', 'c-1', 'refund', 50, 'm-1'))).rejects.toMatchObject({
        code: 'REFUND_ALREADY_RECORDED',
      });

      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(100);
      expect(await transactions.listByClient('c-1')).toHaveLength(1);
    });

    it('dois estornos simultâneos da mesma mensagem: só um vale', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 0));
      const refund = (client: Client) => client.refund(cents(50), now);

      const results = await Promise.allSettled([
        clients.mutate('c-1', refund, entry('t-1', 'c-1', 'refund', 50, 'm-1')),
        clients.mutate('c-1', refund, entry('t-2', 'c-1', 'refund', 50, 'm-1')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await clients.findById('c-1'))?.account.balance.cents).toBe(50);
    });

    it('estornos de mensagens diferentes, e débitos repetidos da mesma mensagem, não são confundidos', async () => {
      await clients.save(prepaid('c-1', CPF.ana, 100));
      await clients.mutate('c-1', (client) => client.refund(cents(50), now), entry('t-1', 'c-1', 'refund', 50, 'm-1'));
      await clients.mutate('c-1', (client) => client.refund(cents(50), now), entry('t-2', 'c-1', 'refund', 50, 'm-2'));
      await clients.mutate('c-1', credit, entry('t-3', 'c-1', 'credit', 100));
      await clients.mutate('c-1', credit, entry('t-4', 'c-1', 'credit', 100));

      expect(await transactions.listByClient('c-1')).toHaveLength(4);
    });
  });
});
