import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/http/app'
import { createUser } from '../src/db/queries'
import { hashPassword } from '../src/crypto/webcrypto'
import { refreshStaleAvatars } from '../src/db/avatars'
import { isSteamId64, parseProfileAvatarHash, steamAvatarUrl } from '../src/steam/profile'
import { createTestEnv } from './helpers/d1'
import type { Bindings } from '../src/types'

const app = createApp()
const PASSWORD = 'correct-horse-battery'
const STEAM_ID = '76561199000000001'
const HASH = 'c5d56249ee5d28a07db4ac9f7f60af961fab5426'
const OTHER_HASH = '0123456789abcdef0123456789abcdef01234567'

function profileXml(hash: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
  <steamID64>${STEAM_ID}</steamID64>
  <privacyState>friendsonly</privacyState>
  <avatarIcon><![CDATA[https://avatars.fastly.steamstatic.com/${hash}.jpg]]></avatarIcon>
  <avatarMedium><![CDATA[https://avatars.fastly.steamstatic.com/${hash}_medium.jpg]]></avatarMedium>
  <avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/${hash}_full.jpg]]></avatarFull>
</profile>`
}

describe('steam profile parsing', () => {
  it('extracts the avatar hash from the XML profile feed', () => {
    expect(parseProfileAvatarHash(profileXml(HASH))).toBe(HASH)
  })

  it('treats Steam\'s placeholder avatar and missing profiles as no avatar', () => {
    expect(parseProfileAvatarHash(profileXml('fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb'))).toBeNull()
    expect(parseProfileAvatarHash('<response><error><![CDATA[The specified profile could not be found.]]></error></response>')).toBeNull()
  })

  it('builds avatar URLs only from well-formed hashes', () => {
    expect(steamAvatarUrl(HASH)).toBe(`https://avatars.steamstatic.com/${HASH}_full.jpg`)
    expect(steamAvatarUrl('../evil')).toBeNull()
    expect(steamAvatarUrl(null)).toBeNull()
  })

  it('accepts only SteamID64 values', () => {
    expect(isSteamId64(STEAM_ID)).toBe(true)
    expect(isSteamId64('')).toBe(false)
    expect(isSteamId64('76561199000000001/../x')).toBe(false)
  })
})

describe('account avatars over HTTP', () => {
  let hashed: { hash: string; salt: string; scheme: string }

  beforeAll(async () => {
    hashed = await hashPassword(PASSWORD)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubProfile(hash: string | Error) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://steamcommunity.com/profiles/')) {
        if (hash instanceof Error) throw hash
        return new Response(profileXml(hash), { status: 200, headers: { 'content-type': 'text/xml' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function adminWithAccount(env: Bindings): Promise<{ cookie: string; accountId: string }> {
    await createUser(env, { username: 'admin', role: 'admin', passwordHash: hashed.hash, passwordSalt: hashed.salt, passwordScheme: hashed.scheme })
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    }, env)
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? ''
    const res = await app.request('/api/accounts/import-mafile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        maFile: {
          account_name: 'avataraccount',
          steam_id: STEAM_ID,
          shared_secret: Buffer.alloc(20, 7).toString('base64'),
          identity_secret: Buffer.alloc(20, 9).toString('base64'),
          revocation_code: 'R12345',
        },
      }),
    }, env)
    expect(res.status).toBe(201)
    const body = await res.json() as { data: { account: { id: string } } }
    return { cookie, accountId: body.data.account.id }
  }

  async function listAvatars(env: Bindings, cookie: string): Promise<(string | null)[]> {
    const res = await app.request('/api/accounts', { headers: { cookie } }, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { accounts: { avatarUrl: string | null }[] } }
    return body.data.accounts.map((account) => account.avatarUrl)
  }

  it('looks up a new account\'s avatar once and serves it from the cache after', async () => {
    const env = createTestEnv()
    const fetchMock = stubProfile(HASH)
    const { cookie } = await adminWithAccount(env)

    expect(await listAvatars(env, cookie)).toEqual([`https://avatars.steamstatic.com/${HASH}_full.jpg`])
    expect(await listAvatars(env, cookie)).toEqual([`https://avatars.steamstatic.com/${HASH}_full.jpg`])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://steamcommunity.com/profiles/${STEAM_ID}/?xml=1`)
  })

  it('still lists accounts when Steam is unreachable, without retrying on every request', async () => {
    const env = createTestEnv()
    const fetchMock = stubProfile(new Error('network down'))
    const { cookie } = await adminWithAccount(env)

    expect(await listAvatars(env, cookie)).toEqual([null])
    expect(await listAvatars(env, cookie)).toEqual([null])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cron refresh picks up avatar changes on stale rows', async () => {
    const env = createTestEnv()
    stubProfile(HASH)
    const { cookie, accountId } = await adminWithAccount(env)
    await listAvatars(env, cookie)

    // Fresh rows are left alone.
    stubProfile(OTHER_HASH)
    expect(await refreshStaleAvatars(env)).toEqual({ checked: 0 })

    await env.DB.prepare('UPDATE steam_accounts SET avatar_checked_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 2 * 24 * 3600_000).toISOString(), accountId).run()
    expect(await refreshStaleAvatars(env)).toEqual({ checked: 1 })
    expect(await listAvatars(env, cookie)).toEqual([`https://avatars.steamstatic.com/${OTHER_HASH}_full.jpg`])
  })
})
