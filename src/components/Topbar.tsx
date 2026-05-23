import { useLocation } from 'react-router-dom'

/** Breadcrumb label for the current route. */
function crumbFor(pathname: string): string {
  if (pathname === '/') return 'Overview'
  if (pathname.startsWith('/runs')) return 'Runs'
  if (pathname.startsWith('/agents')) return 'Agents'
  if (pathname.startsWith('/tickets')) return 'Tickets'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/editor')) return 'Editor'
  return 'Overview'
}

export default function Topbar() {
  const { pathname } = useLocation()
  return (
    <div className="topbar">
      <div className="crumb">{crumbFor(pathname)}</div>
      <div className="top-spacer" />
      <div className="search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>
        </svg>
        <input placeholder="Search" />
        <span className="kbd">⌘K</span>
      </div>
    </div>
  )
}
