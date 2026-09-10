/**
 * Il FIREWALL INFORMATIVO.
 *
 * `view(state, playerId)` proietta il GameState in ciò che quel giocatore può
 * davvero sapere seduto al tavolo. Ogni bot — e in futuro ogni policy addestrata —
 * DEVE partire da qui e mai da `GameState`: un'AI che vede le mani altrui non può
 * imparare a bluffare né a temere il bluff, e i risultati di bilanciamento che
 * produce descrivono un gioco diverso da quello che giocherai tu.
 */
import type { GameConfig } from './config'
import { positionFee, purchaseCost } from './market'
import { holdingsBySector } from './scoring'
import type {
  ETFCardInstance,
  GameState,
  OrderDeclaration,
  PlacedMarketNews,
  Phase,
  Role,
  RumorCardInstance,
  RumorTarget,
  SectorId,
} from './types'

export interface OpponentView {
  id: string
  name: string
  cash: number
  role: Role | null
  /** Quante Carte Azione ha in mano — non quali (salvo peek, sotto). */
  actionCardCount: number
  rumorCardCount: number
  etfCardCount: number
  hasPlayedCardThisRound: boolean
  ipoUsesThisRound: number
  /** Settori delle sue Carte Azione, ma solo se le hai sbirciate con Insider Wiretap. */
  peekedActionSectors: SectorId[] | null
}

export interface MarketSlotView {
  instanceId: string
  sector: SectorId
  name: string
  /** Prezzo dell'indicatore + commissione di posizione, già sommati. */
  cost: number
  fee: number
}

export interface Observation {
  config: GameConfig
  round: number
  phase: Phase
  selfId: string
  /** Posizione nell'ordine di turno di questo Round (0 = Primo Giocatore). */
  seat: number
  turnOrder: string[]
  firstPlayerId: string

  // --- Pubblico ---
  sectors: Record<SectorId, number>
  feesModifierThisRound: number
  market: MarketSlotView[]
  ipoDeckSize: number
  mixedDeckSize: number
  /** Dichiarazioni già fatte in questo Round, nell'ordine in cui sono arrivate. */
  declarations: OrderDeclaration[]
  /** Market News scoperte in attesa: le vedi arrivare con un Round di anticipo. */
  pendingMarketNews: PlacedMarketNews[]
  opponents: OpponentView[]

  // --- Privato ---
  cash: number
  actionCards: { instanceId: string; sector: SectorId; name: string }[]
  holdings: Record<SectorId, number>
  rumorCards: RumorCardInstance[]
  etfCards: ETFCardInstance[]
  hasPlayedCardThisRound: boolean
  ipoUsesThisRound: number
  myDeclaration: OrderDeclaration | null

  /**
   * Card counting: quante copie di ogni carta del mazzo misto NON hai ancora visto.
   * Sono quelle che stanno nel mazzo o in mano agli avversari — esattamente ciò che
   * sa un giocatore attento. È la base per stimare se una dichiarazione è un bluff.
   */
  unseenMixedByDefId: Record<string, number>
  unseenMixedTotal: number
}

