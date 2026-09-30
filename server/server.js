/**
 * server.js — Tiny Express + SQLite backend for the TMS frontend.
 *
 * Serves the static frontend from the project root and a REST API
 * under /api that mirrors the old IndexedDB-wrapper contract.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const DB_PATH     = process.env.TMS_DB_PATH || path.join(ROOT, 'tms.db');
const UPLOADS_DIR = path.resolve(process.env.TMS_UPLOADS_DIR || path.join(ROOT, 'uploads'));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Pre-schema migration: older DBs had a `backtests` table; rename it to
// `journals` so CREATE TABLE IF NOT EXISTS sees it and skips creation.
try {
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (tableNames.includes('backtests') && !tableNames.includes('journals')) {
    const migrate = db.transaction(() => {
      db.exec('DROP INDEX IF EXISTS idx_backtests_strategy');
      db.exec('DROP INDEX IF EXISTS idx_backtests_account');
      db.exec('DROP INDEX IF EXISTS idx_backtests_created');
      db.exec('ALTER TABLE backtests RENAME TO journals');
    });
    migrate();
    console.log('[migrate] renamed backtests → journals');
  }
} catch (err) {
  console.warn('[migrate] backtests → journals:', err.message);
}

db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// Lightweight migrations for older DB files
try {
  const cols = db.prepare('PRAGMA table_info(journals)').all().map(c => c.name);
  if (!cols.includes('amount')) db.exec('ALTER TABLE journals ADD COLUMN amount REAL');
  if (!cols.includes('strategy_ids')) {
    db.exec('ALTER TABLE journals ADD COLUMN strategy_ids TEXT');
    // Backfill multi-strategy column from legacy single strategy_id
    const backfill = db.transaction(() => {
      const rows = db.prepare('SELECT id, strategy_id FROM journals WHERE strategy_ids IS NULL').all();
      const upd = db.prepare('UPDATE journals SET strategy_ids = ? WHERE id = ?');
      for (const r of rows) {
        upd.run(JSON.stringify(r.strategy_id ? [r.strategy_id] : []), r.id);
      }
    });
    backfill();
  }
  if (!cols.includes('plan_id')) db.exec('ALTER TABLE journals ADD COLUMN plan_id TEXT');
  if (!cols.includes('exit_screenshot_path')) db.exec('ALTER TABLE journals ADD COLUMN exit_screenshot_path TEXT');
  if (!cols.includes('sop_checks'))       db.exec('ALTER TABLE journals ADD COLUMN sop_checks TEXT');
  if (!cols.includes('grade'))            db.exec('ALTER TABLE journals ADD COLUMN grade TEXT');
  if (!cols.includes('confluence_count')) db.exec('ALTER TABLE journals ADD COLUMN confluence_count INTEGER');
  if (!cols.includes('pre_grading')) {
    db.exec('ALTER TABLE journals ADD COLUMN pre_grading INTEGER NOT NULL DEFAULT 0');
    const r = db.prepare('UPDATE journals SET pre_grading = 1 WHERE sop_checks IS NULL').run();
    if (r.changes > 0) console.log(`[migrate] flagged ${r.changes} journal entries as pre-grading`);
  }
} catch (err) {
  console.warn('[migrate] journals columns:', err.message);
}

try {
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  const adds = [
    ['starting_capital', 'REAL'],
    ['account_number',   'TEXT'],
    ['tier',             'TEXT'],
    ['phase',            'TEXT'],
    ['risk_appetite',    'TEXT'],
    ['broker',           'TEXT'],
    ['vps',              'TEXT'],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
  }
  if (!cols.includes('personal_daily_cap_pct')) {
    db.exec('ALTER TABLE accounts ADD COLUMN personal_daily_cap_pct REAL');
    db.prepare('UPDATE accounts SET personal_daily_cap_pct = 3.0 WHERE personal_daily_cap_pct IS NULL').run();
  }
  if (!cols.includes('firm_daily_cap_pct')) {
    db.exec('ALTER TABLE accounts ADD COLUMN firm_daily_cap_pct REAL');
    db.prepare('UPDATE accounts SET firm_daily_cap_pct = 5.0 WHERE firm_daily_cap_pct IS NULL').run();
  }
} catch (err) {
  console.warn('[migrate] accounts columns:', err.message);
}

// ── Seed default global checks (only if `checks` table is empty) ─────────
try {
  const count = db.prepare('SELECT COUNT(*) AS n FROM checks').get().n;
  if (count === 0) {
    const now = Date.now();
    const defaults = [
      // Must-pass discipline gates
      { id: 'g-risk-1pct',   scope: 'global', label: 'Risk on this trade is ≤ 1% of account',           mustPass: 1, position: 0 },
      { id: 'g-no-news',     scope: 'global', label: 'No high-impact news within 30 minutes of entry',  mustPass: 1, position: 1 },
      { id: 'g-not-tilted',  scope: 'global', label: 'Not revenge-trading or tilted',                   mustPass: 1, position: 2 },
      { id: 'g-plan-first',  scope: 'global', label: 'Plan written before clicking buy/sell',           mustPass: 1, position: 3 },
      // Scored checks
      { id: 'g-good-session',scope: 'global', label: 'In a high-quality session (London / NY / US open)', mustPass: 0, position: 4 },
      { id: 'g-loss-limit',  scope: 'global', label: 'Daily loss limit not breached',                   mustPass: 0, position: 5 },
      { id: 'g-rr-2',        scope: 'global', label: 'Reward-to-risk ≥ 2.0',                            mustPass: 0, position: 6 },
      { id: 'g-screenshot',  scope: 'global', label: 'Setup screenshot captured',                        mustPass: 0, position: 7 },
    ];
    const ins = db.prepare(`INSERT INTO checks
      (id, scope, strategy_id, label, description, must_pass, position, created_at, updated_at)
      VALUES (@id, @scope, NULL, @label, NULL, @mustPass, @position, @now, @now)`);
    const tx = db.transaction(rows => { for (const r of rows) ins.run({ ...r, now }); });
    tx(defaults);
    console.log(`[seed] inserted ${defaults.length} default global checks`);
  }
} catch (err) {
  console.warn('[seed] global checks:', err.message);
}

// ── Auto-expire stale planned plans (older than 7 days) ──────────────────
try {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - sevenDaysMs;
  const upd = db.prepare(`UPDATE trade_plans
                          SET status = 'expired', updated_at = ?
                          WHERE status = 'planned' AND created_at < ?`);
  const result = upd.run(Date.now(), cutoff);
  if (result.changes > 0) console.log(`[expire] moved ${result.changes} stale plans to expired`);
} catch (err) {
  console.warn('[expire] plans:', err.message);
}

// ── Field mapping (snake_case DB ↔ camelCase JS) ─────────
const SOP_RULE_KEYS = ['rule_1','rule_2','rule_3','rule_4','rule_5','rule_6','rule_7','rule_8'];

function computeJournalGradeServer(sopChecks) {
  const n = SOP_RULE_KEYS.reduce((c, k) => c + (sopChecks?.[k]?.confirmed === true ? 1 : 0), 0);
  const grade = n >= 7 ? 'A' : n >= 5 ? 'B' : n >= 3 ? 'C' : 'Off-SOP';
  return { grade, confluenceCount: n };
}

function validateSopChecks(sopChecks) {
  if (sopChecks == null) return { ok: true };
  if (typeof sopChecks !== 'object') return { ok: false, msg: 'sopChecks must be an object' };
  for (const k of SOP_RULE_KEYS) {
    if (!(k in sopChecks)) return { ok: false, msg: `sopChecks missing rule key: ${k}` };
  }
  return { ok: true };
}

function computeCapState({ dailyPnlToday, startingCapital, personalDailyCapPct, firmDailyCapPct }) {
  const balance = Number(startingCapital) || 0;
  const personalPct = Number(personalDailyCapPct) || 3.0;
  const firmPct     = Number(firmDailyCapPct)     || 5.0;
  const pnl = Number(dailyPnlToday) || 0;

  const personalCapDollars = -(balance * personalPct / 100);
  const firmCapDollars     = -(balance * firmPct / 100);
  const personalCapPctUsed = balance > 0 && pnl < 0 ? Math.abs(pnl / personalCapDollars * 100) : 0;
  const firmCapPctUsed     = balance > 0 && pnl < 0 ? Math.abs(pnl / firmCapDollars * 100)     : 0;

  let capState = 'safe';
  if (firmCapPctUsed >= 100)            capState = 'firm_breached';
  else if (personalCapPctUsed >= 100)   capState = 'personal_breached';
  else if (personalCapPctUsed >= 90)    capState = 'breach_imminent';
  else if (personalCapPctUsed >= 70)    capState = 'warning';
  else if (personalCapPctUsed >= 40)    capState = 'caution';

  return { dailyPnlToday: pnl, personalCapDollars, firmCapDollars, personalCapPctUsed, firmCapPctUsed, capState };
}

const TRADER_TZ_OFFSET_MINUTES = 420;  // GMT+7 (Cambodia)

function todayBoundsMs(now = Date.now()) {
  const localNow = now + TRADER_TZ_OFFSET_MINUTES * 60_000;
  const dayMs = 24 * 60 * 60 * 1000;
  const startLocal = Math.floor(localNow / dayMs) * dayMs;
  const endLocal = startLocal + dayMs;
  return {
    startUtcMs: startLocal - TRADER_TZ_OFFSET_MINUTES * 60_000,
    endUtcMs:   endLocal   - TRADER_TZ_OFFSET_MINUTES * 60_000,
  };
}

function dailyPnlForAccount(accountId) {
  if (!accountId) return 0;
  const { startUtcMs, endUtcMs } = todayBoundsMs();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE
      WHEN result = 'win'  THEN amount
      WHEN result = 'loss' THEN -amount
      ELSE 0
    END), 0) AS pnl
    FROM journals
    WHERE account_id = ? AND entry_date >= ? AND entry_date < ?
  `).get(accountId, startUtcMs, endUtcMs);
  return row.pnl || 0;
}

function enrichAccount(account) {
  const pnl = dailyPnlForAccount(account.id);
  const cap = computeCapState({
    dailyPnlToday: pnl,
    startingCapital: account.startingCapital ?? account.capital,
    personalDailyCapPct: account.personalDailyCapPct,
    firmDailyCapPct: account.firmDailyCapPct,
  });
  return { ...account, ...cap };
}

const MAPPERS = {
  accounts: {
    toDb: a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      company: a.company ?? null,
      account_number: a.accountNumber ?? null,
      capital: a.capital ?? null,
      starting_capital: a.startingCapital ?? null,
      status: a.status ?? null,
      tier: a.tier ?? null,
      phase: a.phase ?? null,
      risk_appetite: a.riskAppetite ?? null,
      rules: JSON.stringify(a.rules ?? {}),
      strategy_ids: JSON.stringify(a.strategyIds ?? []),
      ea_name: a.eaName ?? null,
      broker: a.broker ?? null,
      vps: a.vps ?? null,
      personal_daily_cap_pct: a.personalDailyCapPct ?? 3.0,
      firm_daily_cap_pct: a.firmDailyCapPct ?? 5.0,
      created_at: a.createdAt ?? Date.now(),
      updated_at: a.updatedAt ?? Date.now(),
    }),
    fromDb: r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      company: r.company,
      accountNumber: r.account_number,
      capital: r.capital,
      startingCapital: r.starting_capital,
      status: r.status,
      tier: r.tier,
      phase: r.phase,
      riskAppetite: r.risk_appetite,
      rules: r.rules ? JSON.parse(r.rules) : {},
      strategyIds: r.strategy_ids ? JSON.parse(r.strategy_ids) : [],
      eaName: r.ea_name,
      broker: r.broker,
      vps: r.vps,
      personalDailyCapPct: r.personal_daily_cap_pct ?? 3.0,
      firmDailyCapPct: r.firm_daily_cap_pct ?? 5.0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  },
  strategies: {
    toDb: s => ({
      id: s.id,
      name: s.name,
      color: s.color ?? null,
      description: s.description ?? null,
      entry_methods: JSON.stringify(s.entryMethods ?? []),
      timeframes: JSON.stringify(s.timeframes ?? []),
      instruments: JSON.stringify(s.instruments ?? []),
      preferred_rr: s.preferredRR ?? null,
      max_sl_pips: s.maxSLPips ?? null,
      notes: s.notes ?? null,
      created_at: s.createdAt ?? Date.now(),
      updated_at: s.updatedAt ?? Date.now(),
    }),
    fromDb: r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      description: r.description,
      entryMethods: r.entry_methods ? JSON.parse(r.entry_methods) : [],
      timeframes: r.timeframes ? JSON.parse(r.timeframes) : [],
      instruments: r.instruments ? JSON.parse(r.instruments) : [],
      preferredRR: r.preferred_rr,
      maxSLPips: r.max_sl_pips,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  },
  journals: {
    toDb: b => {
      const ids = Array.isArray(b.strategyIds) && b.strategyIds.length
        ? b.strategyIds.filter(Boolean)
        : (b.strategyId ? [b.strategyId] : []);
      const hasSop = b.sopChecks && typeof b.sopChecks === 'object';
      const graded = hasSop ? computeJournalGradeServer(b.sopChecks) : null;
      return {
        id: b.id,
        strategy_id: ids[0] ?? null,
        strategy_ids: JSON.stringify(ids),
        account_id: b.accountId ?? null,
        instrument: b.instrument ?? null,
        timeframe: b.timeframe ?? null,
        direction: b.direction ?? null,
        entry_date: b.entryDate ?? null,
        result: b.result ?? null,
        r_achieved: b.rAchieved ?? null,
        amount: b.amount ?? null,
        screenshot_path: b.screenshotPath ?? null,
        exit_screenshot_path: b.exitScreenshotPath ?? null,
        description: b.description ?? null,
        tags: JSON.stringify(b.tags ?? []),
        plan_id: b.planId ?? null,
        sop_checks: hasSop ? JSON.stringify(b.sopChecks) : null,
        grade: graded?.grade ?? null,
        confluence_count: graded?.confluenceCount ?? null,
        pre_grading: hasSop ? 0 : 1,
        created_at: b.createdAt ?? Date.now(),
        updated_at: b.updatedAt ?? Date.now(),
      };
    },
    fromDb: r => {
      const ids = r.strategy_ids ? JSON.parse(r.strategy_ids) : (r.strategy_id ? [r.strategy_id] : []);
      return {
        id: r.id,
        strategyId: ids[0] ?? r.strategy_id ?? null,
        strategyIds: ids,
        accountId: r.account_id,
        instrument: r.instrument,
        timeframe: r.timeframe,
        direction: r.direction,
        entryDate: r.entry_date,
        result: r.result,
        rAchieved: r.r_achieved,
        amount: r.amount,
        screenshotPath: r.screenshot_path,
        exitScreenshotPath: r.exit_screenshot_path,
        description: r.description,
        tags: r.tags ? JSON.parse(r.tags) : [],
        planId: r.plan_id,
        sopChecks: r.sop_checks ? JSON.parse(r.sop_checks) : null,
        grade: r.grade,
        confluenceCount: r.confluence_count,
        preGrading: r.pre_grading === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },
  },
  trade_plans: {
    toDb: p => ({
      id: p.id,
      strategy_ids: JSON.stringify(p.strategyIds ?? []),
      account_id: p.accountId ?? null,
      instrument: p.instrument ?? null,
      timeframe: p.timeframe ?? null,
      direction: p.direction ?? null,
      planned_entry: p.plannedEntry ?? null,
      planned_sl: p.plannedSl ?? null,
      planned_tp: p.plannedTp ?? null,
      planned_rr: p.plannedRr ?? null,
      risk_pct: p.riskPct ?? null,
      check_results: JSON.stringify(p.checkResults ?? {}),
      grade: p.grade ?? null,
      status: p.status ?? 'draft',
      journal_id: p.journalId ?? null,
      premortem: p.premortem ?? null,
      screenshot_path: p.screenshotPath ?? null,
      discipline_violation: p.disciplineViolation ? 1 : 0,
      created_at: p.createdAt ?? Date.now(),
      updated_at: p.updatedAt ?? Date.now(),
      executed_at: p.executedAt ?? null,
    }),
    fromDb: r => ({
      id: r.id,
      strategyIds: r.strategy_ids ? JSON.parse(r.strategy_ids) : [],
      accountId: r.account_id,
      instrument: r.instrument,
      timeframe: r.timeframe,
      direction: r.direction,
      plannedEntry: r.planned_entry,
      plannedSl: r.planned_sl,
      plannedTp: r.planned_tp,
      plannedRr: r.planned_rr,
      riskPct: r.risk_pct,
      checkResults: r.check_results ? JSON.parse(r.check_results) : {},
      grade: r.grade,
      status: r.status,
      journalId: r.journal_id,
      premortem: r.premortem,
      screenshotPath: r.screenshot_path,
      disciplineViolation: r.discipline_violation === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      executedAt: r.executed_at,
    }),
  },
  checks: {
    toDb: c => ({
      id: c.id,
      scope: c.scope,
      strategy_id: c.strategyId ?? null,
      label: c.label,
      description: c.description ?? null,
      must_pass: c.mustPass ? 1 : 0,
      position: Number.isFinite(c.position) ? c.position : 0,
      created_at: c.createdAt ?? Date.now(),
      updated_at: c.updatedAt ?? Date.now(),
    }),
    fromDb: r => ({
      id: r.id,
      scope: r.scope,
      strategyId: r.strategy_id,
      label: r.label,
      description: r.description,
      mustPass: r.must_pass === 1,
      position: r.position ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  },
};

const STORES = Object.keys(MAPPERS);
const isStore = s => STORES.includes(s);

// ── App ──────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve the frontend + uploaded screenshots
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(ROOT, { index: 'index.html' }));

// Multer disk storage for screenshots
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.png').toLowerCase();
    const id = crypto.randomBytes(6).toString('hex');
    cb(null, `bt-${Date.now()}-${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads allowed'));
    cb(null, true);
  },
});

// ── API ──────────────────────────────────────────────────
app.get('/api/:store', (req, res) => {
  const { store } = req.params;
  if (!isStore(store)) return res.status(404).json({ error: 'Unknown store' });

  if (store === 'journals' && typeof req.query.grade === 'string' && req.query.grade.length) {
    const wanted = req.query.grade.split(',').map(s => s.trim()).filter(Boolean);
    const grades  = wanted.filter(g => g !== 'Pre-grading');
    const wantsPg = wanted.includes('Pre-grading');
    const clauses = [];
    const params = [];
    if (grades.length) {
      clauses.push(`grade IN (${grades.map(() => '?').join(',')})`);
      params.push(...grades);
    }
    if (wantsPg) clauses.push('pre_grading = 1');
    const where = clauses.length ? `WHERE ${clauses.join(' OR ')}` : '';
    const rows = db.prepare(`SELECT * FROM journals ${where} ORDER BY created_at DESC`).all(...params);
    return res.json(rows.map(MAPPERS.journals.fromDb));
  }

  const rows = db.prepare(`SELECT * FROM ${store} ORDER BY created_at DESC`).all();
  const mapped = rows.map(MAPPERS[store].fromDb);
  if (store === 'accounts') return res.json(mapped.map(enrichAccount));
  res.json(mapped);
});

app.get('/api/:store/:id', (req, res) => {
  const { store, id } = req.params;
  if (!isStore(store)) return res.status(404).json({ error: 'Unknown store' });
  const row = db.prepare(`SELECT * FROM ${store} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const mapped = MAPPERS[store].fromDb(row);
  if (store === 'accounts') return res.json(enrichAccount(mapped));
  res.json(mapped);
});

app.put('/api/:store', (req, res) => {
  const { store } = req.params;
  if (!isStore(store)) return res.status(404).json({ error: 'Unknown store' });
  const obj = req.body || {};
  if (!obj.id) return res.status(400).json({ error: 'id required' });

  if (store === 'journals') {
    const v = validateSopChecks(obj.sopChecks);
    if (!v.ok) return res.status(400).json({ error: v.msg });
  }

  const row = MAPPERS[store].toDb(obj);
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(',');
  const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(',');
  const sql = `INSERT INTO ${store} (${cols.join(',')}) VALUES (${placeholders})
               ON CONFLICT(id) DO UPDATE SET ${updates}`;
  db.prepare(sql).run(...cols.map(c => row[c]));

  const saved = db.prepare(`SELECT * FROM ${store} WHERE id = ?`).get(obj.id);
  res.json(MAPPERS[store].fromDb(saved));
});

app.delete('/api/:store/:id', (req, res) => {
  const { store, id } = req.params;
  if (!isStore(store)) return res.status(404).json({ error: 'Unknown store' });

  if (store === 'journals') {
    const row = db.prepare('SELECT screenshot_path, exit_screenshot_path FROM journals WHERE id = ?').get(id);
    if (row?.screenshot_path) deleteUpload(row.screenshot_path);
    if (row?.exit_screenshot_path) deleteUpload(row.exit_screenshot_path);
    // Unlink any plan that referenced this journal
    db.prepare('UPDATE trade_plans SET journal_id = NULL WHERE journal_id = ?').run(id);
  }

  if (store === 'trade_plans') {
    const row = db.prepare('SELECT screenshot_path, journal_id FROM trade_plans WHERE id = ?').get(id);
    if (row?.screenshot_path) deleteUpload(row.screenshot_path);
    // Null out the back-link on any journal that pointed at this plan
    if (row?.journal_id) {
      db.prepare('UPDATE journals SET plan_id = NULL WHERE id = ?').run(row.journal_id);
    }
  }

  db.prepare(`DELETE FROM ${store} WHERE id = ?`).run(id);
  res.status(204).end();
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// Stored paths are URLs (`/uploads/<file>`); map them onto UPLOADS_DIR,
// which may live outside ROOT (e.g. a Docker volume).
function deleteUpload(relPath) {
  const match = /^\/*uploads\/(.+)$/.exec(String(relPath));
  if (!match) return;
  const abs = path.resolve(UPLOADS_DIR, match[1]);
  if (!abs.startsWith(UPLOADS_DIR + path.sep)) return;  // guard against traversal
  fs.promises.unlink(abs).catch(() => {});
}

app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`TMS server → http://localhost:${PORT}`);
    console.log(`Database   → ${DB_PATH}`);
    console.log(`Uploads    → ${UPLOADS_DIR}`);
  });

  // PID 1 in a container ignores SIGTERM by default; handle it so `docker stop`
  // is instant and SQLite checkpoints the WAL into tms.db before exit.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      db.close();
      process.exit(0);
    });
  }
}

module.exports = { app, db, computeCapState };
