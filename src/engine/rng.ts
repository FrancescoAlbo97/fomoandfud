// Small deterministic PRNG so a game can be seeded/replayed.
export interface Rng {
  next(): number // float in [0,1)
  int(maxExclusive: number): number
  pick<T>(arr: T[]): T
  shuffle<T>(arr: T[]): T[]
  getState(): number
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    // mulberry32
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive)
  const pick = <T,>(arr: T[]): T => arr[int(arr.length)]
  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = arr.slice()
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1)
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }
  return { next, int, pick, shuffle, getState: () => state }
}

/**
 * Runs `fn` with a fresh Rng seeded from `seed` and returns both the result
 * and the evolved seed, so callers holding state in a plain object (e.g. a
 * GameState) can thread randomness through without a module-level mutable RNG.
 */
export function withRng<T>(seed: number, fn: (rng: Rng) => T): [T, number] {
  const rng = makeRng(seed)
  const result = fn(rng)
  return [result, rng.getState()]
}
