/**
 * Trasforma un `Balance` (i valori che modifichi tu) in un `GameConfig`: la
 * stessa cosa, più i cataloghi di carte derivati e le mappe di lookup che
 * l'engine usa a runtime.
 *
 * `makeConfig` VALIDA sempre. Se un valore rompe un'invariante del gioco ricevi
 * un errore che dice esattamente cosa e dove, invece di una partita che esplode
 * a metà simulazione.
 */
import { DEFAULT_BALANCE, type Balance, type EtfBalance, type RumorBalance, type SectorBalance } from './balance'
import type { ActionCardDef, SectorId } from './types'

export interface GameConfig extends Balance {
  sectorIds: SectorId[]
  sectorById: Record<SectorId, SectorBalance>
  actionDefs: ActionCardDef[]
  actionById: Record<string, ActionCardDef>
  rumorById: Record<string, RumorBalance>
  etfById: Record<string, EtfBalance>
  /** Numero di Carte Azione per settore, derivato dalla lunghezza delle liste. */
  actionCardsBySector: Record<SectorId, number>
  totalActionCards: number
  totalMixedCards: number
}

export function validateBalance(b: Balance): string[] {
  const errors: string[] = []
  const fail = (msg: string) => errors.push(msg)

  if (b.rounds < 1) fail(`rounds deve essere >= 1 (ora ${b.rounds})`)
  if (b.minPlayers < 2) fail(`minPlayers deve essere >= 2 (ora ${b.minPlayers})`)
  if (b.maxPlayers < b.minPlayers) fail(`maxPlayers (${b.maxPlayers}) < minPlayers (${b.minPlayers})`)
  if (b.startingCash < 0) fail(`startingCash non può essere negativo`)
  if (b.wealthPerPV <= 0) fail(`wealthPerPV deve essere > 0 (ora ${b.wealthPerPV})`)

  // --- Settori e prezzi ---
  if (b.sectors.length === 0) fail('serve almeno un settore')
  const sectorIds = b.sectors.map((s) => s.id)
  const dupSectors = sectorIds.filter((id, i) => sectorIds.indexOf(id) !== i)
  if (dupSectors.length) fail(`id di settore duplicati: ${[...new Set(dupSectors)].join(', ')}`)
  for (const s of b.sectors) {
    if (s.cards.length === 0) fail(`il settore "${s.id}" non ha Carte Azione`)
    const dup = s.cards.filter((c, i) => s.cards.indexOf(c) !== i)
    if (dup.length) fail(`nomi di carta duplicati nel settore "${s.id}": ${[...new Set(dup)].join(', ')}`)
  }
  if (b.priceMin > b.priceStart || b.priceStart > b.priceMax) {
    fail(`priceStart (${b.priceStart}) deve stare fra priceMin (${b.priceMin}) e priceMax (${b.priceMax})`)
  }
  if (b.shortSqueezeAt < b.priceMin || b.shortSqueezeAt > b.priceMax) fail(`shortSqueezeAt fuori dalla scala prezzi`)
  if (b.crashAt < b.priceMin || b.crashAt > b.priceMax) fail(`crashAt fuori dalla scala prezzi`)
  if (b.shortSqueezeAt >= b.crashAt) fail(`shortSqueezeAt (${b.shortSqueezeAt}) deve stare sotto crashAt (${b.crashAt})`)
  if (b.reboundTo <= b.shortSqueezeAt || b.reboundTo >= b.crashAt) {
    fail(`reboundTo (${b.reboundTo}) deve stare STRETTAMENTE fra shortSqueezeAt e crashAt, altrimenti squeeze e crash si autoinnescano all'infinito`)
  }

  // --- Mercato ---
  const totalActionCards = b.sectors.reduce((n, s) => n + s.cards.length, 0)
  if (b.marketFees.length !== b.marketSize) {
    fail(`marketFees ha ${b.marketFees.length} valori ma marketSize è ${b.marketSize}: devono coincidere`)
  }
  if (b.marketFees.some((f) => f < 0)) fail('le commissioni di base non possono essere negative')
  if (b.marketSize < 1) fail('marketSize deve essere >= 1')
  if (b.marketSize > totalActionCards) fail(`marketSize (${b.marketSize}) supera le Carte Azione totali (${totalActionCards})`)
  if (b.setupBumpUpCards + b.setupBumpDownCards > totalActionCards) fail('il Setup rivela più carte di quante ne esistano')
  if (b.ipoRefreshCount < 1 || b.ipoRefreshCount > b.marketSize) fail(`ipoRefreshCount deve stare fra 1 e marketSize`)
  if (b.ipoCost < 0) fail('ipoCost non può essere negativo')

  // --- Ruoli ---
  if (b.valueInvestor.keepMax > b.valueInvestor.draw) {
    fail(`il Value Investor non può tenere ${b.valueInvestor.keepMax} carte pescandone ${b.valueInvestor.draw}`)
  }
  if (b.valueInvestor.draw < 0 || b.trader.draw < 0) fail('le pescate non possono essere negative')

  // --- Rumor ---
  const rumorIds = b.rumors.map((r) => r.id)
  const dupRumors = rumorIds.filter((id, i) => rumorIds.indexOf(id) !== i)
  if (dupRumors.length) fail(`id di Rumor duplicati: ${[...new Set(dupRumors)].join(', ')}`)
  for (const r of b.rumors) {
    if (r.quantity < 0) fail(`Rumor "${r.id}": quantity negativa`)
    if (r.target.kind === 'sector' && !sectorIds.includes(r.target.sector)) {
      fail(`Rumor "${r.id}" punta al settore inesistente "${r.target.sector}"`)
    }
    if (r.target.kind === 'sector' && r.insideTrading.kind !== 'movePrice') {
      fail(`Rumor "${r.id}" ha bersaglio settore ma effetto Inside "${r.insideTrading.kind}": serve movePrice`)
    }
    if (r.target.kind === 'sector' && r.marketNews.kind !== 'movePrice') {
      fail(`Rumor "${r.id}" ha bersaglio settore ma effetto News "${r.marketNews.kind}": serve movePrice`)
    }
    // La direzione dichiarata sul segnalino deve combaciare col segno dell'effetto,
    // altrimenti dichiari "Tech ↑" e la carta fa scendere il prezzo.
    for (const [half, eff] of [['Inside', r.insideTrading], ['News', r.marketNews]] as const) {
      if (eff.kind === 'movePrice' || eff.kind === 'adjustFees') {
        const goesUp = eff.amount > 0
        if (eff.amount !== 0 && goesUp !== (r.target.direction === 'up')) {
          fail(`Rumor "${r.id}" (${half}): bersaglio ${r.target.direction} ma effetto ${eff.amount > 0 ? '+' : ''}${eff.amount}`)
        }
      }
    }
  }

  // --- ETF ---
  const etfIds = b.etfs.map((e) => e.id)
  const dupEtfs = etfIds.filter((id, i) => etfIds.indexOf(id) !== i)
  if (dupEtfs.length) fail(`id di ETF duplicati: ${[...new Set(dupEtfs)].join(', ')}`)
  for (const e of b.etfs) {
    if (e.pv < 0) fail(`ETF "${e.id}": pv negativi`)
    if (e.fireSaleCost < 0) fail(`ETF "${e.id}": fireSaleCost negativo`)
    let needed = 0
    for (const [sector, count] of Object.entries(e.requirement) as [SectorId, number][]) {
      needed += count
      const sectorDef = b.sectors.find((s) => s.id === sector)
      if (!sectorDef) {
        fail(`ETF "${e.id}" richiede il settore inesistente "${sector}"`)
        continue
      }
      if (count > sectorDef.cards.length) {
        fail(`ETF "${e.id}" richiede ${count} carte ${sector} ma nel mazzo ce ne sono ${sectorDef.cards.length}`)
      }
    }
    if (needed === 0) fail(`ETF "${e.id}" non richiede nessuna carta: si completerebbe da solo`)
  }

  return errors
}

