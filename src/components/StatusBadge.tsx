import type { StatusType } from '../types'

const LABELS: Record<StatusType, string> = {
  ok: 'Passed',
  fail: 'Failed',
  run: 'Running',
  warn: 'Diff',
}

export default function StatusBadge({ status }: { status: StatusType }) {
  return (
    <span className={`st ${status}`}>
      <span className="dot" />
      {LABELS[status]}
    </span>
  )
}
