import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/http/app'
import { createUser } from '../src/db/queries'
import { hashPassword, encryptJson, encryptJsonLegacyV1, decryptJson, encryptedPayloadVersion } from '../src/crypto/webcrypto'
import { createEncryptedFlow, loadEncryptedFlow } from '../src/flows/flow-store'
import { runCleanup } from '../src/maintenance/cleanup'
import { toAuthUser } from '../src/db/queries'
import { createTestEnv } from './helpers/d1'
import type { Bindings, UserRow } from '../src/types'

const PASSWORD = 'correct-horse-battery'
const app = createApp()

let hashed: { hash: string; salt: string; scheme: string }

beforeAll(async () => {
  // Steam endpoints must never be reached from tests; getSteamServerTime
  // falls back to worker time when fetch rejects.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network disabled in tests')
  }))
  hashed = await hashPassword(PASSWORD)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function seedUser(env: Bindings, username: string, role: 'admin' | 'viewer'): Promise<UserRow> {
  return createUser(env, {
    username,
    role,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    passwordScheme: hashed.scheme,
  })
}

async function login(env: Bindings, username: string, password = PASSWORD, ip?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (ip) headers['cf-connecting-ip'] = ip
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  }, env)
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
  return { res, cookie }
}

function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers as Record<string, string> | undefined) } }
}

function maFileFixture(accountName: string) {
  return {
    account_name: accountName,
    steam_id: '76561199000000001',
    shared_secret: Buffer.alloc(20, 7).toString('base64'),
    identity_secret: Buffer.alloc(20, 9).toString('base64'),
    revocation_code: 'R12345',
  }
}

async function importAccount(env: Bindings, adminCookie: string, accountName = 'testaccount'): Promise<string> {
  const res = await app.request('/api/accounts/import-mafile', authed(adminCookie, {
    method: 'POST',
    body: JSON.stringify({ maFile: maFileFixture(accountName) }),
  }), env)
  expect(res.status).toBe(201)
  const body = await res.json() as { data: { account: { id: string } } }
  return body.data.account.id
}

describe('auth and sessions', () => {
  it('rejects API requests without a session', async () => {
    const env = createTestEnv()
    const res = await app.request('/api/accounts', {}, env)
    expect(res.status).toBe(401)
  })

  it('logs in with valid credentials and rejects bad passwords', async () => {
    const env = createTestEnv()
    await seedUser(env, 'alice', 'admin')

    const bad = await login(env, 'alice', 'wrong-password')
    expect(bad.res.status).toBe(403)

    const good = await login(env, 'alice')
    expect(good.res.status).toBe(200)
    expect(good.cookie).toMatch(/^sg_session=/)

    const me = await app.request('/api/auth/me', authed(good.cookie), env)
    expect(me.status).toBe(200)
    const body = await me.json() as { data: { user: { username: string; role: string } } }
    expect(body.data.user.username).toBe('alice')
    expect(body.data.user.role).toBe('admin')
  })

  it('denies cross-origin state-changing requests', async () => {
    const env = createTestEnv()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    }, env)
    expect(res.status).toBe(403)
  })
})

describe('login throttling', () => {
  it('locks a username after repeated failures and unlocks after the window', async () => {
    const env = createTestEnv()
    await seedUser(env, 'bob', 'admin')

    for (let i = 0; i < 5; i += 1) {
      const { res } = await login(env, 'bob', 'wrong-password')
      expect(res.status).toBe(403)
    }
    // Locked now: even the correct password is rejected without touching PBKDF2.
    const locked = await login(env, 'bob')
    expect(locked.res.status).toBe(429)

    // Simulate lock expiry, then a successful login clears the user counter.
    await env.DB.prepare('UPDATE login_attempts SET locked_until = ? WHERE key = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), 'user:bob')
      .run()
    const unlocked = await login(env, 'bob')
    expect(unlocked.res.status).toBe(200)
    const counter = await env.DB.prepare('SELECT * FROM login_attempts WHERE key = ?').bind('user:bob').first()
    expect(counter).toBeNull()
  })

  it('locks by IP across different usernames', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 20; i += 1) {
      const { res } = await login(env, `ghost-${i}`, 'whatever', '198.51.100.7')
      expect(res.status).toBe(403)
    }
    const blocked = await login(env, 'another-ghost', 'whatever', '198.51.100.7')
    expect(blocked.res.status).toBe(429)
    // A different IP is unaffected.
    const other = await login(env, 'another-ghost', 'whatever', '203.0.113.9')
    expect(other.res.status).toBe(403)
  })
})

