# SteamGuard Web Architecture

This document defines the v1 foundation of SteamGuard Web. The goal is to build a multi-user web version of Steam Guard that can be deployed to Cloudflare Workers, with feature parity for the core capabilities of `steamguard-cli`, and with permission, encryption, and audit boundaries designed in clearly from the start.

## Goals

- Multi-user web application supporting both administrators and ordinary viewers.
- Administrators can create, delete, and disable viewers, and manage which Steam accounts a viewer can access.
- Viewers by default can only see the Steam Guard verification codes of accounts they have been granted access to; they cannot confirm trades, approve logins, or manage authenticators.
- Administrators can import `.maFile`s, download a single-account Full `.maFile` plaintext backup, create/transfer authenticators, view/handle confirmations, approve/deny login requests, and delete accounts.
- The initial admin account and a random password are automatically generated at deployment; the username and password can be modified through the frontend later.
- The backend runs on Cloudflare Workers, using Hono as the API framework and D1 as the persistence database.
- The frontend is a React static page, hosted by Worker static assets.
- No `auto_approve_ip` or any other automatic login/trade approval functionality.

## Non-Goals

- No public registration.
- No multi-tenant SaaS billing or organization isolation; v1 can have only a single site-level vault.
- No plaintext persistence of Steam secrets, even though the imported source `.maFile` is itself plaintext.
- No copying of `steamguard-cli` GPLv3 CLI command code. Behavior of the MIT/Apache dual-licensed `steamguard` library may be referenced; the core implementation is preferentially re-implemented in TypeScript.

## Threat Model

A `.maFile` is typically a plaintext file on the local machine, but the threat surface of the web version is different:

- D1 database exports or backup leaks.
- Worker API bugs leading to unauthorized reads.
- Administrators accidentally sending the database, logs, or error responses to others.
- Multi-user permission misconfiguration.
- SQL injection, XSS, CSRF, stolen browser sessions.

High-value fields that need to be protected:

- `shared_secret`: can generate Steam Guard login verification codes.
- `identity_secret`: can sign mobile confirmations, affecting trades, market, and account security operations.
- `refresh_token` / `access_token`: can maintain the Steam login state.
- `revocation_code`: can remove the authenticator.
- maFile secret fields such as `device_id`, `uri`, `secret_1`.

Therefore, plaintext `.maFile`s may be accepted at import time, but must be encrypted on storage. The API by default only returns derived results — for example verification codes, confirmation lists, or operation results — and does not return raw secrets.

## Runtime Architecture

```text
React static UI
  -> Hono Worker API
    -> Auth/RBAC middleware
    -> Account grant resolver
    -> Steam service modules
    -> D1

Cloudflare bindings:
  DB                 D1 database
  APP_SECRET         Worker secret for encrypted flows and account key grant wrapping
  ENVIRONMENT        production/development flag
```

Hono app should use typed Cloudflare bindings:

```ts
type Bindings = {
  DB: D1Database
  APP_SECRET: string
  ENVIRONMENT: 'development' | 'production'
}

const app = new Hono<{ Bindings: Bindings }>()
```

## Authentication

V1 uses in-app username/password login and does not open registration.

Password requirements:

- Username is unique, compared case-insensitively, with the original display name preserved.
- Only the password hash is stored; plaintext is not stored.
- Each user has an independent salt.
- `users.password_hash_scheme` records the hash algorithm and parameters, to make future upgrades easy.
- The initial admin must have `must_change_password = 1` set; the password must be changed on first login.

Cloudflare Access is the recommended outer protection layer; it does not replace in-app RBAC:

- Access blocks the public entry point.
- In-app RBAC decides what users can do after entering.
- If you later want to open up to external users, you can disable Access or migrate to a standalone identity provider.

## Admin Bootstrap

The deploy flow must include a one-time admin bootstrap:

```text
bun run deploy
  -> run D1 migrations
  -> deploy Worker
  -> run bootstrap-admin script
```

Bootstrap behavior:

