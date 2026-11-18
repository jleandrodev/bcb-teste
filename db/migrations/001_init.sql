-- Esquema inicial. Tabelas levam o prefixo do módulo dono (ADR-002).
-- Dinheiro em centavos inteiros (ADR-005). Sem chave estrangeira entre módulos.

CREATE TABLE clients_client (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('CPF', 'CNPJ')),
  document      TEXT NOT NULL UNIQUE,
  plan_type     TEXT NOT NULL CHECK (plan_type IN ('prepaid', 'postpaid')),
  balance_cents BIGINT NOT NULL CHECK (balance_cents >= 0),
  limit_cents   BIGINT NOT NULL CHECK (limit_cents >= 0),
  used_cents    BIGINT NOT NULL CHECK (used_cents >= 0),
  usage_period  TEXT NOT NULL,
  active        BOOLEAN NOT NULL,
  seq           BIGSERIAL
);

CREATE TABLE clients_transaction (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients_client (id),
  type         TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'refund')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  message_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL,
  seq          BIGSERIAL
);
CREATE INDEX clients_transaction_client_idx ON clients_transaction (client_id, seq);

CREATE TABLE messaging_conversation (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  recipient_id         TEXT NOT NULL,
  recipient_name       TEXT NOT NULL,
  last_message_content TEXT,
  last_message_time    TIMESTAMPTZ,
  UNIQUE (client_id, recipient_id)
);

CREATE TABLE messaging_message (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES messaging_conversation (id),
  sender_id       TEXT NOT NULL,
  recipient_id    TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  priority        TEXT NOT NULL CHECK (priority IN ('normal', 'urgent')),
  status          TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'read', 'failed')),
  cost_cents      BIGINT NOT NULL CHECK (cost_cents >= 0),
  attempts        INTEGER NOT NULL,
  history         JSONB NOT NULL,
  seq             BIGSERIAL
);
CREATE INDEX messaging_message_sender_idx ON messaging_message (sender_id, seq);
-- A reconstrução da fila na inicialização busca só o que ainda está pendente.
CREATE INDEX messaging_message_pending_idx ON messaging_message (seq) WHERE status IN ('queued', 'processing');
