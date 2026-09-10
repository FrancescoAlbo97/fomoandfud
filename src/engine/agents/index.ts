/**
 * Il ponte fra un `Agent` e l'engine: costruisce l'Observation, calcola le mosse
 * legali, chiede all'agente e applica la risposta. Lo usano sia il simulatore sia
 * l'interfaccia, così in partita giochi contro esattamente gli stessi cervelli che
 * poi metti in torneo.
 */
import { actionMask, decodeAction, makeActionSpace, type ActionSpace } from '../actionSpace'
import type { GameConfig } from '../config'
import type { PendingDecision, TradeActionInput } from '../decisions'
import { currentPending, submitDecision } from '../engine'
import { legalOrderTargets } from '../legalMoves'
import { applyMacro, legalMacroActions } from '../macroActions'
import { view } from '../observation'
import type { PolicyModel } from '../policyFormat'
import type { Rng } from '../rng'
import type { GameState } from '../types'
import { heuristicAgent, randomAgent } from './baseline'
import { policyAgent, type PolicyOptions } from './policyAgent'
import type { Agent, AgentMove, FlatActions } from './types'

export * from './types'
export { heuristicAgent, randomAgent } from './baseline'
export { policyAgent } from './policyAgent'

/**
 * Gli agenti disponibili per nome. Aggiungi qui la policy addestrata e comparirà
 * sia nella CLI (`--agents`) sia nel menu di setup della partita.
 */
export const AGENT_REGISTRY: Record<string, () => Agent> = {
  random: () => randomAgent(),
  heuristic: () => heuristicAgent('heuristic'),
  // Archetipi: stesso codice, personalità diverse.
  etfhunter: () => heuristicAgent('etfhunter', { etfAppetite: 0.9, cashReserve: 1, patience: 0.7 }),
  cashking: () => heuristicAgent('cashking', { etfAppetite: 0.1, cashReserve: 8, bluffRate: 0.1 }),
  bluffer: () => heuristicAgent('bluffer', { bluffRate: 0.8, patience: 0.8, riskTolerance: 0.9 }),
  impatient: () => heuristicAgent('impatient', { patience: 0.05, cashReserve: 2 }),
}

/** Policy addestrate registrate a runtime (da `policies:` in simulazione.yaml). */
const POLICY_AGENTS: Record<string, () => Agent> = {}

/**
 * Rende disponibile una policy addestrata con un nome, come se fosse sempre
 * stata nella registry: da quel momento la puoi usare in `--agents`, in
 * `simulazione.yaml` e nel menu di setup della partita.
 */
export function registerPolicy(name: string, model: PolicyModel, options: PolicyOptions = {}): void {
  if (name in AGENT_REGISTRY) {
    throw new Error(`"${name}" è già un agente del motore: dai un altro nome alla policy.`)
  }
  POLICY_AGENTS[name] = () => policyAgent(name, model, options)
}

export function agentNames(): string[] {
  return [...Object.keys(AGENT_REGISTRY), ...Object.keys(POLICY_AGENTS)]
}

/** Gli agenti di serie. Le policy addestrate si aggiungono con `registerPolicy`. */
export const AGENT_NAMES = Object.keys(AGENT_REGISTRY)

export function makeAgent(name: string): Agent {
  const factory = AGENT_REGISTRY[name] ?? POLICY_AGENTS[name]
  if (!factory) {
    throw new Error(`Agente sconosciuto "${name}". Disponibili: ${agentNames().join(', ')}`)
  }
  return factory()
}

// Lo spazio azioni dipende solo dalla config: si costruisce una volta per partita.
const ACTION_SPACES = new WeakMap<GameConfig, ActionSpace>()
export function actionSpaceFor(config: GameConfig): ActionSpace {
  let space = ACTION_SPACES.get(config)
  if (!space) {
    space = makeActionSpace(config)
    ACTION_SPACES.set(config, space)
  }
  return space
}

function flatActions(state: GameState, pending: PendingDecision): FlatActions {
  const space = actionSpaceFor(state.config)
  return {
    space,
    // Pigra: gli agenti euristici non la chiamano e non ne pagano il costo.
    legal() {
      const mask = actionMask(state, pending, space)
      const legal: number[] = []
      for (let i = 0; i < mask.length; i++) if (mask[i]) legal.push(i)
      return legal
    },
    decode(action: number) {
      return decodeAction(state, pending, space, action)
    },
  }
}

/** Chiede all'agente cosa fare, passandogli SOLO ciò che può vedere. */
export function decideAgentMove(state: GameState, agent: Agent, pending: PendingDecision, rng: Rng): AgentMove {
  const playerId = pending.playerId
  return agent.act({
    obs: view(state, playerId),
    pending,
    legalTargets: pending.type === 'declareOrder' ? legalOrderTargets(state, playerId) : [],
    legalMacros: pending.type === 'tradeAction' ? legalMacroActions(state, playerId) : [],
    flat: flatActions(state, pending),
    rng,
  })
}

/** Applica la mossa e restituisce anche le azioni atomiche eseguite (per la telemetria). */
export function applyAgentMove(
  state: GameState,
  playerId: string,
  move: AgentMove,
): { state: GameState; actions: TradeActionInput[] } {
  if ('macro' in move) return applyMacro(state, playerId, move.macro)
  return { state: submitDecision(state, move.decision), actions: [] }
}

/** Fa giocare all'agente la decisione in sospeso. Comodo per la UI. */
export function stepAgent(state: GameState, agent: Agent, rng: Rng): GameState {
  const pending = currentPending(state)
  if (!pending) return state
  return applyAgentMove(state, pending.playerId, decideAgentMove(state, agent, pending, rng)).state
}
