CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT,
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'confirmado', 'pronto', 'concluido', 'cancelado')),
  modo TEXT NOT NULL CHECK (modo IN ('entrega', 'retirada', 'mesa')),
  mesa TEXT,
  nome TEXT NOT NULL,
  endereco TEXT,
  pagamento TEXT NOT NULL,
  troco_centavos INTEGER,
  itens TEXT NOT NULL,
  subtotal_centavos INTEGER NOT NULL,
  taxa_centavos INTEGER NOT NULL,
  total_centavos INTEGER NOT NULL,
  mensagem TEXT NOT NULL,
  ip_hash TEXT
);
CREATE INDEX idx_pedidos_criado ON pedidos (criado_em);
CREATE INDEX idx_pedidos_ip ON pedidos (ip_hash, criado_em);
CREATE INDEX idx_pedidos_status ON pedidos (status, id);

CREATE TABLE tentativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tentativas_ip ON tentativas (ip_hash, criado_em);
