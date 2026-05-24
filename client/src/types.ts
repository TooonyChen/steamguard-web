export type Role = "admin" | "viewer"

export type User = {
  id: string
  username: string
  displayName: string | null
  role: Role
  status: string
  mustChangePassword: boolean
}

export type Account = {
  id: string
  accountName: string
  steamId: string | null
  status: string
  createdAt?: string
  updatedAt?: string
}

export type FlowMode = "setup" | "transfer"
export type FlowPhase = "start" | "guard" | "poll" | "activation" | "sms" | "done"

export type FlowState = {
  flowId: string
  mode: FlowMode
  phase: FlowPhase
  step: string
  allowedConfirmations?: Array<{
    confirmationType: number
    associatedMessage?: string
  }>
  phoneNumberHint?: string
  revocationCode?: string
  result?: Record<string, unknown>
}
