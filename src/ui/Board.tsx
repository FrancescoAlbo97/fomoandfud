import { positionFee, purchaseCost } from '../engine/market'
import type { GameState, SectorId } from '../engine/types'
import { ActionCardFace } from './cards'
import { sectorClass } from './cardHelpers'
import { useConfig } from './configContext'

function SectorGauge({ sector, price }: { sector: SectorId; price: number }) {
  const config = useConfig()
  const meta = config.sectorById[sector]
  const steps = Array.from({ length: config.priceMax - config.priceMin + 1 }, (_, i) => config.priceMin + i)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel)', flex: 1 }}>
      <div className={sectorClass(sector)} style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
        {meta.icon} {meta.label}
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
        {steps.map((s) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              borderRadius: 4,
              fontWeight: s === price ? 700 : 400,
              background: s === price ? 'var(--accent)' : 'var(--panel-2)',
              color: s === price ? '#fff' : 'var(--text-dim)',
              border: s === 1 || s === 7 ? '1px dashed var(--warn)' : '1px solid transparent',
            }}
          >
            {s}
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-h)' }}>
        ${price}
      </div>
    </div>
  )
}

export function SectorTrack({ state }: { state: GameState }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {state.config.sectorIds.map((s) => (
        <SectorGauge key={s} sector={s} price={state.sectors[s]} />
      ))}
    </div>
  )
}

export function MarketStrip({
  state,
  selectable,
  onBuy,
}: {
  state: GameState
  selectable?: boolean
  onBuy?: (marketIndex: number) => void
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14 }}>Mercato</h3>
        <span className="tag">IPO deck: {state.ipoDeck.length} carte</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {state.market.map((card, i) => (
          <div key={card.instanceId} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <ActionCardFace card={card} />
            <span className="tag mono">
              fee ${positionFee(state, i)} · tot ${purchaseCost(state, i)}
            </span>
            {selectable && (
              <button onClick={() => onBuy?.(i)} disabled={state.players.length === 0}>
                Compra
              </button>
            )}
          </div>
        ))}
        {state.market.length === 0 && <span style={{ color: 'var(--text-dim)' }}>Mercato vuoto.</span>}
      </div>
    </div>
  )
}
