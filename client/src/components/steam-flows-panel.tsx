import { useState } from "react"
import { Clock3Icon, SmartphoneIcon } from "lucide-react"

import { api } from "@/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import type { FlowMode, FlowPhase, FlowState } from "@/types"

export function SteamFlowsPanel({ onComplete }: { onComplete: () => Promise<void> }) {
  const [mode, setMode] = useState<FlowMode>("setup")
  const [accountName, setAccountName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmationType, setConfirmationType] = useState("3")
  const [guardCode, setGuardCode] = useState("")
  const [activationCode, setActivationCode] = useState("")
  const [smsCode, setSmsCode] = useState("")
  const [flow, setFlow] = useState<FlowState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function begin(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    const data = await api<{
      flowId: string
      step: string
      allowedConfirmations?: Array<{ confirmationType: number; associatedMessage?: string }>
    }>(`/api/authenticator/${mode}/begin`, {
      method: "POST",
      body: JSON.stringify({ accountName, password }),
    })
    const first = data.allowedConfirmations?.[0]
    if (first) setConfirmationType(String(first.confirmationType))
    setFlow({
      flowId: data.flowId,
      mode,
      phase: first ? "guard" : "poll",
      step: data.step,
      allowedConfirmations: data.allowedConfirmations,
    })
  }

  async function submitCode() {
    if (!flow) return
    const data = await api<{ step: string }>(`/api/authenticator/${flow.mode}/${flow.flowId}/submit-code`, {
      method: "POST",
      body: JSON.stringify({ code: guardCode, confirmationType: Number(confirmationType) }),
    })
    setGuardCode("")
    setFlow({ ...flow, phase: "poll", step: data.step })
  }

  async function poll() {
    if (!flow) return
    const data = await api<Record<string, unknown>>(`/api/authenticator/${flow.mode}/${flow.flowId}/poll`, {
      method: "POST",
      body: JSON.stringify({}),
    })
    const nextStep = String(data.step || flow.step)
    const nextPhase =
      flow.mode === "setup" && nextStep === "await_activation"
        ? "activation"
        : flow.mode === "transfer" && nextStep === "await_sms"
          ? "sms"
          : "poll"
    setFlow({
      ...flow,
      phase: nextPhase,
      step: nextStep,
      phoneNumberHint: typeof data.phoneNumberHint === "string" ? data.phoneNumberHint : flow.phoneNumberHint,
      revocationCode: typeof data.revocationCode === "string" ? data.revocationCode : flow.revocationCode,
      result: data,
    })
  }

  async function completeSetup() {
    if (!flow) return
    const data = await api<Record<string, unknown>>(`/api/authenticator/setup/${flow.flowId}/complete`, {
      method: "POST",
      body: JSON.stringify({ activationCode }),
    })
    setFlow({ ...flow, phase: "done", step: "completed", result: data })
    setActivationCode("")
    await onComplete()
  }

  async function submitSms() {
    if (!flow) return
    const data = await api<Record<string, unknown>>(`/api/authenticator/transfer/${flow.flowId}/submit-sms`, {
      method: "POST",
      body: JSON.stringify({ smsCode }),
    })
    setFlow({ ...flow, phase: "done", step: "completed", result: data })
    setSmsCode("")
    await onComplete()
  }

  function resetFlow() {
    setFlow(null)
    setMessage(null)
    setPassword("")
    setActivationCode("")
    setSmsCode("")
    setGuardCode("")
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Authenticator flow</CardTitle>
          <CardDescription>{mode === "setup" ? "Create a new authenticator." : "Transfer an authenticator."}</CardDescription>
        </CardHeader>
        <CardContent>
          {!flow ? (
            <form onSubmit={(event) => void begin(event)} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel>Flow type</FieldLabel>
                  <Select value={mode} onValueChange={(value) => setMode(value as FlowMode)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="setup">Setup authenticator</SelectItem>
                      <SelectItem value="transfer">Transfer authenticator</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Steam account name</FieldLabel>
                  <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>Steam password</FieldLabel>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={!accountName || !password}>
                <SmartphoneIcon />
                Begin
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <FlowStepper phase={flow.phase} mode={flow.mode} />
              <Separator />
              <CurrentFlowStep
                flow={flow}
                confirmationType={confirmationType}
                guardCode={guardCode}
                activationCode={activationCode}
                smsCode={smsCode}
                onConfirmationTypeChange={setConfirmationType}
                onGuardCodeChange={setGuardCode}
                onActivationCodeChange={setActivationCode}
                onSmsCodeChange={setSmsCode}
                onSubmitCode={() => void submitCode()}
                onPoll={() => void poll()}
                onCompleteSetup={() => void completeSetup()}
                onSubmitSms={() => void submitSms()}
              />
              <Button type="button" variant="outline" onClick={resetFlow}>
                Start another flow
              </Button>
            </div>
          )}
          {message ? <FieldError className="mt-3">{message}</FieldError> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flow state</CardTitle>
          <CardDescription>{flow ? `${flow.mode} · ${flow.step}` : "No active flow"}</CardDescription>
        </CardHeader>
        <CardContent>
          {flow ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-foreground p-4 text-xs text-background">
              {JSON.stringify(flow.result || flow, null, 2)}
            </pre>
          ) : (
            <div className="grid min-h-64 place-items-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
              Waiting for a flow.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FlowStepper({ phase, mode }: { phase: FlowPhase; mode: FlowMode }) {
  const steps: Array<{ id: FlowPhase; label: string }> =
    mode === "setup"
      ? [
          { id: "guard", label: "Guard" },
          { id: "poll", label: "Poll" },
          { id: "activation", label: "Activate" },
          { id: "done", label: "Done" },
        ]
      : [
          { id: "guard", label: "Guard" },
          { id: "poll", label: "Poll" },
          { id: "sms", label: "SMS" },
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

function CurrentFlowStep({
  flow,
  confirmationType,
  guardCode,
  activationCode,
  smsCode,
  onConfirmationTypeChange,
  onGuardCodeChange,
  onActivationCodeChange,
  onSmsCodeChange,
  onSubmitCode,
  onPoll,
  onCompleteSetup,
  onSubmitSms,
}: {
  flow: FlowState
  confirmationType: string
  guardCode: string
  activationCode: string
  smsCode: string
  onConfirmationTypeChange: (value: string) => void
  onGuardCodeChange: (value: string) => void
  onActivationCodeChange: (value: string) => void
  onSmsCodeChange: (value: string) => void
  onSubmitCode: () => void
  onPoll: () => void
  onCompleteSetup: () => void
  onSubmitSms: () => void
}) {
  if (flow.phase === "guard") {
    return (
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel>Guard confirmation type</FieldLabel>
          <Select value={confirmationType} onValueChange={onConfirmationTypeChange}>
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
          <Input value={guardCode} onChange={(event) => onGuardCodeChange(event.target.value)} />
        </Field>
        <Button type="button" disabled={!guardCode} onClick={onSubmitCode}>
          Submit code
        </Button>
      </div>
    )
  }

  if (flow.phase === "poll") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="font-medium">Waiting for Steam tokens</p>
          <p className="mt-1 text-sm text-muted-foreground">{flow.step}</p>
        </div>
        <Button type="button" onClick={onPoll}>
          <Clock3Icon />
          Poll Steam
        </Button>
      </div>
    )
  }

  if (flow.phase === "activation") {
    return (
      <div className="flex flex-col gap-3">
        {flow.revocationCode ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Revocation code: <span className="font-mono font-semibold">{flow.revocationCode}</span>
          </div>
        ) : null}
        <Field>
          <FieldLabel>Activation code</FieldLabel>
          <Input value={activationCode} onChange={(event) => onActivationCodeChange(event.target.value)} />
          <FieldDescription>{flow.phoneNumberHint || "Steam activation challenge"}</FieldDescription>
        </Field>
        <Button type="button" disabled={!activationCode} onClick={onCompleteSetup}>
          Complete setup
        </Button>
      </div>
    )
  }

  if (flow.phase === "sms") {
    return (
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel>SMS code</FieldLabel>
          <Input value={smsCode} onChange={(event) => onSmsCodeChange(event.target.value)} />
        </Field>
        <Button type="button" disabled={!smsCode} onClick={onSubmitSms}>
          Finish transfer
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-primary/10 p-4 text-sm text-primary">
      Flow completed.
    </div>
  )
}
