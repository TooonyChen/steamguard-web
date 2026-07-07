# Technical Decisions

This file records decisions that affect implementation shape. Update it when a decision changes.

## 2026-05-24: V1 Vault Model

Decision: use a per-user, per-account key grant model.

`vault` means the encrypted collection of Steam account secrets plus the key material needed to unlock them. It is not a folder of plaintext `.maFile`s.

The chosen V1 model:

```text
Steam account secret blob
  encrypted by account_secret_key

account_secret_key
  wrapped separately for every user who is allowed to access that account
  using APP_SECRET-derived AES-GCM grant wrapping

viewer
  can unwrap only assigned account keys

admin
  receives grants for imported/created/transferred accounts
  can create/revoke viewer grants
```

Why:

- viewer does not need a shared global vault passphrase.
- revoking one viewer does not require rotating every account.
- assigning one account to a viewer creates only one grant.
- RBAC controls which API operations are allowed after login.

Operational rule:

- account grants are wrapped by `APP_SECRET`, not by the target user's password.
- every secret-backed request unwraps only the account key for the current user/account.
- password changes and admin viewer password resets do not require grant rewrapping.
- there is no separate vault unlock/re-auth step in V1.

Reason for `APP_SECRET` grant wrapping:

- admin can create, reset, and disable viewer accounts without needing to know viewer passwords.
- viewer password changes do not risk orphaning existing account grants.
- D1 still stores encrypted account blobs and encrypted account key grants, while operational recovery remains straightforward.
- `APP_SECRET` becomes a production backup-critical secret and must be rotated carefully.

## 2026-05-24: Admin Bootstrap Password

Decision: production bootstrap uses `INITIAL_ADMIN_PASSWORD`.

Production behavior:

```text
INITIAL_ADMIN_PASSWORD must be present
bootstrap creates username "admin"
bootstrap stores only password hash/salt
bootstrap sets must_change_password = true
bootstrap does not print the password
```

Development behavior:

- local development may generate and print a random password only when explicitly requested by a dev flag.
- default production and CI paths must not print secrets.

Reason:

- CI logs and deploy logs are easy to retain or forward.
- an explicit secret is easier to rotate and audit.

## 2026-05-24: Steam Protobuf

Decision: use `protobuf.js` with generated static ESM modules.

Steam auth and two-factor APIs use protobuf messages. The TS implementation needs typed encode/decode for `.proto` files under:

```text
steamguard-cli/steamguard-cli/steamguard/protobufs/
```

Recommended toolchain:

```text
protobuf.js
pbjs static-module ESM generation
pbts TypeScript declaration generation
```

Context7 check:

- `protobuf.js` supports browser/Node runtimes, `.proto` loading, runtime reflection, and static code generation.
- Static code generation is preferred for Workers to avoid runtime parser overhead and file-loading issues.

Implementation note:

- generate code during build into `src/generated/steam-protobuf/`.
- do not load `.proto` files dynamically in the Worker.
- keep generated files reproducible with a script.

## 2026-05-24: Steam Crypto

Decision: use Web Crypto where possible, and `node-forge` only for Steam password RSA encryption.

Use Workers `crypto.subtle` for:

- AES-GCM vault encryption.
- PBKDF2/HKDF key derivation.
- HMAC-SHA1 Steam Guard codes.
- HMAC-SHA1 mobile confirmation hashes.
- HMAC-SHA256 login approval signatures.

Use `node-forge` for:

- Steam login password encryption with RSAES-PKCS1-V1_5.

Reason:

- Steam login receives RSA modulus/exponent and expects PKCS#1 v1.5 encryption.
- WebCrypto support for RSA encryption is centered on RSA-OAEP; `node-forge` documents `publicKey.encrypt(bytes, 'RSAES-PKCS1-V1_5')` and is pure JS.

Implementation rule:

- wrap `node-forge` behind `src/steam/crypto/rsa-password.ts`.
- keep all other crypto in `src/crypto/webcrypto.ts`.
- add fixture tests using upstream Rust test vectors where available.

## 2026-05-24: Source Reuse Policy

Decision: only code under the `steamguard` library should be directly ported.

Allowed to port directly to TypeScript:

```text
steamguard-cli/steamguard-cli/steamguard/
```

Reason:

- upstream README says the `steamguard` library is MIT or Apache 2.0.

Use only as behavioral reference unless this Web project becomes GPLv3:

```text
steamguard-cli/steamguard-cli/src/
```

Reason:

- upstream README says the `steamguard-cli` command line program is GPLv3.
- copying GPL CLI implementation details would pull this project toward GPL obligations.

Practical interpretation:

- algorithms and API wire behavior in `steamguard/` can be ported.
- CLI prompt/control-flow files under `src/commands/` can inform web flow state machines, but should not be copied.

## 2026-07-07: HKDF for APP_SECRET-Derived Keys (Encrypted Payload v2)

Decision: derive grant-wrap and flow-encryption keys from `APP_SECRET` with HKDF-SHA256 instead of PBKDF2 (100k iterations).

- `EncryptedPayload` is now versioned: `v: 2` means HKDF derivation, `v: 1` means the legacy PBKDF2 derivation. `decryptJson` accepts both; all new writes are v2.
- `account_key_grants` rows written before this change are upgraded opportunistically: `loadAccountKeyForUser` rewraps a v1 grant as v2 (best effort) after a successful unwrap, so the PBKDF2 cost is paid at most once per grant.
- Grant `wrap_scheme` is now `app-secret/aes-256-gcm:v2`.
- User password hashing keeps PBKDF2 100k — passwords are low-entropy and need stretching. Only machine-secret derivation changed.

Reason:

- `APP_SECRET` is a high-entropy machine secret; PBKDF2 stretching added ~100k iterations of CPU per secret-backed request without any security benefit over a single-pass KDF.

## 2026-07-07: Login Throttling

Decision: D1-backed fixed-window throttling on `POST /api/auth/login`, checked before password verification.

- 5 failures per username or 20 per IP (`cf-connecting-ip`, hashed) within 15 minutes locks that key for 15 minutes; locked attempts return 429 `rate_limited` without running PBKDF2.
- A successful login clears only the per-username counter — never the per-IP counter, so a legit login from a shared IP cannot reset an attacker's budget.
- Counters live in the `login_attempts` table (migration 0002); throttled attempts are intentionally not audited to keep `audit_events` from being flooded during an attack.

## 2026-07-07: Retention Cleanup Cron

Decision: a daily scheduled handler (`triggers.crons`, 03:17 UTC) runs `runCleanup` (`src/maintenance/cleanup.ts`).

- Deletes: expired sessions and sessions revoked >30 days ago; `auth_flows` >24h past expiry; stale unlocked `login_attempts`; `audit_events` older than `AUDIT_RETENTION_DAYS` (env var, default 365; `0` disables audit pruning).
- `GET /api/admin/audit` paginates via `limit` (1–200, default 100) and `before` (ISO cursor on `created_at`), returning `nextBefore`.
