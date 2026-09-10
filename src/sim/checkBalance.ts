/**
 * `npm run balance` — controlla il file di bilanciamento e stampa i numeri
 * derivati. Da lanciare dopo ogni modifica a balance.ts, prima di simulare.
 */
import { DEFAULT_BALANCE } from '../engine/balance'
import { balanceWarnings, makeConfig, validateBalance } from '../engine/config'

const errors = validateBalance(DEFAULT_BALANCE)
if (errors.length > 0) {
  console.error('\n❌ Bilanciamento NON valido:\n')
  for (const error of errors) console.error(`   • ${error}`)
  console.error('')
  process.exit(1)
}

const config = makeConfig()
const warnings = balanceWarnings(config)

console.log('\n✅ Bilanciamento valido\n')
console.log(`   Giocatori          ${config.minPlayers}-${config.maxPlayers} · ${config.rounds} Round · $${config.startingCash} iniziali`)
console.log(`   Settori            ${config.sectorIds.map((s) => `${config.sectorById[s].icon} ${config.sectorById[s].label} (${config.actionCardsBySector[s]} carte)`).join(' · ')}`)
console.log(`   Scala prezzi       $${config.priceMin}–$${config.priceMax}, parte da $${config.priceStart}`)
console.log(`   Squeeze / Crash    $${config.shortSqueezeAt} / $${config.crashAt} → rimbalzo a $${config.reboundTo}`)
console.log(`   Mercato            ${config.marketSize} carte · commissioni ${config.marketFees.map((f) => `$${f}`).join(' / ')}`)
console.log(`   IPO                $${config.ipoCost}, rinnova ${config.ipoRefreshCount} carte, ${config.ipoPerRound}× per Round`)
console.log(`   Value Investor     pesca ${config.valueInvestor.draw}, tiene ${config.valueInvestor.keepMax}, +$${config.valueInvestor.cash}`)
console.log(`   Trader             pesca ${config.trader.draw}, +$${config.trader.cash}, penalità ${config.trader.penaltyDiscards} carta`)
console.log(`   Mazzo Azioni       ${config.totalActionCards} carte`)
console.log(`   Mazzo misto        ${config.totalMixedCards} carte (${config.totalMixedCards - config.etfs.length} Rumor + ${config.etfs.length} ETF)`)
console.log(`   Patrimonio → PV    1 PV ogni $${config.wealthPerPV}`)

const maxRoleCash = Math.max(config.valueInvestor.cash, config.trader.cash)
console.log('\n   Stime a tavolino:')
console.log(`   • cash massimo generabile da un giocatore: $${config.startingCash + maxRoleCash * config.rounds}`)
console.log(`   • PV di solo patrimonio se non spende nulla: ${Math.floor((config.startingCash + maxRoleCash * config.rounds) / config.wealthPerPV)}`)
console.log(`   • PV medio di un ETF: ${(config.etfs.reduce((n, e) => n + e.pv, 0) / config.etfs.length).toFixed(1)}`)

if (warnings.length > 0) {
  console.log('\n⚠️  Avvertimenti (non bloccanti):')
  for (const warning of warnings) console.log(`   • ${warning}`)
}
console.log('')
