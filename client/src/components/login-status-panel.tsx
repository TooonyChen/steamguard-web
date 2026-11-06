import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  InfoIcon,
  LogInIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react"

import { api, ApiError } from "@/api"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { needsSignin, type SigninStatuses } from "@/hooks/use-signin-statuses"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Account, SteamLoginState, SteamLoginStatus } from "@/types"

type LoginPhase = "credentials" | "guard" | "poll" | "done"

type SteamLoginFlow = {
  flowId: string
  phase: LoginPhase
  step: string
  interval?: number
  autoSubmittedGuardCode?: boolean
  allowedConfirmations?: Array<{
    confirmationType: number
    associatedMessage?: string
  }>
}

const stateLabels: Record<SteamLoginState, string> = {
  active: "Signed in",
  refreshable: "Renews on next use",
  missing: "Not signed in",
  invalid: "Sign-in rejected",
}

function StatusLabel({ state }: { state: SteamLoginState | undefined }) {
  if (!state) return <span className="text-subtle">Loading</span>
  if (state === "missing" || state === "invalid") {
    const Icon = state === "missing" ? AlertTriangleIcon : ShieldAlertIcon
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          state === "missing" ? "text-warning" : "text-destructive",
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.2} />
        {stateLabels[state]}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "active" ? "bg-guard" : "border-2 border-guard",
        )}
      />
      {stateLabels[state]}
    </span>
  )
}

type LoginError = { title: string; description: string }

/** Steam turning the sign-in down (wrong password, bad code, throttled) vs. anything else. */
function loginError(err: unknown, fallback: string): LoginError {
  const rejected =
    err instanceof ApiError &&
    (err.code === "steam_login_rejected" || err.code === "steam_rate_limited" || err.code === "steam_login_failed")
  return {
    title: rejected ? stateLabels.invalid : "Steam sign-in failed",
    description: err instanceof Error ? err.message : fallback,
  }
}

function LoginErrorAlert({ error }: { error: LoginError }) {
  return (
    <Alert variant="destructive">
      <ShieldAlertIcon />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>{error.description}</AlertDescription>
    </Alert>
  )
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))
}

/** "Today, 09:00", "Yesterday, 22:14", or a plain date for anything older. */
function formatWhen(value: string | null) {
  if (!value) return "Never"
  const date = new Date(value)
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000
  if (date.getTime() >= startOfToday.getTime()) return `Today, ${time}`
  if (date.getTime() >= startOfToday.getTime() - dayMs) return `Yesterday, ${time}`
  return formatDay(value)
}

function refreshTokenText(status: SteamLoginStatus | undefined) {
  if (!status) return "…"
  if (!status.hasRefreshToken) return "None stored"
  return status.refreshTokenExpiresAt
    ? `Valid until ${formatDay(status.refreshTokenExpiresAt)}`
    : "Stored"
}

function accessTokenText(status: SteamLoginStatus | undefined) {
  if (!status?.hasAccessToken) return "Access token: none stored"
  if (!status.accessTokenExpiresAt) return "Access token: stored"
  const expires = new Date(status.accessTokenExpiresAt)
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(expires)
  return expires.getTime() > Date.now()
    ? `Access token: valid until ${when}`
    : `Access token: expired ${when}`
}

