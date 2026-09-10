/**
 * Aggregazione delle partite.
 *
 * Una sola passata produce un `RunAcc`, un accumulatore fatto solo di numeri:
 * i worker ne calcolano uno per fetta, il processo principale li fonde. Le
 * partite non attraversano mai i thread e non restano mai tutte in memoria —
 * è ciò che permette di simulare centinaia di migliaia di partite.
 *
 * Da un `RunAcc` finito escono entrambe le rappresentazioni: il riepilogo a
 * terminale (aggregate.ts) e i grafici del report (reportHtml.ts).
 */
import { makeConfig } from '../engine/config'
import type { MatchRecord } from './runGame'

export interface RunMeta {
  label?: string
  agents?: string[]
  overrides?: Record<string, unknown>
  seed?: number
  generatedAt?: string
}

interface AgentAcc {
  games: number
  win: number
  score: number
  pv: number
  wealthPV: number
  etfPV: number
  cash: number
  buys: number
  declarations: number
  bluffs: number
  played: number
  roleValueInvestor: number
  /** PV finali grezzi: i bin dell'istogramma si decidono solo alla fine. */
  pvValues: number[]
}

export interface RunAcc {
  games: number
  playerCount: number
  rounds: number
  marketSize: number
  sectors: string[]
  sectorLabels: string[]
  etfCatalog: { id: string; label: string; pv: number }[]
  decisions: number
  forced: number
  exhausted: number
  squeezes: number
  crashes: number
  winBySeat: number[]
  buysByPosition: number[]
  roleByRound: { valueInvestor: number; trader: number }[]
  priceSum: number[][]
  priceCount: number[]
  closing: { squeeze: number; crash: number }[]
  etfHeld: Record<string, number>
  etfDone: Record<string, number>
  agents: Record<string, AgentAcc>
  margins: number[]
}

export interface AgentStat {
  agent: string
  games: number
  winRate: number
  /** Semiampiezza dell'intervallo di confidenza al 95% sul win rate. */
  winRateCi: number
  score: number
  avgPV: number
  avgWealthPV: number
  avgEtfPV: number
  etfShare: number
  avgCash: number
  avgBuys: number
  bluffRate: number
  followThroughRate: number
  roleValueInvestor: number
  pvBins: number[]
}

export interface RunReport {
  label: string
  games: number
  playerCount: number
  rounds: number
  avgDecisions: number
  agents: AgentStat[]
  winRateBySeat: number[]
  buysByPosition: number[]
  sectors: string[]
  sectorLabels: string[]
  pricesByRound: number[][]
  roleByRound: { valueInvestor: number; trader: number }[]
  etfStats: { id: string; label: string; pv: number | null; heldAtEnd: number; completed: number; rate: number }[]
  closingBySector: { sector: string; label: string; squeeze: number; crash: number }[]
  squeezesPerGame: number
  crashesPerGame: number
  forcedDecisionRate: number
  deckExhaustedRate: number
  marginBins: number[]
  medianMargin: number
  meta: RunMeta
}

export interface ReportData {
  generatedAt: string
  runs: RunReport[]
  pvBinEdges: number[]
  marginBinEdges: number[]
}

// ---------------------------------------------------------------------------
// Accumulazione
// ---------------------------------------------------------------------------

