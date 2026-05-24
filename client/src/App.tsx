import { useEffect, useState } from "react"

import { api } from "@/api"
import { AccountsPanel } from "@/components/accounts-panel"
import { AdminUsersPanel } from "@/components/admin-users-panel"
import { AppSidebar, type AppSection } from "@/components/app-sidebar"
import { AuditPanel } from "@/components/audit-panel"
import { LoginView } from "@/components/login-view"
import { OverviewPanel } from "@/components/overview-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { SiteHeader } from "@/components/site-header"
import { SteamFlowsPanel } from "@/components/steam-flows-panel"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { Account, User } from "@/types"

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeSection, setActiveSection] = useState<AppSection>("overview")
  const [loading, setLoading] = useState(true)

  async function refreshMe() {
    const data = await api<{ user: User }>("/api/auth/me")
    setUser(data.user)
  }

  async function refreshAccounts() {
    const data = await api<{ accounts: Account[] }>("/api/accounts")
    setAccounts(data.accounts)
  }

  async function refreshAll() {
    await refreshMe()
    await refreshAccounts()
  }

  useEffect(() => {
    refreshAll()
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (user?.role === "viewer" && !["overview", "accounts", "settings"].includes(activeSection)) {
      setActiveSection("overview")
    }
  }, [activeSection, user?.role])

  async function logout() {
    await api("/api/auth/logout", { method: "POST" })
    setUser(null)
    setAccounts([])
    setActiveSection("overview")
  }

  if (loading) {
    return (
      <main className="grid min-h-svh place-items-center">
        <p className="text-sm text-muted-foreground">Loading</p>
      </main>
    )
  }

  if (!user) return <LoginView onLogin={refreshAll} />

  return (
    <TooltipProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "18rem",
            "--header-height": "4.5rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar
          variant="inset"
          user={user}
          activeSection={activeSection}
          accountCount={accounts.length}
          onNavigate={setActiveSection}
          onLogout={() => void logout()}
        />
        <SidebarInset>
          <SiteHeader activeSection={activeSection} />
          <div className="@container/main flex flex-1 flex-col">
            <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
              {activeSection === "overview" ? <OverviewPanel user={user} accounts={accounts} /> : null}
              {activeSection === "accounts" ? (
                <AccountsPanel accounts={accounts} role={user.role} onRefresh={refreshAccounts} />
              ) : null}
              {activeSection === "steam" && user.role === "admin" ? (
                <SteamFlowsPanel onComplete={refreshAccounts} />
              ) : null}
              {activeSection === "users" && user.role === "admin" ? (
                <AdminUsersPanel
                  accounts={accounts}
                  currentUserId={user.id}
                  onRefresh={refreshAll}
                />
              ) : null}
              {activeSection === "audit" && user.role === "admin" ? <AuditPanel /> : null}
              {activeSection === "settings" ? <SettingsPanel user={user} onDone={refreshMe} /> : null}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
