import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SessionUser } from '@/lib/auth'

export interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
}

/**
 * PortalShell — dark sidebar + topbar layout shared by both portals.
 * The shell renders NOTHING until `user` is present, so unauthenticated
 * content can never leak into the authenticated frame.
 */
export function PortalShell({
  brand,
  brandSub,
  nav,
  user,
  onLogout,
  children,
  banner,
}: {
  brand: string
  brandSub: string
  nav: NavItem[]
  user: SessionUser
  onLogout: () => void
  children: React.ReactNode
  banner?: React.ReactNode
}) {
  const navigate = useNavigate()
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white">
            <Zap className="h-4.5 w-4.5 h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">{brand}</p>
            <p className="text-[11px] text-sidebar-foreground/70">{brandSub}</p>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-sidebar-foreground/50">
          Zoo Studios Platform
          <br />
          Secure client & staff portals
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
          {banner}
          <div className="flex h-14 items-center justify-end gap-3 px-4 md:px-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-md px-2 py-1.5 outline-none ring-ring focus-visible:ring-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials || 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm font-medium leading-tight">{user.name}</span>
                    <span className="block text-xs text-muted-foreground">{user.email}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>{user.name}</span>
                  <Badge variant={user.role === 'ADMIN' ? 'default' : user.role === 'SERVICEMAN' ? 'info' : 'secondary'} className="text-[10px]">
                    {user.role}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    onLogout()
                    navigate('/login', { replace: true })
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b bg-white px-3 py-2 md:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={() => {
              onLogout()
              navigate('/login', { replace: true })
            }}
            className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-destructive"
          >
            Sign out
          </button>
        </nav>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
