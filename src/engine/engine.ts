import type { Decision, PendingDecision } from './decisions'
import { applyEffect } from './effects'
import { buyFromMarket, doIpo, purchaseCost, sellCard } from './market'
import { orderFrom } from './setup'
import { computeScores } from './scoring'
import type {
  ETFCardInstance,
  GameState,
  LogEntry,
  MixedCardInstance,
  OrderTarget,
  PlayerState,
  RumorCardInstance,
  RumorTarget,
} from './types'

export { createInitialState } from './setup'
export type { GameOptions, NewPlayerConfig } from './setup'
export * from './decisions'

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error(`Giocatore sconosciuto: ${playerId}`)
  return player
}

function updatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? fn(p) : p)) }
}

function addLog(state: GameState, text: string): GameState {
  const entry: LogEntry = { id: `log-${state.log.length}`, round: state.round, phase: state.phase, text }
  return { ...state, log: [...state.log, entry] }
}

function drawTop(deck: MixedCardInstance[], n: number): [MixedCardInstance[], MixedCardInstance[]] {
  const count = Math.min(n, deck.length)
  const drawn = deck.slice(deck.length - count)
  const remaining = deck.slice(0, deck.length - count)
  return [drawn, remaining]
}

function addCardsToHand(p: PlayerState, cards: MixedCardInstance[]): PlayerState {
  const rumors = cards.filter((c): c is RumorCardInstance => c.kind === 'rumor')
  const etfs = cards.filter((c): c is ETFCardInstance => c.kind === 'etf')
  return { ...p, rumorCards: [...p.rumorCards, ...rumors], etfCards: [...p.etfCards, ...etfs] }
}

export function targetsMatch(cardTarget: RumorTarget, orderTarget: OrderTarget): boolean {
  if (cardTarget.kind !== orderTarget.kind) return false
  if (cardTarget.kind === 'sector' && orderTarget.kind === 'sector') {
    return cardTarget.sector === orderTarget.sector && cardTarget.direction === orderTarget.direction
  }
  if (cardTarget.kind === 'fees' && orderTarget.kind === 'fees') return cardTarget.direction === orderTarget.direction
  if (cardTarget.kind === 'opponent' && orderTarget.kind === 'opponent') {
    return cardTarget.direction === orderTarget.direction
  }
  return false
}

export function findMatchingRumorCards(state: GameState, player: PlayerState, target: OrderTarget): RumorCardInstance[] {
  return player.rumorCards.filter((c) => targetsMatch(state.config.rumorById[c.defId].target, target))
}

function describeTarget(state: GameState, target: OrderTarget): string {
  if (target.kind === 'sector') {
    return `${state.config.sectorById[target.sector].label} ${target.direction === 'up' ? '↑' : '↓'}`
  }
  if (target.kind === 'fees') return `Commissioni ${target.direction === 'up' ? '↑' : '↓'}`
  return `${getPlayer(state, target.opponentId).name} ${target.direction === 'up' ? '↑' : '↓'}`
}

// ---------------------------------------------------------------------------
// Phase transitions & auto-resolution
// ---------------------------------------------------------------------------

function applyClosingChecks(state: GameState): GameState {
  const { sectorIds, sectorById, shortSqueezeAt, crashAt, reboundTo } = state.config
  let next = state
  let triggered = false
  for (const sector of sectorIds) {
    const price = next.sectors[sector]
    const kind = price <= shortSqueezeAt ? 'squeeze' : price >= crashAt ? 'crash' : null
    if (!kind) continue
    next = {
      ...next,
      sectors: { ...next.sectors, [sector]: reboundTo },
      closingEvents: [...next.closingEvents, { round: next.round, sector, kind }],
    }
    next = addLog(
      next,
      kind === 'squeeze'
        ? `Short Squeeze in ${sectorById[sector].label}: l'indicatore risale a $${reboundTo}.`
        : `Crash di Mercato in ${sectorById[sector].label}: l'indicatore crolla a $${reboundTo}.`,
    )
    triggered = true
  }
  const playersNeedingTraderDiscard =
    triggered && state.config.trader.penaltyDiscards > 0
      ? next.players.filter((p) => p.role === 'trader' && p.rumorCards.length > 0).map((p) => p.id)
      : []
  return { ...next, shortSqueezeOrCrashThisRound: triggered, playersNeedingTraderDiscard }
}

