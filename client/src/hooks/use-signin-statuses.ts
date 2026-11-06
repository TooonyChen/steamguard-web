import { useCallback, useEffect, useMemo, useState } from "react"

import { api } from "@/api"
import type { Account, SteamLoginState, SteamLoginStatus } from "@/types"

/** States where the account cannot act on Steam until someone signs in again. */
export function needsSignin(state: SteamLoginState | undefined) {
  return state === "missing" || state === "invalid"
}

/**
 * Stored Steam sign-in status per account (admin only). The status route only
 * decrypts what is stored and does not call Steam, so it is cheap to load once
 * for the nav badge and the Codes page warnings.
 */
export function useSigninStatuses(accounts: Account[], enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, SteamLoginStatus>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const accountKey = useMemo(() => accounts.map((account) => account.id).join("|"), [accounts])

  const reload = useCallback(async () => {
    if (!enabled) {
      setStatuses({})
      return
    }
    setLoading(true)
    setError(null)
    try {
      const entries = await Promise.all(
        accounts.map(async (account) => {
          const data = await api<{ steamLogin: SteamLoginStatus }>(
            `/api/accounts/${account.id}/steam-login/status`,
          )
          return [account.id, data.steamLogin] as const
        }),
      )
      setStatuses(Object.fromEntries(entries))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status request failed")
    } finally {
      setLoading(false)
    }
    // accountKey collapses account identity changes into one stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  const setStatus = useCallback((accountId: string, status: SteamLoginStatus) => {
    setStatuses((current) => ({ ...current, [accountId]: status }))
  }, [])

  const attention = useMemo(
    () => accounts.filter((account) => needsSignin(statuses[account.id]?.state)).length,
    [accounts, statuses],
  )

  return { statuses, setStatus, reload, loading, error, attention }
}

export type SigninStatuses = ReturnType<typeof useSigninStatuses>
