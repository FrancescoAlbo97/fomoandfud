/**
 * Agenti di baseline. Non sono la policy RL: servono a far girare l'harness fin
 * da subito, a dare un metro di paragone ("la rete batte l'euristica?") e a
 * popolare il torneo mentre l'addestramento non c'è ancora.
 *
 * La policy addestrata implementerà la stessa interfaccia `Agent` e si infilerà
 * qui dentro senza toccare né engine né simulatore.
 */
import type { Decision } from '../decisions'
import { myMatchingRumors, type Observation } from '../observation'
import { etfCardsMissing } from '../scoring'
import type { MacroAction } from '../macroActions'
import type { OrderTarget, SectorId } from '../types'
import { BASE_PARAMS, type Agent, type AgentContext, type AgentMove, type AgentParams } from './types'

// ---------------------------------------------------------------------------
// Random: sceglie uniformemente fra le mosse legali. È il pavimento assoluto.
// ---------------------------------------------------------------------------

export function randomAgent(name = 'random'): Agent {
  return {
    name,
    act({ obs, pending, legalTargets, legalMacros, rng }: AgentContext): AgentMove {
      switch (pending.type) {
        case 'chooseRole':
          return d({ type: 'chooseRole', playerId: obs.selfId, role: rng.next() < 0.5 ? 'valueInvestor' : 'trader' })
        case 'valueInvestorKeep': {
          const keep = rng.shuffle(pending.drawn).slice(0, obs.config.valueInvestor.keepMax)
          return d({ type: 'valueInvestorKeep', playerId: obs.selfId, keepInstanceIds: keep.map((c) => c.instanceId) })
        }
        case 'declareOrder': {
          const target = rng.pick(legalTargets)
          const matching = myMatchingRumors(obs, target)
          const now = matching.length > 0 && rng.next() < 0.3
          return d({
            type: 'declareOrder',
            playerId: obs.selfId,
            target,
            marketNewsCardInstanceId: now ? rng.pick(matching).instanceId : undefined,
          })
        }
        case 'insideTradingChoice': {
          const play = rng.next() < 0.5
          return d({ type: 'insideTradingChoice', playerId: obs.selfId, play, cardInstanceId: play ? rng.pick(pending.eligibleCardIds) : undefined })
        }
        case 'tradeAction':
          return { macro: rng.pick(legalMacros) }
        case 'lateMarketNewsChoice': {
          const play = rng.next() < 0.5
          return d({ type: 'lateMarketNewsChoice', playerId: obs.selfId, play, cardInstanceId: play ? rng.pick(pending.eligibleCardIds) : undefined })
        }
        case 'traderPenaltyDiscard':
          return d({ type: 'traderPenaltyDiscard', playerId: obs.selfId, cardInstanceId: rng.pick(obs.rumorCards).instanceId })
        case 'forcedDiscard':
          return d({
            type: 'forcedDiscard',
            playerId: obs.selfId,
            rumorInstanceId: pending.rumorCardIds.length ? rng.pick(pending.rumorCardIds) : undefined,
            actionInstanceId: pending.actionCardIds.length ? rng.pick(pending.actionCardIds) : undefined,
          })
        case 'insiderSwap':
          return d({
            type: 'insiderSwap',
            playerId: obs.selfId,
            giveInstanceId: rng.pick(pending.ownCardIds),
            takeInstanceId: rng.pick(pending.opponentCardIds),
          })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Heuristic: euristica parametrica. Cambiando `params` ottieni archetipi diversi
// dallo stesso codice — è la popolazione che poi farai sfidare.
// ---------------------------------------------------------------------------

export function heuristicAgent(name: string, overrides: Partial<AgentParams> = {}): Agent {
  const params: AgentParams = { ...BASE_PARAMS, ...overrides }

  return {
    name,
    act({ obs, pending, legalTargets, legalMacros, rng }: AgentContext): AgentMove {
      switch (pending.type) {
        case 'chooseRole': {
          // Serve cash per comprare i titoli degli ETF; servono carte per averne di nuovi.
          const shortOnCash = obs.cash < obs.config.startingCash * 0.6
          const wantsCards = rng.next() < params.etfAppetite && !shortOnCash
          return d({ type: 'chooseRole', playerId: obs.selfId, role: wantsCards ? 'valueInvestor' : 'trader' })
        }

        case 'valueInvestorKeep': {
          // Tieni prima gli ETF quasi completabili, poi i Rumor sui settori che possiedi.
          const scored = pending.drawn
            .map((card) => ({ card, score: card.kind === 'etf' ? etfValue(obs, card.defId) : rumorValue(obs, card.defId) }))
            .sort((a, b) => b.score - a.score)
          const keep = scored.slice(0, obs.config.valueInvestor.keepMax).filter((s) => s.score > 0)
          return d({ type: 'valueInvestorKeep', playerId: obs.selfId, keepInstanceIds: keep.map((s) => s.card.instanceId) })
        }

        case 'declareOrder': {
          const target = pickTarget(obs, legalTargets, params, rng.next())
          const matching = myMatchingRumors(obs, target)
          const placeNow = matching.length > 0 && rng.next() > params.patience
          return d({
            type: 'declareOrder',
            playerId: obs.selfId,
            target,
            marketNewsCardInstanceId: placeNow ? matching[0].instanceId : undefined,
          })
        }

        case 'insideTradingChoice': {
          // Metà debole subito solo se sei impaziente: la Market News vale il doppio.
          const play = rng.next() > params.patience
          return d({ type: 'insideTradingChoice', playerId: obs.selfId, play, cardInstanceId: play ? pending.eligibleCardIds[0] : undefined })
        }

        case 'lateMarketNewsChoice': {
          // Al Round finale una Market News non si risolverà mai: inutile piazzarla.
          const useless = obs.round >= obs.config.rounds
          return d({
            type: 'lateMarketNewsChoice',
            playerId: obs.selfId,
            play: !useless,
            cardInstanceId: useless ? undefined : pending.eligibleCardIds[0],
          })
        }

        case 'tradeAction':
          return { macro: pickMacro(obs, legalMacros, params) }

        case 'traderPenaltyDiscard': {
          const worst = [...obs.rumorCards].sort((a, b) => rumorValue(obs, a.defId) - rumorValue(obs, b.defId))[0]
          return d({ type: 'traderPenaltyDiscard', playerId: obs.selfId, cardInstanceId: worst.instanceId })
        }

        case 'forcedDiscard': {
          // Sacrifica ciò che serve meno: il Rumor peggiore e il titolo non richiesto da ETF.
          const rumor = [...obs.rumorCards].sort((a, b) => rumorValue(obs, a.defId) - rumorValue(obs, b.defId))[0]
          const needed = requiredBySector(obs)
          const action =
            obs.actionCards.find((c) => obs.holdings[c.sector] > (needed[c.sector] ?? 0)) ?? obs.actionCards[0]
          return d({
            type: 'forcedDiscard',
            playerId: obs.selfId,
            rumorInstanceId: pending.rumorCardIds.length ? rumor?.instanceId : undefined,
            actionInstanceId: pending.actionCardIds.length ? action?.instanceId : undefined,
          })
        }

        case 'insiderSwap': {
          // Cedi un doppione, prendi a caso: non sai i settori altrui finché non guardi.
          const needed = requiredBySector(obs)
          const give =
            obs.actionCards.find((c) => obs.holdings[c.sector] > (needed[c.sector] ?? 0)) ?? obs.actionCards[0]
          return d({
            type: 'insiderSwap',
            playerId: obs.selfId,
            giveInstanceId: give ? give.instanceId : pending.ownCardIds[0],
            takeInstanceId: rng.pick(pending.opponentCardIds),
          })
        }
      }
    },
  }
}

// --- Valutazioni di supporto ------------------------------------------------

function etfValue(obs: Observation, defId: string): number {
  const def = obs.config.etfById[defId]
  const missing = etfCardsMissing(obs.holdings, def.requirement)
  const roundsLeft = obs.config.rounds - obs.round + 1
  if (missing > roundsLeft * 2) return 0 // irraggiungibile: non vale un posto in mano
  return def.pv / (missing + 1)
}

function rumorValue(obs: Observation, defId: string): number {
  const def = obs.config.rumorById[defId]
  if (def.target.kind !== 'sector') return 1
  // Una carta vale quanto muove il TUO portafoglio nella direzione giusta.
  const held = obs.holdings[def.target.sector] ?? 0
  const wantUp = held > 0
  return def.target.direction === (wantUp ? 'up' : 'down') ? 2 + held : 0.5
}

function requiredBySector(obs: Observation): Record<SectorId, number> {
  const required: Record<SectorId, number> = {}
  for (const id of obs.config.sectorIds) required[id] = 0
  for (const card of obs.etfCards) {
    for (const [sector, needed] of Object.entries(obs.config.etfById[card.defId].requirement) as [SectorId, number][]) {
      required[sector] = Math.max(required[sector] ?? 0, needed)
    }
  }
  return required
}

function pickTarget(obs: Observation, legal: OrderTarget[], params: AgentParams, roll: number): OrderTarget {
  const backed = legal.filter((t) => myMatchingRumors(obs, t).length > 0)
  const bluffing = backed.length === 0 || roll < params.bluffRate
  const pool = bluffing ? legal : backed

  // Punteggio: spingi in alto i settori che possiedi, in basso quelli che vuoi comprare.
  const scored = pool.map((t) => {
    if (t.kind !== 'sector') return { t, score: 0.5 }
    const held = obs.holdings[t.sector] ?? 0
    const price = obs.sectors[t.sector]
    const wantsUp = held > 0
    let score = t.direction === (wantsUp ? 'up' : 'down') ? 1 + held : 0.2
    // Non spingere un settore già al limite: farlo scoppiare azzera il tuo guadagno.
    const nearCrash = price >= obs.config.crashAt - 1
    const nearSqueeze = price <= obs.config.shortSqueezeAt + 1
    if ((t.direction === 'up' && nearCrash) || (t.direction === 'down' && nearSqueeze)) {
      score *= params.riskTolerance
    }
    return { t, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].t
}

function pickMacro(obs: Observation, legal: MacroAction[], params: AgentParams): MacroAction {
  const has = (kind: MacroAction['kind']) => legal.find((m) => m.kind === kind)
  const spendable = obs.cash - params.cashReserve

  // 1. Un ETF chiaramente morto è solo un posto occupato: liberalo finché si può.
  const deadEtf = obs.etfCards.some((c) => etfValue(obs, c.defId) === 0)
  if (deadEtf && has('abandonEtf')) return has('abandonEtf')!

  // 2. Comprare per gli obiettivi è la fonte di PV più densa.
  const forEtf = has('buyForEtf')
  if (forEtf && spendable > 0) return forEtf

  // 3. Senza cash, liquida ciò che nessun ETF richiede.
  if (obs.cash < params.cashReserve) {
    const surplus = has('sellSurplus')
    if (surplus) return surplus
  }

  // 4. Il patrimonio si conserva negli acquisti (§11.5): con cash in eccesso, compra.
  const cheap = obs.market.filter((s) => s.cost <= spendable)
  if (cheap.length > 0 && spendable >= obs.config.wealthPerPV) {
    const buy = has('buyCheapest')
    if (buy) return buy
  }

  return { kind: 'pass' }
}

function d(decision: Decision): AgentMove {
  return { decision }
}
