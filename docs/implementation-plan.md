# Implementation Plan

This plan turns the architecture into a practical build order. It assumes the existing `bun create hono@latest .` scaffold remains the Worker API root, with React added after the backend foundation is stable.

## Phase 0: Project Foundation

Deliverables:

- Keep `src/index.ts` as the Hono Worker entry.
- Add typed Cloudflare bindings.
- Add D1 binding in `wrangler.jsonc`.
- Add Steam implementation dependencies:
  - `protobufjs` for generated Steam protobuf modules.
  - `node-forge` for Steam RSAES-PKCS1-V1_5 password encryption.
- Add migrations under `migrations/`.
- Add module folders:

```text
src/http
src/auth
src/rbac
src/db
src/crypto
src/vault
src/steam
src/audit
src/flows
src/admin
```

Acceptance criteria:

- `GET /api/health` returns environment and build metadata without secrets.
- Local D1 migrations run.
- Type generation works with `bun run cf-typegen`.

## Phase 1: D1 Schema and Admin Bootstrap

Deliverables:

- Create migrations for:
  - `users`
  - `sessions`
  - `vaults`
  - `account_key_grants`
  - `steam_accounts`
  - `steam_account_secrets`
  - `account_permissions`
  - `auth_flows`
  - `audit_events`
  - `bootstrap_state`
- Create `scripts/bootstrap-admin.ts`.
- Update deploy script so deployment can run migrations and bootstrap idempotently.

Bootstrap behavior:

```text
if users table is empty:
  username = "admin"
  password = INITIAL_ADMIN_PASSWORD
  role = "admin"
  must_change_password = true
else:
  print "admin already exists"
```

Acceptance criteria:

- Fresh remote deployment creates one admin.
- Re-running bootstrap does not create duplicates.
- Production bootstrap requires `INITIAL_ADMIN_PASSWORD`; it must not generate or print a random production password.
- Local development bootstrap may generate a random password only when explicitly requested.
- Admin cannot be deleted if it is the last active admin.
- Admin can create, disable, delete, and reset passwords for viewers.
- Viewer cannot access admin routes.

## Phase 2: Auth, Sessions, and RBAC

Deliverables:

- Password hashing utilities.
- Login/logout endpoints.
- Session middleware.
- CSRF protection for state-changing browser requests.
- RBAC middleware:
  - `requireAdmin`
  - `requireViewerOrAdmin`
  - `requireAccountAccess(accountId, capability)`
- User self-service endpoints:
  - change username
  - change password

Acceptance criteria:

- `admin` can create and delete viewer users.
- viewer can log in only after admin creates the account.
- viewer can change own password but cannot change role.
- disabled users cannot log in.
- every denied admin attempt is audited.

## Phase 3: Vault Crypto and Account Grants

Deliverables:

- AES-GCM encrypt/decrypt helpers.
- PBKDF2/HKDF helpers with versioned params.
- Vault creation on bootstrap.
- Per-user per-account key grant creation and revocation.
- Secret-backed routes unwrap the current user's account grant with `APP_SECRET`.

Acceptance criteria:

- D1 never stores `shared_secret`, `identity_secret`, Steam tokens, or revocation code in plaintext.
- Logout revokes the login session.
- Permission changes revoke affected account grants.
- viewer can unwrap only assigned account keys.
- Wrong account or unassigned account access fails without revealing secrets.

## Phase 4: maFile Import, Export, and Account Visibility

Deliverables:

- Parser for SteamGuardAccount-compatible `.maFile`.
- Full `.maFile` exporter for a single account.
- Basic validation:
  - required fields present
  - `shared_secret` base64 parses to 20 bytes
  - duplicate account names rejected per vault
- Admin import endpoint.
- Admin-only single-account Full `.maFile` export endpoint.
- Account list endpoint with RBAC filtering.
- Account permission endpoints for assigning viewers.

Acceptance criteria:

- Admin can import a plaintext `.maFile`.
- Imported account is saved as encrypted blob.
- Admin can download a single-account Full `.maFile` with an active admin session.
- Full `.maFile` download includes compatible SteamGuardAccount data, including tokens when present.
- Full `.maFile` response uses attachment download headers and does not persist plaintext server-side.
- Full `.maFile` download is audited with `account_mafile_exported`.
- UI shows a red warning that the Full `.maFile` is a plaintext high-sensitivity backup before download.
- Admin can assign account to viewer.
- viewer sees only assigned accounts.
- viewer cannot download `.maFile`.
- API never returns raw maFile data except the explicit admin-only export endpoint.

## Phase 5: Steam Guard Codes

Deliverables:

- TypeScript implementation of Steam Guard code generation.
- Server time service:
  - primary: Steam `ITwoFactorService/QueryTime`
  - fallback: Worker local time only if Steam time fails and response marks fallback
- `GET /api/accounts/:accountId/code`.

Acceptance criteria:

- Code output matches known fixtures from `steamguard-cli`.
- viewer can get codes only for assigned accounts.
- code views are audited.
- response includes `code`, `secondsRemaining`, `serverTimeSource`.

## Phase 6: Steam Authentication and Token Refresh

Deliverables:

- Steam WebAPI transport.
- Protobuf encode/decode support for Steam auth APIs using generated static `protobuf.js` ESM modules.
- Reproducible protobuf generation script for files under `steamguard-cli/steamguard-cli/steamguard/protobufs/`.
- Credential login flow state machine.
- Token refresh service.
- Persist changed tokens back into encrypted account blob.

Acceptance criteria:

- Admin can start a Steam login flow.
- Flow handles email code, device code, and device confirmation prompts.
- Expired access token refreshes using stored refresh token.
- Token refresh failures fall back to explicit login flow.

## Phase 7: Create Authenticator

Deliverables:

