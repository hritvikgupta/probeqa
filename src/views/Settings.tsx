import { useEffect, useRef, useState } from 'react'
import type { User } from '../types'

interface InboxInfo {
  enabled: boolean
  address: string | null
}

interface Props {
  user: User
  onUserUpdate: (u: User) => void
  onToast: (msg: string) => void
}

/** Avatars are kept client-side as a small downscaled data URL, keyed by user. */
const avatarKey = (id: string) => `probe_avatar_${id}`

function initials(name: string) {
  return (
    name
      .split(/[\s·@.]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U'
  )
}

/** Read an image file, centre-crop it to a 256px square JPEG data URL. */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas'))
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export default function Settings({ user, onUserUpdate, onToast }: Props) {
  const [inbox, setInbox] = useState<InboxInfo | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  // Profile
  const [name, setName] = useState(user.name)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Password
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)


  useEffect(() => {
    fetch('/api/email/inbox')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setInbox(d))
      .catch(() => setInbox(null))
  }, [])

  useEffect(() => {
    setName(user.name)
    setAvatar(localStorage.getItem(avatarKey(user.id)))
  }, [user.id, user.name])

  function copy() {
    if (!inbox?.address) return
    navigator.clipboard.writeText(inbox.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = await fileToAvatar(file)
      localStorage.setItem(avatarKey(user.id), data)
      setAvatar(data)
      window.dispatchEvent(new CustomEvent('probe-avatar-changed'))
      onToast('Profile picture updated')
    } catch {
      onToast('Could not read that image')
    }
  }

  function removeAvatar() {
    localStorage.removeItem(avatarKey(user.id))
    setAvatar(null)
    window.dispatchEvent(new CustomEvent('probe-avatar-changed'))
    onToast('Profile picture removed')
  }

  async function saveProfile() {
    const trimmed = name.trim()
    if (!trimmed) {
      onToast('Name cannot be empty')
      return
    }
    setSavingProfile(true)
    try {
      const r = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        onToast(d.error || 'Could not save profile')
        return
      }
      onUserUpdate(d.user)
      onToast('Profile saved')
    } catch {
      onToast('Could not save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    if (!currentPw || !newPw) {
      onToast('Fill in both password fields')
      return
    }
    if (newPw.length < 6) {
      onToast('New password must be at least 6 characters')
      return
    }
    if (newPw !== confirmPw) {
      onToast('New passwords do not match')
      return
    }
    setSavingPw(true)
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        onToast(d.error || 'Could not change password')
        return
      }
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      onToast('Password changed')
    } catch {
      onToast('Could not change password')
    } finally {
      setSavingPw(false)
    }
  }

  const nameDirty = name.trim() !== user.name && name.trim() !== ''

  return (
    <section className="page">
      {/* ---- Profile ---- */}
      <div className="panel" style={{ padding: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Profile</div>
        <div className="sub" style={{ marginTop: 5, maxWidth: 520 }}>
          Your name and picture appear across the workspace.
        </div>

        <div
          style={{
            marginTop: 22,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexWrap: 'wrap',
          }}
        >
          <div className="avatar-lg">
            {avatar ? <img src={avatar} alt="" /> : <span>{initials(user.name || user.email)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>
                {avatar ? 'Change picture' : 'Upload picture'}
              </button>
              {avatar && (
                <button className="btn ghost" onClick={removeAvatar}>
                  Remove
                </button>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              JPG or PNG — cropped to a square.
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={pickAvatar}
            style={{ display: 'none' }}
          />
        </div>

        <div style={{ marginTop: 22, maxWidth: 380 }}>
          <label className="field-label">Display name</label>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div style={{ marginTop: 16, maxWidth: 380 }}>
          <label className="field-label">Email</label>
          <input className="field-input" value={user.email} disabled />
        </div>

        <div style={{ marginTop: 20 }}>
          <button className="btn" onClick={saveProfile} disabled={savingProfile || !nameDirty}>
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>

      {/* ---- Password ---- */}
      <div className="panel" style={{ padding: 28, marginTop: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Password</div>
        <div className="sub" style={{ marginTop: 5, maxWidth: 520 }}>
          Choose a strong password you don't reuse elsewhere.
        </div>

        <div style={{ marginTop: 20, maxWidth: 380 }}>
          <label className="field-label">Current password</label>
          <input
            className="field-input"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div style={{ marginTop: 16, maxWidth: 380 }}>
          <label className="field-label">New password</label>
          <input
            className="field-input"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div style={{ marginTop: 16, maxWidth: 380 }}>
          <label className="field-label">Confirm new password</label>
          <input
            className="field-input"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <button className="btn" onClick={savePassword} disabled={savingPw}>
            {savingPw ? 'Updating…' : 'Change password'}
          </button>
        </div>
      </div>

      {/* ---- Email agent ---- */}
      <div className="panel" style={{ padding: 28, marginTop: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Email agent</div>
        <div className="sub" style={{ marginTop: 5, maxWidth: 520 }}>
          Email this address in plain English — the agent can create testing agents, run them, and
          email you the results. Write from your Probe account email so it knows it's you.
        </div>

        {inbox === undefined ? (
          <div className="muted" style={{ marginTop: 18 }}>Loading…</div>
        ) : !inbox || !inbox.enabled ? (
          <div className="muted" style={{ marginTop: 18 }}>
            Not configured — set <span className="mono">AGENTMAIL_API_KEY</span> on the server.
          </div>
        ) : !inbox.address ? (
          <div className="muted" style={{ marginTop: 18 }}>
            Inbox is still being created — check back shortly.
          </div>
        ) : (
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 13,
                padding: '9px 12px',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 7,
              }}
            >
              {inbox.address}
            </span>
            <button className="btn ghost" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
