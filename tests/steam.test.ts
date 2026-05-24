import { describe, expect, it, vi } from 'vitest'
import protobuf from 'protobufjs/minimal.js'
import {
  CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData,
  CAuthentication_AccessToken_GenerateForApp_Response,
  CAuthentication_GetPasswordRSAPublicKey_Response,
  EAuthTokenPlatformType,
  ESessionPersistence,
} from '../src/generated/steam-protobuf'
import { base64ToBytes } from '../src/crypto/encoding'
import { hashPassword, newAccountKey, verifyPassword } from '../src/crypto/webcrypto'
import { unwrapAccountKey, wrapAccountKey } from '../src/vault/vault'
import { generateSteamGuardCode, secondsRemaining } from '../src/steam/guard-code'
import { decodeSteamJwt, steamIdFromJwt } from '../src/steam/tokens'
import { generateConfirmationHash } from '../src/steam/confirmation-hash'
import { parseSteamQrChallenge } from '../src/steam/qr-login'
import { buildLoginApprovalSignature } from '../src/steam/login-approval-signature'
import { parseMaFile, serializeFullMaFile } from '../src/steam/mafile'
import { encryptSteamPassword } from '../src/steam/crypto/rsa-password'
import { eresultName } from '../src/steam/eresult'
import { hasUsableTokens } from '../src/steam/session-tokens'
import { refreshMobileAccessToken } from '../src/steam/token-refresh'
import { accountBlobAad } from '../src/db/accounts'
import type { SteamGuardAccount } from '../src/steam/account'
import type { Bindings } from '../src/types'

const sharedSecret = 'zvIayp3JPvtvX/QGHqsqKBk/44s='
const sampleSteamJwt = 'eyAidHlwIjogIkpXVCIsICJhbGciOiAiRWREU0EiIH0.eyAiaXNzIjogInN0ZWFtIiwgInN1YiI6ICI3NjU2MTE5OTE1NTcwNjg5MiIsICJhdWQiOiBbICJ3ZWIiLCAicmVuZXciLCAiZGVyaXZlIiBdLCAiZXhwIjogMTcwNTAxMTk1NSwgIm5iZiI6IDE2Nzg0NjQ4MzcsICJpYXQiOiAxNjg3MTA0ODM3LCAianRpIjogIjE4QzVfMjJCM0Y0MzFfQ0RGNkEiLCAib2F0IjogMTY4NzEwNDgzNywgInBlciI6IDEsICJpcF9zdWJqZWN0IjogIjY5LjEyMC4xMzYuMTI0IiwgImlwX2NvbmZpcm1lciI6ICI2OS4xMjAuMTM2LjEyNCIgfQ.7p5TPj9pGQbxIzWDDNCSP9OkKYSeDnWBE8E-M8hUrxOEPCW0XwrbDUrh199RzjPDw'

function accountWithTokens(tokens: SteamGuardAccount['tokens']): SteamGuardAccount {
  return {
    account_name: 'example',
    steam_id: '76561197960265728',
    serial_number: '123',
    revocation_code: 'R12345',
    shared_secret: sharedSecret,
    token_gid: 'gid',
    identity_secret: 'GQP46b73Ws7gr8GmZFR0sDuau5c=',
    uri: 'otpauth://totp/Steam:example',
    device_id: 'android:00000000-0000-0000-0000-000000000000',
    secret_1: '',
    tokens,
  }
}

