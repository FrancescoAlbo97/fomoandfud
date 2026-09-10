/**
 * MACRO-AZIONI del Passo 4.
 *
 * Il turno di compravendita è una sequenza di azioni atomiche: con 4 carte a
 * Mercato e una mano di titoli le sequenze possibili sono migliaia, e nessuna
 * ricerca (né gradiente) regge quel branching. Qui il turno viene ridotto a una
 * dozzina di INTENZIONI ("compra per l'ETF", "liquida il settore Crypto"), ognuna
 * delle quali si espande da sola nelle azioni atomiche necessarie.
 *
 * Vantaggi: branching costante e piccolo, azioni leggibili nei log e nelle
 * statistiche, e una policy che sceglie fra intenzioni invece che fra click.
 */
import type { TradeActionInput } from './decisions'
import { getPlayer, submitDecision } from './engine'
import { purchaseCost, saleValue } from './market'
import { etfCardsMissing, holdingsBySector } from './scoring'
import type { GameState, SectorId } from './types'

export type MacroAction =
  /** Chiude il turno di compravendita. */
  | { kind: 'pass' }
  /** Compra la carta a Mercato che avvicina di più un ETF ancora incompleto. */
  | { kind: 'buyForEtf' }
  /** Compra la carta a Mercato più economica che ti puoi permettere. */
  | { kind: 'buyCheapest' }
  /** Compra la carta più economica di quel settore. */
  | { kind: 'buySector'; sector: SectorId }
  /** Liquida TUTTE le carte di quel settore che hai in mano. */
  | { kind: 'sellSector'; sector: SectorId }
  /** Vende solo i titoli che nessun ETF in mano richiede: incassa senza perdere obiettivi. */
  | { kind: 'sellSurplus' }
  | { kind: 'ipo' }
  /** Abbandona l'ETF più lontano dal completamento (§9.2). */
  | { kind: 'abandonEtf' }

export function macroKey(macro: MacroAction): string {
  return macro.kind === 'buySector' || macro.kind === 'sellSector' ? `${macro.kind}:${macro.sector}` : macro.kind
}

/** L'insieme completo e ORDINATO delle macro-azioni per una data config.
 *  L'indice di ogni voce è stabile: è direttamente l'action space della policy. */
export function macroActionSpace(sectorIds: SectorId[]): MacroAction[] {
  return [
    { kind: 'pass' },
    { kind: 'buyForEtf' },
    { kind: 'buyCheapest' },
    ...sectorIds.map((sector): MacroAction => ({ kind: 'buySector', sector })),
    ...sectorIds.map((sector): MacroAction => ({ kind: 'sellSector', sector })),
    { kind: 'sellSurplus' },
    { kind: 'ipo' },
    { kind: 'abandonEtf' },
  ]
}

/** Maschera di legalità allineata a `macroActionSpace`: true = mossa che fa davvero qualcosa. */
export function macroActionMask(state: GameState, playerId: string): boolean[] {
  return macroActionSpace(state.config.sectorIds).map((macro) => expand(state, playerId, macro).length > 0)
}

export function legalMacroActions(state: GameState, playerId: string): MacroAction[] {
  return macroActionSpace(state.config.sectorIds).filter((macro) => expand(state, playerId, macro).length > 0)
}

/**
 * Esegue la macro-azione sull'engine reale, un'azione atomica alla volta.
 * Ritorna il nuovo stato e le azioni atomiche effettivamente eseguite (utili per
 * log e telemetria).
 */
export function applyMacro(
  state: GameState,
  playerId: string,
  macro: MacroAction,
): { state: GameState; actions: TradeActionInput[] } {
  const actions: TradeActionInput[] = []
  let next = state
  // Ricalcolata a ogni passo: dopo un acquisto il Mercato scorre e gli indici cambiano.
  for (let guard = 0; guard < 64; guard++) {
    const step = expand(next, playerId, macro)[0]
    if (!step) break
    actions.push(step)
    next = submitDecision(next, { type: 'tradeAction', playerId, action: step })
    if (step.kind === 'end') break
    if (!repeats(macro)) break
  }
  return { state: next, actions }
}

/** Le macro "liquida tutto" ripetono finché hanno effetto; le altre fanno un passo solo. */
function repeats(macro: MacroAction): boolean {
  return macro.kind === 'sellSector' || macro.kind === 'sellSurplus'
}

