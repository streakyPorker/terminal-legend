import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_RECIPES,
  applyBuildingDecay,
  applyBuildingDelta,
  deriveLabor,
  effectiveCount,
  infrastructureDemand,
  makeRngForWorld,
  mixedRecipe,
} from '../engine/data'
import { applyCheat } from '../engine/cheat'
import {
  advance,
  completeBuilding,
  computeEconomy,
  inspectEconomy,
  newWorld,
} from '../engine/sim'
import type { Country, GoodId, WorldState } from '../types'
import { EQ_MONTHS, LONG_MONTHS } from './helpers/horizon'

// ============================================================================
// Plan 0015 §S1 — settlement correctness for the tier blend.
//
// `mixedRecipe(country, id)` is the tier-count-weighted recipe every consumer
// (production / intermediate demand / labour / per-building profit) reads. The
// tests below pin the four claims S1's acceptance rests on:
//
//   1. all-I byte-identity with the tier-I `BUILDING_RECIPES` oracle — the swap
//      of the consumer reads is behaviour-neutral before any II/III seat exists;
//   2. the 5 I + 3 II hand-calculated blend AND the engine observables it drives
//      (labour demand, intermediate iron demand), computed independently of the
//      helpers (`mixedRecipe` / `recipeAt` are never called to derive an
//      expectation);
//   3. `Σ buildingTiers[id] === buildings[id]` across EVERY writer;
//   4. 60-month determinism, which also re-pins all-I byte-identity.
// ============================================================================

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

const close = (actual: number, expected: number): void => {
  expect(
    Math.abs(actual - expected),
    `expected ${expected}, got ${actual}`,
  ).toBeLessThan(1e-9)
}

// The 5 I + 3 II steelMills mix the hand-calc tests are built on.
const COUNT_I = 5
const COUNT_II = 3
const COUNT_TOTAL = COUNT_I + COUNT_II // 8

/**
 * Tier-count-weighted coefficient over the STORED per-tier arrays — deliberately
 * independent of `mixedRecipe` / `recipeAt`. Length-agnostic: `counts[t]` is the
 * seat count at tier index `t` (0 = tier I) and `values[t]` its coefficient.
 */
const blend = (counts: readonly number[], values: readonly number[]): number => {
  const total = counts.reduce((running, n) => running + n, 0)
  return counts.reduce((running, n, i) => running + n * (values[i] ?? 0), 0) / Math.max(1, total)
}

/** The legacy 5 I + 3 II mix, with per-tier values. */
const blend2 = (tierI: number, tierII: number): number =>
  blend([COUNT_I, COUNT_II], [tierI, tierII])

/** Tier-II steelMills recipe, resolved without touching the helpers. */
const steelTierII = () => {
  const tier = BUILDING_RECIPES.steelMills.tiers?.[0]
  if (tier === undefined) throw new Error('steelMills tier II is missing')
  return tier
}

/** Any steelMills `tiers[]` entry by index (0 = II, 1 = III, 2 = IV, 3 = V). */
const steelTier = (index: number) => {
  const tier = BUILDING_RECIPES.steelMills.tiers?.[index]
  if (tier === undefined) throw new Error(`steelMills tiers[${index}] is missing`)
  return tier
}

describe('mixedRecipe — all-I equivalence (plan 0015 S1)', () => {
  test('a fresh world blends to the byte-identical tier-I recipe, every country × building', () => {
    const world = newWorld(9100, 'QING')
    for (const country of Object.values(world.countries)) {
      for (const id of BUILDING_IDS) {
        // Deep equality (output / input / labor / gates / modifiers), so the
        // all-I settlement is unchanged from v13's direct BUILDING_RECIPES read.
        expect(mixedRecipe(country, id), `${country.id}.${id}`).toEqual(BUILDING_RECIPES[id])
      }
    }
  })
})

