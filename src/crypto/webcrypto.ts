import type { EncryptedPayload } from '../types'
import { base64ToBytes, bytesToBase64, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from './encoding'

// Cloudflare Workers' WebCrypto caps PBKDF2 iterations at 100_000.
// See https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
const PASSWORD_ITERATIONS = 100_000
const PASSWORD_SCHEME = `pbkdf2-sha256:${PASSWORD_ITERATIONS}`

export function nowIso(): string {
  return new Date().toISOString()
}

export function randomId(prefix = ''): string {
  return `${prefix}${crypto.randomUUID()}`
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

export function randomToken(): string {
  return bytesToBase64Url(randomBytes(32))
}

async function importRawKey(bytes: Uint8Array, usages: KeyUsage[], name = 'AES-GCM'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(bytes), { name }, false, usages)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, lengthBits: number, hash = 'SHA-256'): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(utf8ToBytes(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash }, baseKey, lengthBits)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<{
  hash: string
  salt: string
  scheme: string
}> {
  const derived = await pbkdf2(password, salt, PASSWORD_ITERATIONS, 256)
  return {
    hash: bytesToBase64(derived),
    salt: bytesToBase64(salt),
    scheme: PASSWORD_SCHEME,
  }
}

export async function verifyPassword(password: string, saltB64: string, expectedHashB64: string, scheme: string): Promise<boolean> {
  const [, rawIterations] = scheme.split(':')
  const iterations = Number(rawIterations || PASSWORD_ITERATIONS)
  const derived = await pbkdf2(password, base64ToBytes(saltB64), iterations, 256)
  const expected = base64ToBytes(expectedHashB64)
  if (derived.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < derived.length; i += 1) diff |= derived[i] ^ expected[i]
  return diff === 0
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(utf8ToBytes(input)))
  return bytesToBase64Url(new Uint8Array(digest))
}

// Legacy v1 derivation. APP_SECRET is a high-entropy machine secret, so the
// PBKDF2 stretching bought nothing over a single-pass KDF while costing 100k
// iterations on every secret-backed request. Kept decrypt-only for payloads
// written before the v2 (HKDF) migration.
async function deriveSecretKeyPbkdf2V1(secret: string, purpose: string): Promise<Uint8Array> {
  return pbkdf2(secret, utf8ToBytes(`steamguard-web:${purpose}`), 100_000, 256)
}

async function deriveSecretKeyHkdfV2(secret: string, purpose: string): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(utf8ToBytes(secret)), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(utf8ToBytes('steamguard-web:hkdf:v2')),
      info: toArrayBuffer(utf8ToBytes(`steamguard-web:${purpose}`)),
    },
    baseKey,
    256,
  )
  return new Uint8Array(bits)
}

async function deriveSecretKey(secret: string, purpose: string, version: EncryptedPayload['v']): Promise<Uint8Array> {
  if (version === 1) return deriveSecretKeyPbkdf2V1(secret, purpose)
  return deriveSecretKeyHkdfV2(secret, purpose)
}

async function encryptJsonWithVersion(secret: string, purpose: string, value: unknown, aad: string | undefined, version: EncryptedPayload['v']): Promise<string> {
  const keyBytes = await deriveSecretKey(secret, purpose, version)
  const key = await importRawKey(keyBytes, ['encrypt'])
  const nonce = randomBytes(12)
  const payload = utf8ToBytes(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: aad ? toArrayBuffer(utf8ToBytes(aad)) : undefined },
    key,
    toArrayBuffer(payload),
  )
  const encrypted: EncryptedPayload = {
    v: version,
    alg: 'AES-256-GCM',
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(encrypted)
}

export async function encryptJson(secret: string, purpose: string, value: unknown, aad?: string): Promise<string> {
  return encryptJsonWithVersion(secret, purpose, value, aad, 2)
}

// Only for tests and migration tooling: writes the legacy PBKDF2-derived format.
export async function encryptJsonLegacyV1(secret: string, purpose: string, value: unknown, aad?: string): Promise<string> {
  return encryptJsonWithVersion(secret, purpose, value, aad, 1)
}

export function encryptedPayloadVersion(encryptedText: string): EncryptedPayload['v'] {
  return (JSON.parse(encryptedText) as EncryptedPayload).v
}

export async function decryptJson<T>(secret: string, purpose: string, encryptedText: string, aad?: string): Promise<T> {
  const encrypted = JSON.parse(encryptedText) as EncryptedPayload
  if (encrypted.v !== 1 && encrypted.v !== 2) throw new Error(`Unsupported encrypted payload version: ${encrypted.v}`)
  const keyBytes = await deriveSecretKey(secret, purpose, encrypted.v)
  const key = await importRawKey(keyBytes, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(encrypted.nonce)), additionalData: aad ? toArrayBuffer(utf8ToBytes(aad)) : undefined },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  )
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext))) as T
}

export async function encryptWithRawKey(keyB64: string, value: unknown, aad?: string): Promise<string> {
  const key = await importRawKey(base64ToBytes(keyB64), ['encrypt'])
  const nonce = randomBytes(12)
  const plaintext = utf8ToBytes(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: aad ? toArrayBuffer(utf8ToBytes(aad)) : undefined },
    key,
    toArrayBuffer(plaintext),
  )
  return JSON.stringify({
    v: 1,
    alg: 'AES-256-GCM',
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  } satisfies EncryptedPayload)
}

export async function decryptWithRawKey<T>(keyB64: string, encryptedText: string, aad?: string): Promise<T> {
  const encrypted = JSON.parse(encryptedText) as EncryptedPayload
  const key = await importRawKey(base64ToBytes(keyB64), ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(encrypted.nonce)), additionalData: aad ? toArrayBuffer(utf8ToBytes(aad)) : undefined },
    key,
    toArrayBuffer(base64ToBytes(encrypted.ciphertext)),
  )
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext))) as T
}

export async function hmacBytes(secret: Uint8Array, data: Uint8Array, hash: 'SHA-1' | 'SHA-256'): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(secret), { name: 'HMAC', hash }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, toArrayBuffer(data)))
}

export function newAccountKey(): string {
  return bytesToBase64(randomBytes(32))
}
