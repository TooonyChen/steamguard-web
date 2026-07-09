import { useState } from "react"

import { api } from "@/api"
import { LoginForm } from "@/components/login-form"

export function LoginView({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) })
      await onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden p-6 md:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_38%,--alpha(var(--color-guard)/9%),transparent)]"
      />
      <div className="relative w-full max-w-sm">
        <LoginForm
          username={username}
          password={password}
          error={error}
          busy={busy}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onSubmit={submit}
        />
      </div>
    </main>
  )
}
