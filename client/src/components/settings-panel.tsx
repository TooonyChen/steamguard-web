import { useState } from "react"

import { api } from "@/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { User } from "@/types"

export function SettingsPanel({ user, onDone }: { user: User; onDone: () => Promise<void> }) {
  const [username, setUsername] = useState(user.username)
  const [displayName, setDisplayName] = useState(user.displayName ?? "")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

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
      setProfileMessage("Account updated.")
      await onDone()
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Account update failed")
    }
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault()
    setPasswordMessage(null)
    try {
      await api("/api/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setCurrentPassword("")
      setNewPassword("")
      setPasswordMessage("Password changed.")
      await onDone()
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "Password change failed")
    }
  }

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Change the username used to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={updateProfile} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Username</FieldLabel>
                <Input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <FieldDescription>Letters, numbers, dots, underscores, and hyphens.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Display name</FieldLabel>
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </Field>
            </FieldGroup>
            {profileMessage ? <p className="text-sm text-muted-foreground">{profileMessage}</p> : null}
            <Button
              type="submit"
              disabled={!username || (username === user.username && displayName === (user.displayName ?? ""))}
            >
              Update account
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Initial and reset passwords must be changed after login.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={updatePassword} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Current password</FieldLabel>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>New password</FieldLabel>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <FieldDescription>Minimum 10 characters.</FieldDescription>
              </Field>
            </FieldGroup>
            {passwordMessage ? <p className="text-sm text-muted-foreground">{passwordMessage}</p> : null}
            <Button type="submit" disabled={!currentPassword || newPassword.length < 10}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
