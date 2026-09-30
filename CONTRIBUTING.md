# Contributing to TMS

Thanks for considering a contribution. This guide gets you from cloned repo → merged PR with the least friction.

If you haven't yet, read [ARCHITECTURE.md](ARCHITECTURE.md) first — most of TMS's invariants are documented there, not in the code.

---

## Quick orientation

- **No build step.** No bundler, no TypeScript, no JSX. Edit `.js` and `.css` files, refresh the browser.
- **Two storage modes.** Server mode (Node + SQLite) and browser-only mode (IndexedDB). Your change has to work in **both** unless it's clearly a server-only feature.
- **One mental model.** Page modules → `store.js` → `db.js` → adapter → storage. Never short-circuit this.
- **MIT licensed.** Contributions are released under the same license.

---

## Setting up a dev environment

Follow the **Quick start** section of the [README](README.md) to install Docker, Git and make, and clone the repo. Then:

```bash
make up              # dev stack: builds the image, starts it, waits until healthy
make logs            # follow the server output (Ctrl+C stops following, not the app)
```

Open http://localhost:3001. The repo is bind-mounted into the container: edit any `.js`/`.css` file and refresh to see changes; edits to `server/server.js` restart the server automatically (`node --watch`).

The dev stack has its **own database volume**, separate from the production one on port 3000, so you can break things freely — and run both at once. `make help` lists everything else (`make shell`, `make destroy` to reset dev data, `make restore FILE=…` to load a prod backup into dev, …).

