import { z } from 'zod'
import type { SteamGuardAccount } from './account'
import { base64ToBytes } from '../crypto/encoding'

const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
}).partial().nullable().optional()

const maFileSchema = z.object({
  account_name: z.string().min(1),
  steam_id: z.union([z.string(), z.number()]),
  serial_number: z.string().default(''),
  revocation_code: z.string().default(''),
  shared_secret: z.string().min(1),
  token_gid: z.string().default(''),
  identity_secret: z.string().min(1),
  uri: z.string().default(''),
  device_id: z.string().default(''),
  secret_1: z.string().default(''),
  tokens: tokensSchema,
})

export function parseMaFile(input: unknown): SteamGuardAccount {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  const parsed = maFileSchema.parse(raw)
  if (base64ToBytes(parsed.shared_secret).length !== 20) {
    throw new Error('shared_secret must decode to 20 bytes')
  }
  return {
    ...parsed,
    steam_id: String(parsed.steam_id),
    tokens: parsed.tokens && parsed.tokens.access_token && parsed.tokens.refresh_token
      ? {
          access_token: parsed.tokens.access_token,
          refresh_token: parsed.tokens.refresh_token,
        }
      : null,
  }
}

export function serializeFullMaFile(account: SteamGuardAccount): string {
  return `${JSON.stringify(account, null, 2)}\n`
}
