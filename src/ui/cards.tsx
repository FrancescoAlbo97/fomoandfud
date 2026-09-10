import type { ActionCardInstance, ETFCardInstance, RumorCardInstance, SectorId } from '../engine/types'
import { describeRumorTarget, sectorBgClass, sectorClass } from './cardHelpers'
import { useConfig } from './configContext'

export function ActionCardFace({ card, small }: { card: ActionCardInstance; small?: boolean }) {
  const config = useConfig()
  const def = config.actionById[card.defId]
  const sector = config.sectorById[def.sector]
  return (
    <div
      className={sectorBgClass(def.sector)}
      style={{
        border: '1px solid',
        borderRadius: 8,
        padding: small ? '4px 8px' : '8px 10px',
        fontSize: small ? 12 : 13,
        minWidth: small ? 0 : 96,
      }}
      title={`${def.name} (${sector.label})`}
    >
      <div className={sectorClass(def.sector)} style={{ fontWeight: 600 }}>
        {sector.icon} {sector.label}
      </div>
      {!small && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{def.name}</div>}
    </div>
  )
}

export function RumorCardFace({ card }: { card: RumorCardInstance }) {
  const config = useConfig()
  const def = config.rumorById[card.defId]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, background: 'var(--panel-2)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text-h)' }}>{def.name}</div>
      <div style={{ color: 'var(--text-dim)', margin: '4px 0' }}>Bersaglio: {describeRumorTarget(config, def.target)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>
          <span className="tag">Inside</span> {effectLabel(def.insideTrading)}
        </span>
        <span>
          <span className="tag">Market News</span> {effectLabel(def.marketNews)}
        </span>
      </div>
    </div>
  )
}

function effectLabel(effect: { kind: string; amount?: number }): string {
  switch (effect.kind) {
    case 'movePrice':
      return `Settore ${effect.amount! >= 0 ? '+' : ''}${effect.amount}`
    case 'adjustFees':
      return `Commissioni ${effect.amount! >= 0 ? '+' : ''}${effect.amount}`
    case 'discardRandomRumor':
      return 'Bersaglio scarta 1 Rumor a caso'
    case 'discardChosenRumorAndAzione':
      return 'Bersaglio scarta 1 Rumor + 1 Azione'
    case 'peekHand':
      return 'Guarda le Azioni in mano al bersaglio'
    case 'swapAzioneCard':
      return 'Scambia 1 Azione col bersaglio'
    default:
      return effect.kind
  }
}

export function EtfCardFace({ card }: { card: ETFCardInstance }) {
  const config = useConfig()
  const def = config.etfById[card.defId]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, background: 'var(--panel-2)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text-h)' }}>{def.name}</div>
      <div style={{ color: 'var(--text-dim)', margin: '4px 0' }}>
        {(Object.entries(def.requirement) as [SectorId, number][])
          .map(([s, n]) => `${n}× ${config.sectorById[s].icon}`)
          .join(' + ')}
      </div>
      <div>
        <span className="tag">{def.pv} PV</span> <span className="tag">Svendita ${def.fireSaleCost}</span>
      </div>
    </div>
  )
}
