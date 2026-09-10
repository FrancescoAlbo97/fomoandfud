import type { GameConfig } from './config'
import type { ActionCardInstance, ETFCardInstance, MixedCardInstance, RumorCardInstance } from './types'

let instanceCounter = 0

/**
 * Card instance ids are handed out from a module counter, so two games in the same
 * process would otherwise get different ids from the same seed. Reset per game to
 * keep seeded runs byte-identical and replayable.
 */
export function resetInstanceIds(): void {
  instanceCounter = 0
}

function nextInstanceId(prefix: string): string {
  instanceCounter += 1
  return `${prefix}-${instanceCounter}`
}

export function buildActionDeck(config: GameConfig): ActionCardInstance[] {
  return config.actionDefs.map((def) => ({ instanceId: nextInstanceId('act'), defId: def.id }))
}

export function buildMixedDeck(config: GameConfig): MixedCardInstance[] {
  const rumors: RumorCardInstance[] = config.rumors.flatMap((def) =>
    Array.from({ length: def.quantity }, () => ({
      instanceId: nextInstanceId('rumor'),
      kind: 'rumor' as const,
      defId: def.id,
    })),
  )
  const etfs: ETFCardInstance[] = config.etfs.map((def) => ({
    instanceId: nextInstanceId('etf'),
    kind: 'etf' as const,
    defId: def.id,
  }))
  return [...rumors, ...etfs]
}