describe('RBAC and account grants', () => {
  it('keeps admin endpoints away from viewers', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    await seedUser(env, 'viewer1', 'viewer')
    const viewer = await login(env, 'viewer1')

    for (const [path, init] of [
      ['/api/admin/users', authed(viewer.cookie)],
      ['/api/admin/audit', authed(viewer.cookie)],
      ['/api/accounts/import-mafile', authed(viewer.cookie, { method: 'POST', body: JSON.stringify({ maFile: maFileFixture('x') }) })],
    ] as const) {
      const res = await app.request(path, init, env)
      expect(res.status, path).toBe(403)
    }
  })

  it('grants imported accounts to every active admin', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    await seedUser(env, 'admin2', 'admin')
    const admin1 = await login(env, 'admin1')
    const admin2 = await login(env, 'admin2')
    const accountId = await importAccount(env, admin1.cookie)

    // The non-importing admin can decrypt too (its own grant, not admin1's).
    const code = await app.request(`/api/accounts/${accountId}/code`, authed(admin2.cookie), env)
    expect(code.status).toBe(200)
    const body = await code.json() as { data: { code: string } }
    expect(body.data.code).toHaveLength(5)
  })

  it('viewer sees an account only after an explicit grant, and loses it on revoke', async () => {
    const env = createTestEnv()
    const adminRow = await seedUser(env, 'admin1', 'admin')
    const viewerRow = await seedUser(env, 'viewer1', 'viewer')
    void adminRow
    const admin = await login(env, 'admin1')
    const viewer = await login(env, 'viewer1')
    const accountId = await importAccount(env, admin.cookie)

    const listBefore = await app.request('/api/accounts', authed(viewer.cookie), env)
    expect((await listBefore.json() as { data: { accounts: unknown[] } }).data.accounts).toHaveLength(0)
    expect((await app.request(`/api/accounts/${accountId}/code`, authed(viewer.cookie), env)).status).toBe(403)

    const grant = await app.request(`/api/accounts/${accountId}/permissions`, authed(admin.cookie, {
      method: 'POST',
      body: JSON.stringify({ userId: viewerRow.id }),
    }), env)
    expect(grant.status).toBe(200)

    const listAfter = await app.request('/api/accounts', authed(viewer.cookie), env)
    expect((await listAfter.json() as { data: { accounts: unknown[] } }).data.accounts).toHaveLength(1)
    expect((await app.request(`/api/accounts/${accountId}/code`, authed(viewer.cookie), env)).status).toBe(200)
    // maFile export stays admin-only even for granted accounts.
    expect((await app.request(`/api/accounts/${accountId}/export-mafile`, authed(viewer.cookie), env)).status).toBe(403)

    const revoke = await app.request(`/api/accounts/${accountId}/permissions/${viewerRow.id}`, authed(admin.cookie, { method: 'DELETE' }), env)
    expect(revoke.status).toBe(200)
    expect((await app.request(`/api/accounts/${accountId}/code`, authed(viewer.cookie), env)).status).toBe(403)
  })

  it('exports a full maFile for admins and audits it', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const accountId = await importAccount(env, admin.cookie)

    const res = await app.request(`/api/accounts/${accountId}/export-mafile`, authed(admin.cookie), env)
    expect(res.status).toBe(200)
    const exported = JSON.parse(await res.text()) as { shared_secret: string; account_name: string }
    expect(exported.shared_secret).toBe(maFileFixture('x').shared_secret)

    const event = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'account_mafile_exported'")
      .first<{ count: number }>()
    expect(Number(event?.count)).toBe(1)
  })

  it('blocks disabling your own account (last-admin safety)', async () => {
    const env = createTestEnv()
    const adminRow = await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const res = await app.request(`/api/admin/users/${adminRow.id}/disable`, authed(admin.cookie, { method: 'POST' }), env)
    expect(res.status).toBe(403)
  })
})