- If the `users` table is empty, create an `admin` user.
- The production environment must read the initial password from `INITIAL_ADMIN_PASSWORD`, hash it, and write it to D1.
- The production environment must not generate or print a random admin password.
- The local development environment is only allowed to generate and print a random password once under an explicit dev flag.
- Write `bootstrap_state.admin_created_at`; subsequent re-runs will not create a second admin.
- The admin must change the username and password after the first login.

In CI/CD scenarios, do not expose the initial password in public logs. It is recommended to store `INITIAL_ADMIN_PASSWORD` in the deploy environment's secret manager, and to change it immediately after the first login.

## RBAC

V1 roles:

```text
admin
viewer
```

Global permissions:

| Capability | admin | viewer |
| --- | --- | --- |
| Log into the back office | yes | yes |
| Create viewer | yes | no |
| Delete/disable viewer | yes | no |
| Modify viewer password | yes | no |
| Modify own password | yes | yes |
| Import `.maFile` | yes | no |
| Download Full `.maFile` plaintext backup | yes | no |
| Create authenticator | yes | no |
| Transfer authenticator | yes | no |
| Delete local account record | yes | no |
| Remove Steam authenticator | yes | no |
| Manage account grants | yes | no |
| View audit log | yes | no |

Account-level permissions:

| Capability | admin | viewer |
| --- | --- | --- |
| View list of granted accounts | all | assigned |
| View verification code | all | assigned only |
| View 2FA status | all | assigned only |
| Download Full `.maFile` plaintext backup | yes | no |
| View confirmations | yes | no |
| Accept/deny confirmations | yes | no |
| View pending login sessions | yes | assigned only |
| Approve/deny login sessions | yes | assigned only |
| QR login approval | yes | assigned only |

Viewer account access must be explicitly authorized through `account_permissions`. Do not guess visibility solely from account name or Steam ID.

## Vault Encryption

V1 does not have a separate vault re-auth/unlock. The login session + RBAC + per-account grants together decide which capabilities a user can access.

Persistence rules:

- D1 does not store plaintext maFiles.
- `steam_account_secrets.encrypted_blob` stores the full encrypted account object.
- The encrypted object contains SteamGuardAccount-compatible fields and token state.
- Public metadata is stored separately in `steam_accounts`, for example `account_name`, `steam_id`, `status`.

V1 uses a per-user, per-account key grant model. `vault` refers to a set of Steam accounts and encryption material, not a plaintext folder.

```text
account_secret_key: randomly generated for every Steam account
encrypted_blob: account_secret_key encrypts the full account secret
account_key_grant: APP_SECRET-derived wrapping key encrypts account_secret_key, bound to user_id/account_id
```

Grant semantics:

- When an admin imports, creates, or transfers an account, the system creates `account_key_grants` for every active admin.
- When an admin assigns an account to a viewer, the system creates the corresponding `account_key_grants` and `account_permissions` for that viewer.
- After login, a viewer can only load the account keys for accounts they have been granted.
- When a viewer is deleted or an account grant is revoked, the corresponding grants are revoked.
- An admin resetting a viewer's password does not require re-wrapping grants; the password is only used for login and does not participate in account key grant wrapping.

This model is more suited to multi-user use than a shared site-level vault passphrase: viewers don't need to know a global key, and rotating all accounts isn't required when revoking a viewer or an account grant.

Encryption algorithm:

- `AES-256-GCM` to encrypt the blob.
- A random 96-bit nonce is used for each encryption.
- AAD binds immutable context such as `account_id`, `schema_version`, `created_at`.
- Account grant wrapping uses the Worker Secret `APP_SECRET` to derive an AES-GCM key via WebCrypto PBKDF2-HMAC-SHA-256; the AAD binds `user_id`/`account_id`.
- User password hashing uses PBKDF2-HMAC-SHA-256 as the v1 baseline; the field records iterations, and migration to Argon2id WASM is possible later.

## Secret Access

After login, secret-backed operations are accessed directly according to role and account grant:

```text
auth session valid
  -> RBAC allows operation
  -> worker unwraps account_key_grant with APP_SECRET for the current user/account
  -> decrypt account blob in memory
  -> call Steam API or return derived data
  -> if tokens changed, re-encrypt and save blob
```

