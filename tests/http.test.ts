import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import forge from 'node-forge'
import { createApp } from '../src/http/app'
import {
  CAuthentication_BeginAuthSessionViaCredentials_Response,
  CAuthentication_GetPasswordRSAPublicKey_Response,
  CAuthentication_PollAuthSessionStatus_Response,
  EAuthSessionGuardType,
} from '../src/generated/steam-protobuf'
import { createUser } from '../src/db/queries'
import { hashPassword, encryptJson, encryptJsonLegacyV1, decryptJson, encryptedPayloadVersion } from '../src/crypto/webcrypto'
import { createEncryptedFlow, loadEncryptedFlow } from '../src/flows/flow-store'
import { runCleanup } from '../src/maintenance/cleanup'
import { toAuthUser } from '../src/db/queries'
import { steamLong } from '../src/steam/long'
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

  it('hard-deletes a viewer that has logged in and keeps their audit history', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const viewerRow = await seedUser(env, 'viewer1', 'viewer')
    const admin = await login(env, 'admin1')
    const viewer = await login(env, 'viewer1')
    expect(viewer.res.status).toBe(200)
    const accountId = await importAccount(env, admin.cookie)
    const grant = await app.request(`/api/accounts/${accountId}/permissions`, authed(admin.cookie, {
      method: 'POST',
      body: JSON.stringify({ userId: viewerRow.id }),
    }), env)
    expect(grant.status).toBe(200)
    expect((await app.request(`/api/accounts/${accountId}/code`, authed(viewer.cookie), env)).status).toBe(200)

    const res = await app.request(`/api/admin/users/${viewerRow.id}`, authed(admin.cookie, { method: 'DELETE' }), env)
    expect(res.status).toBe(200)

    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(viewerRow.id).first()
    expect(user).toBeNull()
    // Audit rows written by the viewer survive the delete.
    const history = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE actor_user_id = ?')
      .bind(viewerRow.id)
      .first<{ count: number }>()
    expect(Number(history?.count)).toBeGreaterThan(0)
    // The old session no longer works.
    expect((await app.request('/api/accounts', authed(viewer.cookie), env)).status).toBe(401)
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

describe('Steam credential sign-in errors', () => {
  // Steam answers a wrong password with HTTP 200 + x-eresult 5 and no body.
  function stubSteamLogin(beginEresult: number) {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 512, e: 0x10001 })
    const rsaBody = CAuthentication_GetPasswordRSAPublicKey_Response.encode(
      CAuthentication_GetPasswordRSAPublicKey_Response.create({
        publickeyMod: keys.publicKey.n.toString(16),
        publickeyExp: keys.publicKey.e.toString(16),
        timestamp: 1,
      }),
    ).finish()
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname.endsWith('/GetPasswordRSAPublicKey/v1')) {
        return new Response(Buffer.from(rsaBody), { status: 200, headers: { 'x-eresult': '1' } })
      }
      if (url.pathname.endsWith('/BeginAuthSessionViaCredentials/v1')) {
        return new Response(new Uint8Array(), { status: 200, headers: { 'x-eresult': String(beginEresult) } })
      }
      throw new Error(`unexpected Steam call ${url.pathname}`)
    })
  }

  it.each([
    { eresult: 5, status: 400, code: 'steam_login_rejected', message: /rejected the password/ },
    { eresult: 84, status: 429, code: 'steam_rate_limited', message: /too many tries/ },
    { eresult: 87, status: 429, code: 'steam_rate_limited', message: /too many tries/ },
    { eresult: 2, status: 502, code: 'steam_login_failed', message: /Fail/ },
  ])('maps EResult $eresult on sign-in to HTTP $status', async ({ eresult, status, code, message }) => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const accountId = await importAccount(env, admin.cookie)

    const offline = globalThis.fetch
    vi.stubGlobal('fetch', stubSteamLogin(eresult))
    try {
      for (const path of [`/api/accounts/${accountId}/steam-login/begin`, '/api/authenticator/setup/begin']) {
        const res = await app.request(path, authed(admin.cookie, {
          method: 'POST',
          body: JSON.stringify({ accountName: 'testaccount', password: 'wrong-password' }),
        }), env)
        expect(res.status, path).toBe(status)
        const body = await res.json() as { ok: false; error: { code: string; message: string } }
        expect(body.error.code, path).toBe(code)
        expect(body.error.message, path).toMatch(message)
      }
    } finally {
      vi.stubGlobal('fetch', offline)
    }
  })
})

