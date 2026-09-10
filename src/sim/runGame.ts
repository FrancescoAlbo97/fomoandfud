/**
 * Runner headless: gioca una partita completa fra agenti e restituisce un
 * `MatchRecord`, cioè tutto ciò che serve poi per i grafici e le decisioni di
 * bilanciamento. Deterministico: stesso seed + stessi agenti = stessa partita.
 */
import type { GameConfig } from '../engine/config'
import { applyAgentMove, decideAgentMove, type Agent } from '../engine/agents'
import { currentPending } from '../engine/engine'
import { legalMacroActions, macroKey } from '../engine/macroActions'
import { myMatchingRumors, view } from '../engine/observation'
import { makeRng } from '../engine/rng'
import { rankResults } from '../engine/scoring'
import { createInitialState, type NewPlayerConfig } from '../engine/setup'
import type { OrderTarget, Role, SectorId } from '../engine/types'

export interface DeclarationRecord {
  round: number
  target: string
  /** true = ha dichiarato senza avere in mano nessuna carta compatibile. */
  wasBluff: boolean
  /** Come ha poi giocato la carta, se l'ha giocata. */
  playedAs: 'inside' | 'news' | null
}

export interface PlayerRecord {
  id: string
  agent: string
  /** Posizione al tavolo (fissa), 0-based. */
  seat: number
  totalPV: number
  wealthPV: number
  etfPV: number
  cash: number
  holdingsValue: number
  rank: number
  /** Payoff per l'RL: 1 = ha battuto tutti, 0 = ultimo. Pareggi condivisi. */
  score: number
  win: number
  rolesByRound: (Role | null)[]
  etfHeldAtEnd: string[]
  etfCompleted: string[]
  etfAbandoned: string[]
  declarations: DeclarationRecord[]
  /** Acquisti per posizione del Mercato: dice se la commissione più alta è mai giustificata. */
  buysByPosition: number[]
  buysBySector: Record<SectorId, number>
  spentOnBuys: number
  sells: number
  ipos: number
  macroCounts: Record<string, number>
}

export interface MatchRecord {
  seed: number
  playerCount: number
  rounds: number
  decisions: number
  players: PlayerRecord[]
  /** Prezzi al termine di ogni Round, dopo Squeeze/Crash. */
  pricesByRound: Record<SectorId, number>[]
  shortSqueezes: number
  crashes: number
  /** Ogni evento di chiusura con round e settore: dice QUALE settore è instabile. */
  closingEvents: { round: number; sector: SectorId; kind: 'squeeze' | 'crash' }[]
  /** Scarto di PV fra 1° e 2° classificato: misura quanto la partita è tirata. */
  winMargin: number
  /** Punti decisione in cui l'agente aveva una sola opzione: misura il "gioco morto". */
  forcedDecisions: number
  mixedDeckExhausted: boolean
}

export interface RunGameOptions {
  seed: number
  agents: Agent[]
  config: GameConfig
  /** Guardia anti-loop: massimo di decisioni prima di dichiarare la partita rotta. */
  maxDecisions?: number
}

