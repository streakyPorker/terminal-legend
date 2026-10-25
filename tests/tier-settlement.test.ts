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
 * Tier-count-weighted coefficient, derived from the STORED tier-I/tier-II
 * arrays — deliberately independent of `mixedRecipe`/`recipeAt`.
 */
const blend = (tierI: number, tierII: number): number =>
  (COUNT_I * tierI + COUNT_II * tierII) / COUNT_TOTAL

/** Tier-II steelMills recipe, resolved without touching the helpers. */
const steelTierII = () => {
  const tier = BUILDING_RECIPES.steelMills.tiers?.[0]
  if (tier === undefined) throw new Error('steelMills tier II is missing')
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
    close(mixed.output.steel ?? 0, blend(base.output.steel ?? 0, tierII.output.steel ?? 0))
    // Labor: (5·I_labor + 3·II_labor) / 8.
    close(mixed.labor, blend(base.labor, tierII.labor))
    // Inputs: every good blends the same way (iron / coal / machinery).
    for (const good of Object.keys(base.input) as GoodId[]) {
      close(
        mixed.input[good] ?? 0,
        blend(base.input[good] ?? 0, tierII.input[good] ?? 0),
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
      blend(base.output.steel ?? 0, tierII.output.steel ?? 0) / (base.output.steel ?? 0),
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
        blend(base.output[good] ?? 0, tierII.output[good] ?? 0) * prices[good] * eff
    }
    let expectedInput = 0
    for (const good of Object.keys(base.input) as GoodId[]) {
      expectedInput +=
        blend(base.input[good] ?? 0, tierII.input[good] ?? 0) * prices[good] * eff
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
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    expect(left.countries.QING?.econ).toEqual(right.countries.QING?.econ)
    expect(left.countries.PRU?.econ).toEqual(right.countries.PRU?.econ)
    expect(left.countries.GBR?.econ).toEqual(right.countries.GBR?.econ)
  })
})
