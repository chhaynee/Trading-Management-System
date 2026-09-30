# Trading Management System (TMS)

A free, **dark-themed desktop dashboard** for traders who want a single home for their **accounts, strategies, journal, and pre-trade checklists** — no subscriptions, no cloud, your data stays on your computer.

Built with plain HTML/CSS/JavaScript and an optional tiny local server, packaged to run in Docker. No frontend build step, no framework, no telemetry.

> **Heads-up for non-technical users:** "build" here doesn't mean compiling code. It just means **install Docker, download the project, and run one command**. The whole setup takes ~10 minutes the first time.

---

## What you can do with it

- **Track multiple trading accounts** — prop challenges, prop instant funding, your own money, EAs/bots, and backtests, each with its own rules (daily loss %, max loss %, profit target, risk per trade)
- **Define your strategies** — entry methods, timeframes, instruments, preferred R:R, plus a per-strategy setup checklist
- **Journal every trade** — with **two screenshots** (entry + exit), result, R achieved, dollar P&L, notes, and tags. Click a thumbnail for a fullscreen lightbox with zoom.
- **Cumulative P&L chart** — filter by time range, account, strategy, or account status
- **Sniper Adaptive Flow** — a 5-phase pre-trade checklist that automatically grades your setup (A+ / Baseline / Building / Skip) and tells you what position size to take
- **Trade calendar** — see your wins/losses day by day
- **Risk calculator** — quick position-size math
- **Works offline** — your data is yours, stored locally (SQLite file or browser IndexedDB)

---

## Three ways to run it

| Mode | What you do | Pros | Cons |
|------|-------------|------|------|
| **Docker (recommended)** | Install Docker, run `make up-prod` | Same steps on Windows, macOS and Linux. No Node.js or C++ build tools. Restarts itself after a reboot. One-command backups. | Docker needs a few GB of disk |
| **Node.js directly** | Install Node.js, run `npm start` | No Docker needed | You need Node.js plus C++ build tools for the database library |
| **Browser-only** | Open the static site (no install) — e.g. host it on GitHub Pages | Zero install | Data lives **inside your browser**. Wipe the browser, lose the data. Use the in-app **Export** button often. |

The same UI works in every mode — the app auto-detects whether a server is behind it.

---

## Quick start (Docker)

### Step 1 — Install Docker, Git and make

<details>
<summary><b>🪟 Windows</b></summary>

The smoothest route on Windows is **Docker Desktop + WSL 2** (a real Linux terminal built into Windows), running every command from inside WSL.

1. **Install WSL** — open **PowerShell as Administrator**, run `wsl --install`, and restart when asked. On first launch, **Ubuntu** asks you to pick a username and password.
2. **Install Docker Desktop** — https://www.docker.com/products/docker-desktop/. Keep the default **"Use WSL 2 instead of Hyper-V"**. After installing, open Docker Desktop → **Settings → Resources → WSL integration** → switch on **Ubuntu**.
3. **Install Git and make inside Ubuntu** — open **Ubuntu** from the Start menu and run:
   ```bash
   sudo apt update && sudo apt install -y git make
   ```

Use this Ubuntu terminal for all the commands below, and keep the project in your Linux home folder (`~/`), **not** under `/mnt/c/…` — it's much faster there, and live reload in development mode only works there.

> Don't want WSL? Docker Desktop on its own works too: skip `make` and use the plain `docker compose` commands from the [command table](#everyday-commands) in PowerShell or Git Bash.

</details>