/** Le azioni atomiche che questa macro eseguirebbe ORA, in ordine. Vuoto = illegale. */
function expand(state: GameState, playerId: string, macro: MacroAction): TradeActionInput[] {
  const player = getPlayer(state, playerId)
  const config = state.config

  switch (macro.kind) {
    case 'pass':
      return [{ kind: 'end' }]

    case 'buyCheapest': {
      const idx = cheapestAffordable(state, playerId)
      return idx === null ? [] : [{ kind: 'buy', marketIndex: idx }]
    }

    case 'buySector': {
      const idx = cheapestAffordable(state, playerId, macro.sector)
      return idx === null ? [] : [{ kind: 'buy', marketIndex: idx }]
    }

    case 'buyForEtf': {
      const counts = holdingsBySector(state, player)
      // Quanto "vale" una carta di ogni settore: PV per carta mancante degli ETF che sblocca.
      const value: Record<SectorId, number> = {}
      for (const id of config.sectorIds) value[id] = 0
      for (const etfCard of player.etfCards) {
        const def = config.etfById[etfCard.defId]
        const missing = etfCardsMissing(counts, def.requirement)
        if (missing === 0) continue
        for (const [sector, needed] of Object.entries(def.requirement) as [SectorId, number][]) {
          if ((counts[sector] ?? 0) < needed) value[sector] += def.pv / missing
        }
      }
      let best: number | null = null
      let bestScore = 0
      state.market.forEach((card, i) => {
        const sector = config.actionById[card.defId].sector
        const score = value[sector] ?? 0
        if (score <= 0) return
        if (player.cash < purchaseCost(state, i)) return
        // A parità di utilità, prendi la più economica.
        const tieBreak = -purchaseCost(state, i) / 1000
        if (best === null || score + tieBreak > bestScore) {
          best = i
          bestScore = score + tieBreak
        }
      })
      return best === null ? [] : [{ kind: 'buy', marketIndex: best }]
    }

    case 'sellSector': {
      const card = player.actionCards.find((c) => config.actionById[c.defId].sector === macro.sector)
      return card ? [{ kind: 'sell', cardInstanceId: card.instanceId }] : []
    }

    case 'sellSurplus': {
      const required = requiredBySector(state, playerId)
      const counts = holdingsBySector(state, player)
      const surplus = player.actionCards.find((c) => {
        const sector = config.actionById[c.defId].sector
        return counts[sector] > (required[sector] ?? 0)
      })
      if (!surplus) return []
      // Vendere sotto il prezzo di rimpiazzo è una perdita secca: non farlo a $0.
      return saleValue(state, surplus.defId) > 0 ? [{ kind: 'sell', cardInstanceId: surplus.instanceId }] : []
    }

    case 'ipo': {
      const canIpo =
        player.ipoUsesThisRound < config.ipoPerRound && player.cash >= config.ipoCost && state.market.length > 0
      return canIpo ? [{ kind: 'ipo' }] : []
    }

    case 'abandonEtf': {
      if (state.round > config.etfAbandonUntilRound) return []
      const counts = holdingsBySector(state, player)
      let worst: { id: string; missing: number } | null = null
      for (const card of player.etfCards) {
        const def = config.etfById[card.defId]
        const missing = etfCardsMissing(counts, def.requirement)
        if (missing === 0 || player.cash < def.fireSaleCost) continue
        if (!worst || missing > worst.missing) worst = { id: card.instanceId, missing }
      }
      return worst ? [{ kind: 'abandonEtf', cardInstanceId: worst.id }] : []
    }
  }
}

function cheapestAffordable(state: GameState, playerId: string, sector?: SectorId): number | null {
  const player = getPlayer(state, playerId)
  let best: number | null = null
  let bestCost = Infinity
  state.market.forEach((card, i) => {
    if (sector && state.config.actionById[card.defId].sector !== sector) return
    const cost = purchaseCost(state, i)
    if (cost > player.cash || cost >= bestCost) return
    best = i
    bestCost = cost
  })
  return best
}

/** Il massimo che ciascun ETF in mano richiede per settore: sotto questa soglia non si vende. */
function requiredBySector(state: GameState, playerId: string): Record<SectorId, number> {
  const player = getPlayer(state, playerId)
  const required: Record<SectorId, number> = {}
  for (const id of state.config.sectorIds) required[id] = 0
  for (const card of player.etfCards) {
    const def = state.config.etfById[card.defId]
    for (const [sector, needed] of Object.entries(def.requirement) as [SectorId, number][]) {
      required[sector] = Math.max(required[sector] ?? 0, needed)
    }
  }
  return required
}
