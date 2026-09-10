/**
 * Il contratto di un agente.
 *
 * Un agente riceve SOLO un'`Observation` — mai il GameState. È il vincolo che
 * rende sensati i risultati di bilanciamento: se un bot potesse leggere le mani
 * altrui, i numeri che produce descriverebbero un altro gioco.
 *
 * Le decisioni di compravendita si esprimono come MACRO-AZIONI, non come click.
 */
import type { ActionSpace } from '../actionSpace'
import type { Decision, PendingDecision } from '../decisions'
import type { MacroAction } from '../macroActions'
import type { Observation } from '../observation'
import type { Rng } from '../rng'
import type { OrderTarget } from '../types'

/**
 * Vista dello spazio azioni PIATTO, per gli agenti che ragionano su un unico
 * vettore di logit (le policy addestrate). È pigra di proposito: gli agenti
 * euristici non la usano e non ne pagano il costo.
 */
export interface FlatActions {
  space: ActionSpace
  /** Indici delle azioni ammesse in questo momento. */
  legal(): number[]
  /** Traduce un indice nella mossa corrispondente. */
  decode(action: number): AgentMove
}

export interface AgentContext {
  obs: Observation
  pending: PendingDecision
  /** Bersagli dichiarabili al Passo 2. */
  legalTargets: OrderTarget[]
  /** Macro-azioni che al Passo 4 farebbero davvero qualcosa. */
  legalMacros: MacroAction[]
  /** Lo stesso insieme di scelte, come indici in un unico Discrete(n). */
  flat: FlatActions
  rng: Rng
}

/** Al Passo 4 si risponde con una macro-azione; in tutti gli altri passi con una Decision. */
export type AgentMove = { decision: Decision } | { macro: MacroAction }

export interface Agent {
  name: string
  act(ctx: AgentContext): AgentMove
}

/** Parametri comuni a tutti gli agenti euristici: è la "personalità" che perturbi
 *  per far sfidare fra loro varianti leggermente diverse. */
export interface AgentParams {
  /** 0 = sempre Trader (cash), 1 = sempre Value Investor (carte). */
  etfAppetite: number
  /** Probabilità di dichiarare un bersaglio senza avere la carta. */
  bluffRate: number
  /** 0 = gioca sempre subito (Inside), 1 = tiene sempre per la Market News. */
  patience: number
  /** Quanto cash tenere da parte invece di comprare. */
  cashReserve: number
  /** Quanto si avvicina volentieri alle soglie di Squeeze/Crash. */
  riskTolerance: number
}

export const BASE_PARAMS: AgentParams = {
  etfAppetite: 0.5,
  bluffRate: 0.25,
  patience: 0.5,
  cashReserve: 3,
  riskTolerance: 0.5,
}
