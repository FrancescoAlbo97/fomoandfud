/**
 * SPAZIO AZIONI PIATTO.
 *
 * Ogni passo del Round chiede una cosa diversa (un ruolo, un bersaglio, una
 * macro-azione di compravendita, quale carta scartare). Una rete vuole invece
 * UN solo vettore di logit con una maschera di legalità.
 *
 * Qui le decisioni vengono affiancate in segmenti contigui di un unico
 * `Discrete(size)`: la maschera accende solo il segmento della decisione in
 * corso, e solo le voci davvero legali. La dimensione dipende dalla config —
 * cambiare settori o giocatori in balance.ts la ricalcola da sé.
 */
import type { GameConfig } from './config'
import type { Decision, PendingDecision } from './decisions'
import { getPlayer } from './engine'
import { macroActionSpace, legalMacroActions, macroKey, type MacroAction } from './macroActions'
import { myMatchingRumors, view } from './observation'
import type { AgentMove } from './agents/types'
import type { GameState, MixedCardInstance, OrderTarget } from './types'

/** Quante carte al massimo può indicare un puntatore (mani più lunghe vengono troncate). */
const MAX_POINTER = 8

export interface Segment {
  type: PendingDecision['type']
  offset: number
  size: number
}

export interface ActionSpace {
  size: number
  segments: Record<string, Segment>
  /** I sottoinsiemi di carte che il Value Investor può tenere, in ordine fisso. */
  keepSubsets: number[][]
  /** I bersagli dichiarabili, in ordine fisso: i posti avversario oltre il tavolo restano mascherati. */
  targetCount: number
  macros: MacroAction[]
}

export function makeActionSpace(config: GameConfig): ActionSpace {
  const sectors = config.sectorIds.length
  const opponentSlots = config.maxPlayers - 1
  const targetCount = sectors * 2 + 2 + opponentSlots * 2
  const keepSubsets = subsetsUpTo(config.valueInvestor.draw, config.valueInvestor.keepMax)
  const macros = macroActionSpace(config.sectorIds)

  const sizes: [PendingDecision['type'], number][] = [
    ['chooseRole', 2],
    ['valueInvestorKeep', keepSubsets.length],
    // bersaglio × {tengo la carta, la piazzo subito come Market News}
    ['declareOrder', targetCount * 2],
    ['insideTradingChoice', 1 + MAX_POINTER],
    ['tradeAction', macros.length],
    ['lateMarketNewsChoice', 1 + MAX_POINTER],
    ['traderPenaltyDiscard', MAX_POINTER],
    ['forcedDiscard', MAX_POINTER],
    ['insiderSwap', MAX_POINTER],
  ]

  const segments: Record<string, Segment> = {}
  let offset = 0
  for (const [type, size] of sizes) {
    segments[type] = { type, offset, size }
    offset += size
  }
  return { size: offset, segments, keepSubsets, targetCount, macros }
}

/** I bersagli in ordine fisso. Le voci `null` sono posti avversario che a questo tavolo non esistono. */
export function declareTargets(state: GameState, playerId: string, space: ActionSpace): (OrderTarget | null)[] {
  const config = state.config
  const targets: (OrderTarget | null)[] = []
  for (const sector of config.sectorIds) {
    targets.push({ kind: 'sector', sector, direction: 'up' })
    targets.push({ kind: 'sector', sector, direction: 'down' })
  }
  targets.push({ kind: 'fees', direction: 'up' })
  targets.push({ kind: 'fees', direction: 'down' })
  const opponents = state.players.filter((p) => p.id !== playerId)
  for (let slot = 0; slot < config.maxPlayers - 1; slot++) {
    const opponent = opponents[slot]
    targets.push(opponent ? { kind: 'opponent', direction: 'up', opponentId: opponent.id } : null)
    targets.push(opponent ? { kind: 'opponent', direction: 'down', opponentId: opponent.id } : null)
  }
  void space
  return targets
}

export function actionMask(state: GameState, pending: PendingDecision, space: ActionSpace): boolean[] {
  const mask = new Array<boolean>(space.size).fill(false)
  const playerId = pending.playerId
  const seg = space.segments[pending.type]
  const on = (i: number) => {
    if (i >= 0 && i < seg.size) mask[seg.offset + i] = true
  }

  switch (pending.type) {
    case 'chooseRole':
      on(0)
      on(1)
      break

    case 'valueInvestorKeep': {
      const drawn = pending.drawn.length
      space.keepSubsets.forEach((subset, i) => {
        if (subset.every((idx) => idx < drawn)) on(i)
      })
      break
    }

    case 'declareOrder': {
      const player = getPlayer(state, playerId)
      declareTargets(state, playerId, space).forEach((target, t) => {
        if (!target) return
        on(t * 2)
        // Piazzare subito una Market News richiede di avere davvero la carta.
        if (myMatchingRumors(view(state, playerId), target).length > 0) on(t * 2 + 1)
      })
      void player
      break
    }

    case 'insideTradingChoice':
    case 'lateMarketNewsChoice': {
      on(0) // non giocare
      const count = Math.min(MAX_POINTER, pending.eligibleCardIds.length)
      for (let i = 0; i < count; i++) on(1 + i)
      break
    }

    case 'tradeAction': {
      const legal = new Set(legalMacroActions(state, playerId).map(macroKey))
      space.macros.forEach((macro, i) => {
        if (legal.has(macroKey(macro))) on(i)
      })
      break
    }

    case 'traderPenaltyDiscard': {
      const count = Math.min(MAX_POINTER, getPlayer(state, playerId).rumorCards.length)
      for (let i = 0; i < count; i++) on(i)
      break
    }

    case 'forcedDiscard': {
      // Il puntatore sceglie la carta Rumor; la Carta Azione la sceglie l'euristica
      // (si cede quella in eccedenza rispetto agli ETF in mano).
      const count = Math.max(1, Math.min(MAX_POINTER, pending.rumorCardIds.length))
      for (let i = 0; i < count; i++) on(i)
      break
    }

    case 'insiderSwap': {
      // Il puntatore sceglie cosa PRENDERE; cosa cedere lo sceglie l'euristica.
      const count = Math.min(MAX_POINTER, pending.opponentCardIds.length)
      for (let i = 0; i < count; i++) on(i)
      break
    }
  }
  return mask
}

