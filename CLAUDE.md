# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SteamGuard Web is a multi-user web port of `steamguard-cli` that runs as a single Cloudflare Worker. The Worker serves both the Hono JSON API (`/api/*`) and a static React SPA built from `client/`. D1 holds all persistent state; there is no other backend. The upstream Rust source lives at `steamguard-cli/` and is treated as a porting reference (see "Source reuse" below).

Detailed design rationale is in `docs/architecture.md`, `docs/decisions.md`, `docs/implementation-plan.md`, and `docs/source-porting-map.md`. Read those before making non-trivial changes to crypto, the vault model, or Steam flows.

## Commands

```bash
bun install                                 # install dependencies
bun run dev                                 # wrangler dev (Worker + built SPA assets)
bun run dev:client                          # vite dev server for React only (no Worker)
bun run build                               # vite build -> dist/client (consumed by Worker ASSETS)

bun run db:migrate:local                    # apply migrations/ to local D1
bun run db:migrate:remote                   # apply migrations/ to remote D1
bun run bootstrap-admin -- --local          # create initial admin in local D1
bun run bootstrap-admin -- --remote         # create initial admin in remote D1
bun run bootstrap-admin -- --local --generate-dev-password  # only path that auto-generates a password

bun run cf-typegen                          # regenerate worker-configuration.d.ts from wrangler.jsonc
bun run proto:generate                      # regenerate src/generated/steam-protobuf.{js,d.ts} from steamguard-cli/

bun run test                                # vitest run (tests/**/*.test.ts, node env)
bun run test:watch
bunx vitest run tests/steam.test.ts -t "generates Steam Guard codes"  # single test

bun run deploy                              # build + remote migrate + wrangler deploy --minify + bootstrap-admin --remote
```

Local development requires `.dev.vars` with at least `APP_SECRET` and (for first bootstrap) `INITIAL_ADMIN_PASSWORD`. See `.env.example`.

## Architecture

### Runtime shape
- Single Worker entry: `src/index.ts` → `createApp()` in `src/http/app.ts` returns a `Hono<AppEnv>` instance.
- Hono is typed with `AppEnv = { Bindings, Variables }` (see `src/types.ts`). `Bindings` includes `DB` (D1), `APP_SECRET` (Worker secret), `ENVIRONMENT`, optional `ASSETS` fetcher, optional `INITIAL_ADMIN_PASSWORD`.
- The catch-all `app.notFound` proxies non-`/api/*` paths to `env.ASSETS` so the same Worker serves the SPA. `wrangler.jsonc` points `ASSETS.directory` at `./dist/client` with SPA fallback — **never deploy without `bun run build` first**.
- Top-level middleware enforces same-origin for state-changing requests and requires `APP_SECRET` to be set for every `/api/*` route except `/api/health`.

### Three-layer secret model (do not break this)
This is the most load-bearing invariant. Changing it requires reading `docs/decisions.md` first.

1. **Account blob**: each Steam account's full SteamGuardAccount JSON (shared_secret, identity_secret, tokens, revocation_code, …) is AES-256-GCM encrypted with a per-account 32-byte `accountKey`. Stored in `steam_account_secrets.encrypted_blob`. AAD binds `account_id` + schema version (`accountBlobAad` in `src/db/accounts.ts`).
2. **Per-user grant**: the raw `accountKey` is wrapped per `(user_id, account_id)` pair with a key derived from `APP_SECRET` via HKDF-SHA256 (`src/vault/vault.ts`; encrypted payload `v: 2`). Legacy rows use PBKDF2 (`v: 1`) and are auto-upgraded on first unwrap in `loadAccountKeyForUser`. The wrapped blob lives in `account_key_grants.wrapped_account_key`. AAD binds `user_id:account_id`.
3. **Permission flags**: `account_permissions` rows decide which capabilities (`can_view_code`, `can_view_status`) a viewer has for a given account. RBAC checks read from this table — never from account name or steam_id.

Consequences any new code must respect:
- On account creation/import/transfer (`createEncryptedAccount`), grants are issued for **every active admin** automatically. Adding an admin retroactively does NOT grant past accounts (no rewrap path exists yet).
- Granting an account to a viewer (`grantAccountToUser`) requires the calling admin to first unwrap the account key with their own grant (see `loadAccountKeyForUser`), then re-wrap it for the viewer.
- Viewer login approval and QR login approval are allowed for assigned accounts through the `can_view_code` account permission and matching key grant; confirmations and maFile export remain admin-only.
- Password changes and admin viewer-password resets must **never** rewrap grants — grant wrapping is bound to `APP_SECRET`, not to user passwords.
- Rotating `APP_SECRET` invalidates every grant. Treat `APP_SECRET` as a production backup-critical secret.

### Request shape for secret-backed routes
Every endpoint that touches Steam data follows the same skeleton:

```
authMiddleware
  -> assertAdmin / assertAccountAccess (src/rbac/rbac.ts)
  -> loadAccountKeyForUser (src/vault/vault.ts)        # unwraps grant
  -> decryptAccountSecret (src/db/accounts.ts)         # AES-GCM decrypt
  -> call into src/steam/* (read or mutate via Steam APIs)
  -> if tokens changed: saveAccountSecret              # re-encrypt with same accountKey
  -> audit(...) (src/audit/audit.ts)
```