describe('maFile import', () => {
  it('imports a Steam Desktop Authenticator maFile uploaded as a file', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const sda = {
      shared_secret: Buffer.alloc(20, 7).toString('base64'),
      identity_secret: Buffer.alloc(20, 9).toString('base64'),
      account_name: 'sdaaccount',
      revocation_code: 'R12345',
      server_time: 1739734563,
      status: 1,
      fully_enrolled: true,
      Session: { SteamID: '76561198990485637', AccessToken: 'access', RefreshToken: 'refresh' },
    }
    const body = new FormData()
    body.append('maFile', new File([JSON.stringify(sda)], '76561198990485637.maFile'))
    const res = await app.request('/api/accounts/import-mafile', { method: 'POST', headers: { cookie: admin.cookie }, body }, env)
    expect(res.status).toBe(201)
    const json = await res.json() as { data: { account: { steamId: string; accountName: string } } }
    expect(json.data.account).toMatchObject({ steamId: '76561198990485637', accountName: 'sdaaccount' })
  })

  it('rejects a bad maFile with 400 and records why in the audit log', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const body = new FormData()
    body.append('maFile', new File(['encrypted-gibberish'], 'x.maFile'))
    const res = await app.request('/api/accounts/import-mafile', { method: 'POST', headers: { cookie: admin.cookie }, body }, env)
    expect(res.status).toBe(400)
    const json = await res.json() as { error: { code: string; message: string } }
    expect(json.error.code).toBe('invalid_mafile')
    expect(json.error.message).toMatch(/not valid JSON/)
    const event = await env.DB
      .prepare("SELECT outcome, metadata_json FROM audit_events WHERE action = 'account_mafile_import_failed'")
      .first<{ outcome: string; metadata_json: string }>()
    expect(event?.outcome).toBe('failure')
    expect(JSON.parse(event!.metadata_json)).toMatchObject({ status: 400, code: 'invalid_mafile' })
  })
})