/**
 * Resolves the head of `marketNewsQueue`. Returns as soon as one card is done —
 * an effect may have parked a `pendingEffectChoice`, and settle() must surface that
 * before the next card resolves.
 */
function resolveNextMarketNews(state: GameState): GameState {
  const [placed, ...rest] = state.marketNewsQueue
  const def = state.config.rumorById[placed.card.defId]
  const actor = getPlayer(state, placed.playerId)
  const { state: afterEffect, text } = applyEffect(def.marketNews, placed.declaredTarget, {
    state: { ...state, marketNewsQueue: rest },
    actingPlayerId: placed.playerId,
    opponentId: placed.opponentId,
  })
  const next = { ...afterEffect, mixedDiscard: [...afterEffect.mixedDiscard, placed.card] }
  return addLog(next, `[Market News di ${actor.name}] ${def.name}: ${text}`)
}

function beginRound(state: GameState): GameState {
  // §6.1 — the new round's turn order is already known (the First Player was set at
  // Step 6), and the pending Market News resolve in that order.
  const turnOrder = orderFrom(state.players.map((p) => p.id), state.firstPlayerId)
  const seat = new Map(turnOrder.map((id, i) => [id, i]))
  const marketNewsQueue = [...state.pendingMarketNews].sort(
    (a, b) => (seat.get(a.playerId) ?? 0) - (seat.get(b.playerId) ?? 0),
  )
  const next: GameState = {
    ...state,
    pendingMarketNews: [],
    marketNewsQueue,
    orderDeclarations: [],
    // Cleared BEFORE the queue drains: last round's Inside Trading fee tweak expires
    // here, and a fee Market News resolving now must survive into the whole new Round.
    feesModifierThisRound: 0,
    shortSqueezeOrCrashThisRound: false,
    playersNeedingTraderDiscard: [],
    turnOrder,
    players: state.players.map((p) => ({
      ...p,
      role: null,
      hasPlayedCardThisRound: false,
      ipoUsesThisRound: 0,
    })),
    phase: 'step1_roleAndFud',
    actorPointer: 0,
  }
  return addLog(next, `— Round ${next.round}, Passo 1: Ruolo e FUD —`)
}

function finalizeRoundAndMaybeAdvance(state: GameState): GameState {
  const maxCash = Math.max(...state.players.map((p) => p.cash))
  // §6.6 — ties go to whoever sits earliest in the CURRENT turn order, i.e. the
  // sitting First Player keeps the token if nobody strictly out-earned them.
  const newFirstPlayerId = state.turnOrder.find((id) => getPlayer(state, id).cash === maxCash)!
  let next = { ...state, firstPlayerId: newFirstPlayerId }
  next = addLog(next, `${getPlayer(next, newFirstPlayerId).name} ha più denaro: sarà Primo Giocatore del prossimo Round.`)
  if (state.round >= state.config.rounds) {
    const results = computeScores(next)
    next = addLog(next, '— Fine partita! —')
    return { ...next, phase: 'gameOver', gameOverResult: results }
  }
  return beginRound({ ...next, round: next.round + 1 })
}

