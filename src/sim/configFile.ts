/**
 * Legge e valida `simulazione.yaml`: il pannello di controllo delle simulazioni.
 *
 * Il file YAML sostituisce gli argomenti da terminale — l'idea è che si lanci
 * `npm run sim` e basta. I flag restano disponibili e vincono sul file, così
 * una prova al volo non costringe a editare la configurazione.
 */
import { existsSync, readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { parse } from 'yaml'
import { DEFAULT_BALANCE } from '../engine/balance'
import { AGENT_NAMES } from '../engine/agents'

export interface Scenario {
  name: string
  games: number
  agents: string[]
  seed: number
  balance: Record<string, unknown>
}

export interface PolicySpec {
  /** File JSON dei pesi prodotto da `npm run train`. */
  file: string
  /** 0 = gioca sempre la mossa migliore; 1 = campiona come in addestramento. */
  temperature: number
}

export interface TrainingConfig {
  scenario: string | null
  opponents: string[] | null
  steps: number
  envs: number
  hidden: number[]
  learningRate: number
  entropy: number
  gamma: number
  gaeLambda: number
  clip: number
  epochs: number
  minibatches: number
  rolloutSteps: number
  evalEvery: number
  evalEpisodes: number
  out: string
}

export interface RlConfig {
  /** Partite portate avanti in parallelo dentro un solo processo Node. */
  envs: number
  /** Posto occupato dall'agente in addestramento: un indice, o "rotate". */
  learnerSeat: number | 'rotate'
}

export interface SimConfig {
  workers: number
  rotateSeats: boolean
  outDir: string
  report: boolean
  saveMatches: boolean
  rl: RlConfig
  /** Policy addestrate da rendere disponibili come agenti. */
  policies: Record<string, PolicySpec>
  training: TrainingConfig
  scenarios: Scenario[]
}

export const CONFIG_FILE = 'simulazione.yaml'
/** Oltre 3 serie i colori del report non restano distinguibili sotto daltonismo. */
export const MAX_REPORT_SCENARIOS = 3

const DEFAULTS = {
  games: 5000,
  agents: ['heuristic', 'etfhunter', 'cashking', 'bluffer'],
  seed: 1,
  workers: 'auto' as number | 'auto',
  rotateSeats: true,
  outDir: 'data',
  report: true,
  saveMatches: true,
}

export function loadConfig(path = CONFIG_FILE): SimConfig {
  const raw: Record<string, unknown> = existsSync(path) ? (parse(readFileSync(path, 'utf8')) ?? {}) : {}
  const errors: string[] = []
  const fail = (msg: string) => errors.push(msg)

  const policies = parsePolicies(raw.policies, fail)
  const games = int(raw.games, DEFAULTS.games, 'games', fail)
  const agents = list(raw.agents, DEFAULTS.agents, 'agents', fail)
  const seed = int(raw.seed, DEFAULTS.seed, 'seed', fail)
  const workersRaw = raw.workers ?? DEFAULTS.workers
  const workers =
    workersRaw === 'auto' ? Math.max(1, Math.min(8, cpus().length - 1)) : int(workersRaw, 1, 'workers', fail)

  const rawScenarios = raw.scenarios === undefined ? [{ name: 'base' }] : raw.scenarios
  if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
    fail('"scenarios" deve essere un elenco con almeno una voce')
  }
  const scenarioList = Array.isArray(rawScenarios) ? rawScenarios : []

  const seen = new Set<string>()
  const scenarios: Scenario[] = scenarioList.map((entry, i) => {
    const s = (entry ?? {}) as Record<string, unknown>
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : `scenario ${i + 1}`
    if (seen.has(name)) fail(`due scenari si chiamano "${name}": servono nomi distinti`)
    seen.add(name)
    return {
      name,
      games: int(s.games, games, `scenari > ${name} > games`, fail),
      agents: list(s.agents, agents, `scenari > ${name} > agents`, fail),
      seed: int(s.seed, seed, `scenari > ${name} > seed`, fail),
      balance: checkBalanceKeys(s.balance, name, fail),
    }
  })

  const known = [...AGENT_NAMES, ...Object.keys(policies)]
  for (const scenario of scenarios) {
    for (const agent of scenario.agents) {
      if (!known.includes(agent)) {
        fail(`scenario "${scenario.name}": agente sconosciuto "${agent}". Disponibili: ${known.join(', ')}`)
      }
    }
    if (scenario.agents.length < DEFAULT_BALANCE.minPlayers || scenario.agents.length > DEFAULT_BALANCE.maxPlayers) {
      fail(
        `scenario "${scenario.name}": servono da ${DEFAULT_BALANCE.minPlayers} a ${DEFAULT_BALANCE.maxPlayers} agenti, ` +
          `ne hai elencati ${scenario.agents.length}`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(`${path} non è valido:\n  - ${errors.join('\n  - ')}`)
  }

  const training = parseTraining(raw.training, fail)
  const rlRaw = (raw.rl ?? {}) as Record<string, unknown>
  const learnerSeat = rlRaw.learnerSeat === undefined || rlRaw.learnerSeat === 'rotate'
    ? ('rotate' as const)
    : int(rlRaw.learnerSeat, 0, 'rl.learnerSeat', fail) - 1

  return {
    workers,
    rotateSeats: bool(raw.rotateSeats, DEFAULTS.rotateSeats),
    rl: { envs: int(rlRaw.envs, 64, 'rl.envs', fail), learnerSeat },
    policies,
    training,
    outDir: typeof raw.outDir === 'string' ? raw.outDir : DEFAULTS.outDir,
    report: bool(raw.report, DEFAULTS.report),
    saveMatches: bool(raw.saveMatches, DEFAULTS.saveMatches),
    scenarios,
  }
}

/** Un refuso in una chiave di balance passerebbe silenziosamente: qui viene fermato. */
function checkBalanceKeys(
  value: unknown,
  scenarioName: string,
  fail: (msg: string) => void,
): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail(`scenario "${scenarioName}": "balance" deve essere un blocco chiave: valore`)
    return {}
  }
  const overrides = value as Record<string, unknown>
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULT_BALANCE)) {
      fail(
        `scenario "${scenarioName}": "${key}" non è un campo di balance. ` +
          `Campi validi: ${Object.keys(DEFAULT_BALANCE).join(', ')}`,
      )
      continue
    }
    // Un blocco annidato (es. trader: { cash: 3 }) si fonde col default, così
    // scrivere solo "cash" non azzera "draw" e "penaltyDiscards".
    const base = DEFAULT_BALANCE[key as keyof typeof DEFAULT_BALANCE]
    const patch = overrides[key]
    if (isPlainObject(base) && isPlainObject(patch)) {
      for (const inner of Object.keys(patch)) {
        if (!(inner in (base as object))) {
          fail(`scenario "${scenarioName}": "${key}.${inner}" non esiste. Campi validi: ${Object.keys(base as object).join(', ')}`)
        }
      }
      overrides[key] = { ...(base as object), ...patch }
    }
  }
  return overrides
}

