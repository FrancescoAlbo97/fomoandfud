import { DEFAULT_CONFIG, type GameConfig } from './config'
import { buildActionDeck, buildMixedDeck, resetInstanceIds } from './deck'
import { withRng } from './rng'
import type { ControllerType, GameState, PlayerState, SectorId } from './types'

export interface NewPlayerConfig {
  id: string
  name: string
  controller: ControllerType
  /** Obbligatorio per i posti 'bot': il nome nella AGENT_REGISTRY. */
  agentName?: string
}

export interface GameOptions {
  seed?: number
  config?: GameConfig
}

export function createInitialState(players: NewPlayerConfig[], options: GameOptions | number = {}): GameState {
  // `createInitialState(players, 1234)` resta supportato per comodità.
  const opts: GameOptions = typeof options === 'number' ? { seed: options } : options
  const config = opts.config ?? DEFAULT_CONFIG
  const seed = opts.seed ?? Date.now()

  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`FOMO & FUD si gioca in ${config.minPlayers}-${config.maxPlayers} giocatori`)
  }
  resetInstanceIds()

  const sectors: Record<SectorId, number> = {}
  for (const id of config.sectorIds) sectors[id] = config.priceStart

  let market: GameState['market'] = []
  let ipoDeck: GameState['ipoDeck'] = []
  let mixedDeck: GameState['mixedDeck'] = []
  let firstPlayerId = players[0].id

  const [, seedAfterSetup] = withRng(seed, (rng) => {
    // §4.2 — reveal N cards to bump sectors up, N more to bump them down.
    let actionPool = rng.shuffle(buildActionDeck(config))
    const bumpUp = actionPool.slice(0, config.setupBumpUpCards)
    const bumpDown = actionPool.slice(config.setupBumpUpCards, config.setupBumpUpCards + config.setupBumpDownCards)
    for (const c of bumpUp) sectors[config.actionById[c.defId].sector] += 1
    for (const c of bumpDown) sectors[config.actionById[c.defId].sector] -= 1
    for (const s of config.sectorIds) {
      sectors[s] = Math.max(config.priceMin, Math.min(config.priceMax, sectors[s]))
    }

    // Reshuffle the full pool again to form the Market + IPO deck.
    actionPool = rng.shuffle(actionPool)
    market = actionPool.slice(0, config.marketSize)
    ipoDeck = actionPool.slice(config.marketSize)

    mixedDeck = rng.shuffle(buildMixedDeck(config))
    firstPlayerId = rng.pick(players).id
  })

  const playerStates: PlayerState[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    controller: p.controller,
    agentName: p.controller === 'bot' ? (p.agentName ?? 'heuristic') : null,
    cash: config.startingCash,
    actionCards: [],
    rumorCards: [],
    etfCards: [],
    role: null,
    hasPlayedCardThisRound: false,
    ipoUsesThisRound: 0,
    knownOpponentActionCards: {},
  }))

  let deckPointer = mixedDeck.length
  for (const player of playerStates) {
    for (let i = 0; i < config.startingMixedCards && deckPointer > 0; i++) {
      deckPointer -= 1
      const card = mixedDeck[deckPointer]
      if (card.kind === 'rumor') player.rumorCards.push(card)
      else player.etfCards.push(card)
    }
  }
  const remainingMixedDeck = mixedDeck.slice(0, deckPointer)

  return {
    config,
    round: 1,
    phase: 'step1_roleAndFud',
    sectors,
    market,
    ipoDeck,
    actionDiscard: [],
    mixedDeck: remainingMixedDeck,
    mixedDiscard: [],
    players: playerStates,
    firstPlayerId,
    turnOrder: orderFrom(playerStates.map((p) => p.id), firstPlayerId),
    feesModifierThisRound: 0,
    pendingMarketNews: [],
    marketNewsQueue: [],
    pendingEffectChoice: null,
    orderDeclarations: [],
    actorPointer: 0,
    shortSqueezeOrCrashThisRound: false,
    closingEvents: [],
    playersNeedingTraderDiscard: [],
    log: [{ id: 'log-0', round: 1, phase: 'step1_roleAndFud', text: 'La partita inizia. Round 1, Passo 1: Ruolo e FUD.' }],
    gameOverResult: null,
    rngSeed: seedAfterSetup,
    pendingDraw: null,
  }
}

/** Rotates `ids` (assumed to be in fixed table/clockwise order) so it starts at `startId`. */
export function orderFrom(ids: string[], startId: string): string[] {
  const idx = ids.indexOf(startId)
  if (idx < 0) return ids.slice()
  return [...ids.slice(idx), ...ids.slice(0, idx)]
}
