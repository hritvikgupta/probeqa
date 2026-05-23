import { useState } from 'react'
import { TARGETS } from '../data'
import StatusBadge from '../components/StatusBadge'
import type { EditorTarget } from '../types'

type Tab = 'apps' | 'pages' | 'apis'

interface Props {
  onTargetClick: (target: EditorTarget) => void
}

export default function Targets({ onTargetClick }: Props) {
  const [tab, setTab] = useState<Tab>('apps')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'apps', label: 'Web apps' },
    { key: 'pages', label: 'Pages' },
    { key: 'apis', label: 'APIs' },
  ]

  return (
    <section className="page">
      <div className="tabs">
        {tabs.map(t => (
          <button key={t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Base URL</th><th>Agent</th><th>Last status</th></tr>
          </thead>
          <tbody>
            {TARGETS[tab].map((r, i) => {
              const edTarget: EditorTarget = {
                n: r.n,
                url: r.url,
                mode: r.ty === 'API' ? 'api' : 'page',
              }
              return (
                <tr key={i} onClick={() => onTargetClick(edTarget)}>
                  <td><span className="name">{r.n}</span></td>
                  <td><span className="type-pill">{r.ty.toLowerCase()}</span></td>
                  <td className="mono">{r.url}</td>
                  <td className="muted">{r.a}</td>
                  <td><StatusBadge status={r.s} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
