import type { Bindings, SteamAccountRow } from '../types'
import { nowIso } from '../crypto/webcrypto'
import { fetchSteamAvatarHash, isSteamId64 } from '../steam/profile'

// One Steam lookup should never hold up the account list for long.
const LOOKUP_TIMEOUT_MS = 4000
// Lookups done while serving a request; the cron picks up anything left over.
const INLINE_LOOKUP_LIMIT = 10
// The daily cron refreshes avatars older than this.
const STALE_AFTER_MS = 20 * 3600_000
const CRON_LOOKUP_LIMIT = 200
const CRON_CONCURRENCY = 4

type AvatarTarget = Pick<SteamAccountRow, 'id' | 'steam_id'>

/**
 * Looks up and stores the avatar for one account. A failed lookup still records
 * avatar_checked_at (keeping the previous hash) so a Steam outage does not slow
 * every list request; the next cron run retries it.
 */
async function refreshOne(env: Bindings, account: AvatarTarget): Promise<string | null | undefined> {
  if (!isSteamId64(account.steam_id)) return undefined
  const checkedAt = nowIso()
  try {
    const hash = await fetchSteamAvatarHash(account.steam_id, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
    await env.DB
      .prepare('UPDATE steam_accounts SET avatar_hash = ?, avatar_checked_at = ? WHERE id = ? AND steam_id = ?')
      .bind(hash, checkedAt, account.id, account.steam_id)
      .run()
    return hash
  } catch (error) {
    console.warn('steam avatar lookup failed', account.id, error instanceof Error ? error.message : String(error))
    await env.DB
      .prepare('UPDATE steam_accounts SET avatar_checked_at = ? WHERE id = ? AND steam_id = ?')
      .bind(checkedAt, account.id, account.steam_id)
      .run()
    return undefined
  }
}

/**
 * Fills in avatars for accounts that have never been looked up, mutating the
 * passed rows so the caller can return them straight away.
 */
export async function fillMissingAvatars(env: Bindings, rows: SteamAccountRow[]): Promise<void> {
  const pending = rows
    .filter((row) => row.avatar_checked_at == null && isSteamId64(row.steam_id))
    .slice(0, INLINE_LOOKUP_LIMIT)
  await Promise.all(pending.map(async (row) => {
    const hash = await refreshOne(env, row)
    if (hash !== undefined) row.avatar_hash = hash
    row.avatar_checked_at = nowIso()
  }))
}

/** Cron entry point: refresh avatars that were never checked or are older than a day. */
export async function refreshStaleAvatars(env: Bindings): Promise<{ checked: number }> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString()
  const { results = [] } = await env.DB
    .prepare(
      `SELECT id, steam_id FROM steam_accounts
       WHERE steam_id IS NOT NULL AND steam_id != ''
         AND (avatar_checked_at IS NULL OR avatar_checked_at <= ?)
       ORDER BY avatar_checked_at IS NOT NULL, avatar_checked_at
       LIMIT ?`,
    )
    .bind(cutoff, CRON_LOOKUP_LIMIT)
    .all<AvatarTarget>()
  const queue = [...results]
  let checked = 0
  await Promise.all(Array.from({ length: CRON_CONCURRENCY }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await refreshOne(env, next)
      checked += 1
    }
  }))
  return { checked }
}
