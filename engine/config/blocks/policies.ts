import type { ConfigBlock, PolicyEffect } from '../../../types'

/**
 * Compiles a submitted policy into a `ConfigBlock` (ADR 0024 §3). Policies are
 * dynamic — built at runtime from the player's `PolicyEffect[]`, never a static
 * registry — so this module only shapes the block; installation goes through
 * `installBlock` at the submission point.
 *
 * The block carries no trigger (`potential_trigger: []`) and `lifecycle: 'once'`:
 * a policy is permanent once submitted, and each effect's own `months` gives the
 * timed case (today's `monthsLeft`), mirroring the pre-block policy behaviour.
 */
export function compilePolicyBlock(
  name: string,
  effects: PolicyEffect[],
): ConfigBlock {
  return {
    id: `policy:${name}`,
    kind: 'policy',
    label: name,
    potential_trigger: [],
    lifecycle: 'once',
    scales_with: [],
    effects: effects.map(effect => ({
      stat: effect.stat,
      stack: effect.stack ?? 'flat',
      value: effect.value,
      label: effect.label,
      months: effect.months,
    })),
  }
}
