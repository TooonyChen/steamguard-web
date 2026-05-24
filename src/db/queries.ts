import type { AuthUser, Bindings, SteamAccountRow, UserRow } from '../types'
import { conflict, notFound } from '../http/errors'
import { nowIso, randomId } from '../crypto/webcrypto'

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
  }
}

export async function findUserByUsername(env: Bindings, username: string): Promise<UserRow | null> {
  return env.DB
    .prepare('SELECT * FROM users WHERE username_normalized = ?')
    .bind(username.toLowerCase())
    .first<UserRow>()
}

export async function findUserById(env: Bindings, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
}

export async function activeAdminCount(env: Bindings): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function ensureDefaultVault(env: Bindings): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM vaults ORDER BY created_at LIMIT 1').first<{ id: string }>()
  if (existing) return existing.id
  const now = nowIso()
  const id = randomId('vault_')
  await env.DB
    .prepare('INSERT INTO vaults (id, name, schema_version, kdf_scheme, kdf_params_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'default', 1, 'pbkdf2-sha256', JSON.stringify({ purpose: 'account-key-grants' }), now, now)
    .run()
  return id
}

export async function createUser(env: Bindings, input: {
  username: string
  displayName?: string | null
  role: 'admin' | 'viewer'
  status?: 'active' | 'disabled'
  passwordHash: string
  passwordSalt: string
  passwordScheme: string
  mustChangePassword?: boolean
  createdBy?: string | null
}): Promise<UserRow> {
  const now = nowIso()
  const id = randomId('user_')
  try {
    await env.DB.prepare(
      `INSERT INTO users (
        id, username, username_normalized, display_name, role, status,
        password_hash, password_salt, password_hash_scheme, must_change_password,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.username,
        input.username.toLowerCase(),
        input.displayName ?? null,
        input.role,
        input.status ?? 'active',
        input.passwordHash,
        input.passwordSalt,
        input.passwordScheme,
        input.mustChangePassword ? 1 : 0,
        input.createdBy ?? null,
        now,
        now,
      )
      .run()
  } catch (error) {
    if (String(error).includes('UNIQUE')) conflict('Username already exists')
    throw error
  }
  const row = await findUserById(env, id)
  if (!row) throw new Error('Failed to load created user')
  return row
}

export async function getAccount(env: Bindings, accountId: string): Promise<SteamAccountRow> {
  const account = await env.DB.prepare('SELECT * FROM steam_accounts WHERE id = ?').bind(accountId).first<SteamAccountRow>()
  if (!account) notFound('Account not found')
  return account
}

export async function listAccountsForUser(env: Bindings, user: AuthUser): Promise<SteamAccountRow[]> {
  if (user.role === 'admin') {
    const { results = [] } = await env.DB.prepare('SELECT * FROM steam_accounts ORDER BY account_name').all<SteamAccountRow>()
    return results
  }
  const { results = [] } = await env.DB
    .prepare(
      `SELECT a.* FROM steam_accounts a
       INNER JOIN account_permissions p ON p.account_id = a.id
       WHERE p.user_id = ?
       ORDER BY a.account_name`,
    )
    .bind(user.id)
    .all<SteamAccountRow>()
  return results
}

export async function hasAccountAccess(env: Bindings, user: AuthUser, accountId: string, capability: 'code' | 'status'): Promise<boolean> {
  if (user.role === 'admin') return true
  const column = capability === 'code' ? 'can_view_code' : 'can_view_status'
  const row = await env.DB
    .prepare(`SELECT ${column} AS allowed FROM account_permissions WHERE user_id = ? AND account_id = ?`)
    .bind(user.id, accountId)
    .first<{ allowed: number }>()
  return Boolean(row?.allowed)
}
