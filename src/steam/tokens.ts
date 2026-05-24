import { base64UrlToBytes, bytesToUtf8 } from '../crypto/encoding'

export type SteamJwtData = {
  exp: number
  iat: number
  iss: string
  aud: string[]
  sub: string
  jti: string
}

export function decodeSteamJwt(jwt: string): SteamJwtData {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  return JSON.parse(bytesToUtf8(base64UrlToBytes(parts[1]))) as SteamJwtData
}

export function steamIdFromJwt(jwt: string): string {
  return decodeSteamJwt(jwt).sub
}
