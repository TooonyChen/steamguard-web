import { useCallback, useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, EyeIcon } from "lucide-react"

import { api } from "@/api"
import { cn, copyToClipboard } from "@/lib/utils"

const CODE_PERIOD_SECONDS = 30

type CodeResponse = {
  code: string
  secondsRemaining: number
  serverTimeSource: string
}

/**
 * The Steam mobile Guard screen, as a card block: a large live code with a
 * draining time bar underneath. Revealing fetches the code; while revealed it
 * ticks down each second and silently fetches the next code on expiry.
 * Clicking the code copies it.
 */
export function LiveCode({ accountId }: { accountId: string }) {
  const [state, setState] = useState<CodeResponse | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCode = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<CodeResponse>(`/api/accounts/${accountId}/code`)
      setState(data)
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load code")
      setState(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (!revealed) return
    const timer = setInterval(() => {
      setState((current) => {
        if (!current) return current
        if (current.secondsRemaining <= 1) {
          void fetchCode()
          return current
        }
        return { ...current, secondsRemaining: current.secondsRemaining - 1 }
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [revealed, fetchCode])

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])

  async function copyCode(code: string) {
    const ok = await copyToClipboard(code)
    if (!ok) return
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  async function reveal() {
    setRevealed(true)
    const data = await fetchCode()
    if (data) void copyCode(data.code)
  }

  const expiring = state !== null && state.secondsRemaining <= 7
  const fraction = state
    ? Math.max(0, Math.min(1, state.secondsRemaining / CODE_PERIOD_SECONDS))
    : 0

  if (!revealed || (!state && !loading)) {
    return (
      <button
        type="button"
        onClick={() => void reveal()}
        className="group flex w-full items-center justify-between rounded-lg border border-dashed bg-background/60 px-4 py-3 text-left transition-colors hover:border-guard/40 hover:bg-guard/5"
      >
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Steam Guard code
          </p>
          <p className="code-digits mt-1 text-3xl text-muted-foreground/40 select-none">
            •••••
          </p>
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-guard">
          <EyeIcon className="size-3.5" />
          {error ? "Retry" : "Reveal"}
        </span>
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-background/60">
      <button
        type="button"
        onClick={() => state && void copyCode(state.code)}
        disabled={!state}
        className="group flex w-full items-center justify-between px-4 py-3 text-left"
        aria-label="Copy Steam Guard code"
      >
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Steam Guard code
          </p>
          <p
            className={cn(
              "code-digits mt-1 text-3xl transition-colors",
              state ? (expiring ? "text-warning" : "text-guard") : "text-muted-foreground/40",
            )}
          >
            {state ? state.code : "•••••"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            {copied ? (
              <>
                <CheckIcon className="size-3.5 text-guard" />
                <span className="text-guard">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon className="size-3.5" />
                Copy
              </>
            )}
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              expiring ? "text-warning" : "text-muted-foreground",
            )}
          >
            {state ? `${state.secondsRemaining}s` : "…"}
          </span>
        </div>
      </button>
      <div className="h-1 overflow-hidden rounded-b-lg bg-muted/60">
        <div
          className={cn(
            "h-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
            expiring ? "bg-warning" : "bg-guard",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
