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
    <main className="flex min-h-svh items-center justify-center px-6 py-10">
      <LoginForm
        className="w-full max-w-sm"
        username={username}
        password={password}
        error={error}
        busy={busy}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={submit}
      />
    </main>
  )
}
