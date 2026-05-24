# SteamGuard Web Architecture

本文档定义 SteamGuard Web 的第一版地基。目标是做一个可部署到 Cloudflare Workers 的多用户网页版 Steam Guard，功能对齐 `steamguard-cli` 的核心能力，并从一开始把权限、加密和审计边界设计清楚。

## Goals

- 多用户 Web 应用，支持管理员和普通 viewer。
- 管理员可以创建、删除、禁用 viewer，并管理 viewer 能访问的 Steam 账号。
- viewer 默认只能查看被授权账号的 Steam Guard 验证码，不能确认交易、批准登录或管理 authenticator。
- 管理员可以导入 `.maFile`、下载单账号 Full `.maFile` 明文备份、创建/转移 authenticator、查看/处理 confirmations、批准/拒绝登录请求、删除账号。
- 部署时自动生成初始 admin 账号和随机密码；后续可在前端修改用户名和密码。
- 后端运行在 Cloudflare Workers，使用 Hono 作为 API 框架，D1 作为持久化数据库。
- 前端是 React 静态页面，由 Worker static assets 托管。
- 不做 `auto_approve_ip` 或任何自动批准登录/交易功能。

## Non-Goals

- 不做公开注册。
- 不做多租户 SaaS 计费或组织隔离；第一版可以只有一个站点级 vault。
- 不明文持久化 Steam secrets，即使导入源 `.maFile` 本身是明文。
- 不复制 `steamguard-cli` GPLv3 CLI command code。可以参考 MIT/Apache 双许可的 `steamguard` library 行为，核心实现优先用 TypeScript 重新实现。

## Threat Model

`.maFile` 通常是本机明文文件，但 Web 版的威胁面不同：

- D1 数据库导出或备份泄露。
- Worker API bug 导致越权读取。
- 管理员误把数据库、日志或错误响应发给别人。
- 多用户权限配置错误。
- SQL 注入、XSS、CSRF、被盗浏览器会话。

需要保护的高价值字段：

- `shared_secret`：可生成 Steam Guard 登录验证码。
- `identity_secret`：可签名移动 confirmations，影响交易、市场、账号安全操作。
- `refresh_token` / `access_token`：可维持 Steam 登录态。
- `revocation_code`：可移除 authenticator。
- `device_id`、`uri`、`secret_1` 等 maFile 机密字段。

因此，导入时可以接收明文 `.maFile`，但入库必须加密。API 默认只返回派生结果，例如验证码、确认列表或操作结果，不返回原始 secret。

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

第一版使用应用内账号密码登录，不开放注册。

Password requirements:

- 用户名唯一，不区分大小写比较，保留原始显示名。
- 密码只存 hash，不存明文。
- 每个用户独立 salt。
- `users.password_hash_scheme` 记录 hash 算法和参数，方便未来升级。
- 初始 admin 必须设置 `must_change_password = 1`，首次登录后强制修改密码。

Cloudflare Access 是推荐的外层保护，不替代应用内 RBAC：

- Access 负责挡住公网入口。
- 应用内 RBAC 负责决定用户进入后能做什么。
- 如果后续要开放给外部用户，可关闭 Access 或迁移到独立身份提供商。

## Admin Bootstrap

部署流程必须包含一次性 admin bootstrap：

```text
bun run deploy
  -> run D1 migrations
  -> deploy Worker
  -> run bootstrap-admin script
```

bootstrap 行为：

- 如果 `users` 表为空，创建一个 `admin` 用户。
- 生产环境必须从 `INITIAL_ADMIN_PASSWORD` 读取初始密码，hash 后写入 D1。
- 生产环境不得生成或打印随机 admin 密码。
- 本地开发环境只有在显式 dev flag 下才允许生成并打印一次随机密码。
- 写入 `bootstrap_state.admin_created_at`，后续重复执行不再生成第二个 admin。
- admin 首次登录后必须修改用户名和密码。

CI/CD 场景不要把初始密码暴露在公开日志里。推荐把 `INITIAL_ADMIN_PASSWORD` 存在部署环境的 secret manager 中，并在首次登录后立即修改。

## RBAC

第一版角色：

```text
admin
viewer
```

全局权限：

| Capability | admin | viewer |
| --- | --- | --- |
| 登录后台 | yes | yes |
| 创建 viewer | yes | no |
| 删除/禁用 viewer | yes | no |
| 修改 viewer 密码 | yes | no |
| 修改自己的密码 | yes | yes |
| 导入 `.maFile` | yes | no |
| 下载 Full `.maFile` 明文备份 | yes | no |
| 创建 authenticator | yes | no |
| 转移 authenticator | yes | no |
| 删除本地账号记录 | yes | no |
| 移除 Steam authenticator | yes | no |
| 管理账号授权 | yes | no |
| 查看审计日志 | yes | no |

账号级权限：

