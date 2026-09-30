# Architecture

This document describes how the Trading Management System (TMS) is put together. It's the recommended read before contributing — most of the project's invariants are documented here, not in the code.

For setup instructions, see [README.md](README.md). For contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## High-level overview

TMS is a **single-page application** with two interchangeable storage backends:

```
[Local server mode]  (normally inside the Docker container — see "Runtime & deployment")
Browser ──► localhost:3000  (Express)
              ├── static → index.html + css/ + js/
              ├── /uploads/* → screenshot files      (TMS_UPLOADS_DIR)
              └── /api/* → SQLite via better-sqlite3  (TMS_DB_PATH)

[Browser-only mode] (e.g. GitHub Pages, static hosts)
Browser ──► static host
              └── IndexedDB inside the browser
```

`js/db-detect.js` runs once per session, HEADs `/api/accounts` with a 2s abort, and picks the adapter:
- Success → `js/db-http.js`
- Failure (e.g. served statically) → `js/db-idb.js`

The result is cached in `sessionStorage['tms-mode']`. Page modules never know which mode they're in — they only import `js/db.js`, which transparently delegates to whichever adapter was chosen.

---

## Tech choices

| Concern | Choice | Why |
|---------|--------|-----|
| Frontend framework | None (vanilla JS + ES modules) | No build step, no bundler, no upgrade churn |
| State management | In-memory `data` cache + pub/sub in `store.js` | Simpler than Redux for this scale |
| Routing | Hand-rolled hash router (`js/router.js`) | Works on static hosts, no server config needed |
| Charts | Hand-rolled SVG | No chart library dependency, full styling control |
| Server | Express + `better-sqlite3` + `multer` | Synchronous SQLite is fast and simple for single-user use |
| Runtime / packaging | Docker + Compose, driven by a `Makefile` | Identical setup on Windows/macOS/Linux; no host Node.js or C++ toolchain; data isolated in a volume |
| Storage (browser-only) | IndexedDB via `js/db-idb.js` | Survives reloads, holds binary screenshots as Blobs |
| Active account / calculator state | `localStorage` | Per-device preference, not user data |

The project deliberately avoids: TypeScript, React, Vite/Webpack, chart libraries, CSS frameworks, ORMs, telemetry.

---

## File structure

```
index.html                  # Frontend shell — pages mount into <section data-page="...">
tms.db                      # SQLite database (non-Docker server mode only, gitignored)
uploads/                    # Screenshot storage (non-Docker server mode only, gitignored)
pages/                      # Archived single-page references (HTML)

Dockerfile                  # Multi-stage image: deps → app → dev | prod (default)
compose.yaml                # Production stack (project `tms`, port 3000, volume tms_data)
compose.dev.yaml            # Development stack (project `tms-dev`, port 3001, repo bind-mounted)
Makefile                    # `make help` — up/down/build/logs/backup/... for either stack
.env.example                # Optional overrides (ENV, ports, bind address, Node version)
docker/
  backup.sh                 # → /usr/local/bin/tms-backup: streams tms.db + uploads/ as .tar.gz
  restore.sh                # → /usr/local/bin/tms-restore: validates, then swaps in an archive

css/
  base.css                  # Reset, variables, typography
  components.css            # Cards, badges, buttons, customSelect, confirmDialog, lightbox
  background.css            # Starfield background
  layout.css                # Header, sidebar, mobile drawer, main grid
  forms.css                 # Centered modal form panel + field styles
  dashboard.css, accounts.css, strategies.css, journal.css
  sniper.css                # Sniper Adaptive Flow workspace
  data-manager.css          # Backup/restore UI

js/
  main.js                   # Bootstraps router + registers pages
  router.js                 # Hash router: register(), go(), initRouter()
  store.js                  # In-memory cache over the storage adapter, pub/sub change events
  state.js                  # Risk calculator state (separate from `data`)
  utils.js                  # el(), fmtMoney(), fmtPct(), customSelect, confirmDialog, imageLightbox

  db.js                     # Adapter facade — picks at boot via db-detect.js
  db-detect.js              # Probes /api/accounts → 'http' or 'idb'
  db-http.js                # fetch()-based adapter
  db-idb.js                 # IndexedDB adapter (same surface as db-http)
  migrate.js                # One-way export HTTP → IDB
  backup.js                 # Manual JSON export/import
  compute.js                # Pure-functional derivations (PnL series, stats)

  dashboard.js              # Dashboard + cumulative PnL chart widget
  accounts.js               # Account CRUD + detail page
  strategies.js             # Strategy CRUD + detail page
  journal.js                # Journal gallery + detail modal (dual screenshots, lightbox)
  sniper.js                 # Sniper Adaptive Flow (5-phase tick list + tier grading)
  data-manager.js           # /data page: export/import/migrate/wipe
  doctrine.js               # Doctrine docs viewer (#doctrine/<topic>)
  calendar.js               # Trade calendar
  forms.js                  # openFormPanel() centered modal; field builders; imageUpload
  checklist.js              # Per-strategy setup checklist editor
  theme.js, background.js, ui.js

server/
  package.json              # express, better-sqlite3, multer, cors
  schema.sql                # Table definitions (auto-applied on boot)
  server.js                 # Express app — serves frontend + /api + /uploads
```

