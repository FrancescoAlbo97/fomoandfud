import { rankResults } from '../engine/scoring'
import type { GameState } from '../engine/types'

export function GameOverScreen({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  if (!state.gameOverResult) return null
  const ranked = rankResults(state, state.gameOverResult)

  return (
    <div style={{ maxWidth: 720, margin: '48px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>🏆 Fine partita</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ranked.map((r, i) => {
          const player = state.players.find((p) => p.id === r.playerId)!
          return (
            <div
              key={r.playerId}
              style={{
                border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: 14,
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ color: 'var(--text-h)', fontSize: 16 }}>
                  {i + 1}° — {player.name}
                </strong>
                <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                  {r.totalPV} PV
                </span>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>
                Patrimonio ${r.wealth} (contanti ${r.cash} + titoli ${r.holdingsValue}) → {r.wealthPV} PV &nbsp;·&nbsp; ETF: {r.etfPV} PV
              </div>
              {r.completedEtfs.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {r.completedEtfs.map((id) => (
                    <span key={id} className="tag" style={{ marginRight: 6 }}>
                      ✅ {state.config.etfById[id].name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button className="primary" style={{ marginTop: 24, padding: '10px 20px' }} onClick={onRestart}>
        Nuova partita
      </button>
    </div>
  )
}
