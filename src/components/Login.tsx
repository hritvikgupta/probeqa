import { useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '../types'
import loginImg from '../assets/spot-3.jpg'
import './Login.css'

interface Props {
  /** Which form to show — driven by the /login vs /signup route. */
  mode: 'login' | 'register'
  onAuthed: (u: User) => void
}

/** Sign-in / sign-up screen — image panel left, form right, on the cream theme. */
export default function Login({ mode, onAuthed }: Props) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'register' ? { email, password, name } : { email, password },
        ),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(d.error || 'Something went wrong.')
        return
      }
      onAuthed(d.user)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className="login-page">
      <div className="login-visual" style={{ backgroundImage: `url(${loginImg})` }}>
        <div className="login-visual-fade" />
        <div className="login-mark">
          <span className="cube">
            <svg viewBox="0 0 24 24" shapeRendering="crispEdges">
              <polygon points="12,2 22,7 12,12 2,7" fill="#A8A8A8" />
              <polygon points="2,7 12,12 12,22 2,17" fill="#545454" />
              <polygon points="22,7 12,12 12,22 22,17" fill="#3A3A3A" />
            </svg>
          </span>
          Probe
        </div>
        <p className="login-quote">
          Autonomous QA agents that test every surface, every release — so the test pyramid scales
          with your product.
        </p>
      </div>

      <div className="login-panel">
        <div className="login-form">
          <div className="login-head">
            <h1 className="login-title">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="login-sub">
              {mode === 'login'
                ? 'Sign in to your testing workspaces.'
                : 'Your agents, runs and memory are saved to your account.'}
            </p>
          </div>

          {mode === 'register' && (
            <div className="login-field">
              <label htmlFor="login-name">Name</label>
              <input
                id="login-name"
                className="login-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onKey}
                placeholder="Jane Doe"
              />
            </div>
          )}

          <div className="login-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onKey}
              placeholder="you@company.com"
              autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
              placeholder="••••••••"
            />
          </div>

          {err && <div className="login-error">{err}</div>}

          <button
            className="login-submit"
            onClick={submit}
            disabled={busy || !email.trim() || !password}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          <div className="login-alt">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              className="login-alt-link"
              onClick={() => navigate(mode === 'login' ? '/signup' : '/login')}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
