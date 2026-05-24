import { base64ToBytes, concatBytes, u16le, u64le } from '../crypto/encoding'
import { hmacBytes } from '../crypto/webcrypto'

export async function buildLoginApprovalSignature(
  sharedSecretB64: string,
  steamId: string | number | bigint,
  challenge: { version: number; clientId: string | number | bigint },
): Promise<Uint8Array> {
  return hmacBytes(
    base64ToBytes(sharedSecretB64),
    concatBytes(u16le(challenge.version), u64le(BigInt(challenge.clientId)), u64le(BigInt(steamId))),
    'SHA-256',
  )
}