describe('Steam deterministic ports', () => {
  it('generates Steam Guard codes from upstream fixture', async () => {
    await expect(generateSteamGuardCode(sharedSecret, 1616374841)).resolves.toBe('2F9J5')
  })

  it('reports seconds remaining in the 30s TOTP window', () => {
    expect(secondsRemaining(0)).toBe(30)
    expect(secondsRemaining(29)).toBe(1)
    expect(secondsRemaining(30)).toBe(30)
    expect(secondsRemaining(1616374841)).toBe(30 - (1616374841 % 30))
    expect(secondsRemaining(1616374841.9)).toBe(30 - (1616374841 % 30))
  })

  it('decodes Steam JWT payloads', () => {
    const decoded = decodeSteamJwt(sampleSteamJwt)
    expect(decoded.exp).toBe(1705011955)
    expect(decoded.iat).toBe(1687104837)
    expect(decoded.iss).toBe('steam')
    expect(decoded.aud).toEqual(['web', 'renew', 'derive'])
    expect(decoded.sub).toBe('76561199155706892')
    expect(decoded.jti).toBe('18C5_22B3F431_CDF6A')
  })

  it('extracts the Steam ID from a Steam JWT', () => {
    expect(steamIdFromJwt(sampleSteamJwt)).toBe('76561199155706892')
  })

  it('generates confirmation hashes from upstream fixture', async () => {
    await expect(generateConfirmationHash(1617591917, 'conf', 'GQP46b73Ws7gr8GmZFR0sDuau5c=')).resolves.toBe('NaL8EIMhfy/7vBounJ0CvpKbrPk=')
  })

  it('parses Steam QR challenge URLs', () => {
    expect(parseSteamQrChallenge('https://s.team/q/1/2372462679780599330')).toEqual({
      version: 1,
      clientId: '2372462679780599330',
    })
    expect(() => parseSteamQrChallenge('https://s.team/q/1/asdf')).toThrow()
  })

  it('rejects malformed Steam QR challenge URLs', () => {
    expect(() => parseSteamQrChallenge('https://s.team/q/1/123asdf')).toThrow('Invalid Steam QR challenge URL')
    expect(() => parseSteamQrChallenge('https://s.team/q/a/123')).toThrow('Invalid Steam QR challenge URL')
    expect(() => parseSteamQrChallenge('https://s.team/q/123a/123')).toThrow('Invalid Steam QR challenge URL')
    expect(() => parseSteamQrChallenge('https://steamcommunity.com/q/1/123')).toThrow('Invalid Steam QR host')
  })

  it('builds login approval signatures from upstream fixture', async () => {
    const signature = await buildLoginApprovalSignature(sharedSecret, 76561197960265728n, {
      version: 1,
      clientId: '2372462679780599330',
    })
    expect(Array.from(signature)).toEqual([
      56, 233, 253, 249, 254, 89, 110, 161, 18, 35, 35, 144, 14, 217, 210, 150,
      170, 110, 61, 166, 176, 161, 140, 211, 108, 78, 138, 202, 61, 52, 85, 46,
    ])
  })
})

