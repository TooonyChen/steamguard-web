import { useState } from "react"
import { LogOutIcon } from "lucide-react"

import { api } from "@/api"
import { BrandMark } from "@/components/app-nav"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { User } from "@/types"

const MIN_PASSWORD_LENGTH = 10

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 md:p-6">
      <h2 className="text-base">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Current + new password form. Used by Settings and by the first-login gate. */
export function PasswordForm({
  onDone,
  submitLabel = "Update password",
}: {
  onDone: () => Promise<void>
  submitLabel?: string
}) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    setBusy(true)
    try {
      await api("/api/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setCurrentPassword("")
      setNewPassword("")
      setMessage({ kind: "ok", text: "Password changed." })
      await onDone()
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Password change failed",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <FieldDescription>At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
        </Field>
      </FieldGroup>
      {message?.kind === "error" ? <FieldError>{message.text}</FieldError> : null}
      {message?.kind === "ok" ? <p className="text-sm text-primary">{message.text}</p> : null}
      <Button
        type="submit"
        size="lg"
        disabled={busy || !currentPassword || newPassword.length < MIN_PASSWORD_LENGTH}
      >
        {busy ? "Saving" : submitLabel}
      </Button>
    </form>
  )
}

export function SettingsPanel({ user, onDone }: { user: User; onDone: () => Promise<void> }) {
  const [username, setUsername] = useState(user.username)
  const [displayName, setDisplayName] = useState(user.displayName ?? "")
  const [profileMessage, setProfileMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  async function updateProfile(event: React.FormEvent) {
    event.preventDefault()
    setProfileMessage(null)
    try {
      await api("/api/me/username", {
        method: "PATCH",
        body: JSON.stringify({
          username,
          displayName: displayName || null,
        }),
      })
      setProfileMessage({ kind: "ok", text: "Account updated." })
      await onDone()
    } catch (err) {
      setProfileMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Account update failed",
      })
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Your sign-in name and password for this app." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Account" description="The username you sign in with.">
          <form onSubmit={(event) => void updateProfile(event)} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-username">Username</FieldLabel>
                <Input
                  id="settings-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <FieldDescription>Letters, numbers, dots, underscores, and hyphens.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-display-name">Display name</FieldLabel>
                <Input
                  id="settings-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
            </FieldGroup>
            {profileMessage?.kind === "error" ? <FieldError>{profileMessage.text}</FieldError> : null}
            {profileMessage?.kind === "ok" ? (
              <p className="text-sm text-primary">{profileMessage.text}</p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              disabled={!username || (username === user.username && displayName === (user.displayName ?? ""))}
            >
              Update account
            </Button>
          </form>
        </Section>

        <Section title="Password" description="The password you sign in with.">
          <PasswordForm onDone={onDone} />
        </Section>
      </div>
    </>
  )
}

/**
 * Full-screen gate shown while the server flags the user with
 * mustChangePassword (first login, or after an admin reset). Nothing else in
 * the app is reachable until the password is changed.
 */
export function PasswordChangeGate({
  user,
  onDone,
  onLogout,
}: {
  user: User
  onDone: () => Promise<void>
  onLogout: () => void
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-start gap-4">
          <BrandMark className="size-12 rounded-[13px] [&_svg]:size-6" />
          <div>
            <h1 className="text-[28px] leading-[34px] tracking-tight">Choose a new password</h1>
            <p className="mt-1.5 text-muted-foreground">
              Signed in as {user.username}. The password you were given is temporary and has to be
              changed before you continue.
            </p>
          </div>
        </div>
        <PasswordForm onDone={onDone} submitLabel="Save and continue" />
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOutIcon className="size-4" />
          Log out
        </button>
      </div>
    </main>
  )
}