<details>
<summary><b>🐧 Linux</b></summary>

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install -y git make curl
curl -fsSL https://get.docker.com | sudo sh       # Docker Engine + Compose + Buildx
```

**Fedora:** `sudo dnf install -y git make`, then follow https://docs.docker.com/engine/install/fedora/.
**Arch:** `sudo pacman -S git make docker docker-compose docker-buildx`

Then, on any distro, start Docker at boot and let your user run it without `sudo`:
```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER      # then log out and back in
```

</details>

<details>
<summary><b>🍎 macOS</b></summary>

1. Install **Docker Desktop** — https://www.docker.com/products/docker-desktop/ (pick Apple Silicon or Intel). [OrbStack](https://orbstack.dev/) or Colima work too.
2. Install Git and make (Apple's Command Line Tools include both):
   ```bash
   xcode-select --install
   ```

</details>

---

### Step 2 — Download (clone) the project

```bash
cd ~
git clone https://github.com/lek1-krom-mek/Trading-Management-System.git
cd Trading-Management-System
make doctor        # checks that Docker is installed and running
```

---

### Step 3 — Start it

```bash
make up-prod
```

The first run builds the app image (1–3 minutes); after that, starting takes seconds. When you see

```
✓ TMS (prod) is up → http://localhost:3000
```

open **http://localhost:3000** in any modern browser (or run `make open-prod`).

- **Stop it:** `make down-prod` — your data stays safe in a Docker volume.
- **It starts again by itself** after a reboot, as long as Docker starts at login (Docker Desktop: *Settings → General → Start Docker Desktop when you sign in*; Linux: the `systemctl enable` step above). `make down-prod` turns that off until the next `make up-prod`.

> **Only using the app, not developing it?** Run `cp .env.example .env` and set `ENV=prod` in `.env`. From then on plain `make up`, `make down`, `make logs`, … control the production app — no `-prod` suffix needed.

---

## Everyday commands

Run `make` (or `make help`) for the full list. Every target works with `-prod` (production, your real data) or without it (development).

| What you want | With `make` | Without `make` |
|---------------|-------------|----------------|
| Start | `make up-prod` | `docker compose up -d --build` |
| Stop | `make down-prod` | `docker compose down` |
| Is it running? | `make ps-prod` | `docker compose ps` |
| Live logs | `make logs-prod` | `docker compose logs -f app` |
| Restart | `make restart-prod` | `docker compose restart app` |
| Open in browser | `make open-prod` | visit http://localhost:3000 |
| Back up | `make backup-prod` | `docker compose run --rm -T app tms-backup > tms-backup.tar.gz` |
| Update to the latest version | `make update` | `git pull && docker compose up -d --build` |
| Check your Docker setup | `make doctor` | `docker compose version && docker info` |

> **Windows PowerShell:** don't use the "without make" backup line there — PowerShell's `>` corrupts binary files. Run it from Git Bash or WSL instead.

### Development vs production

There are two separate stacks, and they can run at the same time:

| | `make up` (development) | `make up-prod` (production) |
|---|---|---|
| URL | http://localhost:3001 | http://localhost:3000 |
| Data | its own throwaway volume (`tms-dev_data`) | your real data (`tms_data`) |
| Code | live from your checkout — refresh the browser for frontend edits; `server.js` edits restart the server | baked into the image; `make up-prod` rebuilds it when the code changed |
| Extras | test suite (`make test`) | read-only filesystem, non-root user, auto-restart, capped log files |

---

## Where is my data?

| Item | Docker | Node.js directly | Browser-only |
|------|--------|------------------|--------------|
| Trades, accounts, strategies | `tms.db` in the `tms_data` Docker volume | `tms.db` in the project folder | Inside your browser's IndexedDB |
| Screenshots | `uploads/` in the same volume | `uploads/` in the project folder | Inside your browser's IndexedDB |

**Every mode is 100% local. Nothing is uploaded anywhere.** The Docker volume survives `make down`, rebuilds and updates — only `make destroy-prod` deletes it, and that asks first and takes a backup.

### Backing up

- **Docker:** `make backup-prod` → `backups/tms-prod-<date>-<time>.tar.gz`. Safe to run while the app is in use. Copy the `backups/` folder somewhere safe (Dropbox, USB stick, external drive).
- **Restore:** `make restore-prod FILE=backups/tms-prod-….tar.gz` — asks first, and backs up the current data before replacing it.
- **Node.js mode:** copy `tms.db` and the `uploads/` folder somewhere safe.
- **Browser-only mode:** open the app → **Data** → **Export** → save the JSON file. Do this regularly — clearing your browser data **will delete everything**. **Import** restores it.

A backup archive contains `tms.db` + `uploads/` — the same layout as a Node.js install, so it works outside Docker too.

### Moving over from the old (pre-Docker) setup

If you've been running TMS with `npm start` or PM2, your data is in `tms.db` and `uploads/` in the project folder. To move it into Docker:

1. **Stop the old server** — Ctrl+C in its terminal, or `pm2 delete tms && pm2 save`.
2. **Get the Docker version:** `git pull`
3. **Import:** `make import-legacy-prod` — reads `tms.db` + `uploads/` from the project folder. If they're somewhere else (e.g. copied over from your old Windows PC), point at that folder: `make import-legacy-prod SRC=/path/to/old/folder`. Your original files are left untouched.
4. **Check** http://localhost:3000. Once everything is there you can delete the old `tms.db`, `uploads/` and `server/node_modules`, and remove PM2 (`pm2 unstartup` on macOS/Linux or `pm2-startup uninstall` on Windows, then `npm uninstall -g pm2`).

### Inspecting the database

Pull a copy out of a backup and open it with any SQLite viewer:

```bash
make backup-prod
tar -xzf backups/tms-prod-<date>-<time>.tar.gz tms.db
```

- [DB Browser for SQLite](https://sqlitebrowser.org/) (easiest)
- [DBeaver](https://dbeaver.io/) (more powerful)
- [TablePlus](https://tableplus.com/) (paid but slick)

---

## Updating to a new version

```bash
make update
```

This backs up your data, runs `git pull`, then rebuilds and restarts the production app. Database changes a new version needs are applied automatically on startup; `git pull` never touches your data.

---

## Settings

Copy `.env.example` to `.env` to change the defaults — both `make` and `docker compose` read it.

| Setting | Default | What it does |
|---------|---------|--------------|
| `ENV` | `dev` | Which stack plain `make up/down/logs/…` controls: `dev` or `prod` |
| `TMS_PORT` | `3000` | Port for the production app |
| `TMS_DEV_PORT` | `3001` | Port for the development app |
| `TMS_BIND` | `127.0.0.1` | `127.0.0.1` = this computer only. `0.0.0.0` = also reachable from your phone/tablet on the same Wi-Fi (trusted networks only — there's no login) |
| `NODE_VERSION` | `22` | Node.js version inside the image |

One-off overrides work too: `make up-prod TMS_PORT=8080`.

---

## Running without Docker

<details>
<summary><b>Node.js directly (<code>npm start</code>), with optional auto-start via PM2</b></summary>

1. Install **Git** and **Node.js 22 LTS** (https://nodejs.org/). The database library compiles native code, so you also need C++ build tools:
   - **Windows:** in the Node.js installer, tick **"Tools for Native Modules"**
   - **macOS:** `xcode-select --install`
   - **Linux:** `sudo apt install build-essential python3`
2. Install and run:
   ```bash
   cd server
   npm install
   npm start          # → http://localhost:3000, Ctrl+C to stop
   ```
   Data goes to `tms.db` and `uploads/` in the project folder. `PORT=3005 npm start` picks another port. If `npm install` fails on `better-sqlite3`, the build tools are missing — install them, then `rm -rf node_modules && npm install`.
3. **Optional auto-start with PM2:**
   ```bash
   npm install -g pm2
   cd server && pm2 start server.js --name tms && pm2 save
   pm2 startup        # macOS/Linux: run the sudo line it prints, then `pm2 save` again
   # Windows instead: npm install -g pm2-windows-startup && pm2-startup install && pm2 save
   ```
   Day to day: `pm2 list`, `pm2 logs tms`, `pm2 restart tms` (after `git pull` + `npm install`).

**WSL users:** keep the project in your WSL home (`~/`), not on a Windows drive (`/mnt/c/…`) — SQLite's file locking is unreliable across that boundary.

</details>

---

## Pages / workspaces

| Page | What it's for |
|------|---------------|
| **Dashboard** | KPIs, cumulative P&L chart, account strip, doctrine quick links |
| **Accounts** | All your accounts with drawdown bars, rule chips, attached strategies. Click an account to drill down. |
| **Strategies** | Define your setups (entry methods, timeframes, instruments, R:R). Click a strategy to see its win rate, recent trades, and which accounts use it. |
| **Journal** | Gallery of every trade with screenshots. Click any thumbnail for the full detail modal + zoomable lightbox. |
| **Calendar** | Day-by-day overview of trades |
| **Sniper Entry** | The Orderflow Sniper Adaptive Flow — a 5-phase pre-trade checklist that grades your setup and tells you what size to take |
| **Risk Calculator** | Quick position-size / lot calculator |
| **Data** | Export / import / backup your data, switch storage modes |

---

## Hosting it online (advanced, optional)

If you want to access the app from your phone or share it with friends:

- **Same Wi-Fi only:** set `TMS_BIND=0.0.0.0` in `.env`, run `make up-prod`, and open `http://<your-computer's-IP>:3000` on your phone.
- **GitHub Pages / Netlify / Vercel (static):** push your fork to GitHub, enable Pages, point at the project root. The app will auto-fall-back to browser-only mode (data lives per-device).
- **A small VPS** (DigitalOcean, Hetzner, etc.): clone, run `make up-prod`, and put a reverse proxy (Nginx/Caddy) in front of `localhost:3000`. Keep the default `TMS_BIND=127.0.0.1` so only the proxy can reach the app. You get a real database and screenshots in a Docker volume.