export function accumulate(records: MatchRecord[], overrides: Record<string, unknown> = {}): RunAcc {
  if (records.length === 0) throw new Error('Nessuna partita da aggregare')
  const config = makeConfig(overrides)
  const rounds = records[0].rounds
  const playerCount = records[0].playerCount

  const acc: RunAcc = {
    games: 0,
    playerCount,
    rounds,
    marketSize: config.marketSize,
    sectors: config.sectorIds,
    sectorLabels: config.sectorIds.map((s) => `${config.sectorById[s].icon} ${config.sectorById[s].label}`),
    etfCatalog: config.etfs.map((e) => ({ id: e.id, label: e.name, pv: e.pv })),
    decisions: 0,
    forced: 0,
    exhausted: 0,
    squeezes: 0,
    crashes: 0,
    winBySeat: zeros(playerCount),
    buysByPosition: zeros(config.marketSize),
    roleByRound: Array.from({ length: rounds }, () => ({ valueInvestor: 0, trader: 0 })),
    priceSum: config.sectorIds.map(() => zeros(rounds)),
    priceCount: zeros(rounds),
    closing: config.sectorIds.map(() => ({ squeeze: 0, crash: 0 })),
    etfHeld: {},
    etfDone: {},
    agents: {},
    margins: [],
  }

  const sectorIndex: Record<string, number> = {}
  config.sectorIds.forEach((s, i) => {
    sectorIndex[s] = i
  })

  for (const match of records) {
    acc.games += 1
    acc.decisions += match.decisions
    acc.forced += match.forcedDecisions
    acc.squeezes += match.shortSqueezes
    acc.crashes += match.crashes
    if (match.mixedDeckExhausted) acc.exhausted += 1
    acc.margins.push(match.winMargin)

    for (const event of match.closingEvents) {
      const si = sectorIndex[event.sector]
      if (si !== undefined) acc.closing[si][event.kind === 'squeeze' ? 'squeeze' : 'crash'] += 1
    }
    match.pricesByRound.forEach((prices, round) => {
      if (round >= rounds) return
      acc.priceCount[round] += 1
      config.sectorIds.forEach((sector, si) => {
        acc.priceSum[si][round] += prices[sector] ?? 0
      })
    })

    for (const player of match.players) {
      acc.winBySeat[player.seat] += player.win
      player.buysByPosition.forEach((n, i) => {
        if (i < acc.buysByPosition.length) acc.buysByPosition[i] += n
      })
      player.rolesByRound.forEach((role, round) => {
        if (role && round < rounds) acc.roleByRound[round][role] += 1
      })
      for (const id of player.etfHeldAtEnd) acc.etfHeld[id] = (acc.etfHeld[id] ?? 0) + 1
      for (const id of player.etfCompleted) acc.etfDone[id] = (acc.etfDone[id] ?? 0) + 1

      let a = acc.agents[player.agent]
      if (!a) {
        a = { games: 0, win: 0, score: 0, pv: 0, wealthPV: 0, etfPV: 0, cash: 0, buys: 0, declarations: 0, bluffs: 0, played: 0, roleValueInvestor: 0, pvValues: [] }
        acc.agents[player.agent] = a
      }
      a.games += 1
      a.win += player.win
      a.score += player.score
      a.pv += player.totalPV
      a.wealthPV += player.wealthPV
      a.etfPV += player.etfPV
      a.cash += player.cash
      a.buys += player.buysByPosition.reduce((x, y) => x + y, 0)
      a.declarations += player.declarations.length
      a.bluffs += player.declarations.filter((d) => d.wasBluff).length
      a.played += player.declarations.filter((d) => d.playedAs !== null).length
      a.roleValueInvestor += player.rolesByRound.filter((r) => r === 'valueInvestor').length
      a.pvValues.push(player.totalPV)
    }
  }
  return acc
}

