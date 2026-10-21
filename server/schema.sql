CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  display_name     TEXT,
  type             TEXT NOT NULL,
  company          TEXT,
  account_number   TEXT,
  capital          REAL,
  starting_capital REAL,
  status           TEXT,
  tier             TEXT,
  phase            TEXT,
  risk_appetite    TEXT,
  rules            TEXT,           -- JSON object
  strategy_ids     TEXT,           -- JSON array of strategy ids
  ea_name          TEXT,
  broker           TEXT,
  vps              TEXT,
  personal_daily_cap_pct REAL NOT NULL DEFAULT 3.0,
  firm_daily_cap_pct     REAL NOT NULL DEFAULT 5.0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strategies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  color          TEXT,
  description    TEXT,
  entry_methods  TEXT,          -- JSON array
  timeframes     TEXT,          -- JSON array
  instruments    TEXT,          -- JSON array
  preferred_rr   REAL,
  max_sl_pips    REAL,
  notes          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS journals (
  id               TEXT PRIMARY KEY,
  strategy_id      TEXT,        -- legacy single id (mirrors strategy_ids[0] for filtering / FK)
  strategy_ids     TEXT,        -- JSON array of strategy ids (multi-strategy per trade)
  account_id       TEXT,
  instrument       TEXT,
  timeframe        TEXT,
  direction        TEXT,
  entry_date       INTEGER,     -- unix ms
  result           TEXT,        -- win | loss | be
  r_achieved       REAL,
  amount           REAL,        -- dollar P&L magnitude (always positive, sign derived from result)
  screenshot_path  TEXT,        -- entry screenshot, e.g. /uploads/bt-xxx.png
  exit_screenshot_path TEXT,    -- TP / SL hit screenshot (optional)
  description      TEXT,
  tags             TEXT,        -- JSON array
  sop_checks       TEXT,        -- JSON: { rule_1: { confirmed, note }, ... }
  grade            TEXT,        -- 'A' | 'B' | 'C' | 'Off-SOP' | NULL (legacy)
  confluence_count INTEGER,     -- 0–8 confirmed rules; NULL for legacy
  pre_grading      INTEGER NOT NULL DEFAULT 0,  -- 1 if logged before SOP rollout
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL,
  FOREIGN KEY (account_id)  REFERENCES accounts(id)   ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_journals_strategy ON journals(strategy_id);
CREATE INDEX IF NOT EXISTS idx_journals_account  ON journals(account_id);
CREATE INDEX IF NOT EXISTS idx_journals_created  ON journals(created_at DESC);

CREATE TABLE IF NOT EXISTS trade_plans (
  id                    TEXT PRIMARY KEY,
  strategy_ids          TEXT,        -- JSON array of strategy ids
  account_id            TEXT,
  instrument            TEXT,
  timeframe             TEXT,
  direction             TEXT,        -- 'long' | 'short'
  planned_entry         REAL,
  planned_sl            REAL,
  planned_tp            REAL,
  planned_rr            REAL,
  risk_pct              REAL,
  check_results         TEXT,        -- JSON object: { "<checkId>": true|false }
  grade                 TEXT,        -- 'A' | 'B' | 'C' | 'SKIP'
  status                TEXT,        -- 'draft' | 'planned' | 'executed' | 'skipped' | 'expired'
  journal_id            TEXT,
  premortem             TEXT,
  screenshot_path       TEXT,
  discipline_violation  INTEGER DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  executed_at           INTEGER,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_status   ON trade_plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_grade    ON trade_plans(grade);
CREATE INDEX IF NOT EXISTS idx_plans_created  ON trade_plans(created_at DESC);

CREATE TABLE IF NOT EXISTS checks (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,        -- 'global' | 'strategy'
  strategy_id  TEXT,
  label        TEXT NOT NULL,
  description  TEXT,
  must_pass    INTEGER DEFAULT 0,    -- 0 | 1
  position     INTEGER DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checks_scope    ON checks(scope);
CREATE INDEX IF NOT EXISTS idx_checks_strategy ON checks(strategy_id);
CREATE INDEX IF NOT EXISTS idx_checks_position ON checks(position);
