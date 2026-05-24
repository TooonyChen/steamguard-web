import {
  ActivityIcon,
  FileKey2Icon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ShieldIcon,
  SmartphoneIcon,
  UserRoundCogIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

export type AppSection =
  | "overview"
  | "accounts"
  | "steam"
  | "users"
  | "audit"
  | "settings"

type SidebarUser = {
  username: string
  role: "admin" | "viewer"
}

const adminItems = [
  { id: "overview", title: "Overview", icon: LayoutDashboardIcon },
  { id: "accounts", title: "Accounts", icon: KeyRoundIcon },
  { id: "steam", title: "Steam setup", icon: SmartphoneIcon },
  { id: "users", title: "Users", icon: UserRoundCogIcon },
  { id: "audit", title: "Audit", icon: ActivityIcon },
  { id: "settings", title: "Settings", icon: ShieldIcon },
] satisfies Array<{ id: AppSection; title: string; icon: React.ComponentType<{ className?: string }> }>

const viewerItems = [
  { id: "overview", title: "Overview", icon: LayoutDashboardIcon },
  { id: "accounts", title: "Accounts", icon: KeyRoundIcon },
  { id: "settings", title: "Settings", icon: ShieldIcon },
] satisfies Array<{ id: AppSection; title: string; icon: React.ComponentType<{ className?: string }> }>

export function AppSidebar({
  user,
  activeSection,
  accountCount,
  onNavigate,
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SidebarUser
  activeSection: AppSection
  accountCount: number
  onNavigate: (section: AppSection) => void
  onLogout: () => void
}) {
  const items = user.role === "admin" ? adminItems : viewerItems
  const { isMobile, setOpenMobile } = useSidebar()

  function handleNavigate(section: AppSection) {
    onNavigate(section)
    if (isMobile) setOpenMobile(false)
  }

  function handleLogout() {
    if (isMobile) setOpenMobile(false)
    onLogout()
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="h-auto py-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileKey2Icon className="size-5" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">SteamGuard Web</span>
                <span className="truncate text-xs text-muted-foreground">
                  Self-hosted control plane
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={activeSection === item.id}
                    tooltip={item.title}
                    onClick={() => handleNavigate(item.id)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                    {item.id === "accounts" ? (
                      <Badge variant="outline" className="ml-auto h-5 min-w-5 rounded-md px-1.5">
                        {accountCount}
                      </Badge>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter className="p-3">
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </div>
            <Badge variant={user.role === "admin" ? "default" : "secondary"}>
              {user.role}
            </Badge>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border bg-background text-sm hover:bg-muted"
          >
            <LogOutIcon className="size-4" />
            Logout
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
