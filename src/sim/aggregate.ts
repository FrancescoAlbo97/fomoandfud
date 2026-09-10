/** Riepilogo a terminale di una run già aggregata. */
import type { RunReport } from './reportData'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const num = (v: number, d = 1) => v.toFixed(d)

export function formatSummary(s: RunReport): string {
  const lines: string[] = []
  lines.push(`\n${s.games.toLocaleString('it-IT')} partite a ${s.playerCount} giocatori · ${num(s.avgDecisions, 0)} decisioni/partita\n`)

  lines.push('AGENTI (ordinati per win rate)')
  lines.push(
    ['agente'.padEnd(12), 'win'.padStart(7), '±95%'.padStart(6), 'score'.padStart(7), 'PV'.padStart(6),
     'patr.'.padStart(6), 'ETF'.padStart(6), '%ETF'.padStart(6), 'cash'.padStart(6), 'buy'.padStart(5),
     'bluff'.padStart(7), 'segue'.padStart(7), 'VI/Tr'.padStart(11)].join(' '),
  )
  for (const a of s.agents) {
    lines.push(
      [a.agent.padEnd(12), pct(a.winRate).padStart(7), pct(a.winRateCi).padStart(6), num(a.score, 3).padStart(7),
       num(a.avgPV).padStart(6), num(a.avgWealthPV).padStart(6), num(a.avgEtfPV).padStart(6),
       pct(a.etfShare).padStart(6), num(a.avgCash).padStart(6), num(a.avgBuys).padStart(5),
       pct(a.bluffRate).padStart(7), pct(a.followThroughRate).padStart(7),
       `${pct(a.roleValueInvestor)}/${pct(1 - a.roleValueInvestor)}`.padStart(11)].join(' '),
    )
  }

  const baseline = 1 / s.playerCount
  lines.push('')
  lines.push(`EQUITÀ DEI POSTI (atteso ${pct(baseline)} ciascuno)`)
  lines.push('  ' + s.winRateBySeat.map((w, i) => `posto ${i}: ${pct(w)}`).join(' · '))

  lines.push('')
  lines.push('MERCATO')
  lines.push(`  acquisti per posizione: ${s.buysByPosition.map((v, i) => `${i + 1}ª ${pct(v)}`).join(' · ')}`)
  lines.push(`  Short Squeeze/partita: ${num(s.squeezesPerGame, 2)} · Crash/partita: ${num(s.crashesPerGame, 2)}`)
  for (const [i, prices] of s.pricesByRound[0].entries()) {
    void prices
    const parts = s.sectors.map((_, si) => `${s.sectorLabels[si]} $${num(s.pricesByRound[si][i], 2)}`)
    lines.push(`  prezzo medio fine Round ${i + 1}: ${parts.join(' · ')}`)
  }

  lines.push('')
  lines.push('OBIETTIVI E SALUTE DEL DESIGN')
  const etfHeld = s.etfStats.reduce((n, e) => n + e.heldAtEnd, 0)
  const etfDone = s.etfStats.reduce((n, e) => n + e.completed, 0)
  lines.push(`  ETF completati sui tenuti: ${pct(etfHeld ? etfDone / etfHeld : 0)} · scarto mediano 1°–2°: ${s.medianMargin} PV`)
  lines.push(`  decisioni con una sola opzione ("gioco morto"): ${pct(s.forcedDecisionRate)}`)
  lines.push(`  mazzo misto esaurito: ${pct(s.deckExhaustedRate)} delle partite`)
  return lines.join('\n')
}
