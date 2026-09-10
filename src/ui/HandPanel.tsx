import type { PlayerState } from '../engine/types'
import { ActionCardFace, EtfCardFace, RumorCardFace } from './cards'

export function HandPanel({ player }: { player: PlayerState }) {
  const isEmpty = player.actionCards.length === 0 && player.rumorCards.length === 0 && player.etfCards.length === 0
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>🖐 La tua mano — {player.name}</h3>
      {isEmpty && <p style={{ color: 'var(--text-dim)' }}>Non hai ancora nessuna carta in mano.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {player.actionCards.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase' }}>Carte Azione</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {player.actionCards.map((c) => (
                <ActionCardFace key={c.instanceId} card={c} small />
              ))}
            </div>
          </div>
        )}
        {player.rumorCards.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase' }}>Carte Rumor</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {player.rumorCards.map((c) => (
                <RumorCardFace key={c.instanceId} card={c} />
              ))}
            </div>
          </div>
        )}
        {player.etfCards.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase' }}>Carte ETF (obiettivi segreti)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {player.etfCards.map((c) => (
                <EtfCardFace key={c.instanceId} card={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
