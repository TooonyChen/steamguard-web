import { base64ToBytes, bytesToBase64, concatBytes, u64be, utf8ToBytes } from '../crypto/encoding'
import { hmacBytes } from '../crypto/webcrypto'

export async function generateConfirmationHash(time: number, tag: string, identitySecretB64: string): Promise<string> {
  const secret = base64ToBytes(identitySecretB64)
  const hash = await hmacBytes(secret, concatBytes(u64be(time), utf8ToBytes(tag)), 'SHA-1')
  return bytesToBase64(hash)
}