function RowActions({
  account,
  status,
  busy,
  onCheck,
  onSignin,
}: {
  account: Account
  status: SteamLoginStatus | undefined
  busy: boolean
  onCheck: () => void
  onSignin: () => void
}) {
  const missing = needsSignin(status?.state)
  return (
    <div className="flex items-center justify-end gap-1">
      {missing ? (
        <Button type="button" size="sm" disabled={busy} onClick={onSignin} className="max-md:h-10 max-md:flex-1">
          <LogInIcon />
          Sign in
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCheck} className="max-md:h-10 max-md:flex-1">
          <RefreshCwIcon className={cn(busy && "animate-spin")} />
          Check
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground max-md:size-10"
            aria-label={`More for ${account.accountName}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5">
          <DropdownMenuLabel className="flex flex-col gap-1 py-1.5 text-xs font-normal text-muted-foreground">
            <span>{accessTokenText(status)}</span>
            <span>Auto-refresh: {status?.autoRefreshAvailable ? "on" : "off"}</span>
            {status?.message ? <span>Steam: {status.message}</span> : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {missing ? (
            <DropdownMenuItem className="h-9" disabled={busy} onSelect={onCheck}>
              <RefreshCwIcon />
              Check with Steam
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="h-9" disabled={busy} onSelect={onSignin}>
              <LogInIcon />
              Sign in again
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function LoginStatusPanel({
  accounts,
  signins,
  onRefresh,
}: {
  accounts: Account[]
  signins: SigninStatuses
  onRefresh: () => Promise<void>
}) {
  const { statuses, setStatus, reload, loading, error } = signins
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: "success" | "error"; title: string; description?: string } | null>(null)
  const [loginAccount, setLoginAccount] = useState<Account | null>(null)

  async function checkAccount(account: Account) {
    setBusyAccountId(account.id)
    setMessage(null)
    try {
      const data = await api<{ steamLogin: SteamLoginStatus }>(`/api/accounts/${account.id}/steam-login/check`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      setStatus(account.id, data.steamLogin)
      setMessage({
        kind: data.steamLogin.state === "invalid" ? "error" : "success",
        title: `${account.accountName}: ${stateLabels[data.steamLogin.state]}`,
        description: data.steamLogin.message,
      })
    } catch (err) {
      setMessage({
        kind: "error",
        title: "Steam sign-in check failed",
        description: err instanceof Error ? err.message : "Check request failed",
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  const shownMessage =
    message ?? (error ? { kind: "error" as const, title: "Failed to load Steam sign-in status", description: error } : null)

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <PageHeader
        title="Sign-ins"
        description="Steam mobile sessions used for confirmations and login approvals."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="Refresh sign-in status"
            className="max-md:size-10 max-md:p-0"
          >
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
            <span className="hidden md:inline">{loading ? "Loading" : "Refresh"}</span>
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-xl bg-card/60 px-4 py-3 text-[13px] text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <p>
          Access tokens expire within a day, and that is expected: with a refresh token stored, the
          app renews them before each Steam action. Sign in again only when Steam rejects the
          refresh token.
        </p>
      </div>

      {shownMessage ? (
        <Alert variant={shownMessage.kind === "error" ? "destructive" : "default"}>
          {shownMessage.kind === "error" ? <AlertTriangleIcon /> : <CheckCircle2Icon />}
          <AlertTitle>{shownMessage.title}</AlertTitle>
          {shownMessage.description ? <AlertDescription>{shownMessage.description}</AlertDescription> : null}
        </Alert>
      ) : null}

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No accounts yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-[14px] border bg-card md:block">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-subtle">
                  <th scope="col" className="px-5 pt-3.5 pb-2.5 font-medium">Account</th>
                  <th scope="col" className="px-3 pt-3.5 pb-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 pt-3.5 pb-2.5 font-medium">Refresh token</th>
                  <th scope="col" className="px-3 pt-3.5 pb-2.5 font-medium">Last checked</th>
                  <th scope="col" className="px-5 pt-3.5 pb-2.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const status = statuses[account.id]
                  return (
                    <tr
                      key={account.id}
                      className={cn("border-t", needsSignin(status?.state) && "bg-warning/4")}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium">{account.accountName}</div>
                        <div className="font-mono text-xs text-subtle">
                          {account.steamId || "Steam ID unknown"}
                        </div>
                      </td>
                      <td className="px-3 py-3.5" title={status?.message}>
                        <StatusLabel state={status?.state} />
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">{refreshTokenText(status)}</td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {status ? formatWhen(status.checkedAt) : "…"}
                      </td>
                      <td className="px-5 py-3.5">
                        <RowActions
                          account={account}
                          status={status}
                          busy={busyAccountId !== null}
                          onCheck={() => void checkAccount(account)}
                          onSignin={() => setLoginAccount(account)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: cards */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {accounts.map((account) => {
              const status = statuses[account.id]
              return (
                <section key={account.id} className="flex flex-col gap-3 rounded-2xl bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{account.accountName}</div>
                      <div className="truncate font-mono text-xs text-subtle">
                        {account.steamId || "Steam ID unknown"}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm">
                      <StatusLabel state={status?.state} />
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-[13px]">
                    <div>
                      <dt className="text-subtle">Refresh token</dt>
                      <dd className="text-muted-foreground">{refreshTokenText(status)}</dd>
                    </div>
                    <div>
                      <dt className="text-subtle">Last checked</dt>
                      <dd className="text-muted-foreground">{status ? formatWhen(status.checkedAt) : "…"}</dd>
                    </div>
                  </dl>
                  <RowActions
                    account={account}
                    status={status}
                    busy={busyAccountId !== null}
                    onCheck={() => void checkAccount(account)}
                    onSignin={() => setLoginAccount(account)}
                  />
                </section>
              )
            })}
          </div>
        </>
      )}

      <SteamLoginDialog
        account={loginAccount}
        onOpenChange={(open) => {
          if (!open) setLoginAccount(null)
        }}
        onStatus={setStatus}
        onDone={onRefresh}
      />
    </div>
  )
}

function SteamLoginDialog({
  account,
  onOpenChange,
  onStatus,
  onDone,
}: {
  account: Account | null
  onOpenChange: (open: boolean) => void
  onStatus: (accountId: string, status: SteamLoginStatus) => void
  onDone: () => Promise<void>
}) {
  const [password, setPassword] = useState("")
  const [deviceName, setDeviceName] = useState("SteamGuard Web")
  const [confirmationType, setConfirmationType] = useState("3")
  const [guardCode, setGuardCode] = useState("")
  const [flow, setFlow] = useState<SteamLoginFlow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)

  function reset() {
    setPassword("")
    setDeviceName("SteamGuard Web")
    setConfirmationType("3")
    setGuardCode("")
    setFlow(null)
    setBusy(false)
    setError(null)
  }

  useEffect(() => {
    reset()
  }, [account?.id])

  async function begin(event: React.FormEvent) {
    event.preventDefault()
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      const data = await api<{
        flowId: string
        step: string
        interval?: number
        autoSubmittedGuardCode?: boolean
        allowedConfirmations?: Array<{ confirmationType: number; associatedMessage?: string }>
      }>(`/api/accounts/${account.id}/steam-login/begin`, {
        method: "POST",
        body: JSON.stringify({ password, deviceName }),
      })
      const first = data.allowedConfirmations?.[0]
      if (first) setConfirmationType(String(first.confirmationType))
      setFlow({
        flowId: data.flowId,
        phase: data.step === "poll_tokens" ? "poll" : first ? "guard" : "poll",
        step: data.step,
        interval: data.interval,
        autoSubmittedGuardCode: data.autoSubmittedGuardCode,
        allowedConfirmations: data.allowedConfirmations,
      })
    } catch (err) {
      setError(loginError(err, "Steam login failed"))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode() {
    if (!account || !flow) return
    setBusy(true)
    setError(null)
    try {
      const data = await api<{ step: string }>(`/api/accounts/${account.id}/steam-login/${flow.flowId}/submit-code`, {
        method: "POST",
        body: JSON.stringify({ code: guardCode, confirmationType: Number(confirmationType) }),
      })
      setGuardCode("")
      setFlow({ ...flow, phase: "poll", step: data.step })
    } catch (err) {
      setError(loginError(err, "Steam Guard code was rejected"))
    } finally {
      setBusy(false)
    }
  }

  async function pollFlow(activeFlow: SteamLoginFlow) {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      const data = await api<{ step: string; steamLogin?: SteamLoginStatus; steamIdChanged?: boolean }>(
        `/api/accounts/${account.id}/steam-login/${activeFlow.flowId}/poll`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      )
      if (data.steamLogin) {
        onStatus(account.id, data.steamLogin)
        setPassword("")
        setFlow({ ...activeFlow, phase: "done", step: data.step })
        await onDone()
      } else {
        setFlow({ ...activeFlow, phase: "poll", step: data.step })
      }
    } catch (err) {
      setError(loginError(err, "Steam login poll failed"))
    } finally {
      setBusy(false)
    }
  }

  async function poll() {
    if (!flow) return
    await pollFlow(flow)
  }

  useEffect(() => {
    if (!account || flow?.phase !== "poll") return
    let cancelled = false
    let inFlight = false
    const delay = Math.max(2, flow.interval || 2) * 1000
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      await pollFlow(flow)
      inFlight = false
    }
    const firstPoll = window.setTimeout(() => {
      void tick()
    }, 300)
    const interval = window.setInterval(() => {
      void tick()
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(firstPoll)
      window.clearInterval(interval)
    }
  }, [account?.id, flow?.flowId, flow?.phase, flow?.interval])

  return (
    <Dialog
      open={Boolean(account)}
      onOpenChange={(open) => {
        if (!open) reset()
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log in to Steam</DialogTitle>
          <DialogDescription>
            {account ? account.accountName : "Steam account"}
          </DialogDescription>
        </DialogHeader>

        {!flow ? (
          <form onSubmit={(event) => void begin(event)} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Steam password</FieldLabel>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Device name</FieldLabel>
                <Input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
                <FieldDescription>Shown in Steam session records.</FieldDescription>
              </Field>
            </FieldGroup>
            {error ? <LoginErrorAlert error={error} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                reset()
                onOpenChange(false)
              }}>
                Cancel
              </Button>
              <Button type="submit" disabled={!password || busy}>
                <LogInIcon />
                {busy ? "Starting" : "Begin"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <LoginFlowStepper phase={flow.phase} />
            {flow.phase === "guard" ? (
              <div className="flex flex-col gap-3">
                <Field>
                  <FieldLabel>Guard confirmation type</FieldLabel>
                  <Select value={confirmationType} onValueChange={setConfirmationType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(flow.allowedConfirmations || []).map((item) => (
                        <SelectItem key={item.confirmationType} value={String(item.confirmationType)}>
                          {item.associatedMessage || `Type ${item.confirmationType}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Steam Guard code</FieldLabel>
                  <Input value={guardCode} onChange={(event) => setGuardCode(event.target.value)} />
                </Field>
                {error ? <LoginErrorAlert error={error} /> : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => reset()} disabled={busy}>
                    Restart
                  </Button>
                  <Button type="button" disabled={!guardCode || busy} onClick={() => void submitCode()}>
                    {busy ? "Submitting" : "Submit code"}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}

            {flow.phase === "poll" ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="font-medium">Waiting for Steam tokens</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {flow.autoSubmittedGuardCode
                      ? "Stored Steam Guard code was submitted automatically."
                      : flow.step}
                  </p>
                </div>
                {error ? <LoginErrorAlert error={error} /> : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => reset()} disabled={busy}>
                    Restart
                  </Button>
                  <Button type="button" onClick={() => void poll()} disabled={busy}>
                    <Clock3Icon />
                    {busy ? "Polling" : "Poll now"}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}

            {flow.phase === "done" ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border bg-primary/10 p-4 text-sm text-primary">
                  Steam login saved.
                </div>
                <DialogFooter>
                  <Button type="button" onClick={() => {
                    reset()
                    onOpenChange(false)
                  }}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LoginFlowStepper({ phase }: { phase: LoginPhase }) {
  const steps: Array<{ id: LoginPhase; label: string }> = [
    { id: "credentials", label: "Password" },
    { id: "guard", label: "Guard" },
    { id: "poll", label: "Tokens" },
    { id: "done", label: "Done" },
  ]
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === phase))
  return (
    <div className="grid grid-cols-4 gap-2">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={
            index <= activeIndex
              ? "rounded-md border bg-primary px-2 py-2 text-center text-xs font-medium text-primary-foreground"
              : "rounded-md border bg-muted px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          }
        >
          {step.label}
        </div>
      ))}
    </div>
  )
}
