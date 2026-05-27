import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { User, Project } from '../types'

function projInitials(name: string) {
  return name.split(/[\s·]+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'P'
}

interface Props {
  user: User
  onLogout: () => void
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string) => void
}

export default function Sidebar({
  user, onLogout,
  projects, activeProjectId, onSelectProject, onCreateProject,
}: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const [avatar, setAvatar] = useState<string | null>(
    () => localStorage.getItem(`probe_avatar_${user.id}`),
  )

  // Keep the footer avatar in sync when it's changed from the Settings page.
  useEffect(() => {
    const sync = () => setAvatar(localStorage.getItem(`probe_avatar_${user.id}`))
    sync()
    window.addEventListener('probe-avatar-changed', sync)
    return () => window.removeEventListener('probe-avatar-changed', sync)
  }, [user.id])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setAdding(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const active = projects.find(p => p.id === activeProjectId)
  const activeName = active?.name ?? 'All projects'

  function submitNew() {
    const name = draft.trim()
    if (!name) return
    onCreateProject(name)
    setDraft('')
    setAdding(false)
    setMenuOpen(false)
  }

  const navItems: { path: string; label: string; icon: React.ReactNode }[] = [
    {
      path: '/overview', label: 'Overview',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>,
    },
    {
      path: '/editor', label: 'Quick chat',
      icon: <svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>,
    },
    {
      path: '/runs', label: 'Runs',
      icon: <svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>,
    },
    {
      path: '/agents', label: 'Agents',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>,
    },
    {
      path: '/tickets', label: 'Tickets',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/></svg>,
    },
    {
      path: '/recordings', label: 'Recordings',
      icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>,
    },
  ]

  const settingsIcon = (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
  )
  const docsIcon = (
    <svg viewBox="0 0 24 24"><path d="M6 2h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><polyline points="14 2 14 8 19 8"/><line x1="8.5" y1="13" x2="15" y2="13"/><line x1="8.5" y1="16.5" x2="15" y2="16.5"/></svg>
  )
  const billingIcon = (
    <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="11" y2="15"/></svg>
  )

  const isActive = (path: string) => pathname.startsWith(path)

  return (
    <aside className="side">
      <div className="brand">
        {/* White voxel cube — same mark as the landing nav, tuned for the dark sidebar. */}
        <svg className="brand-mark" viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
          <polygon points="12,2 22,7 12,12 2,7" fill="#FFFFFF" />
          <polygon points="2,7 12,12 12,22 2,17" fill="#BFBFBF" />
          <polygon points="22,7 12,12 12,22 22,17" fill="#8A8A8A" />
        </svg>
        <div className="brand-name">Probe</div>
      </div>

      <div style={{ position: 'relative' }} ref={menuRef}>
        <button className="proj" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}>
          <div className="proj-ic">{active ? projInitials(active.name) : '◎'}</div>
          <span className="proj-name">{activeName}</span>
          <span className="proj-caret">
            <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div className={`proj-menu${menuOpen ? ' on' : ''}`}>
          <button
            className={`proj-opt${activeProjectId === null ? ' on' : ''}`}
            onClick={() => { onSelectProject(null); setMenuOpen(false) }}
          >
            <div className="proj-ic">◎</div>
            All projects
            <span className="check">
              <svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>
            </span>
          </button>
          {projects.map(p => (
            <button
              key={p.id}
              className={`proj-opt${p.id === activeProjectId ? ' on' : ''}`}
              onClick={() => { onSelectProject(p.id); setMenuOpen(false) }}
            >
              <div className="proj-ic">{projInitials(p.name)}</div>
              {p.name}
              <span className="check">
                <svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>
              </span>
            </button>
          ))}
          <div className="proj-divider" />
          {adding ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitNew()
                  if (e.key === 'Escape') { setAdding(false); setDraft('') }
                }}
                placeholder="Project name"
                style={{
                  flex: 1, minWidth: 0, padding: '6px 8px',
                  background: 'var(--panel)', border: '1px solid var(--line)',
                  borderRadius: 6, color: 'var(--ink)', fontSize: 12.5,
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button
                onClick={submitNew}
                style={{
                  background: 'var(--ink)', color: '#111', border: 0, borderRadius: 6,
                  padding: '6px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              className="proj-opt"
              onClick={e => { e.stopPropagation(); setAdding(true) }}
            >
              <div className="proj-ic" style={{ background: 'transparent', border: '1px dashed var(--line)', color: 'var(--ink-3)' }}>+</div>
              New project
            </button>
          )}
        </div>
      </div>

      <nav className="nav">
        {navItems.map(item => (
          <button
            key={item.path}
            className={`nav-item${isActive(item.path) ? ' active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <div className="foot-nav">
          <button
            className={`nav-item${isActive('/settings') ? ' active' : ''}`}
            onClick={() => navigate('/settings')}
          >
            {settingsIcon}
            Settings
          </button>
          <button
            className={`nav-item${pathname === '/billing' || pathname.startsWith('/billing/') ? ' active' : ''}`}
            onClick={() => navigate('/billing')}
          >
            {billingIcon}
            Billing
          </button>
          <button
            className={`nav-item${isActive('/docs') ? ' active' : ''}`}
            onClick={() => navigate('/docs')}
          >
            {docsIcon}
            Docs
            <svg className="foot-ext" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="7" y1="17" x2="17" y2="7"/>
              <polyline points="8 7 17 7 17 16"/>
            </svg>
          </button>
        </div>
        <div className="me">
          <div className="me-av">
            {avatar ? <img src={avatar} alt="" /> : projInitials(user.name || user.email)}
          </div>
          <div className="me-name" title={user.email}>{user.name || user.email}</div>
          <button
            className="me-org"
            onClick={onLogout}
            title="Sign out"
            style={{ background: 'transparent', border: 0, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
