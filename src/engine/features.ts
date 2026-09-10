/**
 * ENCODER DELLE FEATURE: Observation → vettore piatto di numeri.
 *
 * È l'ingresso della rete. Vale la stessa regola del firewall: qui entra solo
 * ciò che il giocatore può vedere al tavolo. L'unica informazione "nascosta"
 * che compare è il card counting su ciò che NON è ancora uscito — che un
 * giocatore attento fa a mente, e che è il segnale con cui si valuta se una
 * dichiarazione avversaria è credibile o un bluff.
 *
 * La lunghezza del vettore dipende dalla config: cambiare settori o giocatori
 * in balance.ts la ricalcola da sé, e `featureLayout()` la documenta.
 */
import type { GameConfig } from './config'
import { probOpponentCanBack, type Observation } from './observation'
import type { Phase, RumorTarget, SectorId } from './types'

const PHASES: Phase[] = [
  'step1_roleAndFud', 'step2_declare', 'step3_insideTrading',
  'step4_trade', 'step5_lateMarketNews', 'step6_closing',
]

export interface FeatureBlock {
  name: string
  size: number
}

export function featureLayout(config: GameConfig): FeatureBlock[] {
  const S = config.sectorIds.length
  const opponents = config.maxPlayers - 1
  const targetBuckets = 2 * S + 4 // settori↑↓ + commissioni↑↓ + avversario↑↓
  return [
    { name: 'round', size: config.rounds },
    { name: 'phase', size: PHASES.length },
    { name: 'seat', size: config.maxPlayers },
    { name: 'prezzi', size: S },
    { name: 'distanza da squeeze/crash', size: 2 * S },
    { name: 'commissioni', size: 1 },
    { name: 'mercato', size: config.marketSize * (S + 2) },
    { name: 'io: cash e mano', size: 4 },
    { name: 'io: titoli per settore', size: S },
    { name: 'io: ETF mancanti per settore', size: S },
    { name: 'io: PV ETF completabili', size: 2 },
    { name: 'io: Rumor per bersaglio', size: targetBuckets },
    { name: 'io: flag di turno', size: 3 },
    { name: 'avversari', size: opponents * (6 + targetBuckets + 1) },
    { name: 'Market News in arrivo', size: S + 1 },
    { name: 'mazzi', size: 2 },
    { name: 'card counting per bersaglio', size: targetBuckets },
  ]
}

export function featureSize(config: GameConfig): number {
  return featureLayout(config).reduce((n, b) => n + b.size, 0)
}

/** Estremi dichiarati del Box di osservazione (Gymnasium). */
export const FEATURE_MIN = -1
export const FEATURE_MAX = 2

/**
 * Arrotonda a 4 decimali e vincola agli estremi del Box.
 *
 * L'arrotondamento: serializzare 0.3333333333333333 costa 18 caratteri contro 6,
 * e attraverso il ponte passano decine di migliaia di numeri a ogni passo — la
 * precisione persa è irrilevante per una rete, il traffico no.
 *
 * Il vincolo: qualche feature può sfondare in casi estremi (quattro Market News
 * sullo stesso settore, commissioni impilate). Meglio saturare che violare in
 * silenzio lo spazio di osservazione dichiarato.
 */
function clean(v: number): number {
  return Math.round(Math.max(FEATURE_MIN, Math.min(FEATURE_MAX, v)) * 10000) / 10000
}

