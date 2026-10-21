import type { ConditionStat, ConfigBlock, Curve } from '../../../types'
import { TECH_MULTIPLIER_CURVE } from './tech'

/**
 * The four production-gate multipliers as block data (C7, ADR 0024 §7). Each
 * gate is a `ConfigBlock` whose single `scales_with` curve is the multiplier a
 * recipe's `gates` / `outputGates` flag turns on. The engine supplies the gate's
 * input at its existing seam and reads the curve from config:
 *
 *   tech           ← country.tech.level  (`techMultiplier`, also `tech:multiplier`)
 *   infrastructure ← applyModifiers('transportInfrastructure', econ.transportInfrastructure)
 *   access         ← applyModifiers('marketAccess', econ.marketAccess)
 *   industrial     ← (resourceFactors.coal + resourceFactors.iron) / 2
 *
 * `stat` names the base reading for validation/documentation; where the seam
 * needs the modifier-applied value, the engine overrides the input.
 *
 * The curves use `preOffset`/`divisor` where the old formula divided, so the
 * production numbers stay bit-for-bit identical (a plain `x × slope` cannot
 * reproduce `x / 160`).
 */

export type ProductionGateId = 'tech' | 'infrastructure' | 'access' | 'industrial'

export type ProductionGateSpec = {
  id: ProductionGateId
  label: string
  stat: ConditionStat
  curve: Curve
}

/** Every gate's declaration, 1:1 from the pre-C7 hardcoded multipliers. */
export const PRODUCTION_GATE_SPECS: ProductionGateSpec[] = [
  { id: 'tech', label: '科技门控', stat: 'techLevel', curve: TECH_MULTIPLIER_CURVE },
  {
    id: 'infrastructure',
    label: '交通基础设施门控',
    stat: 'transportInfrastructure',
    curve: { kind: 'linear', slope: 1, divisor: 160, offset: 0.6 },
  },
  {
    id: 'access',
    label: '市场接入门控',
    stat: 'marketAccess',
    curve: { kind: 'linear', slope: 0.9, offset: 0.55 },
  },
  {
    id: 'industrial',
    label: '工业禀赋门控',
    stat: 'industrialEndowment',
    curve: { kind: 'linear', slope: 1, min: 0.7, max: 1.3 },
  },
]

/** The multiplier curve for a gate. */
export function productionGateCurve(id: ProductionGateId): Curve {
  const spec = PRODUCTION_GATE_SPECS.find(entry => entry.id === id)
  if (spec === undefined) throw new Error(`unknown production gate: ${id}`)
  return spec.curve
}

/** The gate multiplier curves, keyed by gate id — what the production seam reads. */
export const PRODUCTION_GATE_CURVES: Record<ProductionGateId, Curve> = {
  tech: productionGateCurve('tech'),
  infrastructure: productionGateCurve('infrastructure'),
  access: productionGateCurve('access'),
  industrial: productionGateCurve('industrial'),
}

/** Shapes one gate's declaration into a `ConfigBlock` (ADR 0024 §3). */
export function compileGateBlock(spec: ProductionGateSpec): ConfigBlock {
  return {
    id: `gate:${spec.id}`,
    kind: 'economy',
    label: spec.label,
    potential_trigger: [],
    lifecycle: 'while',
    scales_with: [{ stat: spec.stat, curve: spec.curve }],
    effects: [],
  }
}

/**
 * The gate blocks for the global registry. The `tech` gate reuses
 * `tech:multiplier` (C5), so it is not duplicated here.
 */
export const GATE_BLOCKS: ConfigBlock[] = PRODUCTION_GATE_SPECS.filter(
  spec => spec.id !== 'tech',
).map(compileGateBlock)
