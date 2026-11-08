import { z } from 'zod'
import type { SteamGuardAccount } from './account'
import { base64ToBytes } from '../crypto/encoding'
import { steamIdFromJwt } from './tokens'

// A maFile the user uploaded is unusable. The message is safe to show and to
// audit: it names fields, never their values.
export class MaFileError extends Error {}

const steamIdSchema = z.union([z.string(), z.number()]).transform(String).optional()

const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
}).partial().nullable().optional()

// Steam Desktop Authenticator (SDA) keeps the SteamID and login tokens in a
// `Session` object instead of top-level `steam_id` / `tokens`.
const sdaSessionSchema = z.object({
  SteamID: steamIdSchema,
  AccessToken: z.string().optional(),
  RefreshToken: z.string().optional(),
}).partial().nullable().optional()

const maFileSchema = z.object({
  account_name: z.string().min(1),
  steam_id: steamIdSchema,
  serial_number: z.string().default(''),
  revocation_code: z.string().default(''),
  shared_secret: z.string().min(1),
  token_gid: z.string().default(''),
  identity_secret: z.string().min(1),
  uri: z.string().default(''),
  device_id: z.string().default(''),
  secret_1: z.string().default(''),
  tokens: tokensSchema,
  Session: sdaSessionSchema,
})

// SteamIDs are 64-bit and do not fit in a JS number, so JSON.parse would round
// an unquoted `"steam_id": 76561198...` (the steamguard-cli format). Quote them
// before parsing.
function quoteSteamIds(text: string): string {
  return text.replace(/"(steam_id|SteamID)"(\s*):(\s*)(\d+)/g, '"$1"$2:$3"$4"')
}

function parseMaFileText(text: string): unknown {
  try {
    return JSON.parse(quoteSteamIds(text.replace(/^﻿/, '')))
  } catch {
    throw new MaFileError('maFile is not valid JSON. If Steam Desktop Authenticator encrypted it, turn off encryption in SDA and export it again.')
  }
}

function describeIssues(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'file'))]
  return `maFile is missing or has invalid fields: ${fields.join(', ')}`
}

function steamIdFromToken(token: string | undefined): string {
  if (!token) return ''
  try {
    return steamIdFromJwt(token)
  } catch {
    return ''
  }
}

export function parseMaFile(input: unknown): SteamGuardAccount {
  const raw = typeof input === 'string' ? parseMaFileText(input) : input
  const result = maFileSchema.safeParse(raw)
  if (!result.success) throw new MaFileError(describeIssues(result.error))
  const { Session: session, tokens: rawTokens, ...parsed } = result.data

  let sharedSecretBytes: Uint8Array
  try {
    sharedSecretBytes = base64ToBytes(parsed.shared_secret)
  } catch {
    throw new MaFileError('shared_secret is not valid base64')
  }
  if (sharedSecretBytes.length !== 20) {
    throw new MaFileError('shared_secret must decode to 20 bytes')
  }

  const accessToken = rawTokens?.access_token || session?.AccessToken
  const refreshToken = rawTokens?.refresh_token || session?.RefreshToken
  const steamId = parsed.steam_id || session?.SteamID || steamIdFromToken(accessToken || refreshToken)
  if (!/^\d+$/.test(steamId ?? '')) {
    throw new MaFileError('maFile has no SteamID (expected steam_id or Session.SteamID)')
  }

  return {
    ...parsed,
    steam_id: steamId as string,
    tokens: accessToken && refreshToken
      ? { access_token: accessToken, refresh_token: refreshToken }
      : null,
  }
}

export function serializeFullMaFile(account: SteamGuardAccount): string {
  return `${JSON.stringify(account, null, 2)}\n`
}
