import { useEffect, useRef } from 'react'
import type { LogEntry } from '../engine/types'

export function LogPanel({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [log.length])

  return (
    <div
      ref={ref}
      className="scrollbar-thin"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--panel)',
        padding: 10,
        height: '100%',
        overflowY: 'auto',
        fontSize: 12.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {log.map((entry) => (
        <div key={entry.id} style={{ color: 'var(--text-dim)' }}>
          {entry.text}
        </div>
      ))}
    </div>
  )
}
