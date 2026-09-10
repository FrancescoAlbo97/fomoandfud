import type { GameState, PlayerState } from './types'

/** Commissione effettiva della posizione, incluso il modificatore Rumor del Round. */
export function positionFee(state: GameState, marketIndex: number): number {
  return Math.max(0, state.config.marketFees[marketIndex] + state.feesModifierThisRound)
}

export function purchaseCost(state: GameState, marketIndex: number): number {
  const card = state.market[marketIndex]
  const sector = state.config.actionById[card.defId].sector
  return state.sectors[sector] + positionFee(state, marketIndex)
}

/** Prezzo di realizzo di una Carta Azione in mano (§6.4: nessuna commissione in vendita). */
export function saleValue(state: GameState, defId: string): number {
  return state.sectors[state.config.actionById[defId].sector]
}

function updatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? fn(p) : p)) }
}

export function buyFromMarket(state: GameState, playerId: string, marketIndex: number): GameState {
  const card = state.market[marketIndex]
  if (!card) throw new Error('Posizione di mercato vuota')
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error('Giocatore sconosciuto')
  const cost = purchaseCost(state, marketIndex)
  if (player.cash < cost) throw new Error('Fondi insufficienti per questo acquisto')

  const draw = state.ipoDeck[0]
  const remainingIpo = state.ipoDeck.slice(1)
  const remainingMarket = state.market.filter((_, i) => i !== marketIndex)
  const newMarket = draw ? [...remainingMarket, draw] : remainingMarket

  let next = { ...state, market: newMarket, ipoDeck: remainingIpo }
  next = updatePlayer(next, playerId, (p) => ({
    ...p,
    cash: p.cash - cost,
    actionCards: [...p.actionCards, card],
  }))
  return next
}

export function sellCard(state: GameState, playerId: string, cardInstanceId: string): GameState {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error('Giocatore sconosciuto')
  const card = player.actionCards.find((c) => c.instanceId === cardInstanceId)
  if (!card) throw new Error('Carta non trovata in mano')
  const price = saleValue(state, card.defId)

  // §6.4 — le Carte Azione vendute tornano in FONDO al mazzo IPO, non negli scarti.
  let next = { ...state, ipoDeck: [...state.ipoDeck, card] }
  next = updatePlayer(next, playerId, (p) => ({
    ...p,
    cash: p.cash + price,
    actionCards: p.actionCards.filter((c) => c.instanceId !== cardInstanceId),
  }))
  return next
}

export function doIpo(state: GameState, playerId: string): GameState {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error('Giocatore sconosciuto')
  const { ipoCost, ipoPerRound, ipoRefreshCount, marketSize } = state.config
  if (player.ipoUsesThisRound >= ipoPerRound) throw new Error(`Puoi fare solo ${ipoPerRound} IPO per Round`)
  if (player.cash < ipoCost) throw new Error("Fondi insufficienti per l'IPO")

  const removedCount = Math.min(ipoRefreshCount, state.market.length)
  const removed = state.market.slice(0, removedCount)
  const keptMarket = state.market.slice(removedCount)
  const wanted = Math.min(marketSize - keptMarket.length, state.ipoDeck.length)
  const drawn = state.ipoDeck.slice(0, wanted)
  const remainingIpo = state.ipoDeck.slice(wanted)

  let next: GameState = {
    ...state,
    market: [...keptMarket, ...drawn],
    ipoDeck: remainingIpo,
    actionDiscard: [...state.actionDiscard, ...removed],
  }
  next = updatePlayer(next, playerId, (p) => ({
    ...p,
    cash: p.cash - ipoCost,
    ipoUsesThisRound: p.ipoUsesThisRound + 1,
  }))
  return next
}