export function encodeObservation(obs: Observation): number[] {
  const config = obs.config
  const S = config.sectorIds.length
  const out: number[] = []
  const push = (...values: number[]) => out.push(...values)
  const oneHot = (index: number, size: number) => {
    for (let i = 0; i < size; i++) out.push(i === index ? 1 : 0)
  }
  const priceSpan = config.priceMax - config.priceMin || 1
  const normPrice = (p: number) => (p - config.priceMin) / priceSpan
  // Il cash si normalizza su quanto se ne può realisticamente avere a fine partita.
  const cashScale = config.startingCash + Math.max(config.valueInvestor.cash, config.trader.cash) * config.rounds
  const normCash = (c: number) => Math.min(2, c / cashScale)

  oneHot(obs.round - 1, config.rounds)
  oneHot(PHASES.indexOf(obs.phase), PHASES.length)
  oneHot(obs.seat, config.maxPlayers)

  for (const sector of config.sectorIds) push(normPrice(obs.sectors[sector]))
  for (const sector of config.sectorIds) {
    const price = obs.sectors[sector]
    push(
      (price - config.shortSqueezeAt) / priceSpan, // quanto manca allo Short Squeeze
      (config.crashAt - price) / priceSpan, // quanto manca al Crash
    )
  }
  push(obs.feesModifierThisRound / 4)

  // Mercato: settore in one-hot, costo normalizzato, e se te lo puoi permettere.
  for (let i = 0; i < config.marketSize; i++) {
    const slot = obs.market[i]
    if (!slot) {
      for (let k = 0; k < S + 2; k++) push(0)
      continue
    }
    oneHot(config.sectorIds.indexOf(slot.sector), S)
    push(slot.cost / (config.priceMax + 4), obs.cash >= slot.cost ? 1 : 0)
  }

  push(
    normCash(obs.cash),
    Math.min(1, obs.actionCards.length / 8),
    Math.min(1, obs.rumorCards.length / 5),
    Math.min(1, obs.etfCards.length / 5),
  )
  for (const sector of config.sectorIds) push(Math.min(1, (obs.holdings[sector] ?? 0) / 6))

  // ETF in mano: quante carte mancano per settore, e quanti PV sono ancora in gioco.
  const missing: Record<SectorId, number> = {}
  for (const sector of config.sectorIds) missing[sector] = 0
  let reachablePV = 0
  let deadPV = 0
  const roundsLeft = config.rounds - obs.round + 1
  for (const card of obs.etfCards) {
    const def = config.etfById[card.defId]
    let total = 0
    for (const [sector, needed] of Object.entries(def.requirement) as [SectorId, number][]) {
      const gap = Math.max(0, needed - (obs.holdings[sector] ?? 0))
      missing[sector] += gap
      total += gap
    }
    if (total === 0 || total <= roundsLeft * 2) reachablePV += def.pv
    else deadPV += def.pv
  }
  for (const sector of config.sectorIds) push(Math.min(1, missing[sector] / 6))
  push(Math.min(1, reachablePV / 20), Math.min(1, deadPV / 20))

  // Rumor in mano, raggruppate per bersaglio.
  const buckets = targetBucketCounts(config, obs.rumorCards.map((c) => config.rumorById[c.defId].target))
  for (const v of buckets) push(Math.min(1, v / 3))

  push(
    obs.hasPlayedCardThisRound ? 1 : 0,
    obs.ipoUsesThisRound >= config.ipoPerRound ? 1 : 0,
    obs.selfId === obs.firstPlayerId ? 1 : 0,
  )

  // Avversari: posti fissi, quelli assenti restano a zero (l'ultimo flag dice se esiste).
  for (let slot = 0; slot < config.maxPlayers - 1; slot++) {
    const opponent = obs.opponents[slot]
    const bucketCount = 2 * S + 4
    if (!opponent) {
      for (let k = 0; k < 6 + bucketCount + 1; k++) push(0)
      continue
    }
    const declaration = obs.declarations.find((d) => d.playerId === opponent.id)
    push(
      normCash(opponent.cash),
      Math.min(1, opponent.actionCardCount / 8),
      Math.min(1, opponent.rumorCardCount / 5),
      Math.min(1, opponent.etfCardCount / 5),
      opponent.role === 'valueInvestor' ? 1 : 0,
      opponent.role === 'trader' ? 1 : 0,
    )
    // Cosa ha dichiarato, in one-hot sul bersaglio.
    const declared = declaration ? targetBucketCounts(config, [toRumorTarget(declaration.target)]) : new Array(bucketCount).fill(0)
    for (const v of declared) push(v)
    // ...e quanto è credibile, dato il card counting.
    push(declaration ? probOpponentCanBack(obs, opponent, toRumorTarget(declaration.target)) : 0)
  }

  // Market News già scoperte: effetto netto atteso, settore per settore.
  const incoming: Record<SectorId, number> = {}
  for (const sector of config.sectorIds) incoming[sector] = 0
  let incomingFees = 0
  for (const news of obs.pendingMarketNews) {
    const def = config.rumorById[news.card.defId]
    if (def.marketNews.kind === 'movePrice' && def.target.kind === 'sector') {
      incoming[def.target.sector] += def.marketNews.amount
    } else if (def.marketNews.kind === 'adjustFees') {
      incomingFees += def.marketNews.amount
    }
  }
  for (const sector of config.sectorIds) push(incoming[sector] / 4)
  push(incomingFees / 4)

  push(Math.min(1, obs.ipoDeckSize / config.totalActionCards), Math.min(1, obs.mixedDeckSize / config.totalMixedCards))

  // Card counting: quota di carte non ancora viste, per bersaglio.
  const unseen = new Array(2 * S + 4).fill(0)
  for (const rumor of config.rumors) {
    const idx = bucketIndex(config, rumor.target)
    unseen[idx] += obs.unseenMixedByDefId[rumor.id] ?? 0
  }
  const totalUnseen = obs.unseenMixedTotal || 1
  for (const v of unseen) push(v / totalUnseen)

  return out.map(clean)
}

function toRumorTarget(target: { kind: string; direction: string; sector?: SectorId }): RumorTarget {
  if (target.kind === 'sector') return { kind: 'sector', sector: target.sector!, direction: target.direction as 'up' | 'down' }
  if (target.kind === 'fees') return { kind: 'fees', direction: target.direction as 'up' | 'down' }
  return { kind: 'opponent', direction: target.direction as 'up' | 'down' }
}

function bucketIndex(config: GameConfig, target: RumorTarget): number {
  const S = config.sectorIds.length
  if (target.kind === 'sector') {
    return config.sectorIds.indexOf(target.sector) * 2 + (target.direction === 'up' ? 0 : 1)
  }
  if (target.kind === 'fees') return S * 2 + (target.direction === 'up' ? 0 : 1)
  return S * 2 + 2 + (target.direction === 'up' ? 0 : 1)
}

function targetBucketCounts(config: GameConfig, targets: RumorTarget[]): number[] {
  const buckets = new Array(config.sectorIds.length * 2 + 4).fill(0)
  for (const target of targets) buckets[bucketIndex(config, target)] += 1
  return buckets
}
