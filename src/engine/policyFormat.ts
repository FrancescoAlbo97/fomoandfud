/**
 * POLICY ADDESTRATA: formato, verifica di compatibilità e forward pass.
 *
 * L'addestramento avviene in Python (`npm run train`), ma la policy deve poter
 * giocare nel motore TypeScript come qualunque altro agente — altrimenti non
 * finirebbe nella stessa tabella e negli stessi grafici degli archetipi, e non
 * saprebbe se ha davvero imparato.
 *
 * Il ponte è un file JSON di pesi: una MLP con attivazione tanh, una testa per
 * la policy e una per il valore. Il forward pass qui sotto è qualche riga di
 * moltiplicazioni: nessuna dipendenza, gira anche nel browser.
 */
import type { GameConfig } from './config'

export interface DenseLayer {
  /** Pesi in ordine per righe: [out][in] appiattito. */
  w: number[]
  b: number[]
  in: number
  out: number
}

export interface PolicyModel {
  format: 'fomofud-policy-1'
  obsSize: number
  actionSize: number
  /**
   * Impronta della FORMA della config con cui è stata addestrata: settori,
   * dimensione del Mercato, Round, giocatori. Non include l'economia — cambiare
   * `trader.cash` o le commissioni e rigiocare è esattamente lo scopo, e non
   * invalida i pesi. Cambiare il numero di settori sì.
   */
  shape: string
  trunk: DenseLayer[]
  policyHead: DenseLayer
  valueHead: DenseLayer
  meta?: Record<string, unknown>
}

/**
 * Impronta della forma: cambia solo se cambiano le dimensioni di osservazione o
 * azione. Così una policy addestrata una volta resta valida mentre fai variare
 * i parametri economici da simulazione.yaml.
 */
export function configShape(config: GameConfig): string {
  const parts = [
    `sectors=${config.sectorIds.join('|')}`,
    `market=${config.marketSize}`,
    `rounds=${config.rounds}`,
    `players=${config.minPlayers}-${config.maxPlayers}`,
    `vi=${config.valueInvestor.draw}/${config.valueInvestor.keepMax}`,
    `rumorTargets=${[...new Set(config.rumors.map((r) => `${r.target.kind}:${r.target.direction}`))].sort().join(',')}`,
  ]
  return parts.join(';')
}

export function assertCompatible(model: PolicyModel, config: GameConfig, obsSize: number, actionSize: number): void {
  if (model.format !== 'fomofud-policy-1') {
    throw new Error(`Formato modello sconosciuto: "${model.format}"`)
  }
  const shape = configShape(config)
  if (model.shape !== shape) {
    throw new Error(
      'La policy è stata addestrata su una forma di gioco diversa.\n' +
        `  addestrata su: ${model.shape}\n` +
        `  in uso ora:    ${shape}\n` +
        'Riaddestrala con `npm run train` (i soli parametri economici, invece, non richiedono riaddestramento).',
    )
  }
  if (model.obsSize !== obsSize || model.actionSize !== actionSize) {
    throw new Error(
      `Dimensioni incompatibili: la policy vuole ${model.obsSize}→${model.actionSize}, ` +
        `il motore produce ${obsSize}→${actionSize}.`,
    )
  }
}

/** y = tanh(Wx + b), con W in ordine per righe. */
function dense(layer: DenseLayer, x: Float64Array<ArrayBuffer>, activate: boolean): Float64Array<ArrayBuffer> {
  const out = new Float64Array(layer.out)
  for (let o = 0; o < layer.out; o++) {
    let sum = layer.b[o]
    const row = o * layer.in
    for (let i = 0; i < layer.in; i++) sum += layer.w[row + i] * x[i]
    out[o] = activate ? Math.tanh(sum) : sum
  }
  return out
}

export interface Forward {
  logits: Float64Array<ArrayBuffer>
  value: number
}

export function forward(model: PolicyModel, observation: number[]): Forward {
  let h: Float64Array<ArrayBuffer> = new Float64Array(observation)
  for (const layer of model.trunk) h = dense(layer, h, true)
  return {
    logits: dense(model.policyHead, h, false),
    value: dense(model.valueHead, h, false)[0],
  }
}

/**
 * Sceglie un'azione fra quelle legali.
 *
 * `temperature` è il parametro con cui si cambia carattere alla stessa policy
 * senza riaddestrare: 0 gioca sempre la mossa che ritiene migliore (forte ma
 * prevedibile), 1 campiona dalla distribuzione appresa (più varia, e in un gioco
 * di bluff una policy prevedibile è sfruttabile).
 */
export function chooseAction(
  logits: Float64Array<ArrayBuffer>,
  legal: number[],
  temperature: number,
  random: () => number,
): number {
  if (legal.length === 0) return 0
  if (legal.length === 1) return legal[0]

  if (temperature <= 0) {
    let best = legal[0]
    for (const i of legal) if (logits[i] > logits[best]) best = i
    return best
  }

  let max = -Infinity
  for (const i of legal) max = Math.max(max, logits[i] / temperature)
  let total = 0
  const weights = legal.map((i) => {
    const w = Math.exp(logits[i] / temperature - max)
    total += w
    return w
  })
  let roll = random() * total
  for (let k = 0; k < legal.length; k++) {
    roll -= weights[k]
    if (roll <= 0) return legal[k]
  }
  return legal[legal.length - 1]
}
