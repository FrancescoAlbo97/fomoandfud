import type { GameConfig } from '../engine/config'
import type { OrderTarget, RumorTarget, SectorId } from '../engine/types'

export function sectorClass(sector: SectorId): string {
  return `sector-${sector}`
}
export function sectorBgClass(sector: SectorId): string {
  return `bg-sector-${sector}`
}

export function describeRumorTarget(
  config: GameConfig,
  target: RumorTarget | OrderTarget,
  opponentName?: string,
): string {
  const arrow = target.direction === 'up' ? '↑' : '↓'
  if (target.kind === 'sector') {
    const sector = config.sectorById[target.sector]
    return `${sector.icon} ${sector.label} ${arrow}`
  }
  if (target.kind === 'fees') return `💰 Commissioni ${arrow}`
  return `🎯 ${opponentName ?? 'Avversario'} ${arrow}`
}