export function runGame({ seed, agents, config, maxDecisions = 20000 }: RunGameOptions): MatchRecord {
  const playerConfigs: NewPlayerConfig[] = agents.map((a, i) => ({
    id: `p${i}`,
    name: `${a.name}#${i}`,
    controller: 'bot' as const,
    agentName: a.name,
  }))
  const agentById = new Map(playerConfigs.map((p, i) => [p.id, agents[i]]))
  const seatById = new Map(playerConfigs.map((p, i) => [p.id, i]))

  let state = createInitialState(playerConfigs, { seed, config })
  const rng = makeRng(seed ^ 0x5bf03635)

  const rec = new Map<string, PlayerRecord>(
    playerConfigs.map((p, i) => [
      p.id,
      {
        id: p.id,
        agent: agents[i].name,
        seat: i,
        totalPV: 0, wealthPV: 0, etfPV: 0, cash: 0, holdingsValue: 0,
        rank: 0, score: 0, win: 0,
        rolesByRound: [],
        etfHeldAtEnd: [], etfCompleted: [], etfAbandoned: [],
        declarations: [],
        buysByPosition: Array.from({ length: config.marketSize }, () => 0),
        buysBySector: Object.fromEntries(config.sectorIds.map((s) => [s, 0])),
        spentOnBuys: 0, sells: 0, ipos: 0,
        macroCounts: {},
      },
    ]),
  )

  const pricesByRound: Record<SectorId, number>[] = []
  let forcedDecisions = 0
  let decisions = 0

  while (state.phase !== 'gameOver') {
    if (++decisions > maxDecisions) {
      throw new Error(`Partita non terminata dopo ${maxDecisions} decisioni (seed ${seed}, fase ${state.phase})`)
    }
    const pending = currentPending(state)
    if (!pending) throw new Error(`Nessuna decisione ma partita non finita (fase ${state.phase})`)

    const playerId = pending.playerId
    const agent = agentById.get(playerId)!
    const record = rec.get(playerId)!
    const obs = view(state, playerId)
    // "Gioco morto": punti in cui l'agente non ha davvero una scelta da fare.
    if (pending.type === 'tradeAction' && legalMacroActions(state, playerId).length <= 1) forcedDecisions++
    const move = decideAgentMove(state, agent, pending, rng)
    const before = state

    if ('macro' in move) {
      if (pending.type !== 'tradeAction') throw new Error(`${agent.name} ha risposto con una macro a ${pending.type}`)
      const key = macroKey(move.macro)
      record.macroCounts[key] = (record.macroCounts[key] ?? 0) + 1
      const { state: after, actions } = applyAgentMove(state, playerId, move)
      for (const action of actions) {
        if (action.kind === 'buy') {
          const slot = before.market[action.marketIndex]
          if (slot) {
            record.buysByPosition[action.marketIndex] += 1
            record.buysBySector[config.actionById[slot.defId].sector] += 1
            record.spentOnBuys += obs.market[action.marketIndex]?.cost ?? 0
          }
        } else if (action.kind === 'sell') record.sells += 1
        else if (action.kind === 'ipo') record.ipos += 1
        else if (action.kind === 'abandonEtf') {
          const card = before.players.find((p) => p.id === playerId)!.etfCards.find((c) => c.instanceId === action.cardInstanceId)
          if (card) record.etfAbandoned.push(card.defId)
        }
      }
      state = after
    } else {
      const decision = move.decision
      if (decision.type === 'chooseRole') {
        record.rolesByRound[before.round - 1] = decision.role
      } else if (decision.type === 'declareOrder') {
        record.declarations.push({
          round: before.round,
          target: describeTargetKey(decision.target),
          wasBluff: myMatchingRumors(obs, decision.target).length === 0,
          playedAs: decision.marketNewsCardInstanceId ? 'news' : null,
        })
      } else if (decision.type === 'insideTradingChoice' && decision.play) {
        markPlayed(record, before.round, 'inside')
      } else if (decision.type === 'lateMarketNewsChoice' && decision.play) {
        markPlayed(record, before.round, 'news')
      }
      state = applyAgentMove(state, playerId, move).state
    }

    if (state.round !== before.round || state.phase === 'gameOver') {
      pricesByRound.push(afterClosing(config, before.sectors))
    }
  }

  const results = state.gameOverResult!
  const ranked = rankResults(state, results)
  const topPV = ranked[0].totalPV
  const winners = ranked.filter((r) => r.totalPV === topPV).length

  for (const result of results) {
    const record = rec.get(result.playerId)!
    const player = state.players.find((p) => p.id === result.playerId)!
    record.totalPV = result.totalPV
    record.wealthPV = result.wealthPV
    record.etfPV = result.etfPV
    record.cash = result.cash
    record.holdingsValue = result.holdingsValue
    record.etfCompleted = result.completedEtfs
    record.etfHeldAtEnd = player.etfCards.map((c) => c.defId)
    record.rank = ranked.findIndex((r) => r.playerId === result.playerId) + 1
    // Payoff basato sul RANGO, non sui PV: l'obiettivo è vincere, non fare punti.
    const beaten = results.filter((o) => o.totalPV < result.totalPV).length
    const tied = results.filter((o) => o.totalPV === result.totalPV).length - 1
    record.score = (beaten + tied / 2) / Math.max(1, results.length - 1)
    record.win = result.totalPV === topPV ? 1 / winners : 0
  }

  return {
    seed,
    playerCount: agents.length,
    rounds: config.rounds,
    decisions,
    players: playerConfigs.map((p) => rec.get(p.id)!).sort((a, b) => (seatById.get(a.id)! - seatById.get(b.id)!)),
    pricesByRound,
    shortSqueezes: state.closingEvents.filter((e) => e.kind === 'squeeze').length,
    crashes: state.closingEvents.filter((e) => e.kind === 'crash').length,
    closingEvents: state.closingEvents,
    winMargin: ranked.length > 1 ? ranked[0].totalPV - ranked[1].totalPV : 0,
    forcedDecisions,
    mixedDeckExhausted: state.mixedDeck.length === 0,
  }
}

function markPlayed(record: PlayerRecord, round: number, how: 'inside' | 'news') {
  const declaration = [...record.declarations].reverse().find((entry) => entry.round === round)
  if (declaration) declaration.playedAs = how
}

function describeTargetKey(target: OrderTarget): string {
  if (target.kind === 'sector') return `${target.sector}:${target.direction}`
  return `${target.kind}:${target.direction}`
}

/** Applica la regola di chiusura (§8) a una fotografia dei prezzi. Idempotente. */
function afterClosing(config: GameConfig, sectors: Record<SectorId, number>): Record<SectorId, number> {
  const out: Record<SectorId, number> = { ...sectors }
  for (const id of config.sectorIds) {
    if (out[id] <= config.shortSqueezeAt || out[id] >= config.crashAt) out[id] = config.reboundTo
  }
  return out
}
