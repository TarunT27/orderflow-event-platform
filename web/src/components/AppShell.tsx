import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icons.js'

const navItems: { href: string; label: string; icon: IconName }[] = [
  { href: '#create-order', label: 'Create', icon: 'cart' },
  { href: '#inventory', label: 'Inventory', icon: 'cube' },
  { href: '#orders', label: 'Orders', icon: 'layers' },
  { href: '#operations', label: 'Operations', icon: 'activity' },
  { href: '#dead-letters', label: 'DLQ', icon: 'archive' },
]

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="OrderFlow dashboard home">
          <span className="brand__mark" aria-hidden="true"><span /></span>
          <span>OrderFlow</span>
        </a>
        <div className="topbar__status" aria-label="System connection status">
          <span className="live-dot" />
          API connected
        </div>
      </header>

      <nav className="section-nav" aria-label="Dashboard sections">
        {navItems.map((item) => (
          <a href={item.href} key={item.href}>
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <main id="top">{children}</main>
    </div>
  )
}
