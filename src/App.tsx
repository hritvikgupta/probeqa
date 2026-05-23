import { useState, useCallback, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useMatch, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Drawer from './components/Drawer'
import Editor from './components/Editor'
import AgentWorkspace from './components/AgentWorkspace'
import FirstProjectModal from './components/FirstProjectModal'
import Toast from './components/Toast'
import Login from './components/Login'
import Landing from './views/Landing'
import Docs from './views/Docs'
import { BlogIndex, BlogPost } from './views/Blog'
import Overview from './views/Overview'
import Runs from './views/Runs'
import Agents from './views/Agents'
import Tickets from './views/Tickets'
import Settings from './views/Settings'
import Billing from './views/Billing'
import BillingSuccess from './views/BillingSuccess'
import type { EditorTarget, User, Project, OverviewRun } from './types'

const DEFAULT_EDITOR_TARGET: EditorTarget = {
  n: 'Checkout flow',
  url: 'shop.acme.com/checkout',
  mode: 'page',
}

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // The agent workspace and editor are URL-driven overlays: a match means open.
  const agentMatch = useMatch('/agents/:id')
  const editorMatch = useMatch('/editor')
  const workspaceId = agentMatch?.params.id ?? null

  const [drawerRun, setDrawerRun] = useState<OverviewRun | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  // undefined = checking the session, null = signed out, User = signed in.
  const [user, setUser] = useState<User | null | undefined>(undefined)
  // Projects (sidebar grouping). activeProjectId === null means "All agents".
  const [projects, setProjects] = useState<Project[]>([])
  // Persisted across refreshes so the project filter survives a reload.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem('probe_project') || null,
  )
  // false until the first /api/projects fetch resolves — avoids flashing the
  // "create your first project" modal before we know whether any exist.
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const toastTimerRef = { current: 0 as ReturnType<typeof setTimeout> }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null))
  }, [])

  const loadProjects = useCallback(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => {
        const list: Project[] = d.projects ?? []
        setProjects(list)
        // Drop a persisted selection that no longer belongs to this user.
        setActiveProjectId((cur) => (cur && !list.some((p) => p.id === cur) ? null : cur))
      })
      .catch(() => {})
      .finally(() => setProjectsLoaded(true))
  }, [])

  // Remember the active project across page reloads.
  useEffect(() => {
    if (activeProjectId) localStorage.setItem('probe_project', activeProjectId)
    else localStorage.removeItem('probe_project')
  }, [activeProjectId])

  useEffect(() => {
    if (user) loadProjects()
  }, [user, loadProjects])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setProjects([])
    setActiveProjectId(null)
    setProjectsLoaded(false)
    navigate('/login')
  }, [navigate])

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3200)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createProject = useCallback(async (name: string) => {
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Plan-limit gate (HTTP 402) — surface the server message verbatim
        // so the user sees "You've reached your Free-plan limit of 1 projects".
        showToast(d.error || 'Could not create project')
        return
      }
      if (d.project) {
        setProjects((prev) => [...prev, d.project])
        setActiveProjectId(d.project.id)
        navigate('/agents')
        showToast(`Project “${d.project.name}” created`)
      }
    } catch {
      showToast('Could not create project')
    }
  }, [showToast, navigate])

  const openWorkspace = useCallback((id: string) => navigate(`/agents/${id}`), [navigate])
  const closeWorkspace = useCallback(() => navigate('/agents'), [navigate])
  const closeEditor = useCallback(() => navigate(-1), [navigate])

  const openRun = useCallback((run: OverviewRun) => setDrawerRun(run), [])
  const closeDrawer = useCallback(() => setDrawerRun(null), [])

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The marketing landing page lives at "/" — public, standalone, no app shell.
  if (pathname === '/') {
    return <Landing />
  }
  // The documentation page is public and standalone too.
  if (pathname === '/docs') {
    return <Docs />
  }
  // The blog is public and standalone — index + per-post routes.
  if (pathname === '/blog' || pathname.startsWith('/blog/')) {
    return (
      <Routes>
        <Route path="/blog" element={<BlogIndex />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    )
  }
  if (user === undefined) {
    return <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }} />
  }
  // Signed out — only the auth routes exist.
  if (user === null) {
    return (
      <Routes>
        <Route path="/login" element={<Login key="login" mode="login" onAuthed={setUser} />} />
        <Route path="/signup" element={<Login key="signup" mode="register" onAuthed={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <div className="app">
        <Sidebar
          user={user}
          onLogout={logout}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          onCreateProject={createProject}
        />
        <main className="main">
          <Topbar />
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route
              path="/overview"
              element={
                <Overview
                  key={`overview-${activeProjectId}`}
                  projectId={activeProjectId}
                  onRunClick={openRun}
                  onViewRuns={() => navigate('/runs')}
                />
              }
            />
            <Route
              path="/runs"
              element={<Runs key={`runs-${activeProjectId}`} projectId={activeProjectId} onRunClick={openRun} />}
            />
            <Route
              path="/agents"
              element={<Agents key={`agents-${activeProjectId}`} projectId={activeProjectId} onOpen={openWorkspace} />}
            />
            <Route
              path="/agents/:id"
              element={<Agents key={`agents-${activeProjectId}`} projectId={activeProjectId} onOpen={openWorkspace} />}
            />
            <Route
              path="/tickets"
              element={<Tickets key={`tickets-${activeProjectId}`} projectId={activeProjectId} onToast={showToast} />}
            />
            <Route
              path="/settings"
              element={<Settings user={user} onUserUpdate={setUser} onToast={showToast} />}
            />
            <Route
              path="/billing"
              element={<Billing user={user} onToast={showToast} onUserUpdate={setUser} />}
            />
            <Route path="/billing/success" element={<BillingSuccess onUserUpdate={setUser} />} />
            {/* The editor is a full-screen overlay; nothing renders behind it. */}
            <Route path="/editor" element={null} />
            {/* Already signed in — the auth routes fall through to the app. */}
            <Route path="/login" element={<Navigate to="/overview" replace />} />
            <Route path="/signup" element={<Navigate to="/overview" replace />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>

      <Drawer run={drawerRun} onClose={closeDrawer} />

      <Editor
        open={!!editorMatch}
        target={DEFAULT_EDITOR_TARGET}
        projectId={activeProjectId}
        onClose={closeEditor}
      />

      <AgentWorkspace
        agentId={workspaceId}
        open={workspaceId !== null}
        onClose={closeWorkspace}
      />

      {projectsLoaded && projects.length === 0 && (
        <FirstProjectModal onCreate={createProject} />
      )}

      <Toast message={toastMsg} />
    </>
  )
}