describe('encrypted payload versioning (PBKDF2 -> HKDF migration)', () => {
  it('decrypts both v1 and v2 payloads and writes v2', async () => {
    const value = { hello: 'world' }
    const v1 = await encryptJsonLegacyV1('secret', 'test-purpose', value, 'aad')
    const v2 = await encryptJson('secret', 'test-purpose', value, 'aad')
    expect(encryptedPayloadVersion(v1)).toBe(1)
    expect(encryptedPayloadVersion(v2)).toBe(2)
    expect(await decryptJson('secret', 'test-purpose', v1, 'aad')).toEqual(value)
    expect(await decryptJson('secret', 'test-purpose', v2, 'aad')).toEqual(value)
  })

  it('upgrades a legacy v1 grant wrap on first use', async () => {
    const env = createTestEnv()
    const adminRow = await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const accountId = await importAccount(env, admin.cookie)

    // Rewrite the grant as a legacy v1 wrap, as if written before the migration.
    const current = await env.DB
      .prepare('SELECT wrapped_account_key FROM account_key_grants WHERE user_id = ? AND account_id = ?')
      .bind(adminRow.id, accountId)
      .first<{ wrapped_account_key: string }>()
    const purpose = `account-grant:${adminRow.id}:${accountId}`
    const aad = `${adminRow.id}:${accountId}`
    const accountKey = (await decryptJson<{ accountKey: string }>(env.APP_SECRET, purpose, current!.wrapped_account_key, aad)).accountKey
    const legacyWrapped = await encryptJsonLegacyV1(env.APP_SECRET, purpose, { accountKey }, aad)
    await env.DB
      .prepare("UPDATE account_key_grants SET wrapped_account_key = ?, wrap_scheme = 'app-secret/aes-256-gcm:v1' WHERE user_id = ? AND account_id = ?")
      .bind(legacyWrapped, adminRow.id, accountId)
      .run()

    const res = await app.request(`/api/accounts/${accountId}/code`, authed(admin.cookie), env)
    expect(res.status).toBe(200)

    const upgraded = await env.DB
      .prepare('SELECT wrapped_account_key, wrap_scheme FROM account_key_grants WHERE user_id = ? AND account_id = ?')
      .bind(adminRow.id, accountId)
      .first<{ wrapped_account_key: string; wrap_scheme: string }>()
    expect(encryptedPayloadVersion(upgraded!.wrapped_account_key)).toBe(2)
    expect(upgraded!.wrap_scheme).toBe('app-secret/aes-256-gcm:v2')
  })
})

describe('flow store scoping', () => {
  it('refuses to load a flow created by a different user', async () => {
    const env = createTestEnv()
    const owner = toAuthUser(await seedUser(env, 'owner', 'admin'))
    const other = toAuthUser(await seedUser(env, 'other', 'admin'))
    const flow = await createEncryptedFlow(env, { kind: 'authenticator_setup', actor: owner, state: { step: 'x' } })
    await expect(loadEncryptedFlow(env, flow.id, other, 'authenticator_setup')).rejects.toThrowError(/different user/)
    const loaded = await loadEncryptedFlow(env, flow.id, owner, 'authenticator_setup')
    expect(loaded.state).toEqual({ step: 'x' })
  })
})