- `POST /api/authenticator/setup/begin`.
- `POST /api/authenticator/setup/:flowId/submit-code`.
- `POST /api/authenticator/setup/:flowId/poll`.
- Provisional account encryption while setup is pending.
- One-time revocation code display contract.

Flow:

```text
admin starts setup
  -> Steam credential login
  -> AddAuthenticator
  -> save pending encrypted provisional account
  -> display revocation_code once
  -> admin submits email/SMS code
  -> FinalizeAddAuthenticator
  -> QueryStatus verifies state
  -> create steam_accounts row
```

Acceptance criteria:

- Admin can create a new authenticator from the web UI/API.
- Failed finalization does not leave an active account row.
- Revocation code is never written to logs.
- Successful setup is audited.

## Phase 8: Transfer Authenticator

Deliverables:

- `POST /api/authenticator/transfer/begin`.
- `POST /api/authenticator/transfer/:flowId/submit-sms`.
- `POST /api/authenticator/transfer/:flowId/poll`.

Flow:

```text
admin starts transfer
  -> Steam credential login
  -> transfer_start
  -> admin submits SMS code
  -> transfer_finish
  -> display revocation_code once
  -> save encrypted account
```

Acceptance criteria:

- Admin can transfer an existing authenticator.
- Duplicate account names are rejected.
- Incomplete transfer flows expire and are auditable.
- Successful transfer is audited.

## Phase 9: Confirmations

Deliverables:

- Confirmation hash generation using `identity_secret`.
- Mobile confirmation list endpoint.
- Confirmation details endpoint.
- Accept/deny endpoint for selected confirmations.
- Bulk accept/deny for selected items only.

Acceptance criteria:

- Admin can view pending trade/market/mobile confirmations.
- Admin can accept or deny selected confirmations.
- viewer cannot list or act on confirmations.
- Each accept/deny is audited with confirmation id, type, and outcome.

## Phase 10: Login Sessions and QR Login

Deliverables:

- Pending auth session list.
- Session info display.
- Approve/deny endpoint using shared-secret HMAC signature.
- QR login URL parser for `https://s.team/q/:version/:clientId`.
- Optional frontend QR image scanning can be added client-side later.

Acceptance criteria:

- Admin and assigned viewers can view login attempts with IP, location, platform, and device name when Steam provides them.
- Admin and assigned viewers can approve or deny login attempts.
- Admin and assigned viewers can paste or scan a Steam QR login URL and approve it.
- viewers cannot access login approval endpoints for unassigned accounts.
- No automatic approval rules exist.

## Phase 11: Remove Authenticator and Account Deletion

Deliverables:

- Local account delete endpoint.
- Steam authenticator removal endpoint.
- Revocation code prompt support.
- Strong UI confirmation requirement.

Acceptance criteria:

- Admin can delete local encrypted account record.
- Admin can remove authenticator from Steam only after explicit confirmation.
- If Steam removal succeeds, local account is removed or marked removed.
- Last copy warning is shown in UI before destructive actions.

## Phase 12: React Frontend

Deliverables:

- Vite + React app.
- Static assets served by Worker.
- Routes:
  - `/login`
  - `/change-password`
  - `/accounts`
  - `/accounts/:id`
  - `/accounts/:id/confirmations`
  - `/accounts/:id/login-sessions`
  - `/setup`
  - `/transfer`
  - `/admin/users`
  - `/admin/accounts`
  - `/admin/audit`

Acceptance criteria:

- viewer UI only exposes account code/status pages.
- admin UI exposes management and sensitive operation pages.
- All sensitive buttons require deliberate confirmation.
- UI handles expired login sessions by returning to login.

## Foundation Milestone Definition

The first secure foundation milestone should include:

- Admin bootstrap.
- Admin/viewer auth.
- Admin can create/delete viewer.
- Admin can import `.maFile`.
- Admin can download Full `.maFile` backup with red high-risk warning.
- Admin can assign account to viewer.
- viewer can view assigned account code.
- Admin can create and transfer authenticator.

This milestone proves the hardest project foundations: user management, vault encryption, account assignment, code generation, and authenticator setup/transfer.

## Full V1 Definition

The first complete V1 should include every phase through Phase 12:

- Admin and viewer management.
- Encrypted vault and per-account grants.
- maFile import and admin-only Full maFile export.
- Steam Guard code display.
- Steam login/token refresh.
- Create authenticator.
- Transfer authenticator.
- Confirmations list/details/accept/deny.
- Login session approval/denial and QR login URL approval.
- Remove authenticator and local account deletion.
- React frontend with role-specific navigation.

## Testing Strategy

Unit tests:

- password hash verify.
- AES-GCM encrypt/decrypt.
- vault key wrapping/unwrapping.
- Steam Guard code generation using upstream fixture values.
- RBAC decision matrix.
- QR login URL parser.

Integration tests:

- login/session lifecycle.
- admin creates viewer.
- viewer denied admin route.
- import maFile and verify D1 encrypted blob does not contain secret substrings.
- export Full maFile as admin and verify viewer is denied.
- viewer can access assigned account and cannot access unassigned account.

Manual tests:

- deploy fresh environment and verify bootstrap output.
- change initial admin password.
- verify expired login sessions return to login.
- create/transfer authenticator against a test Steam account.
- accept/deny confirmation against a test account.

## Implementation Notes

- Prefer small service modules over putting logic in route handlers.
- Route handlers should do validation, call services, and return typed responses.
- All D1 writes should use prepared statements.
- Steam API clients should return domain errors, not raw fetch exceptions.
- Never log request bodies on auth, vault, setup, transfer, confirmation, or password routes.
- Store timestamps as ISO-8601 UTC strings.
- Use opaque random ids, not sequential ids, for user/session/account/flow records.
