/**
 * PONTE VERSO PYTHON.
 *
 * Un solo processo Node tiene N partite in parallelo e parla con Python via
 * stdin/stdout, una riga JSON per messaggio. Python vede solo i punti in cui
 * DEVE decidere l'agente in addestramento: gli altri posti li gioca il ponte
 * con gli agenti della AGENT_REGISTRY.
 *
 * Perché così e non riscrivendo il motore in Python: il motore resta uno solo
 * (niente due regolamenti da tenere allineati) e resta veloce — ~440.000
 * decisioni/s contro le poche migliaia di una riscrittura Python. Lo scambio è
 * a BLOCCHI, quindi il costo dell'IPC si spalma su tutte le partite insieme.
 *
 * Protocollo (una riga JSON per messaggio):
 *   →  {"cmd":"reset"}
 *   →  {"cmd":"step","actions":[3,17,...]}     una azione per partita
 *   →  {"cmd":"close"}
 *   ←  {"obs":[[...]],"legal":[[3,7,9],...],"reward":[...],"done":[...]}
 *
 * `legal` sono gli INDICI delle azioni ammesse, non una maschera booleana piena:
 * le azioni legali sono in genere 2-14 su 95, e mandare gli indici taglia di
 * molto il volume di JSON — che è il vero costo del ponte.
 */
import { createInterface } from 'node:readline'
import { makeAgent, decideAgentMove, applyAgentMove } from '../engine/agents'
import { actionMask, decodeAction, makeActionSpace } from '../engine/actionSpace'
import { makeConfig, type GameConfig } from '../engine/config'
import { currentPending, type PendingDecision } from '../engine/engine'
import { encodeObservation, featureLayout, featureSize } from '../engine/features'
import { configShape } from '../engine/policyFormat'
import { view } from '../engine/observation'
import { makeRng, type Rng } from '../engine/rng'
import { computeScores } from '../engine/scoring'
import { createInitialState, type NewPlayerConfig } from '../engine/setup'
import type { GameState } from '../engine/types'
import { loadConfig, CONFIG_FILE } from './configFile'
import { registerPolicies } from './policyLoader'

interface Env {
  index: number
  state: GameState
  rng: Rng
  /** Chi siede dove in questo episodio; null = il learner. */
  seating: (string | null)[]
  learnerId: string
  pending: PendingDecision | null
  episodes: number
  /** Ricompensa maturata alla fine dell'episodio appena concluso. */
  lastReward: number
  lastDone: boolean
}

interface Args {
  config: string
  scenario?: string
  envs?: number
  seed: number
  /** Chi riempie gli ALTRI posti. Il tavolo è [learner, ...opponents]. */
  opponents?: string[]
}

