import type { AppSection } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const titles: Record<AppSection, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Session status, visible accounts, and recent operational state.",
  },
  accounts: {
    title: "Accounts",
    description: "Steam Guard codes, confirmations, and account access.",
  },
  steam: {
    title: "Steam setup",
    description: "Create or transfer an authenticator through a guided Steam flow.",
  },
  users: {
    title: "Users",
    description: "Create viewers and assign per-account visibility.",
  },
  audit: {
    title: "Audit",
    description: "Security-relevant events written by the Worker API.",
  },
  settings: {
    title: "Settings",
    description: "Change your own username and password.",
  },
}

export function SiteHeader({
  activeSection,
}: {
  activeSection: AppSection
}) {
  const current = titles[activeSection]

  return (
    <header className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur">
      <div className="flex w-full items-center gap-3 px-4 py-3 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium">{current.title}</h1>
          <p className="hidden truncate text-sm text-muted-foreground sm:block">
            {current.description}
          </p>
        </div>
      </div>
    </header>
  )
}
