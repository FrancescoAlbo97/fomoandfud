/**
 * Agente guidato da una policy addestrata (`npm run train`).
 *
 * Implementa la stessa interfaccia `Agent` degli archetipi euristici, quindi
 * entra in `npm run sim`, nei grafici e nel menu di setup della partita senza
 * che nulla intorno cambi. È il solo modo onesto di sapere se ha imparato:
 * stesso tavolo, stesso metro.
 */
import { encodeObservation } from '../features'
import { chooseAction, forward, type PolicyModel } from '../policyFormat'
import type { Agent, AgentContext, AgentMove } from './types'

export interface PolicyOptions {
  /** 0 = gioca sempre la mossa che ritiene migliore; 1 = campiona come in addestramento. */
  temperature?: number
}

export function policyAgent(name: string, model: PolicyModel, options: PolicyOptions = {}): Agent {
  const temperature = options.temperature ?? 1
  return {
    name,
    act(ctx: AgentContext): AgentMove {
      const legal = ctx.flat.legal()
      if (legal.length === 0) throw new Error(`${name}: nessuna azione legale per ${ctx.pending.type}`)
      const { logits } = forward(model, encodeObservation(ctx.obs))
      const action = chooseAction(logits, legal, temperature, () => ctx.rng.next())
      return ctx.flat.decode(action)
    },
  }
}