export function decodeAction(
  state: GameState,
  pending: PendingDecision,
  space: ActionSpace,
  action: number,
): AgentMove {
  const playerId = pending.playerId
  const seg = space.segments[pending.type]
  const i = action - seg.offset
  if (i < 0 || i >= seg.size) {
    throw new Error(`Azione ${action} fuori dal segmento "${pending.type}" [${seg.offset}, ${seg.offset + seg.size})`)
  }
  const decision = (d: Decision): AgentMove => ({ decision: d })

  switch (pending.type) {
    case 'chooseRole':
      return decision({ type: 'chooseRole', playerId, role: i === 0 ? 'valueInvestor' : 'trader' })

    case 'valueInvestorKeep': {
      const keep = space.keepSubsets[i].filter((idx) => idx < pending.drawn.length)
      return decision({
        type: 'valueInvestorKeep',
        playerId,
        keepInstanceIds: keep.map((idx) => (pending.drawn[idx] as MixedCardInstance).instanceId),
      })
    }

    case 'declareOrder': {
      const target = declareTargets(state, playerId, space)[Math.floor(i / 2)]
      if (!target) throw new Error('Bersaglio non disponibile a questo tavolo')
      const placeNow = i % 2 === 1
      const matching = myMatchingRumors(view(state, playerId), target)
      return decision({
        type: 'declareOrder',
        playerId,
        target,
        marketNewsCardInstanceId: placeNow && matching.length > 0 ? matching[0].instanceId : undefined,
      })
    }

    case 'insideTradingChoice':
      return decision({
        type: 'insideTradingChoice',
        playerId,
        play: i > 0,
        cardInstanceId: i > 0 ? pending.eligibleCardIds[i - 1] : undefined,
      })

    case 'lateMarketNewsChoice':
      return decision({
        type: 'lateMarketNewsChoice',
        playerId,
        play: i > 0,
        cardInstanceId: i > 0 ? pending.eligibleCardIds[i - 1] : undefined,
      })

    case 'tradeAction':
      return { macro: space.macros[i] }

    case 'traderPenaltyDiscard':
      return decision({
        type: 'traderPenaltyDiscard',
        playerId,
        cardInstanceId: getPlayer(state, playerId).rumorCards[i].instanceId,
      })

    case 'forcedDiscard':
      return decision({
        type: 'forcedDiscard',
        playerId,
        rumorInstanceId: pending.rumorCardIds[i],
        actionInstanceId: pending.actionCardIds.length ? leastUsefulActionCard(state, playerId) : undefined,
      })

    case 'insiderSwap':
      return decision({
        type: 'insiderSwap',
        playerId,
        giveInstanceId: leastUsefulActionCard(state, playerId) ?? pending.ownCardIds[0],
        takeInstanceId: pending.opponentCardIds[i],
      })
  }
}

/** La Carta Azione che nessun ETF in mano richiede; se servono tutte, la prima. */
function leastUsefulActionCard(state: GameState, playerId: string): string | undefined {
  const config = state.config
  const player = getPlayer(state, playerId)
  const required: Record<string, number> = {}
  for (const id of config.sectorIds) required[id] = 0
  for (const card of player.etfCards) {
    for (const [sector, needed] of Object.entries(config.etfById[card.defId].requirement)) {
      required[sector] = Math.max(required[sector] ?? 0, needed as number)
    }
  }
  const held: Record<string, number> = {}
  for (const id of config.sectorIds) held[id] = 0
  for (const card of player.actionCards) held[config.actionById[card.defId].sector] += 1
  const surplus = player.actionCards.find((c) => held[config.actionById[c.defId].sector] > required[config.actionById[c.defId].sector])
  return (surplus ?? player.actionCards[0])?.instanceId
}

/** Tutti i sottoinsiemi di indici 0..n-1 di dimensione <= k, in ordine deterministico. */
function subsetsUpTo(n: number, k: number): number[][] {
  const out: number[][] = [[]]
  const build = (start: number, current: number[]) => {
    if (current.length >= k) return
    for (let i = start; i < n; i++) {
      const next = [...current, i]
      out.push(next)
      build(i + 1, next)
    }
  }
  build(0, [])
  return out
}