describe('retention cleanup', () => {
  it('removes expired sessions, flows, stale throttle rows, and old audit events', async () => {
    const env = createTestEnv()
    const now = Date.now()
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()
    const day = 24 * 3600_000

    await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('sess_expired', 'user_x', 'h1', iso(-1 * day), iso(-8 * day)),
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('sess_revoked_old', 'user_x', 'h2', iso(40 * day), iso(-40 * day), iso(-35 * day)),
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('sess_valid', 'user_x', 'h3', iso(5 * day), iso(0)),
      env.DB.prepare('INSERT INTO auth_flows (id, kind, status, state_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('flow_old', 'k', 'pending', '{}', iso(-2 * day), iso(-2 * day), iso(-2 * day)),
      env.DB.prepare('INSERT INTO auth_flows (id, kind, status, state_json, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('flow_live', 'k', 'pending', '{}', iso(600_000), iso(0), iso(0)),
      env.DB.prepare('INSERT INTO login_attempts (key, failed_count, window_started_at) VALUES (?, ?, ?)')
        .bind('user:stale', 3, iso(-2 * day)),
      env.DB.prepare('INSERT INTO login_attempts (key, failed_count, window_started_at, locked_until) VALUES (?, ?, ?, ?)')
        .bind('user:locked', 5, iso(-2 * day), iso(600_000)),
      env.DB.prepare('INSERT INTO audit_events (id, action, outcome, created_at) VALUES (?, ?, ?, ?)')
        .bind('audit_old', 'x', 'success', iso(-400 * day)),
      env.DB.prepare('INSERT INTO audit_events (id, action, outcome, created_at) VALUES (?, ?, ?, ?)')
        .bind('audit_recent', 'x', 'success', iso(-1 * day)),
    ])

    const summary = await runCleanup(env)
    expect(summary).toEqual({ sessionsDeleted: 2, flowsDeleted: 1, loginAttemptsDeleted: 1, auditEventsDeleted: 1 })

    expect(await env.DB.prepare("SELECT id FROM sessions WHERE id = 'sess_valid'").first()).not.toBeNull()
    expect(await env.DB.prepare("SELECT id FROM auth_flows WHERE id = 'flow_live'").first()).not.toBeNull()
    expect(await env.DB.prepare("SELECT key FROM login_attempts WHERE key = 'user:locked'").first()).not.toBeNull()
    expect(await env.DB.prepare("SELECT id FROM audit_events WHERE id = 'audit_recent'").first()).not.toBeNull()
  })

  it('keeps audit events forever when AUDIT_RETENTION_DAYS is 0', async () => {
    const env = createTestEnv({ AUDIT_RETENTION_DAYS: '0' })
    await env.DB.prepare('INSERT INTO audit_events (id, action, outcome, created_at) VALUES (?, ?, ?, ?)')
      .bind('audit_ancient', 'x', 'success', new Date(Date.now() - 1000 * 24 * 3600_000).toISOString())
      .run()
    const summary = await runCleanup(env)
    expect(summary.auditEventsDeleted).toBe(0)
    expect(await env.DB.prepare("SELECT id FROM audit_events WHERE id = 'audit_ancient'").first()).not.toBeNull()
  })
})

describe('audit pagination', () => {
  it('pages with limit and before cursor', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    // Deterministic timestamps: strictly increasing, no collisions.
    const statements = []
    for (let i = 0; i < 5; i += 1) {
      statements.push(
        env.DB.prepare('INSERT INTO audit_events (id, action, outcome, created_at) VALUES (?, ?, ?, ?)')
          .bind(`audit_${i}`, `action_${i}`, 'success', new Date(Date.UTC(2026, 0, 1 + i)).toISOString()),
      )
    }
    await env.DB.batch(statements)

    const page1 = await app.request('/api/admin/audit?limit=2&before=2026-02-01T00:00:00.000Z', authed(admin.cookie), env)
    expect(page1.status).toBe(200)
    const body1 = (await page1.json() as { data: { events: Array<{ id: string }>; nextBefore: string | null } }).data
    expect(body1.events.map((e) => e.id)).toEqual(['audit_4', 'audit_3'])
    expect(body1.nextBefore).toBe(new Date(Date.UTC(2026, 0, 4)).toISOString())

    const page2 = await app.request(`/api/admin/audit?limit=2&before=${encodeURIComponent(body1.nextBefore!)}`, authed(admin.cookie), env)
    const body2 = (await page2.json() as { data: { events: Array<{ id: string }> } }).data
    expect(body2.events.map((e) => e.id)).toEqual(['audit_2', 'audit_1'])
  })
})
