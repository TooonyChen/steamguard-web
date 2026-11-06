import { useCallback, useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, EyeIcon, RotateCwIcon } from "lucide-react"

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
const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
}

/**
 * One account's Steam Guard code, as it sits in a Codes row. Hidden until the
 * viewer asks for it (each fetch is audited). Revealed, it shows the code with
 * a countdown ring on desktop, or a full-width card with a draining bar on a
 * phone, and fetches the next code on expiry. Clicking the code copies it.
 *
 * The root element carries its own flex placement so a revealed code wraps
 * onto its own line on phones and stays inline on md+ screens.
 *
 * The countdown is derived from an absolute expiry time, not by decrementing
 * a counter per tick. Browsers throttle or pause timers in background tabs,
 * so a per-tick counter freezes; the wall clock does not. When the page comes
 * back into view we re-read the clock right away and refetch if the code has
 * expired. While hidden we never refetch: each fetch is an audited code view.
 */
export function LiveCode({ accountId, accountName }: { accountId: string; accountName: string }) {
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
      <div className="flex shrink-0 flex-col items-end gap-1 md:w-[264px]">
        <button
          type="button"
          onClick={() => void reveal()}
          aria-label={`${error ? "Retry showing" : "Show"} code for ${accountName}`}
          className={cn(
            "flex h-11 items-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors md:h-12 md:rounded-[10px] md:border md:text-sm md:font-medium",
            "bg-guard/12 text-guard hover:bg-guard/18",
            "md:border-border md:bg-secondary md:text-foreground md:hover:border-guard/30 md:hover:bg-secondary",
          )}
        >
          <span aria-hidden className="code-digits hidden text-xl tracking-[0.3em] text-subtle/60 md:inline">
            •••••
          </span>
          {error ? <RotateCwIcon className="size-4" /> : <EyeIcon className="size-4" />}
          <span className="md:hidden">{error ? "Retry" : "Show code"}</span>
          <span className="hidden md:inline">{error ? "Retry" : "Show"}</span>
        </button>
        {error ? <p className="max-w-60 text-right text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  const code = current?.code ?? null
  const tone = expiring ? "text-warning" : "text-guard"

  return (
    <div className="order-last basis-full md:order-none md:flex md:w-[264px] md:basis-auto md:items-center md:justify-end md:gap-4">
      {/* Desktop: code pill + countdown ring */}
      <button
        type="button"
        onClick={() => code && void copyCode(code)}
        disabled={!code}
        aria-label={code ? `Copy code ${code}` : "Loading code"}
        className={cn(
          "hidden h-12 items-center gap-3.5 rounded-[10px] border pr-3.5 pl-4 transition-colors md:flex",
          code
            ? expiring
              ? "border-warning/30 bg-warning/8 hover:bg-warning/12"
              : "border-guard/22 bg-guard/7 hover:bg-guard/12"
            : "border-border bg-secondary",
        )}
      >
        <span className={cn("code-digits text-[26px]", code ? tone : "text-subtle/60")}>
          {code ?? "•••••"}
        </span>
        {copied ? (
          <CheckIcon className="size-4 text-guard" />
        ) : (
          <CopyIcon className="size-4 text-muted-foreground" />
        )}
      </button>
      <div
        className="relative hidden size-10 shrink-0 md:block"
        role="img"
        aria-label={code ? `${secondsLeft} seconds left` : "Refreshing code"}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="-rotate-90">
          <circle cx="20" cy="20" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-muted" />
          <circle
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${fraction * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            className={cn(
              "transition-[stroke-dasharray] duration-300 ease-linear motion-reduce:transition-none",
              expiring ? "stroke-warning" : "stroke-guard",
            )}
          />
        </svg>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center font-mono text-xs tabular-nums",
            expiring ? "text-warning" : "text-foreground",
          )}
        >
          {code ? secondsLeft : "…"}
        </span>
      </div>

      {/* Phone: full-width card with a draining bar */}
      <button
        type="button"
        onClick={() => code && void copyCode(code)}
        disabled={!code}
        aria-label={code ? `Copy code ${code}` : "Loading code"}
        className="flex w-full flex-col gap-2.5 rounded-xl bg-background p-4 text-left md:hidden"
      >
        <span className="flex w-full items-baseline justify-between">
          <span className={cn("code-digits text-[38px] leading-[44px]", code ? tone : "text-subtle/60")}>
            {code ?? "•••••"}
          </span>
          <span className={cn("font-mono text-[13px] tabular-nums", expiring ? "text-warning" : "text-muted-foreground")}>
            {code ? `${secondsLeft}s` : "…"}
          </span>
        </span>
        <span className="block h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300 ease-linear motion-reduce:transition-none",
              expiring ? "bg-warning" : "bg-guard",
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {copied ? (
            <>
              <CheckIcon className="size-3.5 text-guard" />
              Copied. Tap to copy again.
            </>
          ) : (
            <>
              <CopyIcon className="size-3.5" />
              Tap to copy
            </>
          )}
        </span>
      </button>
    </div>
  )
}