/** Advances auto-resolvable state and returns what decision (if any) is needed next. */
export function settle(state: GameState): { state: GameState; pending: PendingDecision | null } {
  const choice = state.pendingEffectChoice
  if (choice) {
    if (choice.kind === 'forcedDiscard') {
      const victim = getPlayer(state, choice.targetPlayerId)
      return {
        state,
        pending: {
          type: 'forcedDiscard',
          playerId: victim.id,
          rumorCardIds: victim.rumorCards.map((c) => c.instanceId),
          actionCardIds: victim.actionCards.map((c) => c.instanceId),
        },
      }
    }
    const acting = getPlayer(state, choice.actingPlayerId)
    const opponent = getPlayer(state, choice.opponentId)
    return {
      state,
      pending: {
        type: 'insiderSwap',
        playerId: acting.id,
        opponentId: opponent.id,
        ownCardIds: acting.actionCards.map((c) => c.instanceId),
        opponentCardIds: opponent.actionCards.map((c) => c.instanceId),
      },
    }
  }

  if (state.marketNewsQueue.length > 0) {
    return settle(resolveNextMarketNews(state))
  }

  if (state.pendingDraw) {
    return { state, pending: { type: 'valueInvestorKeep', playerId: state.pendingDraw.playerId, drawn: state.pendingDraw.cards } }
  }

  switch (state.phase) {
    case 'step1_roleAndFud': {
      if (state.actorPointer >= state.turnOrder.length) {
        return settle({ ...state, phase: 'step2_declare', actorPointer: 0 })
      }
      return { state, pending: { type: 'chooseRole', playerId: state.turnOrder[state.actorPointer] } }
    }
    case 'step2_declare': {
      if (state.actorPointer >= state.turnOrder.length) {
        return settle({ ...state, phase: 'step3_insideTrading', actorPointer: 0 })
      }
      return { state, pending: { type: 'declareOrder', playerId: state.turnOrder[state.actorPointer] } }
    }
    case 'step3_insideTrading': {
      if (state.actorPointer >= state.turnOrder.length) {
        return settle({ ...state, phase: 'step4_trade', actorPointer: 0 })
      }
      const playerId = state.turnOrder[state.actorPointer]
      const player = getPlayer(state, playerId)
      const decl = state.orderDeclarations.find((d) => d.playerId === playerId)
      const eligibleCards = decl && !player.hasPlayedCardThisRound ? findMatchingRumorCards(state, player, decl.target) : []
      if (eligibleCards.length === 0) {
        return settle({ ...state, actorPointer: state.actorPointer + 1 })
      }
      return {
        state,
        pending: { type: 'insideTradingChoice', playerId, eligibleCardIds: eligibleCards.map((c) => c.instanceId) },
      }
    }
    case 'step4_trade': {
      const tradeOrder = [...state.turnOrder].reverse()
      if (state.actorPointer >= tradeOrder.length) {
        return settle({ ...state, phase: 'step5_lateMarketNews', actorPointer: 0 })
      }
      return { state, pending: { type: 'tradeAction', playerId: tradeOrder[state.actorPointer] } }
    }
    case 'step5_lateMarketNews': {
      if (state.actorPointer >= state.turnOrder.length) {
        return settle({ ...applyClosingChecks(state), phase: 'step6_closing', actorPointer: 0 })
      }
      const playerId = state.turnOrder[state.actorPointer]
      const player = getPlayer(state, playerId)
      const decl = state.orderDeclarations.find((d) => d.playerId === playerId)
      const eligibleCards = decl && !player.hasPlayedCardThisRound ? findMatchingRumorCards(state, player, decl.target) : []
      if (eligibleCards.length === 0) {
        return settle({ ...state, actorPointer: state.actorPointer + 1 })
      }
      return {
        state,
        pending: { type: 'lateMarketNewsChoice', playerId, eligibleCardIds: eligibleCards.map((c) => c.instanceId) },
      }
    }
    case 'step6_closing': {
      if (state.actorPointer >= state.playersNeedingTraderDiscard.length) {
        return settle(finalizeRoundAndMaybeAdvance(state))
      }
      return { state, pending: { type: 'traderPenaltyDiscard', playerId: state.playersNeedingTraderDiscard[state.actorPointer] } }
    }
    case 'gameOver':
    case 'setup':
      return { state, pending: null }
  }
}

export function currentPending(state: GameState): PendingDecision | null {
  return settle(state).pending
}

// ---------------------------------------------------------------------------
// Decision application
// ---------------------------------------------------------------------------