/** Accetta sia `nome: file.json` sia `nome: { file: ..., temperature: ... }`. */
function parsePolicies(value: unknown, fail: (msg: string) => void): Record<string, PolicySpec> {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) {
    fail('"policies" deve essere un blocco nome: file (oppure nome: { file, temperature })')
    return {}
  }
  const out: Record<string, PolicySpec> = {}
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec === 'string') {
      out[name] = { file: spec, temperature: 1 }
    } else if (isPlainObject(spec) && typeof spec.file === 'string') {
      const temperature = spec.temperature === undefined ? 1 : Number(spec.temperature)
      if (!Number.isFinite(temperature) || temperature < 0) {
        fail(`policies > ${name} > temperature deve essere >= 0`)
      }
      out[name] = { file: spec.file, temperature: Math.max(0, temperature) }
    } else {
      fail(`policies > ${name}: serve un percorso di file (o un blocco con "file")`)
    }
  }
  return out
}

const TRAINING_DEFAULTS: TrainingConfig = {
  scenario: null,
  opponents: null,
  steps: 2_000_000,
  envs: 64,
  hidden: [128, 128],
  learningRate: 0.0003,
  entropy: 0.02,
  gamma: 1,
  gaeLambda: 0.95,
  clip: 0.2,
  epochs: 4,
  minibatches: 4,
  rolloutSteps: 128,
  evalEvery: 200_000,
  evalEpisodes: 2000,
  out: 'models/policy.json',
}

function parseTraining(value: unknown, fail: (msg: string) => void): TrainingConfig {
  if (value === undefined || value === null) return { ...TRAINING_DEFAULTS }
  if (!isPlainObject(value)) {
    fail('"training" deve essere un blocco chiave: valore')
    return { ...TRAINING_DEFAULTS }
  }
  for (const key of Object.keys(value)) {
    if (!(key in TRAINING_DEFAULTS)) {
      fail(`training > "${key}" non esiste. Campi validi: ${Object.keys(TRAINING_DEFAULTS).join(', ')}`)
    }
  }
  const hidden = Array.isArray(value.hidden) ? (value.hidden as unknown[]).map(Number) : TRAINING_DEFAULTS.hidden
  if (hidden.some((h) => !Number.isFinite(h) || h <= 0)) fail('training > hidden deve essere un elenco di interi positivi')
  return {
    ...TRAINING_DEFAULTS,
    ...(value as Partial<TrainingConfig>),
    scenario: typeof value.scenario === 'string' ? value.scenario : null,
    opponents: Array.isArray(value.opponents) ? (value.opponents as string[]) : null,
    hidden,
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function int(value: unknown, fallback: number, label: string, fail: (msg: string) => void): number {
  if (value === undefined || value === null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    fail(`"${label}" deve essere un numero positivo (hai scritto ${JSON.stringify(value)})`)
    return fallback
  }
  return Math.floor(n)
}

function list(value: unknown, fallback: string[], label: string, fail: (msg: string) => void): string[] {
  if (value === undefined || value === null) return fallback
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(`"${label}" deve essere un elenco di nomi, es. [heuristic, cashking, bluffer]`)
    return fallback
  }
  return value as string[]
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Nome di file sicuro a partire dal nome dello scenario. */
export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'scenario'
}