describe('Steam account deletion', () => {
  it('requires the Steam login name, then removes the account, secrets, grants and permissions', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const viewerRow = await seedUser(env, 'viewer1', 'viewer')
    const admin = await login(env, 'admin1')
    const accountId = await importAccount(env, admin.cookie, 'DeleteMe')
    const grant = await app.request(`/api/accounts/${accountId}/permissions`, authed(admin.cookie, {
      method: 'POST',
      body: JSON.stringify({ userId: viewerRow.id, canViewCode: true, canViewStatus: true }),
    }), env)
    expect(grant.status).toBeLessThan(300)

    const del = (confirmAccountName?: string) => app.request(`/api/accounts/${accountId}`, authed(admin.cookie, {
      method: 'DELETE',
      body: JSON.stringify(confirmAccountName === undefined ? {} : { confirmAccountName }),
    }), env)

    expect((await del()).status).toBe(400)
    const wrong = await del('someoneelse')
    expect(wrong.status).toBe(400)
    expect((await wrong.json() as { error: { code: string } }).error.code).toBe('confirmation_mismatch')
    const count = async (table: string) => (await env.DB
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'steam_accounts' ? 'id' : 'account_id'} = ?`)
      .bind(accountId).first<{ count: number }>())!.count
    expect(await count('steam_accounts')).toBe(1)

    // Case-insensitive, like Steam login names.
    const ok = await del(' deleteme ')
    expect(ok.status).toBe(200)
    for (const table of ['steam_accounts', 'steam_account_secrets', 'account_key_grants', 'account_permissions']) {
      expect(await count(table), table).toBe(0)
    }
    const event = await env.DB
      .prepare("SELECT metadata_json FROM audit_events WHERE action = 'account_deleted' AND account_id = ?")
      .bind(accountId).first<{ metadata_json: string }>()
    expect(JSON.parse(event!.metadata_json)).toEqual({ accountName: 'DeleteMe', steamId: '76561199000000001' })

    expect((await del('DeleteMe')).status).toBe(404)
  })

  it('keeps account deletion admin-only', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    await seedUser(env, 'viewer1', 'viewer')
    const admin = await login(env, 'admin1')
    const viewer = await login(env, 'viewer1')
    const accountId = await importAccount(env, admin.cookie, 'keepme')
    const res = await app.request(`/api/accounts/${accountId}`, authed(viewer.cookie, {
      method: 'DELETE',
      body: JSON.stringify({ confirmAccountName: 'keepme' }),
    }), env)
    expect(res.status).toBe(403)
  })
})

describe('authenticator setup flow', () => {
  function steamResponse(body: Uint8Array, eresult: number) {
    return new Response(Buffer.from(body), { status: 200, headers: { 'x-eresult': String(eresult) } })
  }

  function fakeJwt(sub: string) {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${part({ alg: 'none' })}.${part({ sub, exp: 9999999999, iat: 1, iss: 'steam', aud: ['mobile'], jti: 'x' })}.sig`
  }

  it('refuses setup when the account already has a mobile authenticator', async () => {
    const env = createTestEnv()
    await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const keys = forge.pki.rsa.generateKeyPair({ bits: 512, e: 0x10001 })
    const rsaBody = CAuthentication_GetPasswordRSAPublicKey_Response.encode({
      publickeyMod: keys.publicKey.n.toString(16),
      publickeyExp: keys.publicKey.e.toString(16),
      timestamp: 1,
    }).finish()
    const beginBody = CAuthentication_BeginAuthSessionViaCredentials_Response.encode({
      clientId: 1,
      requestId: new Uint8Array([1, 2, 3]),
      steamid: steamLong('76561198990485637'),
      allowedConfirmations: [{ confirmationType: EAuthSessionGuardType.k_EAuthSessionGuardType_DeviceCode }],
    }).finish()
    const offline = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname.endsWith('/GetPasswordRSAPublicKey/v1')) return steamResponse(rsaBody, 1)
      if (url.pathname.endsWith('/BeginAuthSessionViaCredentials/v1')) return steamResponse(beginBody, 1)
      throw new Error(`unexpected Steam call ${url.pathname}`)
    }))
    try {
      const res = await app.request('/api/authenticator/setup/begin', authed(admin.cookie, {
        method: 'POST',
        body: JSON.stringify({ accountName: 'example', password: 'pw' }),
      }), env)
      expect(res.status).toBe(409)
      const json = await res.json() as { error: { code: string } }
      expect(json.error.code).toBe('authenticator_present')
      const event = await env.DB
        .prepare("SELECT metadata_json FROM audit_events WHERE action = 'authenticator_setup_failed'")
        .first<{ metadata_json: string }>()
      expect(JSON.parse(event!.metadata_json)).toMatchObject({ code: 'authenticator_present' })
    } finally {
      vi.stubGlobal('fetch', offline)
    }
  })

  it('keeps the one-time Steam tokens when AddAuthenticator fails, so poll can be retried', async () => {
    const env = createTestEnv()
    const adminRow = await seedUser(env, 'admin1', 'admin')
    const admin = await login(env, 'admin1')
    const flow = await createEncryptedFlow(env, {
      kind: 'authenticator_setup',
      actor: toAuthUser(adminRow),
      state: {
        kind: 'setup',
        step: 'poll_tokens',
        accountName: 'example',
        clientId: '1',
        steamId: '76561198990485637',
        requestId: Buffer.from([1, 2, 3]).toString('base64'),
        interval: 2,
        allowedConfirmations: [],
        deviceId: 'android:00000000-0000-0000-0000-000000000000',
      },
    })
    const pollBody = CAuthentication_PollAuthSessionStatus_Response.encode({
      accessToken: fakeJwt('76561198990485637'),
      refreshToken: fakeJwt('76561198990485637'),
    }).finish()
    const calls: string[] = []
    const offline = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      calls.push(url.pathname.split('/')[2])
      if (url.pathname.endsWith('/PollAuthSessionStatus/v1')) return steamResponse(pollBody, 1)
      if (url.pathname.endsWith('/AddAuthenticator/v1')) return steamResponse(new Uint8Array(), 29)
      throw new Error(`unexpected Steam call ${url.pathname}`)
    }))
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await app.request(`/api/authenticator/setup/${flow.id}/poll`, authed(admin.cookie, { method: 'POST', body: '{}' }), env)
        expect(res.status).toBe(409)
        const json = await res.json() as { error: { code: string; message: string } }
        expect(json.error.code).toBe('authenticator_present')
        expect(json.error.message).toMatch(/Import its maFile/)
      }
      // Steam was polled once; the retry reused the saved tokens.
      expect(calls).toEqual(['PollAuthSessionStatus', 'AddAuthenticator', 'AddAuthenticator'])
      const saved = await loadEncryptedFlow<{ tokens?: { access_token: string } }>(env, flow.id, toAuthUser(adminRow), 'authenticator_setup')
      expect(saved.state.tokens?.access_token).toBeTruthy()
    } finally {
      vi.stubGlobal('fetch', offline)
    }
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
    const user = await seedUser(env, 'cleanup-user', 'viewer')

    await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('sess_expired', user.id, 'h1', iso(-1 * day), iso(-8 * day)),
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('sess_revoked_old', user.id, 'h2', iso(40 * day), iso(-40 * day), iso(-35 * day)),
      env.DB.prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('sess_valid', user.id, 'h3', iso(5 * day), iso(0)),
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
