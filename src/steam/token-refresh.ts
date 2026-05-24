import { decodeSteamJwt } from './tokens'
import { generateAccessTokenForApp } from './authentication-client'
import Long from 'long'
import type { SteamTokens } from './account'

export async function refreshMobileAccessToken(tokens: SteamTokens, steamId?: string | number): Promise<SteamTokens> {
  const jwt = decodeSteamJwt(tokens.refresh_token)
  const response = await generateAccessTokenForApp({
    refreshToken: tokens.refresh_token,
    steamid: Long.fromString(String(steamId || jwt.sub), true),
    renewalType: 1,
  }, tokens.access_token)
  if (!response.response.accessToken) {
    throw new Error('Steam did not return an access token')
  }
  return {
    access_token: response.response.accessToken,
    refresh_token: response.response.refreshToken || tokens.refresh_token,
  }
}