function applyDecision(state: GameState, decision: Decision): GameState {
  switch (decision.type) {
    case 'chooseRole': {
      const { playerId, role } = decision
      const player = getPlayer(state, playerId)
      if (player.role !== null) throw new Error('Ruolo già scelto per questo Round')
      const roleCfg = role === 'valueInvestor' ? state.config.valueInvestor : state.config.trader
      const cashBonus = roleCfg.cash
      let next = updatePlayer(state, playerId, (p) => ({ ...p, role, cash: p.cash + cashBonus }))
      next = addLog(next, `${player.name} sceglie ${role === 'valueInvestor' ? 'Value Investor' : 'Trader'} (+$${cashBonus}).`)
      if (role === 'trader') {
        const [drawn, remaining] = drawTop(next.mixedDeck, state.config.trader.draw)
        next = { ...next, mixedDeck: remaining }
        next = updatePlayer(next, playerId, (p) => addCardsToHand(p, drawn))
        if (drawn.length > 0) next = addLog(next, `${player.name} pesca 1 carta dal mazzo misto.`)
        return { ...next, actorPointer: next.actorPointer + 1 }
      }
      const [drawn, remaining] = drawTop(next.mixedDeck, state.config.valueInvestor.draw)
      next = { ...next, mixedDeck: remaining, pendingDraw: { playerId, cards: drawn } }
      return addLog(next, `${player.name} pesca ${drawn.length} carte dal mazzo misto (terrà fino a 2).`)
    }

    case 'valueInvestorKeep': {
      const { playerId, keepInstanceIds } = decision
      if (!state.pendingDraw || state.pendingDraw.playerId !== playerId) {
        throw new Error('Nessuna pescata in sospeso per questo giocatore')
      }
      const keepMax = state.config.valueInvestor.keepMax
      if (keepInstanceIds.length > keepMax) throw new Error(`Puoi tenere al massimo ${keepMax} carte`)
      const drawn = state.pendingDraw.cards
      const keepSet = new Set(keepInstanceIds)
      if (![...keepSet].every((id) => drawn.some((c) => c.instanceId === id))) {
        throw new Error('ID carta non valido tra quelle pescate')
      }
      const kept = drawn.filter((c) => keepSet.has(c.instanceId))
      const discarded = drawn.filter((c) => !keepSet.has(c.instanceId))
      let next: GameState = { ...state, pendingDraw: null, mixedDiscard: [...state.mixedDiscard, ...discarded] }
      next = updatePlayer(next, playerId, (p) => addCardsToHand(p, kept))
      next = addLog(next, `${getPlayer(state, playerId).name} tiene ${kept.length} carta/e, scarta ${discarded.length}.`)
      return { ...next, actorPointer: next.actorPointer + 1 }
    }

    case 'declareOrder': {
      const { playerId, target, marketNewsCardInstanceId } = decision
      const player = getPlayer(state, playerId)
      let next = state
      if (marketNewsCardInstanceId) {
        const card = player.rumorCards.find((c) => c.instanceId === marketNewsCardInstanceId)
        if (!card) throw new Error('Carta Rumor non trovata in mano')
        const def = state.config.rumorById[card.defId]
        if (!targetsMatch(def.target, target)) throw new Error('La carta non corrisponde al bersaglio dichiarato')
        const opponentId = target.kind === 'opponent' ? target.opponentId : undefined
        next = updatePlayer(next, playerId, (p) => ({
          ...p,
          rumorCards: p.rumorCards.filter((c) => c.instanceId !== marketNewsCardInstanceId),
          hasPlayedCardThisRound: true,
        }))
        next = { ...next, pendingMarketNews: [...next.pendingMarketNews, { playerId, card, declaredTarget: def.target, opponentId }] }
        next = addLog(next, `${player.name} dichiara ${describeTarget(state, target)} e piazza subito una Market News (${def.name}).`)
      } else {
        next = addLog(next, `${player.name} dichiara il bersaglio ${describeTarget(state, target)}.`)
      }
      next = { ...next, orderDeclarations: [...next.orderDeclarations, { playerId, target, placedMarketNewsAtStep2: !!marketNewsCardInstanceId }] }
      return { ...next, actorPointer: next.actorPointer + 1 }
    }

    case 'insideTradingChoice': {
      const { playerId, play, cardInstanceId } = decision
      const player = getPlayer(state, playerId)
      let next = state
      if (play) {
        if (!cardInstanceId) throw new Error('cardInstanceId richiesto per giocare Inside Trading')
        const card = player.rumorCards.find((c) => c.instanceId === cardInstanceId)
        if (!card) throw new Error('Carta non trovata in mano')
        const def = state.config.rumorById[card.defId]
        const decl = state.orderDeclarations.find((d) => d.playerId === playerId)
        if (!decl || !targetsMatch(def.target, decl.target)) throw new Error('La carta non corrisponde al bersaglio dichiarato')
        const opponentId = decl.target.kind === 'opponent' ? decl.target.opponentId : undefined
        const { state: afterEffect, text } = applyEffect(def.insideTrading, def.target, { state, actingPlayerId: playerId, opponentId })
        next = afterEffect
        next = updatePlayer(next, playerId, (p) => ({
          ...p,
          rumorCards: p.rumorCards.filter((c) => c.instanceId !== cardInstanceId),
          hasPlayedCardThisRound: true,
        }))
        next = { ...next, mixedDiscard: [...next.mixedDiscard, card] }
        next = addLog(next, `${player.name} gioca Inside Trading (${def.name}): ${text}`)
      }
      return { ...next, actorPointer: next.actorPointer + 1 }
    }

    case 'tradeAction': {
      const { playerId, action } = decision
      const player = getPlayer(state, playerId)
      switch (action.kind) {
        case 'buy': {
          const next = buyFromMarket(state, playerId, action.marketIndex)
          return addLog(next, `${player.name} compra dal Mercato (posizione ${action.marketIndex + 1}, $${purchaseCost(state, action.marketIndex)}).`)
        }
        case 'sell': {
          const next = sellCard(state, playerId, action.cardInstanceId)
          return addLog(next, `${player.name} vende una Carta Azione.`)
        }
        case 'ipo': {
          const next = doIpo(state, playerId)
          return addLog(next, `${player.name} fa un'IPO: rinnova il Mercato.`)
        }
        case 'abandonEtf': {
          if (state.round > state.config.etfAbandonUntilRound) {
            throw new Error(`Non puoi più abbandonare ETF dopo il Round ${state.config.etfAbandonUntilRound}`)
          }
          const card = player.etfCards.find((c) => c.instanceId === action.cardInstanceId)
          if (!card) throw new Error('Carta ETF non trovata in mano')
          const def = state.config.etfById[card.defId]
          if (player.cash < def.fireSaleCost) throw new Error('Fondi insufficienti per la svendita')
          let next = updatePlayer(state, playerId, (p) => ({
            ...p,
            cash: p.cash - def.fireSaleCost,
            etfCards: p.etfCards.filter((c) => c.instanceId !== action.cardInstanceId),
          }))
          next = { ...next, mixedDiscard: [...next.mixedDiscard, card] }
          return addLog(next, `${player.name} abbandona l'ETF "${def.name}" pagando $${def.fireSaleCost} di svendita.`)
        }
        case 'end':
          return { ...state, actorPointer: state.actorPointer + 1 }
      }
      return state
    }

    case 'lateMarketNewsChoice': {
      const { playerId, play, cardInstanceId } = decision
      const player = getPlayer(state, playerId)
      let next = state
      if (play) {
        if (!cardInstanceId) throw new Error('cardInstanceId richiesto')
        const card = player.rumorCards.find((c) => c.instanceId === cardInstanceId)
        if (!card) throw new Error('Carta non trovata in mano')
        const def = state.config.rumorById[card.defId]
        const decl = state.orderDeclarations.find((d) => d.playerId === playerId)
        if (!decl || !targetsMatch(def.target, decl.target)) throw new Error('La carta non corrisponde al bersaglio dichiarato')
        const opponentId = decl.target.kind === 'opponent' ? decl.target.opponentId : undefined
        next = updatePlayer(next, playerId, (p) => ({
          ...p,
          rumorCards: p.rumorCards.filter((c) => c.instanceId !== cardInstanceId),
          hasPlayedCardThisRound: true,
        }))
        next = { ...next, pendingMarketNews: [...next.pendingMarketNews, { playerId, card, declaredTarget: def.target, opponentId }] }
        next = addLog(next, `${player.name} dichiara TARDIVAMENTE una Market News (${def.name}): si risolverà al Round successivo.`)
      }
      return { ...next, actorPointer: next.actorPointer + 1 }
    }

    case 'traderPenaltyDiscard': {
      const { playerId, cardInstanceId } = decision
      const player = getPlayer(state, playerId)
      const card = player.rumorCards.find((c) => c.instanceId === cardInstanceId)
      if (!card) throw new Error('Carta non trovata in mano')
      let next = updatePlayer(state, playerId, (p) => ({ ...p, rumorCards: p.rumorCards.filter((c) => c.instanceId !== cardInstanceId) }))
      next = { ...next, mixedDiscard: [...next.mixedDiscard, card] }
      next = addLog(next, `${player.name} scarta una carta Rumor per la penalità Trader.`)
      return { ...next, actorPointer: next.actorPointer + 1 }
    }

    case 'forcedDiscard': {
      const { playerId, rumorInstanceId, actionInstanceId } = decision
      const choice = state.pendingEffectChoice
      if (choice?.kind !== 'forcedDiscard' || choice.targetPlayerId !== playerId) {
        throw new Error('Nessuno scarto forzato in sospeso per questo giocatore')
      }
      const victim = getPlayer(state, playerId)
      // One of each, when they have one — you can't dodge by picking nothing.
      if (victim.rumorCards.length > 0 && !rumorInstanceId) throw new Error('Devi scartare 1 carta Rumor')
      if (victim.actionCards.length > 0 && !actionInstanceId) throw new Error('Devi scartare 1 Carta Azione')
      const rumor = rumorInstanceId ? victim.rumorCards.find((c) => c.instanceId === rumorInstanceId) : undefined
      const action = actionInstanceId ? victim.actionCards.find((c) => c.instanceId === actionInstanceId) : undefined
      if (rumorInstanceId && !rumor) throw new Error('Carta Rumor non trovata in mano')
      if (actionInstanceId && !action) throw new Error('Carta Azione non trovata in mano')

      let next = updatePlayer(state, playerId, (p) => ({
        ...p,
        rumorCards: rumor ? p.rumorCards.filter((c) => c.instanceId !== rumor.instanceId) : p.rumorCards,
        actionCards: action ? p.actionCards.filter((c) => c.instanceId !== action.instanceId) : p.actionCards,
      }))
      next = {
        ...next,
        pendingEffectChoice: null,
        mixedDiscard: rumor ? [...next.mixedDiscard, rumor] : next.mixedDiscard,
        // §6.4 — Carte Azione that leave a hand always go to the bottom of the IPO deck.
        ipoDeck: action ? [...next.ipoDeck, action] : next.ipoDeck,
      }
      const lost = [rumor && '1 carta Rumor', action && '1 Carta Azione'].filter(Boolean).join(' e ')
      return addLog(next, `${victim.name} scarta ${lost} (Short Seller's Tip).`)
    }

    case 'insiderSwap': {
      const { playerId, giveInstanceId, takeInstanceId } = decision
      const choice = state.pendingEffectChoice
      if (choice?.kind !== 'insiderSwap' || choice.actingPlayerId !== playerId) {
        throw new Error('Nessuno scambio in sospeso per questo giocatore')
      }
      const acting = getPlayer(state, playerId)
      const opponent = getPlayer(state, choice.opponentId)
      const given = acting.actionCards.find((c) => c.instanceId === giveInstanceId)
      const taken = opponent.actionCards.find((c) => c.instanceId === takeInstanceId)
      if (!given) throw new Error('La carta che vuoi cedere non è in mano tua')
      if (!taken) throw new Error("La carta che vuoi prendere non è in mano all'avversario")

      let next = updatePlayer(state, playerId, (p) => ({
        ...p,
        actionCards: [...p.actionCards.filter((c) => c.instanceId !== giveInstanceId), taken],
      }))
      next = updatePlayer(next, opponent.id, (p) => ({
        ...p,
        actionCards: [...p.actionCards.filter((c) => c.instanceId !== takeInstanceId), given],
      }))
      next = { ...next, pendingEffectChoice: null }
      return addLog(next, `${acting.name} scambia una Carta Azione con ${opponent.name} (Insider Wiretap).`)
    }
  }
}

export function submitDecision(state: GameState, decision: Decision): GameState {
  const mutated = applyDecision(state, decision)
  return settle(mutated).state
}