Prefer no Docker? `cd server && npm install && npm run dev` still works (http://localhost:3000); see *Running without Docker* in the README.

For browser-only mode testing, see [Testing your changes](#testing-your-changes) below.

---

## Before you start coding

1. **Open an issue first** for anything beyond a small bug fix. Quick discussion saves rewrites.
2. **Check [ARCHITECTURE.md → Out of scope](ARCHITECTURE.md#out-of-scope-wont-accept-prs-for)** so you don't build something we can't merge.
3. **One concern per PR.** A bug fix + a refactor + a new feature in one PR is three PRs you'll need to split.

---

## Branch & commit conventions

### Branches

- `main` — always deployable
- `feat/<short-name>` — new feature
- `fix/<short-name>` — bug fix
- `refactor/<short-name>` — internal change, no user-visible behavior change
- `docs/<short-name>` — documentation only

### Commits

[Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>(<scope>): <short summary>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `style`, `test`.

Examples:
- `feat(journal): add exit screenshot field`
- `fix(calculator): round balance input to 2 decimals`
- `docs(readme): clarify Windows setup for non-technical users`

Keep the subject under 72 characters. Use the body for the *why*, not the *what*.

---

## Code style

We don't ship a formal linter yet. Match the surrounding code's style. The hard rules below are the ones most likely to fail review.

### Hard rules (will block a PR)

These match [ARCHITECTURE.md → Coding conventions](ARCHITECTURE.md#coding-conventions):

- **No `innerHTML` with user-provided data.** Use `el()` from `utils.js`.
- **No direct `fetch()` from page modules.** Go through `store.js` → `db.js`.
- **No direct IndexedDB access from page modules.** Same rule.
- **No mutation of `data.*` arrays in place.** Spread into new objects/arrays.
- **No `console.log` left in shipped code.** Remove or gate behind a debug flag.
- **No new dependencies** without explanation in the PR (the project deliberately stays vanilla — see [ARCHITECTURE.md → Tech choices](ARCHITECTURE.md#tech-choices)).
- **Destructive UI actions** (delete, discard) must use `confirmDialog()`, not native `confirm()`.

### Soft conventions

- Files under 400 lines. If you're growing past that, extract a module.
- Functions under ~50 lines. Same logic.
- Indent with 2 spaces.
- Single quotes for strings; backticks for templates.
- No semicolons in `.css`; yes semicolons in `.js`.
- Comments: only when the *why* is non-obvious. Don't restate code.

---

## The "things that look easy but will break stuff" list

Read this before your first PR. Each of these has bitten us before.

### 1. Screenshot URLs

The `screenshotPath` field has a **canonical** value (saved to the row) and a **display** value (resolved on read, attached as `screenshotPathUrl`).

```js
// ✅ Correct — render with display, save with canonical
img.src = record.screenshotPathUrl || record.screenshotPath;
await store.save({ ...record, screenshotPath: canonical });

// ❌ Wrong — saving a blob: URL poisons the row (blob URLs expire on reload)
await store.save({ ...record, screenshotPath: blobUrl });
```

Same applies to `exitScreenshotPath` / `exitScreenshotPathUrl`.

### 2. Adding a new field to any store

You must touch **all four** of these:

1. `server/schema.sql` — add the column in `snake_case`
2. `server/server.js` — add idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` shim
3. `server/server.js` — update the store's `MAPPERS` (`toDb` + `fromDb`) for snake↔camel
4. `js/db-idb.js` — IDB mode stores camelCase as-is, but if the field needs special handling (e.g. Blob), add it here too

Forgetting any of these will cause data loss or silent failures across modes.

### 3. Both modes must keep working

A common mistake: fix a bug in server mode, ship, then the same bug exists in IDB mode (or vice versa). Test in both — see below.

### 4. Hash router quirks

- `go('strategies/abc123')`, not `location.hash = '#strategies/abc123'`.
- Sub-route param comes after `/`. Multiple `/` are ignored — design your routes flat.

### 5. customSelect / portaled dropdowns

If you add a dropdown inside a modal or a card with `overflow: hidden` / `backdrop-filter`, use `customSelect` from `utils.js`. Native `<select>` won't be styled; a non-portaled custom dropdown will get clipped.

---

## Testing your changes

### Automated tests

```bash
make test            # runs tests/*.test.mjs (node:test) in a throwaway dev container
```

Without Docker: `cd server && npm test`. The suite covers the server API and schema; the UI is still tested by hand with the matrix below (a fuller harness is a contribution opportunity, see [#wishlist](#wishlist)).

### Smoke test in server mode

```bash
make up
```

Open http://localhost:3001 and verify:
- Page you changed renders without console errors
- A round-trip works: create → reload → edit → reload → delete

### Smoke test in browser-only mode

In your browser DevTools console, while the page is loaded:

```js
sessionStorage.setItem('tms-mode', 'idb');
location.reload();
```

This forces the IDB adapter. Repeat your round-trip test. When done, clear the override:

```js
sessionStorage.removeItem('tms-mode');
location.reload();
```

### Other things to spot-check before opening a PR

- Resize the browser to mobile width (≤480px). Sidebar drawer + main UI both usable?
- Hard-refresh (Ctrl+Shift+R) and re-test. Catches caching weirdness with the modal/modal-state.
- Inspect the database after server-mode changes: `make backup` and open the `tms.db` inside the archive in a SQLite viewer (see *Inspecting the database* in the README). Did rows update as expected? Any orphaned screenshots? (`make shell`, then `ls /data/uploads`)

---

## Pull request process

1. Fork the repo on GitHub.
2. Create a branch (`feat/x`, `fix/y`, etc.) off `main`.
3. Commit with [Conventional Commits](#commits).
4. Push to your fork.
5. Open a PR against `lek1-krom-mek/Trading-Management-System:main`.
6. In the PR description, include:
   - **What** changed (high level)
   - **Why** (motivation, linked issue if any)
   - **How tested** (server mode? IDB mode? mobile? specific browser?)
   - **Screenshots** for UI changes
7. Be patient — this is maintained by volunteers. Ping if no response after a week.

### What gets a fast merge

- Bug fix with clear repro
- Self-contained feature with screenshots and "tested in both modes" in the description
- Docs improvements that don't change behavior

### What gets pushback

- "Drive-by refactors" that change unrelated code
- New dependencies without justification
- Adding a framework / build step
- Anything in [Out of scope](ARCHITECTURE.md#out-of-scope-wont-accept-prs-for)
- PRs that only work in one storage mode

---

## Reporting bugs

Open a GitHub Issue with:

- **OS + browser + version** (e.g. "Windows 11 + Chrome 134")
- **Storage mode** — server or browser-only?
- **Steps to reproduce**
- **What you expected** vs **what happened**
- **Console errors** if any (DevTools → Console)
- **Screenshot** of the broken UI if applicable

Tag the issue `bug`. If you can also propose a fix, link the PR.

---

## Suggesting features

Open a GitHub Issue tagged `enhancement`. Describe:

- The user problem you're trying to solve (not just the feature)
- Who benefits
- Any UI sketch / wireframe if you have one
- Whether you want to implement it yourself

If it's not clearly out of scope, expect a friendly chat about design before any code lands.

---

## Wishlist

Areas where contributions are especially welcome:

- **A real test suite.** Even a few smoke tests covering: server boot, `/api/accounts` round-trip, IDB adapter round-trip, screenshot save/load in both modes.
- **A linter/formatter config.** Prettier + ESLint with sensible defaults.
- **GitHub Actions CI** that runs the tests + linter on every PR.
- **Issue / PR templates** in `.github/`.
- **Accessibility audit** — keyboard nav, focus rings, ARIA labels, color contrast.
- **i18n scaffolding** — even just extracting strings into a single file so translations become possible.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE), the same license that covers the project.

---

Questions? Open a GitHub Issue tagged `question` or start a Discussion if the repo has Discussions enabled.
