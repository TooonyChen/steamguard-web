# <p align="center">SteamGuard Web</p>

### <p align="center"><b>Multi-user Steam Guard manager for Cloudflare Workers</b></p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/TooonyChen/steamguard-web">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers"/>
  </a>
</p>

---

A web port of Steam Guard that runs as a single Cloudflare Worker with a built-in React UI. Built for small group of friends who need to share a small set of Steam accounts safely.

- Generates Steam Guard codes for any number of accounts you import.
- An **admin** can import `.maFile`s, set up or transfer authenticators, list & act on mobile confirmations, approve QR / push login sessions, and export Full `.maFile` backups.
- **Viewers** are second-class users that can only see Steam Guard codes for accounts an admin has explicitly assigned to them. They cannot confirm trades, approve logins, or export secrets.
- All Steam secrets are AES-256-GCM encrypted in D1 — the database never contains plaintext `.maFile`s, shared secrets, identity secrets, or tokens.
- Per-account, per-user grant model: revoking a viewer or one of their account grants does not require rotating any other account.
- Every secret-backed action writes an audit event.

---

## Architecture in 30 seconds

```
Cloudflare Worker
  ├─ Hono API at /api/*      (TypeScript)
  └─ React SPA from /        (Vite build, served via Workers Static Assets)

D1 (steamguard-web)
  ├─ users / sessions
  ├─ steam_accounts (public metadata)
  ├─ steam_account_secrets (AES-GCM blobs, per-account key)
  ├─ account_key_grants (per-user wrapped account key, wrapped with APP_SECRET)
  ├─ account_permissions
  ├─ auth_flows (encrypted, scoped to actor)
  └─ audit_events
```

`APP_SECRET` is a Worker secret used to wrap each per-account encryption key for each authorised user. Rotating it invalidates every grant — back it up.

For deeper detail see [`docs/architecture.md`](docs/architecture.md), [`docs/decisions.md`](docs/decisions.md), and [`CLAUDE.md`](CLAUDE.md).

---

## Requirements