> **Privacy reminder:** if you host this on a public URL with the local-server mode, **anyone who finds the URL can see your data** — there's no login built in. Keep it on `localhost` or behind a private network unless you add auth.

---

## Troubleshooting

<details>
<summary>"Cannot connect to the Docker daemon" or "permission denied … docker.sock"</summary>

Run `make doctor` — it tells you what's missing. Usually one of:
- Docker isn't running: start **Docker Desktop**, or on Linux `sudo systemctl enable --now docker`
- (Linux) your user isn't in the `docker` group: `sudo usermod -aG docker $USER`, then log out and back in

</details>

<details>
<summary>"Port 3000 is already in use" / "address already in use"</summary>

Something else is on that port — often the **old `npm start` or PM2 server** (stop it with Ctrl+C or `pm2 delete tms`). Or give TMS another port:

```bash
make up-prod TMS_PORT=3005        # or put TMS_PORT=3005 in .env
```

</details>

<details>
<summary><code>make: command not found</code> (Windows)</summary>

Either run the commands from **WSL** (see the Windows install steps), or skip `make` and use the plain `docker compose` commands in the [command table](#everyday-commands).

</details>

<details>
<summary>The app doesn't start, or <code>make up</code> says it's unhealthy</summary>

Check the logs: `make logs-prod` (or `make logs` for the development stack). To rebuild from a clean slate without touching your data: `make clean-prod && make up-prod`.

</details>

<details>
<summary>I opened <code>index.html</code> directly and it looks broken</summary>

Start the app (`make up-prod`) and open **http://localhost:3000**, not the file directly. The file:// protocol blocks the API the app uses.

</details>

<details>
<summary>I want to start fresh / delete all my data</summary>

- **Docker:** `make destroy-prod` (asks first and takes a backup), then `make up-prod`. For the development stack: `make destroy`.
- **Node.js mode:** stop the server, delete `tms.db` and `uploads/bt-*.png`, restart. (Back up first if unsure.)
- **Browser-only mode:** open the app → **Data** page → **Wipe local data**.

</details>

---

## Tech stack (for the curious)

- **Frontend:** vanilla HTML/CSS/JavaScript with ES modules — no React, no build step, no bundler
- **Local backend:** Node.js + Express + SQLite (via `better-sqlite3`) + multer for file uploads
- **Packaging:** Docker (multi-stage image on Node 22 slim, runs as non-root) + Docker Compose, driven by a `Makefile`
- **Storage:** dual-mode — SQLite (local server) or IndexedDB (browser-only), auto-detected at runtime
- **Charts:** hand-rolled SVG, no external chart library
- **Routing:** simple hash router (`#dashboard`, `#accounts`, etc.)
- **No telemetry, no analytics, no external dependencies at runtime in browser-only mode**

---

## Contributing

Pull requests welcome! This is a personal trading tool I'm sharing in case it's useful to others.

- **Read [CONTRIBUTING.md](CONTRIBUTING.md)** for the practical workflow: dev setup, branch/commit conventions, the "things that look easy but will break stuff" list, and the PR process.
- **Read [ARCHITECTURE.md](ARCHITECTURE.md)** to understand how the codebase is put together (storage flow, routing, screenshot invariants, schema). It's the recommended first read before touching code.

Please keep the spirit of the project: **no build step, no framework lock-in, no telemetry, data stays local.**

---

## License

MIT — see [LICENSE](LICENSE) for details. TL;DR: do whatever you want with this code, just keep the copyright notice. No warranty.

---

## Disclaimer

This is a **personal record-keeping tool**, not financial advice and not a trading platform. It doesn't connect to your broker, doesn't place trades, and doesn't guarantee any outcome. Trading carries risk; you can lose money. Use at your own risk.
