import { useState } from 'react'
import type { Decision, PendingDecision } from '../engine/decisions'
import { findMatchingRumorCards, getPlayer } from '../engine/engine'
import { legalOrderTargets, legalTradeActions } from '../engine/legalMoves'
import { purchaseCost } from '../engine/market'
import type { GameState, MixedCardInstance, OrderTarget } from '../engine/types'
import { ActionCardFace, EtfCardFace, RumorCardFace } from './cards'
import { describeRumorTarget } from './cardHelpers'
import { useConfig } from './configContext'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function DeclareOrderForm({ state, playerId, onSubmit }: { state: GameState; playerId: string; onSubmit: (d: Decision) => void }) {
  const [target, setTarget] = useState<OrderTarget | null>(null)
  const [newsCardId, setNewsCardId] = useState<string | undefined>(undefined)
  const player = getPlayer(state, playerId)
  const targets = legalOrderTargets(state, playerId)
  const config = useConfig()
  const matching = target ? findMatchingRumorCards(state, player, target) : []

  return (
    <div>
      <Section title="1. Scegli il bersaglio da dichiarare">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {targets.map((t, i) => {
            const opponentName = t.kind === 'opponent' ? state.players.find((o) => o.id === t.opponentId)?.name : undefined
            const selected = target && JSON.stringify(target) === JSON.stringify(t)
            return (
              <button
                key={i}
                className={selected ? 'primary' : t.direction === 'up' ? 'up' : 'down'}
                onClick={() => {
                  setTarget(t)
                  setNewsCardId(undefined)
                }}
              >
                {describeRumorTarget(config, t, opponentName)}
              </button>
            )
          })}
        </div>
      </Section>

      {target && (
        <Section title="2. Piazzi subito una Market News per questo bersaglio? (opzionale)">
          {matching.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>Non hai carte Rumor che corrispondono a questo bersaglio.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button className={newsCardId === undefined ? 'primary' : ''} onClick={() => setNewsCardId(undefined)}>
                Nessuna (bluff / aspetta)
              </button>
              {matching.map((c) => (
                <div key={c.instanceId} onClick={() => setNewsCardId(c.instanceId)} style={{ cursor: 'pointer' }}>
                  <div style={{ outline: newsCardId === c.instanceId ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                    <RumorCardFace card={c} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <button
        className="primary"
        disabled={!target}
        onClick={() => target && onSubmit({ type: 'declareOrder', playerId, target, marketNewsCardInstanceId: newsCardId })}
      >
        Conferma dichiarazione
      </button>
    </div>
  )
}

function TradeForm({ state, playerId, onSubmit }: { state: GameState; playerId: string; onSubmit: (d: Decision) => void }) {
  const config = state.config
  const player = getPlayer(state, playerId)
  const legal = legalTradeActions(state, playerId)
  const canBuy = new Set(legal.filter((a) => a.kind === 'buy').map((a) => (a as { marketIndex: number }).marketIndex))
  const canIpo = legal.some((a) => a.kind === 'ipo')
  const abandonable = new Set(legal.filter((a) => a.kind === 'abandonEtf').map((a) => (a as { cardInstanceId: string }).cardInstanceId))

  return (
    <div>
      <Section title="Compra dal Mercato">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {state.market.map((card, i) => (
            <div key={card.instanceId} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <ActionCardFace card={card} />
              <button disabled={!canBuy.has(i)} onClick={() => onSubmit({ type: 'tradeAction', playerId, action: { kind: 'buy', marketIndex: i } })}>
                Compra (${purchaseCost(state, i)})
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Vendi dalla tua mano">
        {player.actionCards.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>Non hai Carte Azione da vendere.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {player.actionCards.map((card) => (
              <div key={card.instanceId} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <ActionCardFace card={card} small />
                <button onClick={() => onSubmit({ type: 'tradeAction', playerId, action: { kind: 'sell', cardInstanceId: card.instanceId } })}>
                  Vendi (${state.sectors[config.actionById[card.defId].sector]})
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`IPO (${config.ipoPerRound}× per Round)`}>
        <button disabled={!canIpo} onClick={() => onSubmit({ type: 'tradeAction', playerId, action: { kind: 'ipo' } })}>
          Fai IPO (${config.ipoCost}): scarta le {config.ipoRefreshCount} carte più vecchie e rinnova il Mercato
        </button>
      </Section>

      {state.round <= config.etfAbandonUntilRound && player.etfCards.length > 0 && (
        <Section title={`Abbandona un ETF (solo entro il Round ${config.etfAbandonUntilRound})`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {player.etfCards.map((card) => (
              <div key={card.instanceId} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <EtfCardFace card={card} />
                <button
                  disabled={!abandonable.has(card.instanceId)}
                  onClick={() => onSubmit({ type: 'tradeAction', playerId, action: { kind: 'abandonEtf', cardInstanceId: card.instanceId } })}
                >
                  Abbandona (paga ${config.etfById[card.defId].fireSaleCost})
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <button className="primary" onClick={() => onSubmit({ type: 'tradeAction', playerId, action: { kind: 'end' } })}>
        Fine turno
      </button>
    </div>
  )
}

export function DecisionPanel({ state, pending, onSubmit }: { state: GameState; pending: PendingDecision; onSubmit: (d: Decision) => void }) {
  const player = getPlayer(state, pending.playerId)

  switch (pending.type) {
    case 'chooseRole':
      return (
        <Section title={`${player.name} — scegli il Ruolo di questo Round`}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="primary" onClick={() => onSubmit({ type: 'chooseRole', playerId: player.id, role: 'valueInvestor' })}>
              📚 Value Investor — pesca {state.config.valueInvestor.draw}, tieni fino a{' '}
              {state.config.valueInvestor.keepMax}, +${state.config.valueInvestor.cash}
            </button>
            <button className="primary" onClick={() => onSubmit({ type: 'chooseRole', playerId: player.id, role: 'trader' })}>
              💵 Trader — pesca {state.config.trader.draw}, +${state.config.trader.cash}
            </button>
          </div>
        </Section>
      )

    case 'valueInvestorKeep': {
      return (
        <ValueInvestorKeepForm
          playerId={player.id}
          drawn={pending.drawn}
          keepMax={state.config.valueInvestor.keepMax}
          onSubmit={onSubmit}
        />
      )
    }

    case 'declareOrder':
      return <DeclareOrderForm state={state} playerId={player.id} onSubmit={onSubmit} />

    case 'insideTradingChoice':
      return (
        <Section title={`${player.name} — Finestra Inside Trading`}>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
            Hai una carta che corrisponde al bersaglio dichiarato. Giocarla ora la risolve subito (effetto debole).
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {pending.eligibleCardIds.map((id) => {
              const card = player.rumorCards.find((c) => c.instanceId === id)!
              return (
                <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <RumorCardFace card={card} />
                  <button className="primary" onClick={() => onSubmit({ type: 'insideTradingChoice', playerId: player.id, play: true, cardInstanceId: id })}>
                    Gioca come Inside Trading
                  </button>
                </div>
              )
            })}
          </div>
          <button onClick={() => onSubmit({ type: 'insideTradingChoice', playerId: player.id, play: false })}>Non giocare (tieni la carta)</button>
        </Section>
      )

    case 'tradeAction':
      return <TradeForm state={state} playerId={player.id} onSubmit={onSubmit} />

    case 'lateMarketNewsChoice':
      return (
        <Section title={`${player.name} — Finestra Market News (dichiarazione tardiva)`}>
          <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
            Ultima occasione per piazzare una carta su questo bersaglio: si risolverà al Round successivo (effetto forte).
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {pending.eligibleCardIds.map((id) => {
              const card = player.rumorCards.find((c) => c.instanceId === id)!
              return (
                <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <RumorCardFace card={card} />
                  <button className="primary" onClick={() => onSubmit({ type: 'lateMarketNewsChoice', playerId: player.id, play: true, cardInstanceId: id })}>
                    Piazza come Market News
                  </button>
                </div>
              )
            })}
          </div>
          <button onClick={() => onSubmit({ type: 'lateMarketNewsChoice', playerId: player.id, play: false })}>Non giocare</button>
        </Section>
      )

    case 'forcedDiscard':
      return <ForcedDiscardForm state={state} pending={pending} onSubmit={onSubmit} />

    case 'insiderSwap':
      return <InsiderSwapForm state={state} pending={pending} onSubmit={onSubmit} />

    case 'traderPenaltyDiscard':
      return (
        <Section title={`${player.name} — Penalità Trader: scarta 1 carta Rumor`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {player.rumorCards.map((c) => (
              <div key={c.instanceId} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <RumorCardFace card={c} />
                <button className="primary" onClick={() => onSubmit({ type: 'traderPenaltyDiscard', playerId: player.id, cardInstanceId: c.instanceId })}>
                  Scarta questa
                </button>
              </div>
            ))}
          </div>
        </Section>
      )
  }
}

function ValueInvestorKeepForm({
  playerId,
  drawn,
  keepMax,
  onSubmit,
}: {
  playerId: string
  drawn: MixedCardInstance[]
  keepMax: number
  onSubmit: (d: Decision) => void
}) {
  const [selected, setSelected] = useState<string[]>([])

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= keepMax) return prev
      return [...prev, id]
    })
  }

  return (
    <Section title={`Value Investor — tieni fino a ${keepMax} carte, scarta le altre gratis`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {drawn.map((card) => {
          const isSelected = selected.includes(card.instanceId)
          return (
            <div key={card.instanceId} onClick={() => toggle(card.instanceId)} style={{ cursor: 'pointer' }}>
              <div style={{ outline: isSelected ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                {card.kind === 'rumor' ? <RumorCardFace card={card} /> : <EtfCardFace card={card} />}
              </div>
            </div>
          )
        })}
      </div>
      <button className="primary" onClick={() => onSubmit({ type: 'valueInvestorKeep', playerId, keepInstanceIds: selected })}>
        Conferma ({selected.length}/{keepMax} tenute)
      </button>
    </Section>
  )
}

function ForcedDiscardForm({
  state,
  pending,
  onSubmit,
}: {
  state: GameState
  pending: Extract<PendingDecision, { type: 'forcedDiscard' }>
  onSubmit: (d: Decision) => void
}) {
  const victim = getPlayer(state, pending.playerId)
  const [rumorId, setRumorId] = useState<string | undefined>(undefined)
  const [actionId, setActionId] = useState<string | undefined>(undefined)
  const ready = (pending.rumorCardIds.length === 0 || !!rumorId) && (pending.actionCardIds.length === 0 || !!actionId)

  return (
    <Section title={`${victim.name} — Short Seller's Tip: scarta 1 Rumor e 1 Carta Azione a tua scelta`}>
      {pending.rumorCardIds.length > 0 && (
        <Section title="Carta Rumor da scartare">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {victim.rumorCards.map((c) => (
              <div key={c.instanceId} onClick={() => setRumorId(c.instanceId)} style={{ cursor: 'pointer' }}>
                <div style={{ outline: rumorId === c.instanceId ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                  <RumorCardFace card={c} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {pending.actionCardIds.length > 0 && (
        <Section title="Carta Azione da scartare">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {victim.actionCards.map((c) => (
              <div key={c.instanceId} onClick={() => setActionId(c.instanceId)} style={{ cursor: 'pointer' }}>
                <div style={{ outline: actionId === c.instanceId ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                  <ActionCardFace card={c} small />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      <button
        className="primary"
        disabled={!ready}
        onClick={() => onSubmit({ type: 'forcedDiscard', playerId: victim.id, rumorInstanceId: rumorId, actionInstanceId: actionId })}
      >
        Conferma scarto
      </button>
    </Section>
  )
}

function InsiderSwapForm({
  state,
  pending,
  onSubmit,
}: {
  state: GameState
  pending: Extract<PendingDecision, { type: 'insiderSwap' }>
  onSubmit: (d: Decision) => void
}) {
  const acting = getPlayer(state, pending.playerId)
  const opponent = getPlayer(state, pending.opponentId)
  const [giveId, setGiveId] = useState<string | undefined>(undefined)
  const [takeId, setTakeId] = useState<string | undefined>(undefined)

  return (
    <Section title={`${acting.name} — Insider Wiretap: guardi la mano di ${opponent.name} e scambi 1 Carta Azione`}>
      <Section title="La tua carta da cedere">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {acting.actionCards.map((c) => (
            <div key={c.instanceId} onClick={() => setGiveId(c.instanceId)} style={{ cursor: 'pointer' }}>
              <div style={{ outline: giveId === c.instanceId ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                <ActionCardFace card={c} small />
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={`La carta di ${opponent.name} da prendere`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {opponent.actionCards.map((c) => (
            <div key={c.instanceId} onClick={() => setTakeId(c.instanceId)} style={{ cursor: 'pointer' }}>
              <div style={{ outline: takeId === c.instanceId ? '2px solid var(--accent)' : 'none', borderRadius: 8 }}>
                <ActionCardFace card={c} small />
              </div>
            </div>
          ))}
        </div>
      </Section>
      <button
        className="primary"
        disabled={!giveId || !takeId}
        onClick={() => onSubmit({ type: 'insiderSwap', playerId: acting.id, giveInstanceId: giveId!, takeInstanceId: takeId! })}
      >
        Conferma scambio
      </button>
    </Section>
  )
}
