import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  InfoIcon,
  KeyRoundIcon,
  LogInIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react"

import { api } from "@/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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

function stateBadge(state: SteamLoginState) {
  if (state === "active") return { label: "Active", variant: "default" as const, icon: CheckCircle2Icon }
  if (state === "invalid") return { label: "Invalid", variant: "destructive" as const, icon: ShieldAlertIcon }
  if (state === "missing") return { label: "Missing", variant: "secondary" as const, icon: KeyRoundIcon }
  return { label: "Needs check", variant: "outline" as const, icon: Clock3Icon }
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function LoginStatusPanel({
  accounts,
  onRefresh,
}: {
  accounts: Account[]
  onRefresh: () => Promise<void>
}) {
  const [statuses, setStatuses] = useState<Record<string, SteamLoginStatus>>({})
  const [loading, setLoading] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: "success" | "error"; title: string; description?: string } | null>(null)
  const [loginAccount, setLoginAccount] = useState<Account | null>(null)
  const accountKey = useMemo(() => accounts.map((account) => account.id).join("|"), [accounts])

  async function loadStatuses() {
    setLoading(true)
    setMessage(null)
    try {
      const entries = await Promise.all(accounts.map(async (account) => {
        const data = await api<{ steamLogin: SteamLoginStatus }>(`/api/accounts/${account.id}/steam-login/status`)
        return [account.id, data.steamLogin] as const
      }))
      setStatuses(Object.fromEntries(entries))
    } catch (err) {
      setMessage({
        kind: "error",
        title: "Failed to load Steam login status",
        description: err instanceof Error ? err.message : "Status request failed",
      })
    } finally {
      setLoading(false)
    }
  }

  async function checkAccount(account: Account) {
    setBusyAccountId(account.id)
    setMessage(null)
    try {
      const data = await api<{ steamLogin: SteamLoginStatus }>(`/api/accounts/${account.id}/steam-login/check`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      setStatuses((current) => ({ ...current, [account.id]: data.steamLogin }))
      setMessage({
        kind: data.steamLogin.state === "invalid" ? "error" : "success",
        title: `${account.accountName}: ${stateBadge(data.steamLogin.state).label}`,
        description: data.steamLogin.message,
      })
    } catch (err) {
      setMessage({
        kind: "error",
        title: "Steam login check failed",
        description: err instanceof Error ? err.message : "Check request failed",
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  function updateStatus(accountId: string, status: SteamLoginStatus) {
    setStatuses((current) => ({ ...current, [accountId]: status }))
  }

  useEffect(() => {
    void loadStatuses()
    // accountKey intentionally collapses account identity changes into one stable dependency.
  }, [accountKey])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Login status</h2>
          <p className="text-sm text-muted-foreground">
            Steam mobile sessions for confirmations and login approvals.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadStatuses()} disabled={loading}>
          <RefreshCwIcon />
          {loading ? "Checking" : "Refresh"}
        </Button>
      </div>

      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "error" ? <AlertTriangleIcon /> : <CheckCircle2Icon />}
          <AlertTitle>{message.title}</AlertTitle>
          {message.description ? <AlertDescription>{message.description}</AlertDescription> : null}
        </Alert>
      ) : null}

      <Alert>
        <InfoIcon />
        <AlertTitle>Access tokens are short-lived</AlertTitle>
        <AlertDescription>
          The displayed access-token expiry is not the full login lifetime. When a refresh token is stored, this app renews access tokens automatically before Steam actions. Re-login is only needed if Steam rejects or revokes the refresh token.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3">
        {accounts.map((account) => {
          const status = statuses[account.id]
          const badge = stateBadge(status?.state || "missing")
          const Icon = badge.icon
          return (
            <Card key={account.id} className="bg-card/95">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{account.accountName}</CardTitle>
                    <CardDescription>{account.steamId || "Steam ID unavailable"}</CardDescription>
                  </div>
                  <Badge variant={badge.variant}>
                    <Icon className="size-3" />
                    {badge.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid gap-2 text-sm">
                  <p className="text-muted-foreground">
                    {status?.message || "Status not loaded yet."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">access {status?.hasAccessToken ? "stored" : "none"}</Badge>
                    <Badge variant="outline">refresh {status?.hasRefreshToken ? "stored" : "none"}</Badge>
                    <Badge variant={status?.autoRefreshAvailable ? "default" : "outline"}>
                      auto-refresh {status?.autoRefreshAvailable ? "on" : "off"}
                    </Badge>
                    <Badge variant="outline">access until {formatDate(status?.accessTokenExpiresAt || null)}</Badge>
                    <Badge variant="outline">refresh until {formatDate(status?.refreshTokenExpiresAt || null)}</Badge>
                    {status?.checkedAt ? <Badge variant="outline">checked {formatDate(status.checkedAt)}</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyAccountId !== null}
                    onClick={() => void checkAccount(account)}
                  >
                    <RefreshCwIcon />
                    Check
                  </Button>
                  <Button
                    type="button"
                    disabled={busyAccountId !== null}
                    onClick={() => setLoginAccount(account)}
                  >
                    <LogInIcon />
                    Log in
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {accounts.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No accounts visible.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <SteamLoginDialog
        account={loginAccount}
        onOpenChange={(open) => {
          if (!open) setLoginAccount(null)
        }}
        onStatus={(accountId, status) => updateStatus(accountId, status)}
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
  const [error, setError] = useState<string | null>(null)

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
      setError(err instanceof Error ? err.message : "Steam login failed")
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
      setError(err instanceof Error ? err.message : "Steam Guard code was rejected")
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
      setError(err instanceof Error ? err.message : "Steam login poll failed")
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
            {error ? <FieldError>{error}</FieldError> : null}
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
                {error ? <FieldError>{error}</FieldError> : null}
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
                {error ? <FieldError>{error}</FieldError> : null}
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
