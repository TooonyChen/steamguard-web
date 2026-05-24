import {
  CheckCircle2Icon,
  KeyRoundIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Account, User } from "@/types"

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  title: string
  value: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "default" | "warning" | "good"
}) {
  return (
    <Card className="bg-card/95">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        <CardAction>
          <div
            className={
              tone === "warning"
                ? "rounded-md bg-destructive/10 p-2 text-destructive"
                : tone === "good"
                  ? "rounded-md bg-primary/10 p-2 text-primary"
                  : "rounded-md bg-muted p-2 text-muted-foreground"
            }
          >
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function AccessLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

export function OverviewPanel({
  user,
  accounts,
}: {
  user: User
  accounts: Account[]
}) {
  const activeAccounts = accounts.filter((account) => account.status === "active").length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Session"
          value={user.role === "admin" ? "Admin" : "Viewer"}
          detail={user.mustChangePassword ? "Password change required." : "Signed in."}
          icon={ShieldCheckIcon}
          tone="good"
        />
        <StatCard
          title="Visible accounts"
          value={String(accounts.length)}
          detail={user.role === "admin" ? "All imported accounts." : "Assigned by an admin."}
          icon={KeyRoundIcon}
        />
        <StatCard
          title="Active accounts"
          value={String(activeAccounts)}
          detail="Rows marked active in D1."
          icon={CheckCircle2Icon}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current access model</CardTitle>
          <CardDescription>
            Logged-in users can use only the account grants and capabilities assigned to their role.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <AccessLine label="Codes" value={accounts.length ? "Available" : "No account"} />
          <AccessLine label="Confirmations" value={user.role === "admin" ? "Admin" : "Blocked"} />
        </CardContent>
      </Card>
    </div>
  )
}