---

## Runtime & deployment (Docker)

Docker is the primary way to run the server. Everything the Makefile does is a thin wrapper over `docker compose -f <file>`; `make -n <target>` prints the exact commands.

**Image stages** (`Dockerfile`):

| Stage | Contents |
|-------|----------|
| `deps` | `npm ci`/`npm install --omit=dev` with a compiler toolchain as fallback (better-sqlite3 normally uses a prebuilt binary for Node 22) |
| `app` | `node_modules` at **`/node_modules`**, code at `/app` (root-owned, read-only to the app), runs as `node`, HEALTHCHECK on `HEAD /api/accounts` |
| `dev` | `app` + `tests/`, `NODE_ENV=development`, `node --watch server.js` |
| `prod` | `app` + `NODE_ENV=production`, `node server.js` — the default build target |

Dependencies live at `/node_modules` (outside `/app`) so the dev stack can bind-mount the repo over `/app` without hiding them; Node finds them by walking up parent directories. The dev stack also lays an empty tmpfs over `/app/server/node_modules` so a host copy (e.g. a Windows-built `better-sqlite3`) can't shadow the image's.

**Configuration** (read by `server/server.js`):

| Env var | Default (no Docker) | In the image |
|---------|---------------------|--------------|
| `PORT` | `3000` | `3000` (published on the host as `TMS_PORT` / `TMS_DEV_PORT`) |
| `TMS_DB_PATH` | `<repo>/tms.db` | `/data/tms.db` |
| `TMS_UPLOADS_DIR` | `<repo>/uploads` | `/data/uploads` |

`/data` is a named volume per stack (`tms_data`, `tms-dev_data`). Screenshot paths stored in the database stay `/uploads/<file>` URLs in every mode; the server maps them onto `TMS_UPLOADS_DIR`.

**Stacks:**

| | dev (`compose.dev.yaml`) | prod (`compose.yaml`) |
|---|---|---|
| Host port | `127.0.0.1:3001` | `127.0.0.1:3000` |
| Code | repo bind-mounted at `/app` (live edits) | baked into the image |
| Hardening | — | `read_only` root FS + tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `restart: unless-stopped`, rotated logs |

Both publish on loopback only (`TMS_BIND`, default `127.0.0.1`), because there's no authentication — and Docker's port publishing bypasses host firewalls such as ufw.

