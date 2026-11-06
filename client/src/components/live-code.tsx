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

type LiveCodeState = {
  code: string
  /** Wall-clock ms (Date.now) when this code stops being valid. */
  expiresAt: number
}

const TICK_MS = 250

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
}

/**
 * The Steam mobile Guard screen, as a card block: a large live code with a
 * draining time bar underneath. Revealing fetches the code; while revealed it
 * ticks down and fetches the next code on expiry. Clicking the code copies it.
 *
 * The countdown is derived from an absolute expiry time, not by decrementing
 * a counter per tick. Browsers throttle or pause timers in background tabs,
 * so a per-tick counter freezes; the wall clock does not. When the page comes
 * back into view we re-read the clock right away and refetch if the code has
 * expired. While hidden we never refetch: each fetch is an audited code view.
 */
export function LiveCode({ accountId }: { accountId: string }) {
  const [state, setState] = useState<LiveCodeState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [visible, setVisible] = useState(isPageVisible)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<LiveCodeState | null> | null>(null)

  const fetchCode = useCallback(() => {
    if (inflight.current) return inflight.current
    setLoading(true)
    setError(null)
    const request = (async () => {
      try {
        const data = await api<CodeResponse>(`/api/accounts/${accountId}/code`)
        const fetchedAt = Date.now()
        const next = {
          code: data.code,
          expiresAt: fetchedAt + data.secondsRemaining * 1000,
        }
        setState(next)
        setNow(fetchedAt)
        return next
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load code")
        setState(null)
        return null
      } finally {
        inflight.current = null
        setLoading(false)
      }
    })()
    inflight.current = request
    return request
  }, [accountId])

  // Clock: tick while revealed, and re-sync the moment the page is shown
  // again (a resumed tab may not fire its interval for a while).
  useEffect(() => {
    if (!revealed) return
    const sync = () => {
      setVisible(isPageVisible())
      setNow(Date.now())
    }
    sync()
    const timer = setInterval(sync, TICK_MS)
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", sync)
    window.addEventListener("pageshow", sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("focus", sync)
      window.removeEventListener("pageshow", sync)
    }
  }, [revealed])

  const expired = state !== null && now >= state.expiresAt

  // Fetch the next code once the current one has expired and the page is
  // in view. inflight dedupes; a failed fetch clears state, so no retry loop.
  useEffect(() => {
    if (revealed && expired && visible) void fetchCode()
  }, [revealed, expired, visible, fetchCode])

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

  // An expired code is never shown, even for the moment before the refetch
  // lands: it would be rejected by Steam.
  const current = state && !expired ? state : null
  const secondsLeft = current
    ? Math.max(0, Math.ceil((current.expiresAt - now) / 1000))
    : 0
  const expiring = current !== null && secondsLeft <= 7
  const fraction = current
    ? Math.max(0, Math.min(1, (current.expiresAt - now) / (CODE_PERIOD_SECONDS * 1000)))
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
        onClick={() => current && void copyCode(current.code)}
        disabled={!current}
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
              current ? (expiring ? "text-warning" : "text-guard") : "text-muted-foreground/40",
            )}
          >
            {current ? current.code : "•••••"}
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
            {current ? `${secondsLeft}s` : "…"}
          </span>
        </div>
      </button>
      <div className="h-1 overflow-hidden rounded-b-lg bg-muted/60">
        <div
          className={cn(
            "h-full transition-[width] duration-300 ease-linear motion-reduce:transition-none",
            expiring ? "bg-warning" : "bg-guard",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
