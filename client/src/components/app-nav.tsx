import { useState } from "react"
import {
  ActivityIcon,
  KeyRoundIcon,
  LogInIcon,
  LogOutIcon,
  MenuIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { Role, User } from "@/types"

export type AppSection = "codes" | "signins" | "setup" | "users" | "audit" | "settings"

type NavItem = {
  id: AppSection
  title: string
  icon: React.ComponentType<{ className?: string }>
}

const primaryItems: Record<Role, NavItem[]> = {
  admin: [
    { id: "codes", title: "Codes", icon: KeyRoundIcon },
    { id: "signins", title: "Sign-ins", icon: LogInIcon },
    { id: "setup", title: "Steam setup", icon: SmartphoneIcon },
  ],
  viewer: [{ id: "codes", title: "Codes", icon: KeyRoundIcon }],
}

const adminItems: NavItem[] = [
  { id: "users", title: "Users", icon: UsersIcon },
  { id: "audit", title: "Audit log", icon: ActivityIcon },
]

const settingsItem: NavItem = { id: "settings", title: "Settings", icon: Settings2Icon }

export function sectionsFor(role: Role): AppSection[] {
  return role === "admin"
    ? ["codes", "signins", "setup", "users", "audit", "settings"]
    : ["codes", "settings"]
}

type NavProps = {
  user: User
  activeSection: AppSection
  accountCount: number
  signinAttention: number
  onNavigate: (section: AppSection) => void
  onLogout: () => void
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground",
        className,
      )}
    >
      <ShieldCheckIcon className="size-[18px]" strokeWidth={2.2} />
    </div>
  )
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold",
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function roleLabel(role: Role) {
  return role === "admin" ? "Admin" : "Viewer"
}

function SidebarLink({
  item,
  active,
  trailing,
  onClick,
}: {
  item: NavItem
  active: boolean
  trailing?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
      )}
    >
      <item.icon className={cn("size-4", active && "text-primary")} />
      <span className="flex-1 truncate">{item.title}</span>
      {trailing}
    </button>
  )
}

function AttentionDot({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <>
      <span aria-hidden className="size-[7px] rounded-full bg-warning" />
      <span className="sr-only">, {count} need{count === 1 ? "s" : ""} attention</span>
    </>
  )
}

/** Left rail for md+ screens. */
export function DesktopSidebar({
  user,
  activeSection,
  accountCount,
  signinAttention,
  onNavigate,
  onLogout,
}: NavProps) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-svh w-62 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3.5 py-5 text-sidebar-foreground md:flex"
    >
      <div className="flex items-center gap-2.5 px-2 py-1">
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight">SteamGuard</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {primaryItems[user.role].map((item) => (
          <SidebarLink
            key={item.id}
            item={item}
            active={activeSection === item.id}
            onClick={() => onNavigate(item.id)}
            trailing={
              item.id === "codes" ? (
                <span className="text-xs text-muted-foreground tabular-nums">{accountCount}</span>
              ) : item.id === "signins" ? (
                <AttentionDot count={signinAttention} />
              ) : null
            }
          />
        ))}
      </div>

      {user.role === "admin" ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1.5 text-xs text-subtle">Admin</div>
          {adminItems.map((item) => (
            <SidebarLink
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 rounded-xl p-2">
        <Avatar name={user.username} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user.displayName || user.username}</div>
          <div className="text-xs text-subtle">{roleLabel(user.role)}</div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          aria-current={activeSection === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground",
            activeSection === "settings" && "bg-sidebar-accent text-primary",
          )}
        >
          <Settings2Icon className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Log out"
          onClick={onLogout}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <LogOutIcon className="size-4" />
        </button>
      </div>
    </nav>
  )
}

function TabButton({
  label,
  icon: Icon,
  active,
  dot,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  dot?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-[22px]" />
      {dot ? (
        <span className="absolute top-1 left-[56%] size-2.5 rounded-full border-2 border-sidebar bg-warning" />
      ) : null}
      {label}
    </button>
  )
}

const tabLabels: Partial<Record<AppSection, string>> = { setup: "Setup" }

/** Bottom tab bar for phones. Secondary sections live in the "More" sheet. */
export function MobileTabBar({
  user,
  activeSection,
  signinAttention,
  onNavigate,
  onLogout,
}: NavProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const tabs = primaryItems[user.role]
  const moreItems = user.role === "admin" ? [...adminItems, settingsItem] : [settingsItem]
  const moreActive = moreItems.some((item) => item.id === activeSection)

  function go(section: AppSection) {
    setMoreOpen(false)
    onNavigate(section)
  }

  return (
    <>
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 grid border-t border-sidebar-border bg-sidebar/95 px-2 pt-1.5 backdrop-blur md:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map((item) => (
          <TabButton
            key={item.id}
            label={tabLabels[item.id] ?? item.title}
            icon={item.icon}
            active={activeSection === item.id}
            dot={item.id === "signins" && signinAttention > 0}
            onClick={() => go(item.id)}
          />
        ))}
        <TabButton
          label="More"
          icon={MenuIcon}
          active={moreActive}
          onClick={() => setMoreOpen(true)}
        />
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="pb-safe gap-4 rounded-t-[22px] border-0 bg-card px-4 pt-2.5"
        >
          <div aria-hidden className="mx-auto h-[5px] w-9 rounded-full bg-muted" />
          <SheetHeader className="flex-row items-center gap-3 p-0 px-1">
            <Avatar name={user.username} className="size-10" />
            <div className="min-w-0">
              <SheetTitle className="truncate text-[17px]">
                {user.displayName || user.username}
              </SheetTitle>
              <SheetDescription>{roleLabel(user.role)}</SheetDescription>
            </div>
          </SheetHeader>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-secondary">
            {moreItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className={cn(
                  "flex min-h-14 items-center gap-3.5 px-4 text-left text-[15px]",
                  index > 0 && "border-t border-border",
                  activeSection === item.id && "text-primary",
                )}
              >
                <item.icon className="size-5 text-primary" />
                <span className="flex-1">{item.title}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false)
              onLogout()
            }}
            className="mb-2 flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-secondary text-[15px] font-semibold"
          >
            <LogOutIcon className="size-4" />
            Log out
          </button>
        </SheetContent>
      </Sheet>
    </>
  )
}

export { BrandMark }