- A Cloudflare account (Workers + D1 are on the free tier).
- [Bun](https://bun.sh) ≥ 1.0 for local dev / scripts. (npm/pnpm should also work, but the scripts use `bun run` / `bunx`.)
- The Wrangler CLI is bundled as a dev dependency; you'll invoke it via `bunx wrangler …` or via the `bun run` scripts.

---

## Deploy — option A: one-click

Click the **Deploy to Cloudflare Workers** button at the top of this README. It forks the repo into your GitHub account and provisions a Worker. **You still need to finish a few post-deploy steps manually** because this app needs a D1 database and two secrets — the button can't set those for you.

After the initial deploy, jump straight to [step 3](#3-create-a-d1-database) of the manual flow below using the forked repo, then re-deploy.

---

## Deploy — option B: from source (recommended)

The flow takes ~5 minutes.

### 1. Clone & install

```bash
git clone https://github.com/TooonyChen/steamguard-web.git
cd steamguard-web
bun install
```

### 2. Log in to Cloudflare

```bash
bunx wrangler login
```

### 3. Create a D1 database

```bash
bunx wrangler d1 create steamguard-web
```

This prints something like:

```jsonc
{
  "binding": "DB",
  "database_name": "steamguard-web",
  "database_id": "abcd1234-…"
}
```

Open [`wrangler.jsonc`](wrangler.jsonc) and replace `"replace-with-cloudflare-d1-database-id"` with the returned `database_id`.

### 4. Fill in `.env`

Two pieces of secret data are needed; both go into a local `.env` file (gitignored).

```bash
cp .env.example .env
```

Then open `.env` and replace both placeholders. Suggested generators:

```bash
openssl rand -base64 48    # APP_SECRET           — random high-entropy string
openssl rand -hex 32       # INITIAL_ADMIN_PASSWORD — write this down, you'll need it to log in
```

The resulting `.env` should look like:

```bash
APP_SECRET=<the openssl rand -base64 48 output>
INITIAL_ADMIN_PASSWORD=<the openssl rand -hex 32 output>
```

> **The two values play different roles** — read the table in [Secrets cheatsheet](#secrets-cheatsheet) below if you want to know why.

### 5. Push `APP_SECRET` to Cloudflare

`bun run deploy` does **not** upload your `.env` to Cloudflare. The Worker reads `APP_SECRET` at runtime, so it has to live as a Worker secret. Push it once with this one-liner (reads the value from `.env` and pipes into wrangler):

```bash
grep '^APP_SECRET=' .env | cut -d= -f2- | bunx wrangler secret put APP_SECRET
```

(`INITIAL_ADMIN_PASSWORD` is **not** pushed to Cloudflare. It's only read by the local `bootstrap-admin` script when it talks to the remote D1 to create the first admin row. Pushing it as a Worker secret would just leak plaintext.)

### 6. Deploy

```bash
bun run deploy
```

This composite script does, in order:

1. `vite build` — bundle the React SPA into `dist/client`
2. `wrangler d1 migrations apply --remote` — run pending migrations on the remote D1
3. `wrangler deploy --minify` — upload the Worker
4. `bootstrap-admin -- --remote` — read `INITIAL_ADMIN_PASSWORD` from `.env`, hash it, insert the admin row into the remote D1 (idempotent — skipped if an admin already exists)

The output ends with the Worker URL. The bindings list it prints should include `env.DB`, `env.ASSETS`, `env.ENVIRONMENT`, and `env.APP_SECRET` — if `APP_SECRET` is missing, step 5 didn't take.

### 7. Log in and clean up

Visit the Worker URL, log in:

- Username: `admin`
- Password: the value you wrote into `INITIAL_ADMIN_PASSWORD`

You'll be forced to change the password immediately.

After that, delete the `INITIAL_ADMIN_PASSWORD=...` line from `.env` — the bootstrap script will never read it again, and there's no reason to keep a plaintext password lying around. The `APP_SECRET` line can stay (it's gitignored, and the one-liner in step 5 reads from there if you ever want to rotate).

### 8. Done

- Use **Settings** to change your username.
- Use **Steam** (admin only) to import a `.maFile` or set up / transfer an authenticator.
- Use **Users** (admin only) to add viewers and assign them accounts.

---

## Secrets cheatsheet

This trips people up the first time. Four different "places to put secrets" exist; each is read by a different thing:

| File / mechanism | Who reads it | Pushed to Cloudflare? |
| --- | --- | --- |
| `.env` | Local `bun run …` scripts (e.g. `bootstrap-admin`) | No |
| `.dev.vars` | Local `wrangler dev` simulated Worker | No |
| `wrangler secret put NAME` | The deployed Worker, as `c.env.NAME` | Yes (encrypted) |
| `wrangler.jsonc` → `vars` | The deployed Worker, as `c.env.NAME` (plaintext) | Yes (plaintext — don't put secrets here) |

For this project:

- `APP_SECRET` is read by the Worker at runtime → `wrangler secret put` (and optionally also in `.env` / `.dev.vars` to make rotation / local dev easier)
- `INITIAL_ADMIN_PASSWORD` is read by your local bootstrap script only → `.env` (and `.dev.vars` if you also want `bun run bootstrap-admin -- --local` to work)
- `ENVIRONMENT` is the public flag returned by `/api/health` → `wrangler.jsonc` `vars`

---

## Local development

Local dev needs **both** `.env` (read by `bun run …` scripts) and `.dev.vars` (read by `wrangler dev`). They contain the same two values; you can just copy:

```bash
cp .env.example .env
cp .env.example .dev.vars
# Edit both. They should have identical content:
#   APP_SECRET=<some value, doesn't need to match production>
#   INITIAL_ADMIN_PASSWORD=<some value>
```

Then:

```bash
# Apply migrations against the local SQLite-backed D1
bun run db:migrate:local

# Bootstrap the initial admin in the local D1
bun run bootstrap-admin -- --local
# If you don't want to set INITIAL_ADMIN_PASSWORD locally, add
# --generate-dev-password and the script will print a random one (dev only).

# Start the Worker (serves both API and SPA on http://localhost:8787 by default)
bun run dev
```

If you want hot reload for the React side only (no API), `bun run dev:client` starts Vite by itself, but you won't be able to call `/api/*` without the Worker.

### Useful scripts

| Command | What it does |
| --- | --- |
| `bun run test` | Vitest suite — protobuf encode/decode, guard-code generation, confirmation hash, JWT decode, login-approval signature, RSA password encryption. |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`. |
| `bun run proto:generate` | Regenerate `src/generated/steam-protobuf.{js,d.ts}` from the upstream `.proto` files (only needed when changing the proto set). |
| `bun run db:migrate:local` / `db:migrate:remote` | Apply pending migrations to the local / remote D1. |

---

## Security notes

- **`APP_SECRET` is backup-critical.** It encrypts the wrapping keys for every account grant. Losing it means none of the stored accounts can be decrypted, even with full D1 access. Rotating it invalidates every grant; doing so safely requires a re-wrap migration that doesn't ship yet.
- **`.dev.vars` and `.env*` are gitignored.** Don't commit them.
- **Pair with Cloudflare Access** for a public deployment. The application has its own login + RBAC, but putting Cloudflare Access in front of the Worker eliminates the public attack surface and is highly recommended for a multi-user instance.
- **The `Full .maFile` export endpoint** is the only path that returns plaintext Steam secrets. It is admin-only, single-account, and every call writes an `account_mafile_exported` audit event. The download link in the UI is shown with a red high-risk banner.
- **Viewers cannot** confirm trades, approve logins, export `.maFile`s, set up authenticators, or remove authenticators. Their grants are checked on every secret-backed request, not just on UI navigation.

---

## Attribution

This project ports algorithms and Steam API behaviour from [steamguard-cli](https://github.com/dyc3/steamguard-cli)'s `steamguard` library, dual-licensed under MIT or Apache 2.0 at the user's option. The CLI portion of `steamguard-cli` (GPLv3) is used only as a behavioural reference; no CLI source is copied. See [`docs/source-porting-map.md`](docs/source-porting-map.md) for the file-by-file mapping.

---

## License

[MIT](LICENSE).
