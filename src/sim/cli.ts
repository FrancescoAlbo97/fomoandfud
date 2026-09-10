/**
 * `npm run sim` — legge simulazione.yaml, gioca ogni scenario e stampa i
 * risultati. Con `report: true` genera anche la pagina con i grafici.
 *
 * I flag da terminale restano disponibili e vincono sul file, per le prove al
 * volo che non vale la pena scrivere nella configurazione.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { balanceWarnings, makeConfig } from '../engine/config'
import { AGENT_NAMES, agentNames } from '../engine/agents'
import { CONFIG_FILE, MAX_REPORT_SCENARIOS, loadConfig, slug, type Scenario, type SimConfig } from './configFile'
import { formatSummary } from './aggregate'
import { registerPolicies } from './policyLoader'
import { buildReport, finalizeRun, mergeAccs, type RunAcc } from './reportData'
import { renderReportHtml } from './reportHtml'
import type { WorkerInput, WorkerOutput } from './worker'

/** Il riepilogo a terminale non disegna istogrammi: bin minimi, mai usati. */
const NO_BINS = [0, 1]

interface Flags {
  config: string
  games?: number
  agents?: string[]
  seed?: number
  workers?: number
  outDir?: string
  report?: boolean
  rotateSeats?: boolean
  saveMatches?: boolean
  only?: string
  set: Record<string, unknown>
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { config: CONFIG_FILE, set: {} }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=')
    const next = () => inline ?? argv[++i]
    switch (flag) {
      case '--config': flags.config = next(); break
      case '--games': flags.games = Number(next()); break
      case '--agents': flags.agents = next().split(','); break
      case '--seed': flags.seed = Number(next()); break
      case '--workers': flags.workers = Number(next()); break
      case '--out-dir': flags.outDir = next(); break
      case '--only': flags.only = next(); break
      case '--report': flags.report = true; break
      case '--no-report': flags.report = false; break
      case '--save-matches': flags.saveMatches = true; break
      case '--no-save-matches': flags.saveMatches = false; break
      case '--no-rotate': flags.rotateSeats = false; break
      case '--set': applySet(flags.set, next()); break
      case '--help': printHelp(); process.exit(0); break
      default: throw new Error(`Opzione sconosciuta: ${flag}`)
    }
  }
  return flags
}

/** Converte "trader.cash=4" o "marketFees=0,1,2,3" in un override del Balance. */
function applySet(target: Record<string, unknown>, expr: string) {
  const eq = expr.indexOf('=')
  if (eq < 0) throw new Error(`--set vuole chiave=valore, ricevuto "${expr}"`)
  const path = expr.slice(0, eq).split('.')
  const raw = expr.slice(eq + 1)
  const parsed: unknown = raw.includes(',')
    ? raw.split(',').map(Number)
    : Number.isNaN(Number(raw)) ? raw : Number(raw)
  if (path.length === 1) {
    target[path[0]] = parsed
    return
  }
  const base = (target[path[0]] as Record<string, unknown>) ?? {}
  let cursor = base
  for (const key of path.slice(1, -1)) cursor = (cursor[key] ??= {}) as Record<string, unknown>
  cursor[path[path.length - 1]] = parsed
  target[path[0]] = base
}

function printHelp() {
  console.log(`
FOMO & FUD — simulatore

  npm run sim              legge ${CONFIG_FILE} e simula tutti gli scenari

Il file YAML è il posto giusto per i parametri. Questi flag servono solo per
prove al volo e vincono su di esso:

  --config FILE    usa un altro file di configurazione
  --only NOME      simula solo lo scenario il cui nome contiene NOME
  --games N        partite per scenario
  --agents a,b,c   un agente per posto (${AGENT_NAMES.join(', ')})
  --seed N         seed di partenza
  --workers N      thread paralleli
  --out-dir DIR    cartella di destinazione
  --report         forza la generazione del report grafico
  --no-report      salta il report
  --save-matches   conserva i .jsonl delle partite (--no-save-matches li scarta)
  --no-rotate      non ruota i posti fra le partite
  --set K=V        override di bilanciamento su TUTTI gli scenari
                   es. --set trader.cash=4 --set marketFees=0,2,4,6
`)
}

function applyFlags(config: SimConfig, flags: Flags): SimConfig {
  // Corrispondenza parziale e senza distinzione di maiuscole: npm rimuove le
  // virgolette dagli argomenti, quindi `--only rete` deve bastare.
  const wanted = flags.only?.trim().toLowerCase()
  const matches = wanted ? config.scenarios.filter((s) => s.name.toLowerCase().includes(wanted)) : config.scenarios
  if (wanted && matches.length > 1) {
    throw new Error(`"${flags.only}" corrisponde a più scenari: ${matches.map((s) => s.name).join(', ')}`)
  }
  const scenarios = matches
    .map((s: Scenario) => ({
      ...s,
      games: flags.games ?? s.games,
      agents: flags.agents ?? s.agents,
      seed: flags.seed ?? s.seed,
      balance: { ...s.balance, ...flags.set },
    }))
  // I flag scavalcano la validazione del file: ricontrolla qui, prima di simulare.
  const known = agentNames()
  for (const scenario of scenarios) {
    for (const agent of scenario.agents) {
      if (!known.includes(agent)) {
        throw new Error(`Agente sconosciuto "${agent}". Disponibili: ${known.join(', ')}`)
      }
    }
  }
  if (scenarios.length === 0) {
    throw new Error(`Nessuno scenario si chiama "${flags.only}". Disponibili: ${config.scenarios.map((s) => s.name).join(', ')}`)
  }
  return {
    ...config,
    workers: flags.workers ?? config.workers,
    outDir: flags.outDir ?? config.outDir,
    report: flags.report ?? config.report,
    saveMatches: flags.saveMatches ?? config.saveMatches,
    rotateSeats: flags.rotateSeats ?? config.rotateSeats,
    scenarios,
  }
}

