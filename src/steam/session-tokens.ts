import type { Bindings } from '../types'
import type { SteamGuardAccount } from './account'
import { decodeSteamJwt } from './tokens'
import { deriveMobileAccessToken } from './token-refresh'
import { saveAccountSecret } from '../db/accounts'

export function hasUsableTokens(account: SteamGuardAccount): boolean {
  return Boolean(account.tokens?.refresh_token)
}

export async function ensureMobileAccessToken(env: Bindings, accountId: string, accountKey: string, account: SteamGuardAccount): Promise<string> {
  if (!account.tokens?.refresh_token) {
    throw new Error('Steam account has no stored refresh token; run setup, transfer, or import a Full maFile with tokens')
  }
  const accessToken = account.tokens.access_token
  if (accessToken) {
    try {
      const decoded = decodeSteamJwt(accessToken)
      if (decoded.exp > Math.floor(Date.now() / 1000) + 60) return accessToken
    } catch {
      // fall through to refresh
    }
  }
  const refreshed = await deriveMobileAccessToken(account.tokens.refresh_token)
  account.tokens = {
    access_token: refreshed,
    refresh_token: account.tokens.refresh_token,
  }
  await saveAccountSecret(env, accountId, accountKey, account)
  return refreshed
}

