import { useEffect, useState } from "react"

import { api } from "@/api"
import { AccountsPanel } from "@/components/accounts-panel"
import { AdminUsersPanel } from "@/components/admin-users-panel"
import { DesktopSidebar, MobileTabBar, sectionsFor, type AppSection } from "@/components/app-nav"
import { AuditPanel } from "@/components/audit-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { LoginStatusPanel } from "@/components/login-status-panel"
import { LoginView } from "@/components/login-view"
import { PasswordChangeGate, SettingsPanel } from "@/components/settings-panel"
import { SteamFlowsPanel } from "@/components/steam-flows-panel"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSigninStatuses } from "@/hooks/use-signin-statuses"
import type { Account, User } from "@/types"

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeSection, setActiveSection] = useState<AppSection>("codes")
  const [loading, setLoading] = useState(true)
  const isAdmin = user?.role === "admin" && !user.mustChangePassword
  const signins = useSigninStatuses(accounts, isAdmin)

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
    if (user && !sectionsFor(user.role).includes(activeSection)) {
      setActiveSection("codes")
    }
  }, [activeSection, user])

  function navigate(section: AppSection) {
    setActiveSection(section)
    window.scrollTo({ top: 0 })
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" })
    setUser(null)
    setAccounts([])
    setActiveSection("codes")
  }

  if (loading) {
    return (
      <main className="grid min-h-svh place-items-center">
        <p className="text-sm text-muted-foreground">Loading</p>
      </main>
    )
  }

  if (!user) return <LoginView onLogin={refreshAll} />

  if (user.mustChangePassword) {
    return <PasswordChangeGate user={user} onDone={refreshAll} onLogout={() => void logout()} />
  }

  const navProps = {
    user,
    activeSection,
    accountCount: accounts.length,
    signinAttention: signins.attention,
    onNavigate: navigate,
    onLogout: () => void logout(),
  }

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="flex min-h-svh">
          <DesktopSidebar {...navProps} />
          <main className="pb-tabbar min-w-0 flex-1 px-4 pt-5 md:px-10 md:pt-8 md:pb-12">
            <div className="mx-auto flex max-w-[960px] flex-col gap-5 md:gap-6">
              {activeSection === "codes" ? (
                <AccountsPanel
                  accounts={accounts}
                  role={user.role}
                  signinStatuses={signins.statuses}
                  onRefresh={refreshAccounts}
                  onOpenSignins={() => navigate("signins")}
                />
              ) : null}
              {activeSection === "signins" && isAdmin ? (
                <LoginStatusPanel accounts={accounts} signins={signins} onRefresh={refreshAccounts} />
              ) : null}
              {activeSection === "setup" && isAdmin ? (
                <SteamFlowsPanel onComplete={refreshAccounts} />
              ) : null}
              {activeSection === "users" && isAdmin ? (
                <AdminUsersPanel accounts={accounts} currentUserId={user.id} onRefresh={refreshAll} />
              ) : null}
              {activeSection === "audit" && isAdmin ? <AuditPanel accounts={accounts} /> : null}
              {activeSection === "settings" ? <SettingsPanel user={user} onDone={refreshMe} /> : null}
            </div>
          </main>
          <MobileTabBar {...navProps} />
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  )
}
