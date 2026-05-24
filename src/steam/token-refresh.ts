import { decodeSteamJwt } from './tokens'
import { generateAccessTokenForApp } from './authentication-client'
import Long from 'long'

export async function deriveMobileAccessToken(refreshToken: string): Promise<string> {
  const jwt = decodeSteamJwt(refreshToken)
  const response = await generateAccessTokenForApp({
    refreshToken,
    steamid: Long.fromString(jwt.sub, true),
    renewalType: 1,
  }, refreshToken)
  if (!response.response.accessToken) {
    throw new Error('Steam did not return an access token')
  }
  return response.response.accessToken
}