| Capability | admin | viewer |
| --- | --- | --- |
| 查看被授权账号列表 | all | assigned |
| 查看验证码 | all | assigned only |
| 查看 2FA 状态 | all | assigned only |
| 下载 Full `.maFile` 明文备份 | yes | no |
| 查看 confirmations | yes | no |
| 接受/拒绝 confirmations | yes | no |
| 查看 pending login sessions | yes | no |
| 批准/拒绝 login sessions | yes | no |
| QR login approval | yes | no |

viewer 的账号访问必须通过 `account_permissions` 显式授权。不要仅按账号名或 Steam ID 猜测可见性。

## Vault Encryption

V1 不做单独的 vault re-auth/unlock。登录 session + RBAC + per-account grants 决定用户能访问哪些能力。

持久化规则：

- D1 不存明文 maFile。
- `steam_account_secrets.encrypted_blob` 存完整加密账号对象。
- 加密对象包含 SteamGuardAccount 兼容字段和 token 状态。
- 公开 metadata 单独存在 `steam_accounts`，例如 `account_name`、`steam_id`、`status`。

V1 使用 per-user, per-account key grant 模型。`vault` 指一组 Steam 账号和加密材料，不是一个明文文件夹。

```text
account_secret_key: 每个 Steam 账号随机生成
encrypted_blob: account_secret_key 加密完整账号 secret
account_key_grant: APP_SECRET 派生 wrapping key 加密 account_secret_key，并绑定 user_id/account_id
```

授权语义：

- admin 导入、创建、转移账号时，系统为每个 active admin 创建 `account_key_grants`。
- admin 给 viewer 分配账号时，系统为该 viewer 创建对应账号的 `account_key_grants` 和 `account_permissions`。
- viewer 登录后只能加载自己被授权账号的 account keys。
- 删除 viewer 或撤销账号权限时，撤销对应 grants。
- admin reset viewer password 不需要重新包裹 grants；密码只用于登录，不参与 account key grant wrapping。

这个模型比共享站点级 vault passphrase 更适合多用户：viewer 不需要知道全局密钥，撤销某个 viewer 或某个账号授权时也不需要轮换所有账号。

加密算法：

- `AES-256-GCM` 加密 blob。
- 每次加密使用随机 96-bit nonce。
- AAD 绑定 `account_id`、`schema_version`、`created_at` 等不可变上下文。
- account grant wrapping 使用 Worker Secret `APP_SECRET` 经 WebCrypto PBKDF2-HMAC-SHA-256 派生 AES-GCM key；AAD 绑定 `user_id`/`account_id`。
- 用户密码 hashing 使用 PBKDF2-HMAC-SHA-256 作为第一版基线；字段记录 iterations，未来可迁移 Argon2id WASM。

## Secret Access

登录后按角色和账号授权直接访问 secret-backed 操作：

```text
auth session valid
  -> RBAC allows operation
  -> worker unwraps account_key_grant with APP_SECRET for the current user/account
  -> decrypt account blob in memory
  -> call Steam API or return derived data
  -> if tokens changed, re-encrypt and save blob
```

admin 账号默认能管理 Steam codes、Full export、confirmations、login approvals、setup/transfer/remove。viewer 只能查看被分配账号的 Steam Guard code/status，不能导出 `.maFile` 或执行 Steam 操作。

## maFile Full Export

管理员需要能在创建/转移 authenticator 后下载兼容 `steamguard-cli` / SDA 的 Full `.maFile` 明文备份。这个能力是高风险 admin-only 操作，不用于常规备份。

规则：

- 仅 admin 可用。
- 必须有有效 admin 登录 session。
- 只支持单账号显式导出，不提供 viewer 导出，也不提供批量明文导出作为默认功能。
- 后端只在请求期间临时解密 account blob 并生成 `.maFile` JSON。
- D1 不保存导出的明文 `.maFile`。
- 不把 `.maFile` 内容、tokens、secret 字段写入日志、audit metadata 或错误响应。
- 响应使用下载头：`Content-Type: application/json` 和 `Content-Disposition: attachment; filename="<account_name>.maFile"`。
- 每次导出必须写 audit event：`account_mafile_exported`。

Full export 包含完整 SteamGuardAccount 兼容字段，包括 Steam tokens。它适合迁移到 `steamguard-cli` 或其他兼容工具继续生成验证码和处理 confirmations，但泄露风险等同于泄露 Steam Guard 设备。

前端必须在下载按钮附近用红色危险提示明确说明：

```text
This Full .maFile is a plaintext high-sensitivity backup. Anyone with this file can generate Steam Guard codes and may be able to confirm trades or account actions. Store it offline and delete extra copies.
```

创建/转移 authenticator 成功页应提供：

```text
Download Full .maFile backup
```

该按钮可重复使用，但每次点击都重新经过 admin 权限、审计记录和明确风险提示。

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

viewer navigation should only show:

- account list
- code view
- status view
- own password/username settings

admin navigation should include:

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
