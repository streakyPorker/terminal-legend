import type { ConfigBlock } from '../../../types'

/**
 * Debt pressure as block data (C7, ADR 0024 §7 / ADR 0007). The block's
 * `scales_with` curve is the continuous `severity` the engine reads at the
 * fiscal, construction and legitimacy seams; the per-severity penalty
 * coefficients and the display bands are declared below. This is NOT an
 * `applyModifiers` entry: the four penalties are applied at their own seams.
 *
 * The curve reproduces the old `(ratio − 0.25) / 1.75` bit-for-bit via
 * `preOffset` + `divisor` (a plain `ratio × slope` would round differently).
 */

/** Debt/GDP at which the debuff begins. */
export const DEBT_PRESSURE_START = 0.25
/** Debt/GDP used as the severity curve's second reference point. */
export const DEBT_PRESSURE_FULL = 2

export const DEBT_PRESSURE_BLOCK: ConfigBlock = {
  id: 'fiscal:debt-pressure',
  kind: 'fiscal',
  label: '债务压力',
  description: '净负债/GDP 超过 25% 后的连续惩罚（ADR 0007）',
  potential_trigger: [],
  lifecycle: 'while',
  scales_with: [
    {
      stat: 'debtRatio',
      curve: {
        kind: 'linear',
        slope: 1,
        preOffset: DEBT_PRESSURE_START,
        divisor: DEBT_PRESSURE_FULL - DEBT_PRESSURE_START,
        min: 0,
        max: 2,
      },
    },
  ],
  effects: [],
}

/**
 * Penalty per unit of severity. These are fractions applied at the seams, not
 * modifier entries: incomePenalty is the share of income lost, constructionPenalty
 * the share of state construction speed lost, legitimacyPenalty the points
 * removed from the legitimacy target, interestSpread the extra monthly rate.
 */
export const DEBT_PRESSURE_COEFFICIENTS = {
  income: 0.1,
  construction: 0.2,
  legitimacy: 5,
  interest: 0.004,
} as const

/** Display bands; the first band whose `below` exceeds the ratio wins. */
export const DEBT_PRESSURE_BANDS: { below: number; label: string }[] = [
  { below: DEBT_PRESSURE_START, label: '无' },
  { below: 0.5, label: '轻度' },
  { below: 1, label: '中度' },
  { below: DEBT_PRESSURE_FULL, label: '重度' },
  { below: Number.POSITIVE_INFINITY, label: '危重' },
]

/** The display label for a debt/GDP ratio (ADR 0007 bands). */
export function debtPressureLabel(ratio: number): string {
  for (const band of DEBT_PRESSURE_BANDS) {
    if (ratio < band.below) return band.label
  }
  return '危重'
}