By default, admin accounts can manage Steam codes, Full export, confirmations, login approvals, and setup/transfer/remove. Viewers can view Steam Guard code/status and handle login approvals for accounts assigned to them, but cannot export `.maFile`s, manage confirmations, or manage authenticators.

## maFile Full Export

Administrators need to be able to download a Full `.maFile` plaintext backup compatible with `steamguard-cli` / SDA after creating/transferring an authenticator. This capability is a high-risk admin-only operation, and is not used for routine backups.

Rules:

- Admin only.
- Must have a valid admin login session.
- Only single-account explicit export is supported; viewer export is not offered, and bulk plaintext export is not provided as a default feature.
- The backend only temporarily decrypts the account blob during the request and generates the `.maFile` JSON.
- D1 does not save the exported plaintext `.maFile`.
- Do not write `.maFile` content, tokens, or secret fields into logs, audit metadata, or error responses.
- The response uses download headers: `Content-Type: application/json` and `Content-Disposition: attachment; filename="<account_name>.maFile"`.
- Each export must write an audit event: `account_mafile_exported`.

The Full export contains the complete SteamGuardAccount-compatible fields, including Steam tokens. It is suitable for migrating to `steamguard-cli` or other compatible tools to continue generating verification codes and handling confirmations, but the leakage risk is equivalent to leaking the Steam Guard device.

The frontend must clearly state, in a red danger notice near the download button:

```text
This Full .maFile is a plaintext high-sensitivity backup. Anyone with this file can generate Steam Guard codes and may be able to confirm trades or account actions. Store it offline and delete extra copies.
```

The success page for creating/transferring an authenticator should offer:

```text
Download Full .maFile backup
```

This button is reusable, but each click must go through admin authorization, audit logging, and an explicit risk notice again.

## Data Model

Core tables:

```sql
users (
  id text primary key,
  username text not null unique,
  display_name text,
  role text not null check (role in ('admin', 'viewer')),
  status text not null check (status in ('active', 'disabled')),
  password_hash text not null,
  password_salt text not null,
  password_hash_scheme text not null,
  must_change_password integer not null default 0,
  created_by text,
  created_at text not null,
  updated_at text not null,
  last_login_at text
)

sessions (
  id text primary key,
  user_id text not null references users(id),
  session_hash text not null unique,
  expires_at text not null,
  created_at text not null,
  revoked_at text
)

vaults (
  id text primary key,
  name text not null,
  schema_version integer not null,
  kdf_scheme text not null,
  kdf_params_json text not null,
  created_at text not null,
  updated_at text not null
)

account_key_grants (
  id text primary key,
  user_id text not null references users(id),
  account_id text not null references steam_accounts(id),
  wrapped_account_key text not null,
  wrap_scheme text not null,
  created_by text references users(id),
  created_at text not null,
  revoked_at text,
  unique (user_id, account_id)
)

steam_accounts (
  id text primary key,
  vault_id text not null references vaults(id),
  account_name text not null,
  steam_id text,
  status text not null,
  created_by text references users(id),
  created_at text not null,
  updated_at text not null,
  unique (vault_id, account_name)
)

steam_account_secrets (
  account_id text primary key references steam_accounts(id),
  encrypted_blob text not null,
  encryption_scheme text not null,
  blob_schema_version integer not null,
  updated_at text not null
)

account_permissions (
  id text primary key,
  user_id text not null references users(id),
  account_id text not null references steam_accounts(id),
  can_view_code integer not null default 1,
  can_view_status integer not null default 1,
  created_by text references users(id),
  created_at text not null,
  unique (user_id, account_id)
)

auth_flows (
  id text primary key,
  kind text not null,
  status text not null,
  created_by text references users(id),
  account_id text,
  state_json text not null,
  expires_at text not null,
  created_at text not null,
  updated_at text not null
)

audit_events (
  id text primary key,
  actor_user_id text references users(id),
  account_id text,
  action text not null,
  target_type text,
  target_id text,
  ip_hash text,
  user_agent_hash text,
  outcome text not null,
  metadata_json text,
  created_at text not null
)

bootstrap_state (
  key text primary key,
  value text not null,
  created_at text not null
)
```

