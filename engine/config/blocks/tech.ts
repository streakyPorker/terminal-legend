import type { ConfigBlock, Curve } from '../../../types'

/**
 * The technology multiplier as block data (C5, ADR 0024 §7). This is the
 * `1 + techTier × 0.07` factor the engine applies to every tech-gated recipe
 * output (`computeProduction`) and to construction capacity
 * (`constructionCapacity`). It is NOT an `applyModifiers` entry: the block is a
 * declaration whose `scales_with` curve is the factor, and the engine reads it
 * at its existing per-building/per-good seam via `techMultiplier`. The
 * `techLevel` stat name now resolves to the derived `techTier` (plan 0005 K0).
 */
export const TECH_MULTIPLIER_ID = 'tech:multiplier'

/** The `1 + techTier × 0.07` curve, shared with the production gate registry. */
export const TECH_MULTIPLIER_CURVE: Curve = {
  kind: 'linear',
  slope: 0.07,
  offset: 1,
}

export const TECH_MULTIPLIER_BLOCK: ConfigBlock = {
  id: TECH_MULTIPLIER_ID,
  kind: 'tech',
  label: '科技乘数',
  description: '1 + 科技等级 × 0.07，作用于受科技门控的产出与建造能力',
  potential_trigger: [],
  lifecycle: 'once',
  scales_with: [{ stat: 'techLevel', curve: TECH_MULTIPLIER_CURVE }],
  effects: [],
}