describe('mixedRecipe — 5 I + 3 II steelMills hand-calc (plan 0015 S1)', () => {
  test('the tier-weighted output / input / labor equal the independent blend', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    qing.econ.buildings.steelMills = COUNT_TOTAL

    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()
    const mixed = mixedRecipe(qing, 'steelMills')

    // Output: (5·I_steel + 3·II_steel) / 8.
    close(mixed.output.steel ?? 0, blend2(base.output.steel ?? 0, tierII.output.steel ?? 0))
    // Labor: (5·I_labor + 3·II_labor) / 8.
    close(mixed.labor, blend2(base.labor, tierII.labor))
    // Inputs: every good blends the same way (iron / coal / machinery).
    for (const good of Object.keys(base.input) as GoodId[]) {
      close(
        mixed.input[good] ?? 0,
        blend2(base.input[good] ?? 0, tierII.input[good] ?? 0),
      )
    }
  })

  test('labour demand and intermediate iron demand move by the hand-computed deltas', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    // Pin utilisation so the observable isolates the recipe blend, not the
    // idle gate (which is orthogonal to the tier coefficients under test).
    qing.econ.buildingProfits.steelMills.utilization = 1

    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()

    // Mixed: 5 seats of tier I + 3 seats of tier II.
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    qing.econ.buildings.steelMills = COUNT_TOTAL
    const mixedLabor = deriveLabor(qing).demand
    const mixedIron = inspectEconomy(qing).demand.iron

    // Control: the same 8 seats, all tier I.
    qing.econ.buildingTiers.steelMills = [COUNT_TOTAL]
    qing.econ.buildings.steelMills = COUNT_TOTAL
    const allILabor = deriveLabor(qing).demand
    const allIIron = inspectEconomy(qing).demand.iron

    // Labour demand delta = (5·I_labor + 3·II_labor) − 8·I_labor.
    close(
      mixedLabor - allILabor,
      COUNT_I * base.labor + COUNT_II * tierII.labor - COUNT_TOTAL * base.labor,
    )
    // Intermediate iron demand delta = (5·I_iron + 3·II_iron) − 8·I_iron.
    close(
      mixedIron - allIIron,
      COUNT_I * (base.input.iron ?? 0) +
        COUNT_II * (tierII.input.iron ?? 0) -
        COUNT_TOTAL * (base.input.iron ?? 0),
    )
  })
})

describe('mixedRecipe — IV/V boundary mixes into settlement (plan 0016 S1)', () => {
  test('[3,2,1,0] blends I/II/III and charges no electricity while IV is absent', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingProfits.steelMills.utilization = 1
    const counts = [3, 2, 1, 0]
    qing.econ.buildingTiers.steelMills = [...counts]
    qing.econ.buildings.steelMills = sum(counts)

    const defs = [BUILDING_RECIPES.steelMills, steelTier(0), steelTier(1), steelTier(2)]
    const mixed = mixedRecipe(qing, 'steelMills')
    close(mixed.output.steel ?? 0, blend(counts, defs.map(def => def.output.steel ?? 0)))
    close(mixed.labor, blend(counts, defs.map(def => def.labor)))
    // IV count is 0, so the blended electricity coefficient — and its demand — are 0.
    close(mixed.input.electricity ?? 0, blend(counts, defs.map(def => def.input.electricity ?? 0)))
    expect(mixed.input.electricity ?? 0).toBe(0)
    expect(inspectEconomy(qing).demand.electricity).toBe(0)
  })

  test('[2,1,1,1] blends IV in and charges electricity as effectiveCount × utilisation', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingProfits.steelMills.utilization = 1
    const counts = [2, 1, 1, 1]
    qing.econ.buildingTiers.steelMills = [...counts]
    qing.econ.buildings.steelMills = sum(counts)

    const defs = [BUILDING_RECIPES.steelMills, steelTier(0), steelTier(1), steelTier(2)]
    close(mixedRecipe(qing, 'steelMills').labor, blend(counts, defs.map(def => def.labor)))
    // Electricity is charged by effectiveCount(Σcount) × utilisation, NOT the raw count.
    const blendedElectricity = blend(counts, defs.map(def => def.input.electricity ?? 0))
    expect(blendedElectricity).toBeGreaterThan(0)
    close(
      inspectEconomy(qing).demand.electricity,
      effectiveCount(sum(counts)) * 1 * blendedElectricity,
    )
  })

  test('[1,1,0,1,1] blends IV and V in and charges electricity by effectiveCount × utilisation', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingProfits.steelMills.utilization = 1
    const counts = [1, 1, 0, 1, 1]
    qing.econ.buildingTiers.steelMills = [...counts]
    qing.econ.buildings.steelMills = sum(counts)

    const defs = [
      BUILDING_RECIPES.steelMills,
      steelTier(0),
      steelTier(1),
      steelTier(2),
      steelTier(3),
    ]
    close(
      mixedRecipe(qing, 'steelMills').output.steel ?? 0,
      blend(counts, defs.map(def => def.output.steel ?? 0)),
    )
    const blendedElectricity = blend(counts, defs.map(def => def.input.electricity ?? 0))
    close(
      inspectEconomy(qing).demand.electricity,
      effectiveCount(sum(counts)) * 1 * blendedElectricity,
    )
  })

  test('idle electrified seats draw proportionally less electricity; tradable inputs do not', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [0, 0, 0, 3]
    qing.econ.buildings.steelMills = 3

    qing.econ.buildingProfits.steelMills.utilization = 1
    const active = inspectEconomy(qing).demand
    qing.econ.buildingProfits.steelMills.utilization = 0
    const idle = inspectEconomy(qing).demand

    // Non-tradable (electricity) drops to 0 when the seats idle.
    expect(active.electricity).toBeGreaterThan(0)
    close(idle.electricity, 0)
    // Tradable inputs (coal/iron) charge the RAW count either way — idle-invariant.
    close(idle.coal, active.coal)
    close(idle.iron, active.iron)
  })
})

