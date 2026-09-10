/** Worker di simulazione: gioca una fetta di seed e restituisce solo numeri aggregati. */
import { parentPort, workerData } from 'node:worker_threads'
import { appendFileSync } from 'node:fs'
import { makeConfig } from '../engine/config'
import { makeAgent } from '../engine/agents'
import { registerPolicies } from './policyLoader'
import type { PolicySpec } from './configFile'
import { runGame, type MatchRecord } from './runGame'
import { accumulate, mergeAccs, type RunAcc } from './reportData'

export interface WorkerInput {
  agentNames: string[]
  firstSeed: number
  games: number
  /** Ruota chi siede dove, così nessun agente resta inchiodato allo stesso posto. */
  rotateSeats: boolean
  overrides: Record<string, unknown>
  /** Policy addestrate da registrare in questo thread prima di creare gli agenti. */
  policies: Record<string, PolicySpec>
  outFile: string | null
}

export interface WorkerOutput {
  acc: RunAcc
}

function run(input: WorkerInput): WorkerOutput {
  const config = makeConfig(input.overrides)
  registerPolicies(input.policies ?? {}, config)
  const agents = input.agentNames.map(makeAgent)
  // Le partite vengono aggregate a blocchi e buttate via: mai tutte in memoria.
  const CHUNK = 2000
  let chunk: MatchRecord[] = []
  const parts: RunAcc[] = []
  const buffer: string[] = []

  const flushLines = () => {
    if (input.outFile && buffer.length > 0) {
      appendFileSync(input.outFile, buffer.join('\n') + '\n')
      buffer.length = 0
    }
  }
  const flushChunk = () => {
    if (chunk.length > 0) {
      parts.push(accumulate(chunk, input.overrides))
      chunk = []
    }
  }

  for (let i = 0; i < input.games; i++) {
    const seated = input.rotateSeats ? rotate(agents, i % agents.length) : agents
    const record = runGame({ seed: input.firstSeed + i, agents: seated, config })
    chunk.push(record)
    if (input.outFile) buffer.push(JSON.stringify(record))
    if (buffer.length >= 500) flushLines()
    if (chunk.length >= CHUNK) flushChunk()
  }
  flushLines()
  flushChunk()

  return { acc: mergeAccs(parts) }
}

function rotate<T>(items: T[], by: number): T[] {
  return [...items.slice(by), ...items.slice(0, by)]
}

if (parentPort) {
  parentPort.postMessage(run(workerData as WorkerInput))
}

export { run as runWorker }