## API Boundaries

Public unauthenticated:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/health
```

Authenticated:

```text
GET  /api/me
POST /api/me/password
POST /api/me/username
```

Admin user management:

```text
GET    /api/admin/users
POST   /api/admin/users/viewers
PATCH  /api/admin/users/:userId
DELETE /api/admin/users/:userId
POST   /api/admin/users/:userId/reset-password
```

Accounts:

```text
GET    /api/accounts
POST   /api/accounts/import-mafile
GET    /api/accounts/:accountId
GET    /api/accounts/:accountId/export-mafile
DELETE /api/accounts/:accountId
POST   /api/accounts/:accountId/permissions
```

Codes and status:

```text
GET /api/accounts/:accountId/code
GET /api/accounts/:accountId/status
```

Confirmations and login approvals:

```text
GET  /api/accounts/:accountId/confirmations
GET  /api/accounts/:accountId/confirmations/:confirmationId/details
POST /api/accounts/:accountId/confirmations/action

GET  /api/accounts/:accountId/login-sessions
POST /api/accounts/:accountId/login-sessions/:clientId/approve
POST /api/accounts/:accountId/login-sessions/:clientId/deny
POST /api/accounts/:accountId/qr-login
```

Authenticator setup and transfer:

```text
POST /api/authenticator/setup/begin
POST /api/authenticator/setup/:flowId/submit-code
POST /api/authenticator/setup/:flowId/poll

POST /api/authenticator/transfer/begin
POST /api/authenticator/transfer/:flowId/submit-sms
POST /api/authenticator/transfer/:flowId/poll

POST /api/accounts/:accountId/remove-authenticator
```

## Steam Flows

Long-running CLI prompts must become explicit web state machines.

Create authenticator:

```text
begin credentials login
  -> maybe need email/device/2FA code
  -> get Steam tokens
  -> AddAuthenticator
  -> persist pending flow with encrypted provisional account
  -> show revocation code once
  -> submit email/SMS code
  -> FinalizeAddAuthenticator
  -> QueryStatus
  -> commit encrypted account
```

Transfer authenticator:

```text
begin credentials login
  -> maybe need Steam guard code or device confirmation
  -> transfer_start
  -> need SMS code
  -> transfer_finish
  -> show revocation code once
  -> commit encrypted account
```

Confirmations:

```text
load account secret
  -> refresh Steam access token if needed
  -> build mobileconf query hash with identity_secret
  -> list confirmations
  -> accept/deny selected confirmations
  -> audit each action
```

Login approval:

```text
load account secret
  -> refresh Steam access token if needed
  -> list auth sessions
  -> get session info for display
  -> approve/deny with shared_secret HMAC signature
  -> audit action
```

## Frontend Structure

The UI should be simple but operational:

```text
/login
/change-password
/vault
/accounts
/accounts/:id
/accounts/:id/confirmations
/accounts/:id/login-sessions
/setup
/transfer
/admin/users
/admin/accounts
/admin/audit
```

Viewer navigation should only show:

- account list
- code view
- status view
- login approvals and QR login approval
- own password/username settings

Admin navigation should include:

- users
- account permissions
- import/create/transfer
- confirmations
- login approvals
- audit log

## Audit Rules

Always audit:

- login success/failure.
- viewer creation/deletion/disable.
- password reset.
- account import/delete.
- Full maFile export.
- code viewed.
- confirmation accepted/denied.
- login session approved/denied.
- authenticator created/transferred/removed.
- permission granted/revoked.

Audit metadata must not include raw Steam secrets, passwords, tokens, or full maFile contents.

## Operational Defaults

- Session cookie: HttpOnly, Secure, SameSite=Lax.
- Auth flow TTL: 15 minutes unless Steam API requires shorter.
- Rate limit login, setup, transfer, and confirmation action endpoints.
- Never log request bodies for sensitive routes.
- All admin destructive operations require explicit confirmation in UI.
- Routine backups export encrypted vault data only.
- Full `.maFile` export is allowed only as an explicit single-account admin action with red high-risk UI copy.