describe('Σ buildingTiers[id] === buildings[id] across every writer (plan 0015 S1)', () => {
  test('delta / decay / completeBuilding / cheat all preserve the identity and stay ≥ 0', () => {
    const world = newWorld(9102, 'QING')

    const assertInvariant = (country: Country, label: string): void => {
      for (const id of BUILDING_IDS) {
        const tiers = country.econ.buildingTiers[id]
        expect(tiers, `${country.id}.${id} tiers after ${label}`).toBeDefined()
        expect(sum(tiers), `${country.id}.${id} Σ after ${label}`).toBe(
          country.econ.buildings[id],
        )
        for (const count of tiers) {
          expect(count, `${country.id}.${id} bucket after ${label}`).toBeGreaterThanOrEqual(0)
        }
      }
    }

    for (const countryId of ['QING', 'GBR']) {
      const country = countryOf(world, countryId)
      for (const id of BUILDING_IDS) {
        const where = `${countryId}.${id}`

        applyBuildingDelta(country, id, 1, 3)
        assertInvariant(country, `delta +3@tier1 (${where})`)

        applyBuildingDelta(country, id, 1, -1)
        assertInvariant(country, `delta -1@tier1 (${where})`)

        applyBuildingDelta(country, id, 0, -2)
        assertInvariant(country, `delta -2@tier0 (${where})`)

        applyBuildingDecay(country, id, 0.9)
        assertInvariant(country, `decay 0.9 (${where})`)

        completeBuilding(country, id, 1)
        assertInvariant(country, `completeBuilding +1 (${where})`)

        // The天命 building path: `applyCheat` funnels through `completeBuilding`.
        const cheat = applyCheat(world, { action: 'building', country: countryId, building: id, count: 2 })
        expect(cheat.ok, `${where} cheat building`).toBe(true)
        assertInvariant(country, `cheat building +2 (${where})`)
      }
    }
  })
})