**Lifecycle:** `init: true` runs tini as PID 1 and the server closes SQLite on `SIGTERM`/`SIGINT`, so `docker stop` is immediate and the WAL is checkpointed into `tms.db`. Schema migrations run on every boot (see [Database schema](#database-schema)), so `make update` is just backup → `git pull` → rebuild → restart.

**Backups:** `tms-backup` takes a consistent snapshot with `VACUUM INTO` (safe while the app is writing) and streams `tms.db` + `uploads/` as a tarball on stdout; `tms-restore` reads one on stdin, unpacks it beside the live data, checks that it contains a real SQLite `tms.db`, and only then swaps it in. The archive layout matches a non-Docker install, which is how `make import-legacy` migrates an old `tms.db` + `uploads/` folder.

---

## Data flow

```
storage adapter (http | idb) ◄── db.js ◄── store.js (cache + events) ◄── page modules
```

**Hard rules:**

- **Page modules never call `db.js` directly.** They go through `store.js`. This is what gives change-event propagation across views.
- **After any write, `store.js` calls `notify()`** so subscribed views re-render automatically.
- **`store.js` keeps a single in-memory `data` object**: `data.accounts`, `data.strategies`, `data.journals`, `data.checks`, `data.activeAccountId`. Treat these as read-only snapshots; never mutate them in place.

### Field mapping (server mode)

The HTTP/SQLite adapter converts between two naming conventions:

- **Database columns:** `snake_case` (`screenshot_path`, `strategy_ids`)
- **JS objects:** `camelCase` (`screenshotPath`, `strategyIds`)

Conversion happens in `server/server.js` via per-store `MAPPERS` (`toDb` / `fromDb`). Array and object fields are serialized as JSON text.

**IDB mode stores camelCase objects as-is** — no mapping needed.

> ⚠️ When adding a new field to any store, you must update **both** the SQL schema (snake_case) **and** the mapper (camelCase ↔ snake_case). See [CONTRIBUTING.md](CONTRIBUTING.md) for the checklist.

### Screenshot flow (subtle — read carefully)

Canonical paths (what gets persisted on a record) are mode-specific:

| Mode | Canonical value | Where it lives |
|------|-----------------|----------------|
| HTTP | `/uploads/bt-<ts>-<rand>.png` | `uploads/` folder, served by Express |
| IDB | `idb://sc-<id>` | Blob inside IndexedDB |

Display URLs are resolved on read and attached as **sibling fields**:

- `screenshotPath` → canonical (always preserved on save)
- `screenshotPathUrl` → resolved render URL (`blob:` in IDB mode, same as path in HTTP mode)

Same pattern for `exitScreenshotPath` / `exitScreenshotPathUrl`.

**Two invariants you must preserve:**

1. **Render with `value.screenshotPathUrl || value.screenshotPath`** — never just `value.screenshotPath` (which won't render `idb://` URIs in a browser).
2. **Save only the canonical `screenshotPath`** — never round-trip a `blob:` URL into a record. Blob URLs expire on reload; saving one will silently poison the row.

Upload flow (`js/forms.js` → `imageUpload`):
1. User drops/pastes/selects image → local preview via `URL.createObjectURL()`
2. HTTP mode: `POST /api/upload`, server returns `{ path: '/uploads/...' }`
3. IDB mode: write Blob to IndexedDB, return `idb://sc-<id>`
4. On record delete, the adapter unlinks the file (HTTP) or removes the Blob row (IDB)

---

## Routing

- Pages register handlers via `register(name, fn)` in `js/main.js`.
- Navigate with `go('accounts')`. **Never** mutate `location.hash` directly.
- Sub-routes use `/` as separator: `#strategies/abc123` → `param = 'abc123'`.

Registered pages: `dashboard`, `accounts`, `strategies`, `journal`, `calendar`, `sniper`, `doctrine/<topic>`, `calculator`, `data`.

---

## Workspaces (page-by-page)

| Route | Purpose |
|-------|---------|
| `#dashboard` | KPIs, cumulative P&L chart, account strip, doctrine quick links |
| `#accounts` | Account CRUD; drawdown-used % bar; Backtest type with period/platform/hypothesis fields |
| `#strategies` | Strategy CRUD; detail page with stats + linked accounts + journal thumbnails (thumbnails open journal detail modal directly) |
| `#journal` | Journal entry gallery; detail modal with dual screenshots, lightbox, Amount won/lost pill |
| `#calendar` | Day-by-day trade calendar |
| `#sniper` | Orderflow Sniper Adaptive Flow — 5-phase pre-trade checklist with automated tier grading (A+ / Baseline / Building / Skip) and position % risk readout |
| `#calculator` | Position-size / risk calculator, auto-synced with active account on entry |
| `#data` | Backup/restore JSON, migrate HTTP → IDB, wipe local data |
| `#doctrine/<topic>` | Trading doctrine documents |

---

## API (server mode only)

All mounted under `/api` on `localhost:3000` (`3001` for the dev stack).

| Method | Path | Purpose |
|--------|------|---------|
| HEAD | `/:store` | Liveness probe (used by `db-detect.js`) |
| GET | `/:store` | List all (sorted by `created_at DESC`) |
| GET | `/:store/:id` | Fetch one |
| PUT | `/:store` | Upsert (body = full object, `id` required) |
| DELETE | `/:store/:id` | Delete (cascades screenshot files for journals) |
| POST | `/upload` | Multipart file upload → returns `{ path }` |

`:store` ∈ `accounts` | `strategies` | `journals` | `checks` | `trade_plans` (legacy).

---

## Database schema

Schema lives in `server/schema.sql` and auto-applies on boot. New columns are added via idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` shims in `server/server.js` — never edit production databases by hand.

```sql
accounts(
  id TEXT PK, name, type, company, account_number, capital REAL, starting_capital REAL,
  status, tier, phase, risk_appetite, rules TEXT(json), strategy_ids TEXT(json),
  ea_name, broker, vps,
  personal_daily_cap_pct REAL DEFAULT 3.0, firm_daily_cap_pct REAL DEFAULT 5.0,
  created_at INTEGER, updated_at INTEGER
)

strategies(
  id TEXT PK, name, color, description,
  entry_methods TEXT(json), timeframes TEXT(json), instruments TEXT(json),
  preferred_rr REAL, max_sl_pips REAL, notes,
  created_at INTEGER, updated_at INTEGER
)

journals(
  id TEXT PK,
  strategy_id FK→strategies(id) SET NULL,         -- legacy single id, mirrors strategy_ids[0]
  strategy_ids TEXT(json),                        -- multi-strategy per trade
  account_id  FK→accounts(id)  SET NULL,
  instrument, timeframe, direction,
  entry_date INTEGER, result, r_achieved REAL,
  amount REAL,                                    -- dollar P&L magnitude (sign derived from result)
  screenshot_path TEXT,                           -- entry screenshot
  exit_screenshot_path TEXT,                      -- TP/SL hit screenshot
  description, tags TEXT(json),
  sop_checks TEXT(json), grade, confluence_count, pre_grading,  -- legacy, no longer surfaced in UI
  created_at INTEGER, updated_at INTEGER
)

checks(
  id TEXT PK, scope ('global'|'strategy'),
  strategy_id FK→strategies(id) CASCADE,
  label, description, must_pass INTEGER, position INTEGER,
  created_at INTEGER, updated_at INTEGER
)

trade_plans(...)   -- legacy table, UI removed; kept for backward compatibility
```

IDB mode mirrors this with object stores keyed by `id`. Field names stay in camelCase, no JSON-string wrapping.

---

## Design system

| Token | Value | Use |
|-------|-------|-----|
| Background | `#07090F` | Page base |
| Gold primary | `#F59E0B` → `#FDE68A` | CTAs, active states |
| Profit | `#10B981` | Green P&L |
| Loss | `#EF4444` | Red P&L |
| Prop Challenge | `#F59E0B` | Account badge |
| Prop Instant | `#3B82F6` | Account badge |
| Own Funds | `#10B981` | Account badge |
| EA Robot | `#8B5CF6` | Account badge |
| Backtest | `#06B6D4` | Account badge |
| Sniper phase 1–5 | amber / green / cyan / red / blue | Adaptive Flow palette |

**Component patterns:**

- **Cards**: `rgba(255,255,255,0.04)` background, `16px` radius, hover border → `rgba(249,168,37,0.3)` + `translateY(-2px)`.
- **Forms**: centered modal with `scale(0.96)→1` fade, focus trap, sticky footer **outside** the `<form>` (submit button fires `form.requestSubmit()`).
- **Custom dropdowns** (`customSelect` in `utils.js`): portaled to `<body>` with `position:fixed` + `getBoundingClientRect()` to escape `overflow` / `backdrop-filter` stacking traps.
- **Confirm dialogs** (`confirmDialog()` in `utils.js`): replaces native `confirm()` everywhere. `danger` flag swaps to red gradient + auto-focuses Cancel.
- **Image lightbox** (`imageLightbox()` in `utils.js`): wheel/+/−/0 zoom, drag-pan when zoomed, ESC closes.
- **Mobile**: hamburger uses `env(safe-area-inset-*)`; drawer width `min(320px, 85vw)`.

---

## Coding conventions

These are enforceable invariants — please read [CONTRIBUTING.md](CONTRIBUTING.md) for the practical checklist.

- No framework, no build step — plain ES module `import`/`export`.
- No `innerHTML` with user-provided data. Use `el()` from `utils.js`.
- Immutable updates: spread into new objects, never mutate `data.*` arrays in place.
- Files under 400 lines, organized by domain.
- No comments unless the *why* is non-obvious. Don't restate what the code does.
- Frontend talks to storage **exclusively** via `store.js` → `db.js`. Page modules never `fetch` directly or touch IndexedDB directly.
- Screenshot URLs: render with `value.screenshotPathUrl || value.screenshotPath`; save only the canonical `screenshotPath`. Never round-trip a `blob:` URL into a record.
- Destructive actions (delete, discard unsaved changes) must route through `confirmDialog()`, not native `confirm()`.

---

## Out of scope (won't accept PRs for)

- Multi-user authentication
- Cloud sync between devices (IDB mode is intentionally per-browser)
- Real broker API integration
- Live trade execution
- Payment / subscription features
- Telemetry / analytics
