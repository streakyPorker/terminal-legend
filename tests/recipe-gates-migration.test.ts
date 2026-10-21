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
} from '../engine/data'
import { addModifier, applyModifiers } from '../engine/modifiers'
import { clamp, ensureConstructionFields } from '../engine/internal'
import { advance, inspectEconomy, newWorld, resourceFactors } from '../engine/sim'
import { curveOutput } from '../engine/scale'
import { validateBlockConfig } from '../engine/blocks'
import {
  GATE_BLOCKS,
  PRODUCTION_GATE_CURVES,
  PRODUCTION_GATE_SPECS,
} from '../engine/config/blocks/gates'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const clone = (c: Country): Country => JSON.parse(JSON.stringify(c)) as Country

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const storedUtilization = (c: Country, id: BuildingId): number => {
  const value = c.econ.buildingProfits?.[id]?.utilization
  return Number.isFinite(value) ? clamp(value as number, 0, 1) : 1
}

/** Frozen pre-C7 literals for each gate multiplier. */
const oracleGate = {
  tech: (level: number): number => 1 + level * 0.07,
  access: (marketAccess: number): number => 0.55 + marketAccess * 0.9,
  infrastructure: (transport: number): number => 0.6 + transport / 160,
  industrial: (average: number): number => clamp(average, 0.7, 1.3),
}

/**
 * Plan 0011 F5 replaced the per-recipe `infrastructure` gate with ONE unified
 * shortfall multiplier applied to every building: `clamp(level / 100, 0.35, 1)`,
 * where the level is the stored 0..100 pool reading. This is the oracle form.
 */
const oracleInfraMultiplier = (level: number): number => clamp(level / 100, 0.35, 1)

/**
 * Frozen copy of the pre-C7 `computeProduction` gate math; the four gate
 * multipliers are the pre-C7 literals. The only difference from the shipped
 * engine is where the factors come from (literals vs config curves), plus F5's
 * unified infrastructure multiplier applied to every building.
 */
function oracleProduction(c: Country): Record<GoodId, number> {
  ensureConstructionFields(c)
  const tech = oracleGate.tech(c.tech.level)
  const marketAccess = applyModifiers(c, 'marketAccess', c.econ.marketAccess)
  const access = oracleGate.access(marketAccess)
  const transport = applyModifiers(c, 'transportInfrastructure', c.econ.transportInfrastructure)
  const infra = oracleInfraMultiplier(transport)
  const b = c.econ.buildings
  const resources = resourceFactors(c)
  const industrial = oracleGate.industrial((resources.coal + resources.iron) / 2)
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

function expectProductionMatch(forOracle: Country, forEngine: Country, label: string): void {
  const oracle = oracleProduction(forOracle)
  const actual = inspectEconomy(forEngine).production
  for (const good of GOOD_IDS) {
    expect(
      Object.is(actual[good], oracle[good]),
      `${label} ${good}: ${actual[good]} vs ${oracle[good]}`,
    ).toBe(true)
  }
}

describe('RecipeGates migration equivalence (C7, ADR 0024)', () => {
  test('each gate curve reproduces the pre-C7 literal bit-for-bit', () => {
    for (const x of [0, 0.01, 0.25, 0.5, 1, 30, 55, 90, 160, 240, 400, 999.5]) {
      expect(Object.is(curveOutput(PRODUCTION_GATE_CURVES.access, x), oracleGate.access(x))).toBe(true)
      expect(
        Object.is(curveOutput(PRODUCTION_GATE_CURVES.infrastructure, x), oracleGate.infrastructure(x)),
      ).toBe(true)
      expect(
        Object.is(curveOutput(PRODUCTION_GATE_CURVES.industrial, x), oracleGate.industrial(x)),
      ).toBe(true)
      expect(Object.is(curveOutput(PRODUCTION_GATE_CURVES.tech, x), oracleGate.tech(x))).toBe(true)
    }
  })

  test('production matches the pre-C7 oracle across buildings/goods and gate levels', () => {
    for (const seed of [7101, 7102]) {
      const world = newWorld(seed, 'QING')
      for (let month = 0; month < 4; month += 1) {
        advance(world, 1, [], makeRngForWorld(world))
        for (const id of ['QING', 'GBR', 'FRA']) {
          const live = countryOf(world, id)
          // Sweep the infrastructure, access and industrial gate inputs; both
          // the oracle and the engine read the same country, so any drift shows.
          for (const transport of [0, 40, 80, 160, 320, 640]) {
            for (const marketAccess of [0, 0.2, 0.55, 1, 1.8]) {
              for (const coal of [0, 25, 50, 85, 100]) {
                const forOracle = clone(live)
                const forEngine = clone(live)
                for (const c of [forOracle, forEngine]) {
                  c.econ.transportInfrastructure = transport
                  c.econ.marketAccess = marketAccess
                  c.econ.resources.coal = coal
                  c.econ.resources.iron = 100 - coal
                  c.tech.level = (coal % 10) + 1
                }
                expectProductionMatch(
                  forOracle,
                  forEngine,
                  `${id} m${month} t${transport} a${marketAccess} coal${coal}`,
                )
              }
            }
          }
        }
      }
    }
  })

  test('the modifier-applied access / infrastructure inputs still feed the curves', () => {
    const world = newWorld(7103, 'GBR')
    const gbr = countryOf(world, 'GBR')
    advance(world, 1, [], makeRngForWorld(world))
    addModifier(gbr, {
      id: 'test:access',
      label: 'test access',
      stat: 'marketAccess',
      stack: 'flat',
      value: 0.25,
      source: 'test',
    })
    addModifier(gbr, {
      id: 'test:infra',
      label: 'test infra',
      stat: 'transportInfrastructure',
      stack: 'flat',
      value: 60,
      source: 'test',
    })
    expectProductionMatch(clone(gbr), clone(gbr), 'modified access/infra')
  })

  test('drift guard: gate specs, blocks and the curve map agree', () => {
    expect(PRODUCTION_GATE_SPECS.map(spec => spec.id)).toEqual([
      'tech',
      'infrastructure',
      'access',
      'industrial',
    ])
    expect(GATE_BLOCKS.map(block => block.id)).toEqual([
      'gate:infrastructure',
      'gate:access',
      'gate:industrial',
    ])
    expect(validateBlockConfig(GATE_BLOCKS)).toEqual([])
    for (const spec of PRODUCTION_GATE_SPECS) {
      expect(PRODUCTION_GATE_CURVES[spec.id]).toEqual(spec.curve)
    }
    // The tech gate shares the C5 block's curve rather than duplicating it.
    expect(GATE_BLOCKS.some(block => block.id === 'gate:tech')).toBe(false)
  })
})