// ============================================================================
// Caliber markers (plan 0015 §S1 / 评审 M1). Each of the six settlement sites
// documents whether it reads the RAW seat count or the `effectiveCount`-后座数:
// production and per-building profit cap Σcount ONCE; intermediate demand and
// labour demand read the RAW count; infra demand is tier-independent.
// ============================================================================
describe('settlement caliber markers (plan 0015 S1/评审 M1)', () => {
  test('production caps Σcount once — the mix scales the coefficient, not the cap', () => {
    const world = newWorld(9101, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingProfits.steelMills.utilization = 1
    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()

    // 8 seats, all tier I.
    qing.econ.buildingTiers.steelMills = [COUNT_TOTAL]
    qing.econ.buildings.steelMills = COUNT_TOTAL
    const allISteel = inspectEconomy(qing).production.steel

    // 5 I + 3 II: same seat total, blended coefficient.
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    const mixedSteel = inspectEconomy(qing).production.steel

    // effectiveCount(8) is common to both reads, so the ratio is exactly the
    // blended coefficient over tier I — a per-tier cap would break this identity.
    close(
      mixedSteel / allISteel,
      blend2(base.output.steel ?? 0, tierII.output.steel ?? 0) / (base.output.steel ?? 0),
    )
  })

  test('per-building profit revenue/input cap Σcount once (caliber = effectiveCount(Σcount))', () => {
    const world = newWorld(9101, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingProfits.steelMills.utilization = 1
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    qing.econ.buildings.steelMills = COUNT_TOTAL

    const snap = computeEconomy(qing)
    const prices = qing.econ.prices
    const eff = effectiveCount(COUNT_TOTAL)
    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()

    // Expected row value = effectiveCount(8) × blended coefficient × price, with
    // the coefficient derived from the stored I/II arrays (not via the helper).
    let expectedRevenue = 0
    for (const good of Object.keys(base.output) as GoodId[]) {
      expectedRevenue +=
        blend2(base.output[good] ?? 0, tierII.output[good] ?? 0) * prices[good] * eff
    }
    let expectedInput = 0
    for (const good of Object.keys(base.input) as GoodId[]) {
      expectedInput +=
        blend2(base.input[good] ?? 0, tierII.input[good] ?? 0) * prices[good] * eff
    }

    close(snap.buildingProfits.steelMills.revenue, expectedRevenue)
    close(snap.buildingProfits.steelMills.inputCost, expectedInput)
  })

  test('intermediate demand reads the RAW seat count (caliber = 原始座数)', () => {
    const world = newWorld(9102, 'QING')
    const qing = countryOf(world, 'QING')
    // Isolate steelMills: zero every building and the military machinery blocks,
    // so the `machinery` demand is exactly the intermediate term.
    for (const id of BUILDING_IDS) {
      qing.econ.buildingTiers[id] = [0]
      qing.econ.buildings[id] = 0
    }
    qing.military.army = 0
    qing.military.navy = 0
    qing.econ.spending.army = 0
    qing.econ.spending.navy = 0
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    qing.econ.buildings.steelMills = COUNT_TOTAL

    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()
    // RAW seats 5·I + 3·II, with NO effectiveCount cap.
    close(
      inspectEconomy(qing).demand.machinery,
      COUNT_I * (base.input.machinery ?? 0) + COUNT_II * (tierII.input.machinery ?? 0),
    )
  })

  test('labour demand reads the RAW seat count × stored utilisation', () => {
    const world = newWorld(9102, 'QING')
    const qing = countryOf(world, 'QING')
    for (const id of BUILDING_IDS) {
      qing.econ.buildingTiers[id] = [0]
      qing.econ.buildings[id] = 0
    }
    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    qing.econ.buildings.steelMills = COUNT_TOTAL
    qing.econ.buildingProfits.steelMills.utilization = 1

    const base = BUILDING_RECIPES.steelMills
    const tierII = steelTierII()
    close(deriveLabor(qing).demand, COUNT_I * base.labor + COUNT_II * tierII.labor)
  })

  test('infrastructure demand is tier-independent — only the total count moves it', () => {
    const world = newWorld(9103, 'QING')
    const qing = countryOf(world, 'QING')

    qing.econ.buildingTiers.steelMills = [COUNT_TOTAL]
    qing.econ.buildings.steelMills = COUNT_TOTAL
    const allIInfra = infrastructureDemand(qing)

    qing.econ.buildingTiers.steelMills = [COUNT_I, COUNT_II]
    const mixedInfra = infrastructureDemand(qing)
    close(mixedInfra - allIInfra, 0)

    qing.econ.buildingTiers.steelMills = [COUNT_TOTAL + 2]
    qing.econ.buildings.steelMills = COUNT_TOTAL + 2
    close(infrastructureDemand(qing) - allIInfra, 2 * BUILDINGS.steelMills.infrastructureNeed)
  })
})

describe('tier settlement determinism (plan 0015 S1)', () => {
  test('two worlds advanced 60 months stay economically identical', () => {
    const left = newWorld(205, 'QING')
    const right = newWorld(205, 'QING')
    advance(left, EQ_MONTHS, [], makeRngForWorld(left))
    advance(right, EQ_MONTHS, [], makeRngForWorld(right))
    expect(left.countries.QING?.econ).toEqual(right.countries.QING?.econ)
    expect(left.countries.PRU?.econ).toEqual(right.countries.PRU?.econ)
    expect(left.countries.GBR?.econ).toEqual(right.countries.GBR?.econ)
  })
})