Audit metadata must never include raw secrets, tokens, passwords, or maFile contents. The Full `.maFile` export endpoint (`GET /api/accounts/:id/export-mafile`) is the **only** route that returns plaintext secrets — it is admin-only, single-account, and emits an `account_mafile_exported` audit event on every call.

### Steam protocol layer (`src/steam/`)
All Steam-facing logic is here. The split mirrors the upstream Rust `steamguard/` library and is mapped file-by-file in `docs/source-porting-map.md`.
- `webapi-transport.ts` — generic protobuf-over-WebAPI request builder (input as `input_protobuf_encoded`, response as `Content-Type: application/octet-stream` protobuf).
- `authentication-client.ts`, `twofactor-client.ts` — typed wrappers around the Steam services.
- `login-flow.ts` — credentials → poll → guard-code state machine (web equivalent of CLI prompt loops).
- `authenticator-flows.ts` — `SetupFlowState` / `TransferFlowState` shapes used by `/api/authenticator/*` routes; the route handlers persist these states via `src/flows/flow-store.ts` (encrypted, scoped to the actor user).
- `confirmations.ts`, `login-approvals.ts`, `qr-login.ts` — mobile confirmations, login-session approval, QR login parsing.
- `guard-code.ts`, `confirmation-hash.ts`, `login-approval-signature.ts`, `time.ts`, `tokens.ts`, `device-id.ts` — deterministic primitives. These have parity fixtures in `tests/steam.test.ts` ported from upstream Rust tests; **keep those fixtures green when changing primitives**.
- `crypto/rsa-password.ts` — the **only** place `node-forge` is used (Steam login requires RSAES-PKCS1-v1_5, which WebCrypto does not support). All other crypto goes through `src/crypto/webcrypto.ts`.
- `src/generated/steam-protobuf.{js,d.ts}` is generated by `scripts/generate-protobuf.ts` from `steamguard-cli/steamguard-cli/steamguard/protobufs/`. Do not hand-edit; rerun `bun run proto:generate`. The script renames `common_base.proto`'s `NoResponse` to avoid a collision — preserve that patch if the upstream tree is updated.

### Source reuse policy (license)
- `steamguard-cli/steamguard-cli/steamguard/` is MIT/Apache — algorithms and wire behavior may be ported directly to TypeScript.
- `steamguard-cli/steamguard-cli/src/` (the CLI) is GPLv3 — use as **behavioral reference only**. Do not copy CLI command code. Long-running CLI prompts become explicit web state machines (see `src/flows/` and `authenticator-flows.ts`).

### Frontend
- Vite + React 19, `root: 'client'`, output `dist/client`. Path alias `@/` → `client/src/`.
- `client/src/api.ts` is the only place the SPA calls the Worker API; envelope shape is `{ ok, data | error }`.
- shadcn/ui components live under `client/src/components/ui/`; feature panels are the siblings (`accounts-panel.tsx`, `steam-flows-panel.tsx`, `admin-users-panel.tsx`, etc.).
- Two routes the UI must keep prominent: red-banner warning on the Full `.maFile` download button, and an explicit "must change password" gate after first login.

### Database
- D1 only. Migrations under `migrations/` are applied with `wrangler d1 migrations apply`. The base schema lives in `0001_initial.sql` (`users`, `sessions`, `vaults`, `steam_accounts`, `steam_account_secrets`, `account_key_grants`, `account_permissions`, `auth_flows`, `audit_events`, `bootstrap_state`); `0002` adds `login_attempts` (login throttling) and cleanup indexes.
- A daily cron trigger (`wrangler.jsonc` `triggers.crons`) runs `runCleanup` (`src/maintenance/cleanup.ts`): expired sessions, stale auth flows/throttle rows, and audit events older than `AUDIT_RETENTION_DAYS` (default 365, `0` = keep forever).
- `username_normalized` is the lowercase form and is the unique key for username lookups.
- Deletion semantics for viewers is **soft delete** (`status = 'disabled'` + revoke sessions + revoke grants + drop permissions). Accounts are hard-deleted but grants are marked revoked rather than removed.
- `assertMutableAdminTarget` enforces "cannot disable/delete the last active admin". Preserve this when changing admin management code.

### Conventions worth knowing
- `forbidden`, `unauthorized`, `badRequest`, `notFound`, `conflict` from `src/http/errors.ts` **throw** — they don't return. Calling code should not wrap their results.
- All IDs are prefixed UUIDs: `user_<uuid>`, `acct_<uuid>`, `sess_<uuid>`, `grant_<uuid>`, `perm_<uuid>`, `vault_<uuid>` (`randomId(prefix)` in `src/crypto/webcrypto.ts`).
- Timestamps are ISO strings via `nowIso()`.
- `decryptAccountSecret` + `saveAccountSecret` share the same `accountKey` for a given request; never decrypt-then-rewrap-with-a-new-key as part of normal flows.
- Tests run in the `node` environment (vitest), not in a Workers runtime. Crypto code uses globalThis `crypto.subtle`, which works in both. HTTP-layer tests (`tests/http.test.ts`) exercise the real Hono app via `app.request()` against a `node:sqlite`-backed D1 shim (`tests/helpers/d1.ts`) with migrations applied; global `fetch` is stubbed so nothing reaches Steam.
