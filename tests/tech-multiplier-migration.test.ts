import { describe, expect, test } from 'claude-code/testing'
import type { BuildingId, Country, GoodId, WorldState } from '../types'
import {
  ARTISAN_OUTPUT,
  ARTISAN_SERVICE_OUTPUT,
  BUILDING_IDS,
  BUILDING_RECIPES,
  GOOD_IDS,
  effectiveCount,
  makeRngForWorld,
  techTier,
} from '../engine/data'
import { applyModifiers } from '../engine/modifiers'
import { clamp, ensureConstructionFields, techMultiplier } from '../engine/internal'
import { advance, inspectEconomy, newWorld, resourceFactors } from '../engine/sim'
import {
  TECH_MULTIPLIER_BLOCK,
  TECH_MULTIPLIER_CURVE,
} from '../engine/config/blocks/tech'
import { productionGateCurve } from '../engine/config/blocks/gates'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const clone = (c: Country): Country => JSON.parse(JSON.stringify(c)) as Country

// Holds era 1 and pads the unlock list so techTier = 1 + 1.5 + n×0.05 = tier.
const setTier = (c: Country, tier: number): void => {
  c.tech.era = 1
  const count = Math.max(0, Math.round((tier - 2.5) / 0.05))
  c.tech.unlocked = Array.from({ length: count }, (_, i) => `tier-node-${i}`)
}

/** Frozen pre-C5 tech factor: `1 + tier × 0.07`. */
const oracleTechMultiplier = (tier: number): number => 1 + tier * 0.07

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const storedUtilization = (c: Country, id: BuildingId): number => {
  const value = c.econ.buildingProfits?.[id]?.utilization
  return Number.isFinite(value) ? clamp(value as number, 0, 1) : 1
}

/**
 * Frozen copy of the pre-C5 `computeProduction` gate math. The only difference
 * from the shipped engine is the hardcoded tech factor (`1 + level × 0.07`) —
 * exactly the literal C5 moved into `tech:multiplier`. Every other multiplier
 * is the pre-C5 literal too (`0.55 + access × 0.9`, `clamp(avg, 0.7, 1.3)`),
 * except F5's unified infrastructure multiplier (clamp(level / 100, 0.35, 1))
 * which replaced the retired per-recipe `infrastructure` gate.
 */
function oracleProduction(c: Country): Record<GoodId, number> {
  ensureConstructionFields(c)
  const tech = oracleTechMultiplier(techTier(c.tech))
  const marketAccess = applyModifiers(c, 'marketAccess', c.econ.marketAccess)
  const access = 0.55 + marketAccess * 0.9
  const transport = applyModifiers(c, 'transportInfrastructure', c.econ.transportInfrastructure)
  const infra = clamp(transport / 100, 0.35, 1)
  const b = c.econ.buildings
  const resources = resourceFactors(c)
  const industrial = clamp((resources.coal + resources.iron) / 2, 0.7, 1.3)
  const raw = zeroGoods()
  for (const id of BUILDING_IDS) {
    const recipe = BUILDING_RECIPES[id]
    const count = effectiveCount(b[id]) * storedUtilization(c, id)
    if (count <= 0) continue
    const modifier = recipe.outputModifier
    for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
      const gates = recipe.outputGates?.[good] ?? recipe.gates
      let value = count * coef
      if (gates?.tech) value *= tech
      if (gates?.access) value *= access
      if (gates?.industrial) value *= industrial
      value *= infra
      if (modifier !== undefined) value = applyModifiers(c, modifier, value)
      raw[good] += value
    }
  }
  raw.opium *= c.opium.outputFactor
  raw.clothes += c.pops.artisans * (ARTISAN_OUTPUT.clothes ?? 0)
  raw.liquor += c.pops.artisans * (ARTISAN_OUTPUT.liquor ?? 0)
  raw.furniture += c.pops.artisans * (ARTISAN_OUTPUT.furniture ?? 0)
  raw.services +=
    (c.pops.total / 1000) * 0.5 * access + c.pops.artisans * ARTISAN_SERVICE_OUTPUT
  const out = zeroGoods()
  for (const id of GOOD_IDS) {
    out[id] = applyModifiers(
      c,
      'production',
      applyModifiers(c, `${id}Output`, raw[id] * resources[id]),
    )
  }
  return out
}

describe('techMultiplier migration equivalence (C5, ADR 0024)', () => {
  test('the factor is bit-for-bit the pre-C5 literal across every tech tier', () => {
    for (const seed of [8101, 8102, 8103]) {
      const world = newWorld(seed, 'QING')
      for (const id of ['QING', 'GBR', 'FRA', 'RUS']) {
        const c = countryOf(world, id)
        for (let era = 1; era <= 4; era += 1) {
          for (let unlocked = 0; unlocked <= 16; unlocked += 1) {
            c.tech.era = era
            c.tech.unlocked = Array.from({ length: unlocked }, (_, i) => `n${i}`)
            const tier = techTier(c.tech)
            expect(Object.is(techMultiplier(c), oracleTechMultiplier(tier))).toBe(true)
          }
        }
      }
    }
  })

  test('per-building / per-good production matches the pre-C5 oracle bit-for-bit', () => {
    for (const seed of [8104, 8105]) {
      const world = newWorld(seed, 'QING')
      for (let month = 0; month < 6; month += 1) {
        advance(world, 1, [], makeRngForWorld(world))
        for (const id of ['QING', 'GBR', 'FRA']) {
          const live = countryOf(world, id)
          for (const tier of [1, 2.5, 3.75, 5, 6.5, 8]) {
            const forOracle = clone(live)
            setTier(forOracle, tier)
            const forEngine = clone(live)
            setTier(forEngine, tier)

            const oracle = oracleProduction(forOracle)
            const actual = inspectEconomy(forEngine).production
            for (const good of GOOD_IDS) {
              expect(
                Object.is(actual[good], oracle[good]),
                `${id} m${month} tier${tier} ${good}: ${actual[good]} vs ${oracle[good]}`,
              ).toBe(true)
            }
          }
        }
      }
    }
  })

  test('drift guard: the block declares the pre-C5 curve and the gate shares it', () => {
    expect(TECH_MULTIPLIER_CURVE).toEqual({ kind: 'linear', slope: 0.07, offset: 1 })
    expect(TECH_MULTIPLIER_BLOCK.scales_with).toEqual([
      { stat: 'techLevel', curve: TECH_MULTIPLIER_CURVE },
    ])
    expect(TECH_MULTIPLIER_BLOCK.kind).toBe('tech')
    expect(TECH_MULTIPLIER_BLOCK.effects).toEqual([])
    expect(productionGateCurve('tech')).toEqual(TECH_MULTIPLIER_CURVE)
  })
})
