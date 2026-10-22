/**
 * Multi-country conflict resolution for `engine` situations (plan 0002 §3). When
 * several participants press an opposite side in the same simultaneous
 * situation, leverage decides how much of each side's `pressure` lands: a
 * stronger participant lands proportionally more, and an even match splits the
 * effect in half. Deterministic, no RNG.
 */
export function pressureShare(mine: number, theirs: number): number {
  const total = mine + theirs
  return total > 0 ? mine / total : 0.5
}
