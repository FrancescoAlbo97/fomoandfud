/** Carica le policy addestrate dichiarate in `policies:` e le registra come agenti. */
import { existsSync, readFileSync } from 'node:fs'
import { registerPolicy, actionSpaceFor } from '../engine/agents'
import type { GameConfig } from '../engine/config'
import { featureSize } from '../engine/features'
import { assertCompatible, type PolicyModel } from '../engine/policyFormat'
import type { PolicySpec } from './configFile'

export function loadPolicyModel(file: string, config: GameConfig): PolicyModel {
  if (!existsSync(file)) {
    throw new Error(
      `Policy non trovata: ${file}\n` +
        'Addestrala con `npm run train`, oppure correggi il percorso in simulazione.yaml (blocco policies:).',
    )
  }
  const model = JSON.parse(readFileSync(file, 'utf8')) as PolicyModel
  assertCompatible(model, config, featureSize(config), actionSpaceFor(config).size)
  return model
}

/** Registra tutte le policy del file di configurazione. Da chiamare prima di `makeAgent`. */
export function registerPolicies(policies: Record<string, PolicySpec>, config: GameConfig): void {
  for (const [name, spec] of Object.entries(policies)) {
    registerPolicy(name, loadPolicyModel(spec.file, config), { temperature: spec.temperature })
  }
}
