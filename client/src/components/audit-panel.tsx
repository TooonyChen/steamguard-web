import { useEffect, useMemo, useState } from "react"
import { RefreshCwIcon } from "lucide-react"

import { api } from "@/api"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import type { Account } from "@/types"

type AuditEvent = {
  id: string
  actor_user_id: string | null
  account_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  outcome: string
  metadata_json: string | null
  created_at: string
}

/** "account_code_viewed" -> "Account code viewed" */
function humanizeAction(action: string) {
  const text = action.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function shortId(id: string | null) {
  if (!id) return null
  const [prefix, rest] = id.split("_", 2)
  return rest ? `${prefix}_${rest.slice(0, 8)}` : id.slice(0, 12)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
}

export function AuditPanel({ accounts }: { accounts: Account[] }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.accountName])),
    [accounts],
  )

  async function load(before?: string) {
    setLoading(true)
    setMessage(null)
    try {
      const query = before ? `?before=${encodeURIComponent(before)}` : ""
      const data = await api<{ events: AuditEvent[]; nextBefore: string | null }>(`/api/admin/audit${query}`)
      setEvents((current) => (before ? [...current, ...data.events] : data.events))
      setNextBefore(data.nextBefore)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Audit load failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security-relevant events, newest first."
        actions={
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />
      {message ? <FieldError>{message}</FieldError> : null}
      <section aria-label="Audit events" className="overflow-hidden rounded-[14px] border bg-card">
        {events.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {loading ? "Loading events…" : "No audit events."}
          </p>
        ) : (
          <ol>
            {events.map((event, index) => {
              const accountName = event.account_id
                ? accountNames.get(event.account_id) ?? shortId(event.account_id)
                : null
              const failed = event.outcome !== "success"
              return (
                <li key={event.id} className={cn("px-4 py-3 md:px-5", index > 0 && "border-t")}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={cn("font-medium", failed && "text-destructive")}>
                        {humanizeAction(event.action)}
                      </span>
                      {accountName ? <span className="text-sm text-muted-foreground">{accountName}</span> : null}
                      {failed ? (
                        <span className="rounded-full bg-destructive/15 px-2 text-xs leading-[18px] text-destructive">
                          {event.outcome}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-subtle tabular-nums">{formatTime(event.created_at)}</span>
                    </summary>
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </details>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      {nextBefore ? (
        <Button
          type="button"
          variant="secondary"
          className="self-center"
          disabled={loading}
          onClick={() => void load(nextBefore)}
        >
          {loading ? "Loading" : "Load older events"}
        </Button>
      ) : null}
    </>
  )
}
