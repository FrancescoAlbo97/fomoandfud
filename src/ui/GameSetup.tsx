import { useState } from 'react'
import { AGENT_NAMES } from '../engine/agents'
import type { NewPlayerConfig } from '../engine/engine'

/** 'human' oppure il nome di un agente della AGENT_REGISTRY. */
type SeatBrain = 'human' | string

interface SeatConfig {
  name: string
  brain: SeatBrain
}

const BRAIN_OPTIONS: SeatBrain[] = ['human', ...AGENT_NAMES]
const brainLabel = (brain: SeatBrain) => (brain === 'human' ? '🧑 Umano' : `🤖 ${brain}`)

function defaultSeats(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Giocatore ${i + 1}`,
    brain: i === 0 ? 'human' : 'heuristic',
  }))
}

export function GameSetup({ onStart }: { onStart: (players: NewPlayerConfig[]) => void }) {
  const [seats, setSeats] = useState<SeatConfig[]>(defaultSeats(4))

  function setCount(n: number) {
    setSeats((prev) => {
      const next = defaultSeats(n)
      for (let i = 0; i < Math.min(n, prev.length); i++) next[i] = prev[i]
      return next
    })
  }

  function updateSeat(i: number, patch: Partial<SeatConfig>) {
    setSeats((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function start() {
    const players: NewPlayerConfig[] = seats.map((s, i) => ({
      id: `p${i}`,
      name: s.name.trim() || `Giocatore ${i + 1}`,
      controller: s.brain === 'human' ? 'human' : 'bot',
      agentName: s.brain === 'human' ? undefined : s.brain,
    }))
    onStart(players)
  }

  return (
    <div style={{ maxWidth: 640, margin: '48px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 4 }}>📈 FOMO &amp; FUD</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 32 }}>
        Un gioco di manipolazione del mercato per 3–5 giocatori.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ color: 'var(--text-dim)' }}>Numero di giocatori</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {[3, 4, 5].map((n) => (
            <button key={n} className={seats.length === n ? 'primary' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {seats.map((seat, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--panel)',
            }}
          >
            <input
              value={seat.name}
              onChange={(e) => updateSeat(i, { name: e.target.value })}
              style={{ flex: 1 }}
              maxLength={24}
            />
            <select value={seat.brain} onChange={(e) => updateSeat(i, { brain: e.target.value })}>
              {BRAIN_OPTIONS.map((brain) => (
                <option key={brain} value={brain}>
                  {brainLabel(brain)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 16 }}>
        Gli agenti sono gli stessi che girano nel simulatore (<code>npm run sim</code>): quello che batti al tavolo è
        esattamente quello che misuri in migliaia di partite. <strong>random</strong> è il pavimento,{' '}
        <strong>heuristic</strong> la baseline, gli altri sono archetipi con personalità diverse.
      </p>

      <button className="primary" style={{ marginTop: 24, padding: '10px 20px', fontSize: 16 }} onClick={start}>
        Inizia partita
      </button>
    </div>
  )
}