function parseArgs(argv: string[]): Args {
  const args: Args = { config: CONFIG_FILE, seed: 1 }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=')
    const next = () => inline ?? argv[++i]
    if (flag === '--config') args.config = next()
    else if (flag === '--scenario') args.scenario = next()
    else if (flag === '--envs') args.envs = Number(next())
    else if (flag === '--seed') args.seed = Number(next())
    else if (flag === '--opponents') args.opponents = next().split(',')
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const sim = loadConfig(args.config)
const scenario = args.scenario
  ? sim.scenarios.find((s) => s.name === args.scenario)
  : sim.scenarios[0]
if (!scenario) {
  throw new Error(`Nessuno scenario "${args.scenario}". Disponibili: ${sim.scenarios.map((s) => s.name).join(', ')}`)
}

const config: GameConfig = makeConfig(scenario.balance)
// Così il learner può allenarsi anche contro policy già addestrate (self-play).
registerPolicies(sim.policies, config)
const space = makeActionSpace(config)
const obsSize = featureSize(config)
const envCount = args.envs ?? sim.rl.envs

// Il tavolo è [learner, ...opponents]: per default il learner prende il posto
// del primo agente dello scenario, e gli altri restano al loro.
const opponentNames = args.opponents ?? sim.training.opponents ?? scenario.agents.slice(1)
const tableSize = opponentNames.length + 1
if (tableSize < config.minPlayers || tableSize > config.maxPlayers) {
  throw new Error(
    `Il tavolo sarebbe di ${tableSize} giocatori (learner + ${opponentNames.length} avversari), ` +
      `ma servono da ${config.minPlayers} a ${config.maxPlayers}.`,
  )
}
const opponentAgents = opponentNames.map(makeAgent)

let nextSeed = args.seed
const envs: Env[] = Array.from({ length: envCount }, (_, index) => ({
  index,
  state: null as unknown as GameState,
  rng: makeRng(0),
  seating: [],
  learnerId: 'p0',
  pending: null,
  episodes: 0,
  lastReward: 0,
  lastDone: false,
}))

function startEpisode(env: Env) {
  const seat = sim.rl.learnerSeat === 'rotate'
    ? env.episodes % tableSize
    : Math.min(tableSize - 1, Math.max(0, sim.rl.learnerSeat))
  // Gli avversari scorrono nei posti liberi, nell'ordine dichiarato.
  const seating: (string | null)[] = []
  let next = 0
  for (let i = 0; i < tableSize; i++) seating.push(i === seat ? null : opponentNames[next++])
  const players: NewPlayerConfig[] = seating.map((agentName, i) => ({
    id: `p${i}`,
    name: agentName === null ? `learner#${i}` : `${agentName}#${i}`,
    controller: 'bot' as const,
    agentName: agentName ?? opponentNames[0],
  }))
  env.seating = seating
  const seed = nextSeed++
  env.state = createInitialState(players, { seed, config })
  env.rng = makeRng(seed ^ 0x5bf03635)
  env.learnerId = `p${seat}`
  env.episodes += 1
  advance(env)
}

/** Fa giocare gli avversari finché non tocca all'agente in addestramento. */
function advance(env: Env) {
  for (;;) {
    if (env.state.phase === 'gameOver') {
      env.pending = null
      return
    }
    const pending = currentPending(env.state)
    if (!pending) {
      env.pending = null
      return
    }
    if (pending.playerId === env.learnerId) {
      env.pending = pending
      return
    }
    const seatIndex = Number(pending.playerId.slice(1))
    const agentName = env.seating[seatIndex]
    const agent = opponentAgents[opponentNames.indexOf(agentName ?? opponentNames[0])]
    const move = decideAgentMove(env.state, agent, pending, env.rng)
    env.state = applyAgentMove(env.state, pending.playerId, move).state
  }
}

/** Ricompensa terminale basata sul RANGO: 1 = ha battuto tutti, 0 = ultimo. */
function terminalReward(env: Env): number {
  const results = computeScores(env.state)
  const mine = results.find((r) => r.playerId === env.learnerId)!
  const beaten = results.filter((r) => r.totalPV < mine.totalPV).length
  const tied = results.filter((r) => r.totalPV === mine.totalPV).length - 1
  return (beaten + tied / 2) / Math.max(1, results.length - 1)
}

function snapshot() {
  const obs: number[][] = []
  const legal: number[][] = []
  const reward: number[] = []
  const done: boolean[] = []
  for (const env of envs) {
    obs.push(encodeObservation(view(env.state, env.learnerId)))
    const indices: number[] = []
    if (env.pending) {
      const mask = actionMask(env.state, env.pending, space)
      for (let i = 0; i < mask.length; i++) if (mask[i]) indices.push(i)
    }
    legal.push(indices)
    reward.push(env.lastReward)
    done.push(env.lastDone)
    env.lastReward = 0
    env.lastDone = false
  }
  return { obs, legal, reward, done }
}

function step(actions: number[]) {
  actions.forEach((action, i) => {
    const env = envs[i]
    if (!env.pending) return
    const move = decodeAction(env.state, env.pending, space, action)
    env.state = applyAgentMove(env.state, env.learnerId, move).state
    advance(env)
    if (env.state.phase === 'gameOver') {
      env.lastReward = terminalReward(env)
      env.lastDone = true
      startEpisode(env) // autoreset, come una VecEnv
    }
  })
}

const out = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)

out({
  type: 'hello',
  obsSize,
  actionSize: space.size,
  envs: envCount,
  scenario: scenario.name,
  agents: opponentNames,
  featureLayout: featureLayout(config),
  actionSegments: space.segments,
  players: tableSize,
  rounds: config.rounds,
  // L'impronta finisce nel modello salvato: impedisce di far giocare una policy
  // addestrata su una forma di gioco diversa (settori, Mercato, Round).
  shape: configShape(config),
})

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  const message = JSON.parse(trimmed) as { cmd: string; actions?: number[] }
  if (message.cmd === 'reset') {
    for (const env of envs) {
      env.episodes = 0
      startEpisode(env)
      env.lastReward = 0
      env.lastDone = false
    }
    out(snapshot())
  } else if (message.cmd === 'step') {
    step(message.actions ?? [])
    out(snapshot())
  } else if (message.cmd === 'close') {
    rl.close()
    process.exit(0)
  } else {
    out({ error: `comando sconosciuto: ${message.cmd}` })
  }
})