describe('Steam helper contracts', () => {
  it('names known EResult values and falls back for unknown values', () => {
    expect(eresultName(1)).toBe('OK')
    expect(eresultName(2)).toBe('Fail')
    expect(eresultName(123456)).toBe('EResult(123456)')
  })

  it('reports whether imported accounts have refresh tokens available', () => {
    expect(hasUsableTokens(accountWithTokens({
      access_token: 'access',
      refresh_token: 'refresh',
    }))).toBe(true)
    expect(hasUsableTokens(accountWithTokens({
      access_token: 'access',
      refresh_token: '',
    }))).toBe(false)
    expect(hasUsableTokens(accountWithTokens(null))).toBe(false)
    expect(hasUsableTokens(accountWithTokens(undefined))).toBe(false)
  })

  it('refreshes mobile access tokens with the stored access token as request auth', async () => {
    const responseBody = CAuthentication_AccessToken_GenerateForApp_Response.encode(
      CAuthentication_AccessToken_GenerateForApp_Response.create({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    ).finish()
    const responseBuffer = new ArrayBuffer(responseBody.byteLength)
    new Uint8Array(responseBuffer).set(responseBody)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      expect(url.pathname).toBe('/IAuthenticationService/GenerateAccessTokenForApp/v1')
      expect(url.searchParams.get('access_token')).toBe('old-access')
      expect(url.searchParams.get('access_token')).not.toBe(sampleSteamJwt)
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeInstanceOf(FormData)
      expect((init?.body as FormData).get('input_protobuf_encoded')).toEqual(expect.any(String))
      return new Response(responseBuffer, {
        status: 200,
        headers: { 'x-eresult': '1' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(refreshMobileAccessToken({
        access_token: 'old-access',
        refresh_token: sampleSteamJwt,
      }, '76561199155706892')).resolves.toEqual({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('builds stable account blob associated data', () => {
    expect(accountBlobAad('acct_123')).toBe('account:acct_123:schema:1')
  })
})

describe('Vault and maFile foundation', () => {
  it('hashes and verifies passwords', async () => {
    const hashed = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hashed.salt, hashed.hash, hashed.scheme)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', hashed.salt, hashed.hash, hashed.scheme)).resolves.toBe(false)
  })

  it('wraps and unwraps account key grants', async () => {
    const env = {
      APP_SECRET: 'test-app-secret',
    } as Bindings
    const accountKey = newAccountKey()
    const wrapped = await wrapAccountKey(env, 'user_1', 'acct_1', accountKey)
    await expect(unwrapAccountKey(env, 'user_1', 'acct_1', wrapped)).resolves.toBe(accountKey)
    await expect(unwrapAccountKey(env, 'user_2', 'acct_1', wrapped)).rejects.toThrow()
  })

  it('parses and serializes full maFile shape', () => {
    const parsed = parseMaFile({
      account_name: 'example',
      steam_id: '76561197960265728',
      serial_number: '123',
      revocation_code: 'R12345',
      shared_secret: sharedSecret,
      token_gid: 'gid',
      identity_secret: 'GQP46b73Ws7gr8GmZFR0sDuau5c=',
      uri: 'otpauth://totp/Steam:example',
      device_id: 'android:00000000-0000-0000-0000-000000000000',
      secret_1: '',
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
      },
    })
    const exported = serializeFullMaFile(parsed)
    expect(exported).toContain('"shared_secret": "zvIayp3JPvtvX/QGHqsqKBk/44s="')
    expect(exported).toContain('"refresh_token": "refresh"')
  })
})

describe('Generated protobuf', () => {
  it('encodes credential auth requests with a pure protobuf writer', () => {
    const request = CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData.create({
      accountName: 'example',
      encryptedPassword: 'A'.repeat(344),
      encryptionTimestamp: 123456,
      persistence: ESessionPersistence.k_ESessionPersistence_Persistent,
      platformType: EAuthTokenPlatformType.k_EAuthTokenPlatformType_MobileApp,
      deviceDetails: {
        deviceFriendlyName: 'SteamGuard Web',
        platformType: EAuthTokenPlatformType.k_EAuthTokenPlatformType_MobileApp,
        osType: -500,
        gamingDeviceType: 528,
      },
      language: 0,
      qosLevel: 2,
    })
    const encoded = CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData
      .encode(request, new protobuf.Writer())
      .finish()
    const decoded = CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData.decode(encoded)
    expect(decoded.encryptedPassword).toBe(request.encryptedPassword)
    expect(decoded.deviceDetails?.deviceFriendlyName).toBe('SteamGuard Web')
  })

  it('RSA-encrypts Steam passwords as base64 text', () => {
    const encrypted = encryptSteamPassword('F'.repeat(512), '010001', 'password')
    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(encrypted).toHaveLength(344)
  })

  it('decodes and re-encodes a Steam auth response fixture', () => {
    const sample = 'CoAEYjYyMGI1ZWNhMWIxMjgyYjkxYzZkZmZkYWFhOWI0ODI0YjlhNmRiYmEyZDVmYjc0ODcxNDczZDc1MDYxNGEzNWM4ODQ3NDYzZTEyNjAwNTJmNzZlNTYxMDM5ODdlN2U3NGJkMWZjZGRjYWJhMDVmZGM5OTBjMWIyNmQ2ZDg5MGM2MTEzZmRkNTZmMmQ1YmZjNzU4ODhlMzZhNTM2NjM3N2IzZTE3ZTJiZWM5MjhlNGY4MmE1YzY0NGYxZTZlMTk3NzZkNjIzMDIxYjhmYTA0MGRjNWE5YjY0M2I0N2I5YmVhMjM2YmEyZjM4ODVjM2ZlNWVhNjMzZThlNjJjNGE1YTY4NjNmMzNiMzdlMTQ4M2MwZTUzZTg4ODIzMGFkNTVjNzg5ZmU4Y2NkMjVjNzdiMTkxOTg0ZThjN2JmNWYzNzY2MjI0OGI1NWVmOWM1OGY3NDM5YjA4ZjNhNWJiNzljNTc5ZDE5M2I3NzhmMzFiY2IwYTA3MmVhZWYxOGEyYjljZDY2M2VmYmY2YmRiZDU3MGEyMTNiOTIxNTc4ODk0MjJkMDY3ODFiNTVkY2VjYjQ4NjA4MjUyMmUzZWQyOWM4MjExYzQ5N2Q1YjNhYTk2OGM2MDY1YWFhZTNhNGVmYzZiMGJjNDYyMzMxNmVmYTUxN2JjNzRiZDYzODcxMWU4ZWYSBjAxMDAwMRiQn6Ly3wk='
    const decoded = CAuthentication_GetPasswordRSAPublicKey_Response.decode(base64ToBytes(sample))
    expect(decoded.publickeyExp).toBe('010001')
    const encoded = CAuthentication_GetPasswordRSAPublicKey_Response.encode(decoded).finish()
    expect(Array.from(encoded)).toEqual(Array.from(base64ToBytes(sample)))
  })
})
