/** Deterministic, serialisable PRNG (mulberry32). */
export type Rng = {
  next: () => number
  int: (maxExclusive: number) => number
  range: (min: number, max: number) => number
  chance: (probability: number) => boolean
  pick: <T>(items: readonly T[]) => T
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (maxExclusive: number) => Math.floor(next() * Math.max(1, maxExclusive))
  const range = (min: number, max: number) => min + next() * (max - min)
  const chance = (probability: number) => next() < probability
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T

  return { next, int, range, chance, pick }
}
