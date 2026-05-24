import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  KeyRoundIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"

import { api } from "@/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Account, User } from "@/types"

type AssignDialogState = {
  user: User
  assignedIds: Set<string>
  busyAccountId: string | null
}

type MessageState = {
  kind: "success" | "error"
  title: string
  description?: string
} | null

export function AdminUsersPanel({
  accounts,
  currentUserId,
  onRefresh,
}: {
  accounts: Account[]
  currentUserId: string
  onRefresh: () => Promise<void>
}) {
  const [users, setUsers] = useState<User[]>([])
  const [message, setMessage] = useState<MessageState>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [assignmentsByUser, setAssignmentsByUser] = useState<Record<string, Account[]>>({})

  const [addOpen, setAddOpen] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [creating, setCreating] = useState(false)

  const [assignDialog, setAssignDialog] = useState<AssignDialogState | null>(null)

  const [passwordDialogUser, setPasswordDialogUser] = useState<User | null>(null)
  const [passwordValue, setPasswordValue] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  function notifySuccess(title: string, description?: string) {
    setMessage({ kind: "success", title, description })
  }

  function notifyError(err: unknown, fallback: string) {
    const text = err instanceof Error ? err.message : fallback
    setMessage({ kind: "error", title: fallback, description: text })
  }

  async function loadUsers() {
    const data = await api<{ users: User[] }>("/api/admin/users")
    setUsers(data.users)
    await Promise.all(
      data.users
        .filter((user) => user.role === "viewer")
        .map(async (viewer) => {
          try {
            const assigned = await api<{ accounts: Account[] }>(
              `/api/admin/users/${viewer.id}/accounts`,
            )
            setAssignmentsByUser((current) => ({ ...current, [viewer.id]: assigned.accounts }))
          } catch {
            setAssignmentsByUser((current) => ({ ...current, [viewer.id]: [] }))
          }
        }),
    )
  }

  useEffect(() => {
    void loadUsers().catch((err) => notifyError(err, "Failed to load users"))
  }, [])

  const adminCount = useMemo(
    () => users.filter((user) => user.role === "admin" && user.status === "active").length,
    [users],
  )

  async function createUser(event: React.FormEvent) {
    event.preventDefault()
    setCreating(true)
    setMessage(null)
    try {
      await api("/api/admin/users/viewers", {
        method: "POST",
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      })
      setNewUsername("")
      setNewPassword("")
      setAddOpen(false)
      notifySuccess(`Viewer "${newUsername}" created`)
      await loadUsers()
    } catch (err) {
      notifyError(err, "Failed to create viewer")
    } finally {
      setCreating(false)
    }
  }

  async function setUserStatus(user: User, action: "disable" | "enable") {
    setBusyUserId(user.id)
    setMessage(null)
    try {
      await api(`/api/admin/users/${user.id}/${action}`, { method: "POST" })
      notifySuccess(
        action === "disable"
          ? `${user.username} disabled`
          : `${user.username} re-enabled`,
      )
      await loadUsers()
    } catch (err) {
      notifyError(err, `Failed to ${action} user`)
    } finally {
      setBusyUserId(null)
    }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`Delete viewer "${user.username}"? This revokes all account grants.`)) {
      return
    }
    setBusyUserId(user.id)
    setMessage(null)
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" })
      notifySuccess(`${user.username} deleted`)
      await loadUsers()
    } catch (err) {
      notifyError(err, "Failed to delete viewer")
    } finally {
      setBusyUserId(null)
    }
  }

  function openAssignDialog(user: User) {
    const assigned = assignmentsByUser[user.id] ?? []
    setAssignDialog({
      user,
      assignedIds: new Set(assigned.map((account) => account.id)),
      busyAccountId: null,
    })
  }

  async function toggleAssignment(account: Account, nextAssigned: boolean) {
    if (!assignDialog) return
    const { user } = assignDialog
    setAssignDialog((current) => current && { ...current, busyAccountId: account.id })
    try {
      if (nextAssigned) {
        await api(`/api/accounts/${account.id}/permissions`, {
          method: "POST",
          body: JSON.stringify({ userId: user.id, canViewCode: true, canViewStatus: true }),
        })
      } else {
        await api(`/api/accounts/${account.id}/permissions/${user.id}`, { method: "DELETE" })
      }
      setAssignDialog((current) => {
        if (!current) return current
        const nextIds = new Set(current.assignedIds)
        if (nextAssigned) nextIds.add(account.id)
        else nextIds.delete(account.id)
        return { ...current, assignedIds: nextIds, busyAccountId: null }
      })
      setAssignmentsByUser((current) => {
        const previous = current[user.id] ?? []
        const next = nextAssigned
          ? previous.some((existing) => existing.id === account.id)
            ? previous
            : [...previous, account].sort((a, b) => a.accountName.localeCompare(b.accountName))
          : previous.filter((existing) => existing.id !== account.id)
        return { ...current, [user.id]: next }
      })
      await onRefresh()
    } catch (err) {
      setAssignDialog((current) => current && { ...current, busyAccountId: null })
      notifyError(err, nextAssigned ? "Failed to assign account" : "Failed to unassign account")
    }
  }

  function openPasswordDialog(user: User) {
    setPasswordValue("")
    setPasswordDialogUser(user)
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault()
    if (!passwordDialogUser) return
    setSavingPassword(true)
    setMessage(null)
    try {
      await api(`/api/admin/users/${passwordDialogUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: passwordValue }),
      })
      notifySuccess(
        `Password changed for ${passwordDialogUser.username}`,
        "Existing sessions were revoked. They must change the password on next login.",
      )
      setPasswordDialogUser(null)
      setPasswordValue("")
    } catch (err) {
      notifyError(err, "Failed to change password")
    } finally {
      setSavingPassword(false)
    }
  }

  async function quickUnassign(user: User, account: Account) {
    setBusyUserId(user.id)
    setMessage(null)
    try {
      await api(`/api/accounts/${account.id}/permissions/${user.id}`, { method: "DELETE" })
      setAssignmentsByUser((current) => ({
        ...current,
        [user.id]: (current[user.id] ?? []).filter((existing) => existing.id !== account.id),
      }))
      notifySuccess(`Unassigned ${account.accountName} from ${user.username}`)
      await onRefresh()
    } catch (err) {
      notifyError(err, "Failed to unassign account")
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Users</h2>
          <p className="text-sm text-muted-foreground">
            {users.length} app account{users.length === 1 ? "" : "s"} · {adminCount} active admin
            {adminCount === 1 ? "" : "s"}
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <UserPlusIcon />
            Add user
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create viewer</DialogTitle>
              <DialogDescription>
                Viewers can only see Steam Guard codes for accounts you explicitly assign to them.
                They must change their password on first login.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(event) => void createUser(event)} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-username">Username</FieldLabel>
                  <Input
                    id="new-username"
                    autoComplete="off"
                    value={newUsername}
                    onChange={(event) => setNewUsername(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-password">Temporary password</FieldLabel>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <FieldDescription>At least 10 characters.</FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!newUsername || newPassword.length < 10 || creating}
                >
                  {creating ? "Creating…" : "Create viewer"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"}>
          {message.kind === "error" ? <AlertTriangleIcon /> : <CheckIcon />}
          <AlertTitle>{message.title}</AlertTitle>
          {message.description ? <AlertDescription>{message.description}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {users.map((user) => {
          const assigned = assignmentsByUser[user.id] ?? []
          const isViewer = user.role === "viewer"
          const isActive = user.status === "active"
          const isBusy = busyUserId === user.id
          const isSelf = user.id === currentUserId
          return (
            <Card key={user.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span>{user.username}</span>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                        {user.role}
                      </Badge>
                      <Badge variant={isActive ? "default" : "secondary"}>
                        {user.status}
                      </Badge>
                      {user.mustChangePassword ? (
                        <Badge variant="outline">must change password</Badge>
                      ) : null}
                    </CardTitle>
                    {user.displayName ? (
                      <p className="mt-1 text-sm text-muted-foreground">{user.displayName}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isViewer ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy || !isActive}
                        onClick={() => openAssignDialog(user)}
                      >
                        <LinkIcon />
                        Assign
                      </Button>
                    ) : null}
                    {isSelf ? (
                      <Badge variant="outline">you</Badge>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`More actions for ${user.username}`}
                            disabled={isBusy}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isActive ? (
                            <DropdownMenuItem onSelect={() => void setUserStatus(user, "disable")}>
                              <PowerOffIcon />
                              Disable
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void setUserStatus(user, "enable")}>
                              <PowerIcon />
                              Enable
                            </DropdownMenuItem>
                          )}
                          {isViewer ? (
                            <DropdownMenuItem onSelect={() => openPasswordDialog(user)}>
                              <KeyRoundIcon />
                              Change password
                            </DropdownMenuItem>
                          ) : null}
                          {isViewer ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => void deleteUser(user)}
                              >
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardHeader>
              {isViewer ? (
                <CardContent>
                  <div className="text-xs font-medium text-muted-foreground">
                    Assigned accounts
                  </div>
                  {assigned.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No accounts assigned yet.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {assigned.map((account) => (
                        <Badge
                          key={account.id}
                          variant="secondary"
                          className="flex items-center gap-1.5 py-1 pl-2 pr-1"
                        >
                          <span className="font-mono text-xs">{account.accountName}</span>
                          <button
                            type="button"
                            className="rounded-sm p-0.5 hover:bg-background"
                            aria-label={`Unassign ${account.accountName}`}
                            disabled={isBusy}
                            onClick={() => void quickUnassign(user, account)}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              ) : null}
            </Card>
          )
        })}
      </div>

      {assignDialog ? (
        <Dialog
          open={Boolean(assignDialog)}
          onOpenChange={(open) => !open && setAssignDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign accounts to {assignDialog.user.username}</DialogTitle>
              <DialogDescription>
                Toggle accounts to grant or revoke this viewer's code and login approval access. Changes apply immediately.
              </DialogDescription>
            </DialogHeader>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Steam accounts have been imported yet.
              </p>
            ) : (
              <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
                {accounts.map((account) => {
                  const assigned = assignDialog.assignedIds.has(account.id)
                  const accountBusy = assignDialog.busyAccountId === account.id
                  return (
                    <label
                      key={account.id}
                      className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={assigned}
                        disabled={accountBusy}
                        onCheckedChange={(checked) =>
                          void toggleAssignment(account, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{account.accountName}</div>
                        {account.steamId ? (
                          <div className="font-mono text-xs text-muted-foreground">
                            {account.steamId}
                          </div>
                        ) : null}
                      </div>
                      {accountBusy ? (
                        <span className="text-xs text-muted-foreground">saving…</span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => setAssignDialog(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {passwordDialogUser ? (
        <Dialog
          open={Boolean(passwordDialogUser)}
          onOpenChange={(open) => {
            if (!open) {
              setPasswordDialogUser(null)
              setPasswordValue("")
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change password for {passwordDialogUser.username}</DialogTitle>
              <DialogDescription>
                The new password takes effect immediately. The user's existing sessions are
                revoked, and they will be required to change it again on next login.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(event) => void submitPasswordChange(event)} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={passwordValue}
                  onChange={(event) => setPasswordValue(event.target.value)}
                />
                <FieldDescription>At least 10 characters.</FieldDescription>
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPasswordDialogUser(null)
                    setPasswordValue("")
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={passwordValue.length < 10 || savingPassword}>
                  {savingPassword ? "Saving…" : "Change password"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
