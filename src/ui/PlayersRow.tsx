import type { GameState, OrderTarget } from '../engine/types'
import { describeRumorTarget } from './cardHelpers'

function describeDeclaredTarget(state: GameState, target: OrderTarget): string {
  if (target.kind !== 'opponent') return describeRumorTarget(state.config, target)
  const opponentName = state.players.find((o) => o.id === target.opponentId)?.name
  return describeRumorTarget(state.config, target, opponentName)
}

const CONTROLLER_BADGE: Record<string, string> = {
  human: '🧑',
  bot: '🤖',
}

const ROLE_LABEL: Record<string, string> = {
  valueInvestor: 'Value Investor',
  trader: 'Trader',
}

export function PlayersRow({ state, activePlayerId }: { state: GameState; activePlayerId?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {state.players.map((p) => {
        const declaration = state.orderDeclarations.find((d) => d.playerId === p.id)
        const pendingNews = state.pendingMarketNews.filter((n) => n.playerId === p.id).length
        const isActive = p.id === activePlayerId
        const isFirst = p.id === state.firstPlayerId
        return (
          <div
            key={p.id}
            style={{
              flex: '1 1 200px',
              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10,
              padding: 10,
              background: 'var(--panel)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--text-h)' }}>
                {CONTROLLER_BADGE[p.controller]} {p.name} {isFirst && '👑'}
              </strong>
              <span className="mono" style={{ fontWeight: 700 }}>
                ${p.cash}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {p.role && <span className="tag">{ROLE_LABEL[p.role]}</span>}
              <span className="tag">🗂 {p.actionCards.length}</span>
              <span className="tag">🗞 {p.rumorCards.length}</span>
              <span className="tag">📦 {p.etfCards.length}</span>
              {pendingNews > 0 && <span className="tag">📰 ×{pendingNews} in arrivo</span>}
            </div>
            {declaration && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                Bersaglio dichiarato: <strong style={{ color: 'var(--text-h)' }}>{describeDeclaredTarget(state, declaration.target)}</strong>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