function runScenario(scenario: Scenario, config: SimConfig, outFile: string | null): Promise<RunAcc> {
  const workerCount = Math.max(1, Math.min(config.workers, scenario.games))
  const perWorker = Math.floor(scenario.games / workerCount)
  const jobs: Promise<WorkerOutput>[] = []
  for (let w = 0; w < workerCount; w++) {
    const games = w === workerCount - 1 ? scenario.games - perWorker * (workerCount - 1) : perWorker
    const input: WorkerInput = {
      agentNames: scenario.agents,
      firstSeed: scenario.seed + w * perWorker,
      games,
      rotateSeats: config.rotateSeats,
      overrides: scenario.balance,
      policies: config.policies,
      outFile: outFile ? `${outFile}.w${w}` : null,
    }
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(join(__dirname, 'worker.js'), { workerData: input })
        worker.on('message', resolve)
        worker.on('error', reject)
        worker.on('exit', (code: number) => code !== 0 && reject(new Error(`worker uscito con codice ${code}`)))
      }),
    )
  }
  return Promise.all(jobs).then((outputs) => {
    if (outFile) mergeShards(outFile, workerCount)
    return mergeAccs(outputs.map((o) => o.acc))
  })
}

function mergeShards(outFile: string, workerCount: number) {
  const { appendFileSync, readFileSync } = require('node:fs') as typeof import('node:fs')
  writeFileSync(outFile, '')
  for (let w = 0; w < workerCount; w++) {
    const shard = `${outFile}.w${w}`
    if (existsSync(shard)) {
      appendFileSync(outFile, readFileSync(shard))
      rmSync(shard)
    }
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (!existsSync(flags.config)) {
    console.warn(`⚠️  ${flags.config} non trovato: uso i valori di default. Crealo per non passare più argomenti.`)
  }
  const loaded = loadConfig(flags.config)
  // Le policy addestrate diventano agenti prima di ogni validazione dei nomi.
  registerPolicies(loaded.policies, makeConfig(loaded.scenarios[0]?.balance ?? {}))
  const config = applyFlags(loaded, flags)
  mkdirSync(config.outDir, { recursive: true })

  const results: { label: string; acc: RunAcc }[] = []
  const started = Date.now()
  let totalGames = 0

  for (const scenario of config.scenarios) {
    // Il bilanciamento si valida prima di simulare: meglio fallire adesso.
    const scenarioConfig = makeConfig(scenario.balance)
    for (const warning of balanceWarnings(scenarioConfig)) console.warn(`⚠️  [${scenario.name}] ${warning}`)

    const base = join(config.outDir, slug(scenario.name))
    const outFile = config.saveMatches || config.report ? `${base}.jsonl` : null
    if (outFile && existsSync(outFile)) rmSync(outFile)

    process.stdout.write(`\n▶ ${scenario.name} — ${scenario.games.toLocaleString('it-IT')} partite, ${scenario.agents.join(' vs ')}`)
    if (Object.keys(scenario.balance).length > 0) process.stdout.write(`\n  override: ${JSON.stringify(scenario.balance)}`)
    const t0 = Date.now()
    const acc = await runScenario(scenario, config, outFile)
    const dt = (Date.now() - t0) / 1000
    process.stdout.write(`  ✓ ${dt.toFixed(1)}s (${Math.round(scenario.games / dt).toLocaleString('it-IT')} partite/s)\n`)

    if (outFile) {
      writeFileSync(
        `${outFile}.meta.json`,
        JSON.stringify({ label: scenario.name, agents: scenario.agents, overrides: scenario.balance, seed: scenario.seed, generatedAt: new Date().toISOString() }, null, 2),
      )
    }
    results.push({ label: scenario.name, acc })
    totalGames += scenario.games
  }

  for (const { label, acc } of results) {
    if (config.scenarios.length > 1) console.log(`\n${'═'.repeat(64)}\n${label.toUpperCase()}`)
    console.log(formatSummary(finalizeRun(label, acc, {}, NO_BINS, NO_BINS)))
  }

  if (config.report) {
    if (results.length > MAX_REPORT_SCENARIOS) {
      throw new Error(
        `Simulati ${results.length} scenari, ma il report ne confronta al massimo ${MAX_REPORT_SCENARIOS} ` +
          '(oltre, i colori non restano distinguibili sotto daltonismo).\n' +
          'Riduci gli scenari, usa --only, oppure lancia con --no-report.',
      )
    }
    const reportFile = join(config.outDir, 'report.html')
    writeFileSync(reportFile, renderReportHtml(buildReport(results.map((r) => ({ label: r.label, acc: r.acc })))))
    console.log(`\n📊 Report: ${reportFile}`)
  }
  if (!config.saveMatches) {
    for (const scenario of config.scenarios) {
      const file = join(config.outDir, `${slug(scenario.name)}.jsonl`)
      if (existsSync(file)) rmSync(file)
      if (existsSync(`${file}.meta.json`)) rmSync(`${file}.meta.json`)
    }
  }

  const elapsed = (Date.now() - started) / 1000
  console.log(`\n${totalGames.toLocaleString('it-IT')} partite totali in ${elapsed.toFixed(1)}s\n`)
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