export function mergeAccs(parts: RunAcc[]): RunAcc {
  if (parts.length === 0) throw new Error('Nessun risultato da fondere')
  const out = parts[0]
  for (const part of parts.slice(1)) {
    out.games += part.games
    out.decisions += part.decisions
    out.forced += part.forced
    out.exhausted += part.exhausted
    out.squeezes += part.squeezes
    out.crashes += part.crashes
    addInto(out.winBySeat, part.winBySeat)
    addInto(out.buysByPosition, part.buysByPosition)
    addInto(out.priceCount, part.priceCount)
    out.priceSum.forEach((row, i) => addInto(row, part.priceSum[i]))
    out.roleByRound.forEach((r, i) => {
      r.valueInvestor += part.roleByRound[i].valueInvestor
      r.trader += part.roleByRound[i].trader
    })
    out.closing.forEach((c, i) => {
      c.squeeze += part.closing[i].squeeze
      c.crash += part.closing[i].crash
    })
    for (const id of Object.keys(part.etfHeld)) out.etfHeld[id] = (out.etfHeld[id] ?? 0) + part.etfHeld[id]
    for (const id of Object.keys(part.etfDone)) out.etfDone[id] = (out.etfDone[id] ?? 0) + part.etfDone[id]
    for (const name of Object.keys(part.agents)) {
      const from = part.agents[name]
      const to = out.agents[name]
      if (!to) {
        out.agents[name] = from
        continue
      }
      to.games += from.games; to.win += from.win; to.score += from.score; to.pv += from.pv
      to.wealthPV += from.wealthPV; to.etfPV += from.etfPV; to.cash += from.cash; to.buys += from.buys
      to.declarations += from.declarations; to.bluffs += from.bluffs; to.played += from.played
      to.roleValueInvestor += from.roleValueInvestor
      for (const v of from.pvValues) to.pvValues.push(v)
    }
    for (const v of part.margins) out.margins.push(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// Finalizzazione
// ---------------------------------------------------------------------------

export function buildReport(runs: { label: string; acc: RunAcc; meta?: RunMeta }[]): ReportData {
  if (runs.length === 0) throw new Error('Nessuna run da rappresentare')
  const allPV: number[] = []
  const allMargins: number[] = []
  for (const run of runs) {
    for (const name of Object.keys(run.acc.agents)) for (const v of run.acc.agents[name].pvValues) allPV.push(v)
    for (const v of run.acc.margins) allMargins.push(v)
  }
  // Il 99° percentile invece del massimo: un singolo outlier non deve lasciare
  // mezzo istogramma vuoto. I valori oltre l'ultimo bin ci finiscono dentro.
  const pvBinEdges = makeEdges(percentile(allPV, 0.005), percentile(allPV, 0.995), 14)
  const marginBinEdges = makeEdges(0, Math.max(1, percentile(allMargins, 0.99)), 12)

  return {
    generatedAt: new Date().toISOString(),
    pvBinEdges,
    marginBinEdges,
    runs: runs.map((r) => finalizeRun(r.label, r.acc, r.meta ?? {}, pvBinEdges, marginBinEdges)),
  }
}

export function finalizeRun(
  label: string,
  acc: RunAcc,
  meta: RunMeta,
  pvBinEdges: number[],
  marginBinEdges: number[],
): RunReport {
  const games = acc.games
  const agents: AgentStat[] = Object.keys(acc.agents)
    .map((name) => {
      const a = acc.agents[name]
      const n = a.games || 1
      const winRate = a.win / n
      const avgWealthPV = a.wealthPV / n
      const avgEtfPV = a.etfPV / n
      const bins = zeros(pvBinEdges.length - 1)
      for (const v of a.pvValues) bump(bins, binIndex(pvBinEdges, v))
      return {
        agent: name,
        games: a.games,
        winRate,
        // Wald al 95%: dice se la differenza fra due agenti è reale o rumore.
        winRateCi: 1.96 * Math.sqrt(Math.max(0, winRate * (1 - winRate)) / n),
        score: a.score / n,
        avgPV: a.pv / n,
        avgWealthPV,
        avgEtfPV,
        etfShare: avgEtfPV / (avgWealthPV + avgEtfPV || 1),
        avgCash: a.cash / n,
        avgBuys: a.buys / n,
        bluffRate: a.declarations ? a.bluffs / a.declarations : 0,
        followThroughRate: a.declarations ? a.played / a.declarations : 0,
        roleValueInvestor: a.roleValueInvestor / (n * acc.rounds || 1),
        pvBins: bins,
      }
    })
    .sort((x, y) => y.winRate - x.winRate)

  const totalBuys = acc.buysByPosition.reduce((x, y) => x + y, 0) || 1
  const marginBins = zeros(marginBinEdges.length - 1)
  for (const v of acc.margins) bump(marginBins, binIndex(marginBinEdges, v))
  const sortedMargins = [...acc.margins].sort((x, y) => x - y)

  return {
    label,
    games,
    playerCount: acc.playerCount,
    rounds: acc.rounds,
    avgDecisions: acc.decisions / games,
    agents,
    winRateBySeat: acc.winBySeat.map((w) => w / games),
    buysByPosition: acc.buysByPosition.map((n) => n / totalBuys),
    sectors: acc.sectors,
    sectorLabels: acc.sectorLabels,
    pricesByRound: acc.priceSum.map((row) => row.map((sum, i) => sum / (acc.priceCount[i] || 1))),
    roleByRound: acc.roleByRound.map((r) => {
      const total = r.valueInvestor + r.trader || 1
      return { valueInvestor: r.valueInvestor / total, trader: r.trader / total }
    }),
    etfStats: acc.etfCatalog
      .map((etf) => {
        const held = acc.etfHeld[etf.id] ?? 0
        const done = acc.etfDone[etf.id] ?? 0
        return { id: etf.id, label: etf.label, pv: etf.pv, heldAtEnd: held / games, completed: done / games, rate: held ? done / held : 0 }
      })
      .sort((x, y) => y.rate - x.rate),
    closingBySector: acc.sectors.map((sector, i) => ({
      sector,
      label: acc.sectorLabels[i].replace(/^\S+\s/, ''),
      squeeze: acc.closing[i].squeeze / games,
      crash: acc.closing[i].crash / games,
    })),
    squeezesPerGame: acc.squeezes / games,
    crashesPerGame: acc.crashes / games,
    forcedDecisionRate: acc.forced / acc.decisions,
    deckExhaustedRate: acc.exhausted / games,
    marginBins,
    medianMargin: sortedMargins[Math.floor(sortedMargins.length / 2)] ?? 0,
    meta,
  }
}

/** Comodo per `npm run report`: aggrega e finalizza in un colpo solo. */
export function reportFromRecords(runs: { label: string; records: MatchRecord[]; meta: RunMeta }[]): ReportData {
  return buildReport(runs.map((r) => ({ label: r.label, acc: accumulate(r.records, r.meta.overrides ?? {}), meta: r.meta })))
}

export function parseJsonl(text: string): MatchRecord[] {
  const records: MatchRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) records.push(JSON.parse(trimmed) as MatchRecord)
  }
  return records
}

// --- utilità ---------------------------------------------------------------

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0)
}
function addInto(target: number[], source: number[]) {
  for (let i = 0; i < target.length; i++) target[i] += source[i] ?? 0
}
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))] ?? 0
}
function makeEdges(min: number, max: number, count: number): number[] {
  const lo = Math.floor(min)
  const hi = Math.max(lo + count, Math.ceil(max))
  const width = Math.max(1, Math.ceil((hi - lo) / count))
  return Array.from({ length: count + 1 }, (_, i) => lo + i * width)
}
function binIndex(edges: number[], value: number): number {
  for (let i = 1; i < edges.length; i++) if (value < edges[i]) return i - 1
  return edges.length - 2
}
function bump(bins: number[], index: number) {
  if (index >= 0 && index < bins.length) bins[index] += 1
}
