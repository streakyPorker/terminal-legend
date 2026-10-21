import type {
  ConditionStat,
  ConfigBlock,
  Country,
  Curve,
  Modifier,
  ScaleSpec,
} from '../types'
import { findBlock } from './config/blocks'
import { resourceMultiplier } from './data'
import { effectiveResources } from './endowment'

/**
 * Leaf module for the block engine's read path: curve evaluation, the shared
 * stat reader, and the `scales_with` consume seam. It deliberately imports only
 * types + the config registry so `engine/modifiers.ts` can consume it without a
 * cycle back into `engine/blocks.ts`.
 */

/** Reads a raw country reading by stat name; unknown seams read 0. */
export function readStatValue(country: Country, stat: ConditionStat): number {
  switch (stat) {
    case 'radicals':
      return country.pops.radicals
    case 'loyalists':
      return country.pops.loyalists
    case 'literacy':
      return country.pops.literacy
    case 'legitimacy':
      return country.government.legitimacy
    case 'authority':
      return country.government.authority
    case 'sol':
      return country.pops.sol
    case 'unemployment':
      return country.econ.unemployment
    case 'bureaucracy':
      return country.bureaucracy.score
    case 'treasury':
      return country.econ.treasury
    case 'debt':
      return Math.max(0, -country.econ.treasury)
    case 'debtRatio':
      return Math.max(0, -country.econ.treasury) / Math.max(1, country.econ.gdp)
    case 'gdp':
      return country.econ.gdp
    case 'army':
      return country.military.army
    case 'navy':
      return country.military.navy
    case 'techLevel':
      return country.tech.level
    case 'factories':
      return country.econ.buildings.factories
    case 'prestige':
      return country.diplo.prestige
    case 'income':
      return country.econ.income
    case 'expense':
      return country.econ.expense
    case 'marketAccess':
      return country.econ.marketAccess
    case 'transportInfrastructure':
      return country.econ.transportInfrastructure
    case 'industrialEndowment': {
      const endowment = effectiveResources(country)
      return (
        (resourceMultiplier(endowment, 'coal') +
          resourceMultiplier(endowment, 'iron')) /
        2
      )
    }
    default:
      return 0
  }
}

/** The stats `readStatValue` actually resolves; a `scales_with.stat` must be one. */
export const READABLE_STATS: ReadonlySet<ConditionStat> = new Set<ConditionStat>([
  'radicals',
  'loyalists',
  'literacy',
  'legitimacy',
  'authority',
  'sol',
  'unemployment',
  'bureaucracy',
  'treasury',
  'debt',
  'debtRatio',
  'gdp',
  'army',
  'navy',
  'techLevel',
  'factories',
  'prestige',
  'income',
  'expense',
  'marketAccess',
  'transportInfrastructure',
  'industrialEndowment',
])

function clampCurve(value: number, curve: { min?: number; max?: number }): number {
  let out = value
  if (curve.min !== undefined && out < curve.min) out = curve.min
  if (curve.max !== undefined && out > curve.max) out = curve.max
  return out
}

/**
 * Evaluates one curve at `x`. `linear` = `(x − preOffset) × slope ÷ divisor + offset`
 * (`preOffset`/`divisor` optional; absent means `x × slope + offset`); `steps` =
 * the value of the last point whose `at` ≤ x (0 before the first point, a 0009 §7
 * 待定). The optional `min`/`max` clamp the output.
 */
export function curveOutput(curve: Curve, x: number): number {
  if (curve.kind === 'linear') {
    const shifted = curve.preOffset === undefined ? x : x - curve.preOffset
    let value = shifted * curve.slope
    if (curve.divisor !== undefined) value /= curve.divisor
    return clampCurve(value + (curve.offset ?? 0), curve)
  }
  let value = 0
  for (const point of curve.points) {
    if (point.at > x) break
    value = point.value
  }
  return clampCurve(value, curve)
}

/** The product of every `scales_with` curve at the country's current state. */
export function scaleProduct(country: Country, specs: ScaleSpec[]): number {
  let product = 1
  for (const spec of specs) {
    product *= curveOutput(spec.curve, readStatValue(country, spec.stat))
  }
  return product
}

/** Scales an effect value by the block's curves; empty specs leave it untouched. */
export function scaledValue(
  country: Country,
  value: number,
  specs: ScaleSpec[],
): number {
  if (specs.length === 0) return value
  return value * scaleProduct(country, specs)
}

/**
 * The consume seam: a modifier's effective value is its stored value scaled by
 * its owning block's `scales_with` (ADR 0024 §5, no cross-month cache). Sources
 * without a registered block are returned unchanged.
 */
export function effectiveModifierValue(
  country: Country,
  modifier: Modifier,
  resolve: (id: string) => ConfigBlock | undefined = findBlock,
): number {
  const block = resolve(modifier.source)
  if (block === undefined) return modifier.value
  return scaledValue(country, modifier.value, block.scales_with)
}