export function view(state: GameState, playerId: string): Observation {
  const config = state.config
  const me = state.players.find((p) => p.id === playerId)
  if (!me) throw new Error(`Giocatore sconosciuto: ${playerId}`)

  // Ciò che ho visto uscire: la mia mano, gli scarti pubblici e le News scoperte.
  const seen: Record<string, number> = {}
  const markSeen = (defId: string) => {
    seen[defId] = (seen[defId] ?? 0) + 1
  }
  for (const c of me.rumorCards) markSeen(c.defId)
  for (const c of me.etfCards) markSeen(c.defId)
  for (const c of state.mixedDiscard) markSeen(c.defId)
  for (const n of [...state.pendingMarketNews, ...state.marketNewsQueue]) markSeen(n.card.defId)

  const unseenMixedByDefId: Record<string, number> = {}
  let unseenMixedTotal = 0
  for (const rumor of config.rumors) {
    const left = Math.max(0, rumor.quantity - (seen[rumor.id] ?? 0))
    unseenMixedByDefId[rumor.id] = left
    unseenMixedTotal += left
  }
  for (const etf of config.etfs) {
    const left = Math.max(0, 1 - (seen[etf.id] ?? 0))
    unseenMixedByDefId[etf.id] = left
    unseenMixedTotal += left
  }

  return {
    config,
    round: state.round,
    phase: state.phase,
    selfId: playerId,
    seat: Math.max(0, state.turnOrder.indexOf(playerId)),
    turnOrder: state.turnOrder,
    firstPlayerId: state.firstPlayerId,

    sectors: state.sectors,
    feesModifierThisRound: state.feesModifierThisRound,
    market: state.market.map((card, i) => {
      const def = config.actionById[card.defId]
      return {
        instanceId: card.instanceId,
        sector: def.sector,
        name: def.name,
        cost: purchaseCost(state, i),
        fee: positionFee(state, i),
      }
    }),
    ipoDeckSize: state.ipoDeck.length,
    mixedDeckSize: state.mixedDeck.length,
    declarations: state.orderDeclarations,
    pendingMarketNews: state.pendingMarketNews,
    opponents: state.players
      .filter((p) => p.id !== playerId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        cash: p.cash,
        role: p.role,
        actionCardCount: p.actionCards.length,
        rumorCardCount: p.rumorCards.length,
        etfCardCount: p.etfCards.length,
        hasPlayedCardThisRound: p.hasPlayedCardThisRound,
        ipoUsesThisRound: p.ipoUsesThisRound,
        peekedActionSectors: peeked(state, me.knownOpponentActionCards[p.id], p.id),
      })),

    cash: me.cash,
    actionCards: me.actionCards.map((c) => ({
      instanceId: c.instanceId,
      sector: config.actionById[c.defId].sector,
      name: config.actionById[c.defId].name,
    })),
    holdings: holdingsBySector(state, me),
    rumorCards: me.rumorCards,
    etfCards: me.etfCards,
    hasPlayedCardThisRound: me.hasPlayedCardThisRound,
    ipoUsesThisRound: me.ipoUsesThisRound,
    myDeclaration: state.orderDeclarations.find((d) => d.playerId === playerId) ?? null,

    unseenMixedByDefId,
    unseenMixedTotal,
  }
}

/** Traduce gli instanceId sbirciati nei settori che sono ancora davvero in quella mano. */
function peeked(state: GameState, knownIds: string[] | undefined, opponentId: string): SectorId[] | null {
  if (!knownIds) return null
  const opponent = state.players.find((p) => p.id === opponentId)!
  const stillThere = opponent.actionCards.filter((c) => knownIds.includes(c.instanceId))
  return stillThere.map((c) => state.config.actionById[c.defId].sector)
}

/**
 * Quota di carte non ancora viste che colpirebbero questo bersaglio. Con un solo
 * numero risponde a "quanto è credibile la minaccia che ha appena dichiarato?":
 * vicino a 0 significa quasi certamente un bluff.
 */
export function unseenMatchFraction(obs: Observation, target: RumorTarget | { kind: string; direction: string }): number {
  if (obs.unseenMixedTotal === 0) return 0
  let matching = 0
  for (const rumor of obs.config.rumors) {
    if (rumorHitsTarget(rumor.target, target)) matching += obs.unseenMixedByDefId[rumor.id] ?? 0
  }
  return matching / obs.unseenMixedTotal
}

function rumorHitsTarget(cardTarget: RumorTarget, declared: RumorTarget | { kind: string; direction: string }): boolean {
  if (cardTarget.kind !== declared.kind) return false
  if (cardTarget.direction !== declared.direction) return false
  if (cardTarget.kind === 'sector') {
    return cardTarget.sector === (declared as { sector?: SectorId }).sector
  }
  return true
}

/**
 * Probabilità che un avversario abbia ALMENO una carta compatibile col bersaglio
 * che ha dichiarato, dato quante carte tiene in mano e quante non hai ancora visto.
 * Modello a estrazione senza reimmissione — è il segnale-bluff che la rete userà.
 */
export function probOpponentCanBack(obs: Observation, opponent: OpponentView, target: RumorTarget): number {
  const handSize = opponent.rumorCardCount
  if (handSize === 0) return 0
  const total = obs.unseenMixedTotal
  if (total === 0) return 0
  let matching = 0
  for (const rumor of obs.config.rumors) {
    if (rumorHitsTarget(rumor.target, target)) matching += obs.unseenMixedByDefId[rumor.id] ?? 0
  }
  const misses = total - matching
  let pNone = 1
  for (let i = 0; i < handSize; i++) {
    const remainingMisses = misses - i
    const remainingTotal = total - i
    if (remainingTotal <= 0 || remainingMisses <= 0) return 1
    pNone *= remainingMisses / remainingTotal
  }
  return 1 - pNone
}

/** Le carte Rumor NELLA MIA MANO che possono colpire questo bersaglio (§7.1). */
export function myMatchingRumors(obs: Observation, target: RumorTarget | { kind: string; direction: string }): RumorCardInstance[] {
  return obs.rumorCards.filter((c) => rumorHitsTarget(obs.config.rumorById[c.defId].target, target))
}
