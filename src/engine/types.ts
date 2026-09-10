// Core domain types for FOMO & FUD. Pure data, no React here.
//
// NB: nessun valore di gioco vive qui. Carte, prezzi ed economia stanno in
// balance.ts e arrivano all'engine attraverso `GameState.config`.
import type { GameConfig } from './config'

/** L'id di un settore, definito in balance.ts (di serie: tech / energy / crypto). */
export type SectorId = string

export type Direction = 'up' | 'down'

export type Role = 'valueInvestor' | 'trader'

/** Chi decide per questo posto: una persona, oppure un agente della AGENT_REGISTRY. */
export type ControllerType = 'human' | 'bot'

// --- Order token target (the "bersaglio" declared at Step 2) ---
export type OrderTarget =
  | { kind: 'sector'; sector: SectorId; direction: Direction }
  | { kind: 'fees'; direction: Direction }
  | { kind: 'opponent'; direction: Direction; opponentId: string }

// --- Static card definitions (derived from balance.ts by config.ts) ---

export interface ActionCardDef {
  id: string
  sector: SectorId
  name: string
}

export type RumorTarget =
  | { kind: 'sector'; sector: SectorId; direction: Direction }
  | { kind: 'fees'; direction: Direction }
  | { kind: 'opponent'; direction: Direction }

export type EffectSpec =
  | { kind: 'movePrice'; amount: number } // signed; sector comes from the card's target
  | { kind: 'adjustFees'; amount: number } // signed delta applied to feesModifierThisRound
  | { kind: 'discardRandomRumor' } // target = the declared opponent
  | { kind: 'discardChosenRumorAndAzione' } // target = the declared opponent
  | { kind: 'peekHand' } // target = the declared opponent
  | { kind: 'swapAzioneCard' } // target = the declared opponent

// --- Instances (actual cards moving through the game) ---

export interface ActionCardInstance {
  instanceId: string
  defId: string // ActionCardDef.id
}

export interface RumorCardInstance {
  instanceId: string
  kind: 'rumor'
  defId: string // RumorBalance.id
}

export interface ETFCardInstance {
  instanceId: string
  kind: 'etf'
  defId: string // EtfBalance.id
}

export type MixedCardInstance = RumorCardInstance | ETFCardInstance

// A Rumor card a player has declared as Market News: visible, waiting to resolve
// at Step 1 of the following round.
export interface PlacedMarketNews {
  playerId: string
  card: RumorCardInstance
  declaredTarget: RumorTarget
  opponentId?: string
}

/**
 * An effect that cannot resolve on its own because a player still has to choose
 * something (§15.2 — the two Avversario Market News). The engine parks it here and
 * `settle()` surfaces it as a PendingDecision before anything else continues.
 */
export type PendingEffectChoice =
  | { kind: 'forcedDiscard'; targetPlayerId: string; sourcePlayerId: string }
  | { kind: 'insiderSwap'; actingPlayerId: string; opponentId: string }

export interface OrderDeclaration {
  playerId: string
  target: OrderTarget
  /** Whether this player already placed a Market News alongside this token (Step 2). */
  placedMarketNewsAtStep2: boolean
}

export interface PlayerState {
  id: string
  name: string
  controller: ControllerType
  /** Nome dell'agente che gioca questo posto; null per i giocatori umani. */
  agentName: string | null
  cash: number
  actionCards: ActionCardInstance[]
  rumorCards: RumorCardInstance[]
  etfCards: ETFCardInstance[]
  role: Role | null
  /** Set true once this player has used their single card-play (Inside Trading or Market News) this round. */
  hasPlayedCardThisRound: boolean
  ipoUsesThisRound: number
  /** Public knowledge each player has picked up (peeked hands, forced reveals). */
  knownOpponentActionCards: Record<string, string[]>
}

export type Phase =
  | 'setup'
  | 'step1_roleAndFud'
  | 'step2_declare'
  | 'step3_insideTrading'
  | 'step4_trade'
  | 'step5_lateMarketNews'
  | 'step6_closing'
  | 'gameOver'

export interface LogEntry {
  id: string
  round: number
  phase: Phase
  text: string
}

export interface GameState {
  /** Tutti i valori di gioco per questa partita. Immutabile e condiviso. */
  config: GameConfig
  round: number
  phase: Phase
  sectors: Record<SectorId, number>
  market: ActionCardInstance[]
  ipoDeck: ActionCardInstance[]
  actionDiscard: ActionCardInstance[]
  mixedDeck: MixedCardInstance[]
  mixedDiscard: MixedCardInstance[]
  players: PlayerState[]
  firstPlayerId: string
  turnOrder: string[] // player ids, from first player clockwise, fixed for the round
  feesModifierThisRound: number
  pendingMarketNews: PlacedMarketNews[]
  /**
   * Market News being resolved right now at Step 1, already sorted into turn order.
   * Drained one at a time so an effect can stop and ask its target for a choice.
   */
  marketNewsQueue: PlacedMarketNews[]
  /** A choice an effect is waiting on; blocks everything else until answered. */
  pendingEffectChoice: PendingEffectChoice | null
  orderDeclarations: OrderDeclaration[]
  /** Pointer into turnOrder for whichever step-loop is currently running. */
  actorPointer: number
  shortSqueezeOrCrashThisRound: boolean
  /** Storico di tutti gli Short Squeeze e Crash della partita (§8), per la telemetria. */
  closingEvents: { round: number; sector: SectorId; kind: 'squeeze' | 'crash' }[]
  playersNeedingTraderDiscard: string[]
  log: LogEntry[]
  gameOverResult: ScoreResult[] | null
  rngSeed: number
  /** Transient: a Value Investor's freshly-drawn cards, awaiting the keep decision. */
  pendingDraw: { playerId: string; cards: MixedCardInstance[] } | null
}

export interface ScoreResult {
  playerId: string
  cash: number
  holdingsValue: number
  wealth: number
  wealthPV: number
  etfPV: number
  totalPV: number
  completedEtfs: string[]
}