/** Segnalazioni non bloccanti: il gioco funziona, ma probabilmente non è quello che volevi. */
export function balanceWarnings(b: Balance): string[] {
  const warnings: string[] = []
  const totalMixed = b.rumors.reduce((n, r) => n + r.quantity, 0) + b.etfs.length
  const worstCaseDraws =
    b.maxPlayers * b.startingMixedCards + b.rounds * b.maxPlayers * Math.max(b.valueInvestor.draw, b.trader.draw)
  if (totalMixed < worstCaseDraws) {
    warnings.push(
      `il mazzo misto ha ${totalMixed} carte ma in ${b.rounds} Round a ${b.maxPlayers} giocatori se ne possono pescare fino a ${worstCaseDraws}: il mazzo può esaurirsi`,
    )
  }
  for (const e of b.etfs) {
    const exact = Math.abs(e.fireSaleCost - e.pv / 2) > 0.001
    if (exact) warnings.push(`ETF "${e.id}": la svendita ($${e.fireSaleCost}) non è metà dei PV (${e.pv}) come da §9.1`)
  }
  const totalActionCards = b.sectors.reduce((n, s) => n + s.cards.length, 0)
  const heaviest = Math.max(
    0,
    ...b.etfs.map((e) => (Object.values(e.requirement) as number[]).reduce((a, c) => a + c, 0)),
  )
  if (heaviest * b.maxPlayers > totalActionCards) {
    warnings.push(
      `l'ETF più esigente chiede ${heaviest} Carte Azione: con ${b.maxPlayers} giocatori non possono completarlo tutti (${totalActionCards} carte in totale)`,
    )
  }
  return warnings
}

export function makeConfig(overrides: Partial<Balance> = {}): GameConfig {
  const balance: Balance = { ...DEFAULT_BALANCE, ...overrides }
  const errors = validateBalance(balance)
  if (errors.length > 0) {
    throw new Error(`Bilanciamento non valido:\n  - ${errors.join('\n  - ')}`)
  }

  const actionDefs: ActionCardDef[] = balance.sectors.flatMap((sector) =>
    sector.cards.map((name, i) => ({ id: `action-${sector.id}-${i}`, sector: sector.id, name })),
  )
  const actionCardsBySector: Record<SectorId, number> = {}
  for (const sector of balance.sectors) actionCardsBySector[sector.id] = sector.cards.length

  return {
    ...balance,
    sectorIds: balance.sectors.map((s) => s.id),
    sectorById: Object.fromEntries(balance.sectors.map((s) => [s.id, s])),
    actionDefs,
    actionById: Object.fromEntries(actionDefs.map((d) => [d.id, d])),
    rumorById: Object.fromEntries(balance.rumors.map((r) => [r.id, r])),
    etfById: Object.fromEntries(balance.etfs.map((e) => [e.id, e])),
    actionCardsBySector,
    totalActionCards: actionDefs.length,
    totalMixedCards: balance.rumors.reduce((n, r) => n + r.quantity, 0) + balance.etfs.length,
  }
}

/** Config di default, pronto all'uso. */
export const DEFAULT_CONFIG: GameConfig = makeConfig()
