import forge from 'node-forge'
import { bytesToBase64 } from '../../crypto/encoding'

export function encryptSteamPassword(publickeyModHex: string, publickeyExpHex: string, password: string): string {
  const n = new forge.jsbn.BigInteger(publickeyModHex, 16)
  const e = new forge.jsbn.BigInteger(publickeyExpHex, 16)
  const publicKey = forge.pki.setRsaPublicKey(n, e)
  const encrypted = publicKey.encrypt(password, 'RSAES-PKCS1-V1_5')
  return bytesToBase64(Uint8Array.from(encrypted, (char) => char.charCodeAt(0)))
}
