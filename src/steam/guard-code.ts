import { base64ToBytes, u64be } from '../crypto/encoding'
import { hmacBytes } from '../crypto/webcrypto'

const STEAM_GUARD_CHARS = '23456789BCDFGHJKMNPQRTVWXY'

export async function generateSteamGuardCode(sharedSecretB64: string, unixTime: number): Promise<string> {
  const sharedSecret = base64ToBytes(sharedSecretB64)
  const timeBytes = u64be(Math.floor(unixTime / 30))
  const hashed = await hmacBytes(sharedSecret, timeBytes, 'SHA-1')
  const offset = hashed[19] & 0x0f
  let codePoint =
    ((hashed[offset] & 0x7f) << 24) |
    (hashed[offset + 1] << 16) |
    (hashed[offset + 2] << 8) |
    hashed[offset + 3]

  let code = ''
  for (let i = 0; i < 5; i += 1) {
    code += STEAM_GUARD_CHARS[codePoint % STEAM_GUARD_CHARS.length]
    codePoint = Math.floor(codePoint / STEAM_GUARD_CHARS.length)
  }
  return code
}

export function secondsRemaining(unixTime: number): number {
  return 30 - (Math.floor(unixTime) % 30)
}
