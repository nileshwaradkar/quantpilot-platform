CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users(
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL,
 verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_tokens(
 hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset','oauth')),
 session_id text, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits(key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS broker_accounts(
 user_id uuid PRIMARY KEY REFERENCES users(id), token_cipher text NOT NULL,
 account_hash text UNIQUE NOT NULL, account_mask text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS setups(
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 mode text NOT NULL CHECK(mode IN ('paper','live')), instrument text NOT NULL CHECK(instrument IN ('option','equity')),
 market text NOT NULL, config jsonb NOT NULL,
 status text NOT NULL DEFAULT 'paused' CHECK(status IN ('paused','running','attention')),
 snapshot jsonb NOT NULL DEFAULT '{}', last_candle bigint,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,mode,instrument,market)
);
CREATE TABLE IF NOT EXISTS trades(
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), setup_id uuid NOT NULL REFERENCES setups(id),
 mode text NOT NULL CHECK(mode IN ('paper','live')), symbol text NOT NULL, instrument text NOT NULL,
 side integer NOT NULL CHECK(side IN (1,-1)), multiplier double precision NOT NULL DEFAULT 1 CHECK(multiplier>0), quantity integer NOT NULL CHECK(quantity > 0), filled_qty integer NOT NULL DEFAULT 0,
 entry double precision NOT NULL, stop double precision NOT NULL, target double precision NOT NULL,
 tick double precision NOT NULL, signal_time bigint NOT NULL, trading_day date NOT NULL,
 status text NOT NULL CHECK(status IN ('submitting','pending','open','exit_pending','unknown','closed','rejected')),
 broker_order_id text, broker_position_id text, entry_tag text NOT NULL UNIQUE,
 exit_requested boolean NOT NULL DEFAULT false, exit_sent_at timestamptz, protection_set boolean NOT NULL DEFAULT false,
 position_seen boolean NOT NULL DEFAULT false, flat_since timestamptz,
 last_price double precision, last_quote_at timestamptz, exit double precision, pnl double precision,
 reason text, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 UNIQUE(setup_id,signal_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_symbol ON trades(user_id,mode,symbol) WHERE status NOT IN ('closed','rejected');
CREATE UNIQUE INDEX IF NOT EXISTS one_active_setup ON trades(setup_id) WHERE status NOT IN ('closed','rejected');
CREATE INDEX IF NOT EXISTS trades_owner ON trades(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS daily_halts(user_id uuid NOT NULL REFERENCES users(id), mode text NOT NULL, day date NOT NULL, reason text NOT NULL, PRIMARY KEY(user_id,mode,day));
CREATE TABLE IF NOT EXISTS audit_events(id bigserial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_owner ON audit_events(user_id,id DESC);
CREATE TABLE IF NOT EXISTS worker_health(id text PRIMARY KEY, heartbeat timestamptz NOT NULL, detail jsonb NOT NULL DEFAULT '{}');
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
