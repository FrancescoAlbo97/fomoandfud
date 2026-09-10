import { withRng } from './rng'
import type { EffectSpec, GameState, RumorTarget } from './types'

export interface EffectContext {
  state: GameState
  actingPlayerId: string
  opponentId?: string
}

/** Applies one half (Inside Trading or Market News) of a Rumor card. Returns the new state and a log line. */
export function applyEffect(
  effect: EffectSpec,
  target: RumorTarget,
  ctx: EffectContext,
): { state: GameState; text: string } {
  let state = ctx.state
  const clampPrice = (v: number) => Math.max(state.config.priceMin, Math.min(state.config.priceMax, v))

  switch (effect.kind) {
    case 'movePrice': {
      if (target.kind !== 'sector') throw new Error('movePrice effect requires a sector target')
      const before = state.sectors[target.sector]
      const after = clampPrice(before + effect.amount)
      state = { ...state, sectors: { ...state.sectors, [target.sector]: after } }
      const label = state.config.sectorById[target.sector].label
      const verb = effect.amount >= 0 ? 'sale' : 'scende'
      return { state, text: `Il settore ${label} ${verb} a $${after} (era $${before}).` }
    }
    case 'adjustFees': {
      const before = state.feesModifierThisRound
      const after = before + effect.amount
      state = { ...state, feesModifierThisRound: after }
      const verb = effect.amount >= 0 ? 'aumentano' : 'diminuiscono'
      return { state, text: `Le commissioni del Mercato ${verb} (modificatore ora ${after >= 0 ? '+' : ''}${after}).` }
    }
    case 'discardRandomRumor': {
      const opponent = requireOpponent(state, ctx)
      if (opponent.rumorCards.length === 0) {
        return { state, text: `${opponent.name} non ha carte Rumor da scartare.` }
      }
      const [discardedIndex, nextSeed] = withRng(state.rngSeed, (rng) => rng.int(opponent.rumorCards.length))
      const discarded = opponent.rumorCards[discardedIndex]
      const updatedOpponent = {
        ...opponent,
        rumorCards: opponent.rumorCards.filter((_, i) => i !== discardedIndex),
      }
      state = {
        ...state,
        rngSeed: nextSeed,
        players: state.players.map((p) => (p.id === opponent.id ? updatedOpponent : p)),
        mixedDiscard: [...state.mixedDiscard, discarded],
      }
      return { state, text: `${opponent.name} scarta a caso una carta Rumor dalla mano.` }
    }
    case 'discardChosenRumorAndAzione': {
      // §15.2 — the discard is "a scelta" of the TARGET, so we park a pending choice
      // instead of resolving here; settle() will ask them before anything else runs.
      const opponent = requireOpponent(state, ctx)
      if (opponent.rumorCards.length === 0 && opponent.actionCards.length === 0) {
        return { state, text: `${opponent.name} non ha carte da scartare.` }
      }
      state = {
        ...state,
        pendingEffectChoice: {
          kind: 'forcedDiscard',
          targetPlayerId: opponent.id,
          sourcePlayerId: ctx.actingPlayerId,
        },
      }
      return { state, text: `${opponent.name} deve scartare 1 carta Rumor e 1 Carta Azione a sua scelta.` }
    }
    case 'peekHand': {
      // Guardare la mano vale qualcosa solo se resta scritto: lo registriamo nella
      // conoscenza privata di chi sbircia, così le AI possono davvero usarlo.
      const opponent = requireOpponent(state, ctx)
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === ctx.actingPlayerId
            ? {
                ...p,
                knownOpponentActionCards: {
                  ...p.knownOpponentActionCards,
                  [opponent.id]: opponent.actionCards.map((c) => c.instanceId),
                },
              }
            : p,
        ),
      }
      return { state, text: `Sbirci in segreto le Carte Azione in mano a ${opponent.name} (${opponent.actionCards.length}).` }
    }
    case 'swapAzioneCard': {
      // §15.2 — you look at the hand and THEN choose which card to swap, so this is a
      // pending choice for the acting player, not a deterministic first-card swap.
      const opponent = requireOpponent(state, ctx)
      const acting = state.players.find((p) => p.id === ctx.actingPlayerId)!
      if (opponent.actionCards.length === 0 || acting.actionCards.length === 0) {
        return { state, text: `Scambio non possibile: ${opponent.name} o tu non avete Carte Azione in mano.` }
      }
      state = {
        ...state,
        pendingEffectChoice: { kind: 'insiderSwap', actingPlayerId: acting.id, opponentId: opponent.id },
      }
      return { state, text: `${acting.name} guarda la mano di ${opponent.name} e sceglie una Carta Azione da scambiare.` }
    }
  }
}

function requireOpponent(state: GameState, ctx: EffectContext) {
  const opponent = state.players.find((p) => p.id === ctx.opponentId)
  if (!opponent) throw new Error('Effetto Avversario richiede un opponentId valido')
  return opponent
}
