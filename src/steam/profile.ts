// Public Steam Community profile lookups. These need no tokens: the XML profile
// feed returns the avatar even for private and friends-only profiles.

const PROFILE_BASE = 'https://steamcommunity.com/profiles'
const AVATAR_BASE = 'https://avatars.steamstatic.com'

// Steam's grey "?" placeholder. Treated as "no avatar" so the UI shows its own fallback.
const DEFAULT_AVATAR_HASH = 'fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb'

const STEAM_ID_64 = /^7656\d{13}$/
const AVATAR_HASH = /^[0-9a-f]{40}$/

export function isSteamId64(value: string | null | undefined): value is string {
  return typeof value === 'string' && STEAM_ID_64.test(value)
}

export function steamAvatarUrl(hash: string | null | undefined): string | null {
  if (!hash || !AVATAR_HASH.test(hash)) return null
  return `${AVATAR_BASE}/${hash}_full.jpg`
}

/** Pulls the avatar hash out of a `?xml=1` profile document. Returns null when there is none. */
export function parseProfileAvatarHash(xml: string): string | null {
  const block = /<avatarFull>([\s\S]*?)<\/avatarFull>/.exec(xml)?.[1]
  if (!block) return null
  const hash = /\/([0-9a-f]{40})(?:_full)?\.(?:jpg|png|gif)/i.exec(block)?.[1]?.toLowerCase()
  if (!hash || hash === DEFAULT_AVATAR_HASH) return null
  return hash
}

/**
 * Fetches the current avatar hash for a SteamID64. Resolves to null when the
 * profile has no custom avatar or does not exist; throws on network/HTTP errors.
 */
export async function fetchSteamAvatarHash(steamId: string, options: { signal?: AbortSignal } = {}): Promise<string | null> {
  if (!isSteamId64(steamId)) return null
  const response = await fetch(`${PROFILE_BASE}/${steamId}/?xml=1`, {
    headers: { accept: 'text/xml' },
    redirect: 'follow',
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`Steam profile HTTP ${response.status}`)
  return parseProfileAvatarHash(await response.text())
}
