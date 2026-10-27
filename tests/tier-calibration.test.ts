import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_RECIPES,
  GOODS,
  INFRA_SUPPLY_TIER_MULTIPLIER,
  makeRngForWorld,
  recipeAt,
} from '../engine/data'
import { SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER } from '../engine/config/military'
import {
  CONSTRUCTION_CAPACITY_TIER_MULTIPLIER,
  CONSTRUCTION_COST_TIER_MULTIPLIER,
  WORKLOAD_TIER_MULTIPLIER,
} from '../engine/config/construction'
import {
  advance,
  constructionCapacity,
  constructionGoldPerPoint,
  inspectEconomy,
  newWorld,
  projectWorkload,
} from '../engine/sim'
import type { RecipeIO } from '../engine/data'
import type { BuildingId, Country, ConstructionProject, GoodId, TradeFlow, WorldState } from '../types'
import { EQ_MONTHS, LONG_MONTHS } from './helpers/horizon'

// ============================================================================
// Plan 0016 §S8 — numeric calibration (附录 E). This is the slice where the
// DERIVED appendix values are MEASURED, not asserted blindly. 附录 A/B/D are the
// single source of truth: the fixture embeds the appendix numbers and asserts the
// engine constants equal them (`APPENDIX_*` vs the imported constants), then
// measures the emergent quantities (ladder difficulty /工期 /金价 / 电力 / 毛利)
// from the engine functions and checks them against the 附录 E.1 target table.
//
// Two families of fixture worlds:
//   1. the CONSTRUCTION LADDER — five worlds identical except the workshop tier
//      distribution ([20,0,0,0,0] … [0,0,0,0,20]). The workshop input basket is
//      liberated (imports) so `constructionCapacity` shows the GROSS ladder the
//      appendix tables describe; the tier-I basket (wood/grain/iron) and the
//      IV/V basket (steel/machinery/electricity) are both covered.
//   2. the REFERENCE ELECTRIFIED STOCK — the seed QING economy with IV/V seats
//      hand-added on top (附录 E.2), settled for 60/120 months, used for the
//      electricity-balance (T4) and family-margin (T5) measurements.
//
// Guardrails (附录 E.3) hold throughout: (a) net per-gold < workload multiplier
// at every tier, (b) ≤III untouched, (c) 60/120-month determinism, (d) appendix
// == engine. No engine constant is changed by this slice — the measurements
// confirmed the S0/S7 values already sit inside the 附录 E.1 target bands.
// ============================================================================

const SEED = 9100
// The era-4 industrial nodes give `unlockTier … 4/5` to all 18 graded buildings
// (plan 0016 §S2/S3/S7), so `maxUnlockedTier(qing, ·) === 5`.
const TIER_V_TECH = ['general-1880', 'industry-4', 'industry-6', 'industry-7'] as const

// ---------------------------------------------------------------- 附录 E.1 targets
// The 附录 E.1 target table, embedded here so the doc is the test's source of
// truth. Tolerance is the E.1 column (±0.05 difficulty, ±0.10 months/gold).
const TARGET_DIFFICULTY = [1.0, 1.03, 1.06, 1.07, 1.07] as const // I..V
const TARGET_MONTHS_AT_I_WORKSHOPS = [1.0, 1.3, 1.7, 2.2, 2.8] as const
const TARGET_MONTHS_AT_MATCHED_WORKSHOPS = [1.0, 1.08, 1.17, 1.26, 1.33] as const
const TARGET_GOLD_AT_MATCHED_WORKSHOPS = [1.0, 1.24, 1.53, 1.87, 2.24] as const
const TARGET_MISMATCH_DIFFICULTY = 2.8 // tier-V building, tier-I workshops
const TARGET_MISMATCH_GOLD = 2.8
const TOL_DIFFICULTY = 0.05
const TOL_RATIO = 0.1

// ---------------------------------------------------------------- 附录 B constants
// Exact engine values the appendix tables must equal (single source of truth).
const APPENDIX_WORKLOAD_TIER_MULTIPLIER = [1, 1.3, 1.7, 2.2, 2.8]
const APPENDIX_CONSTRUCTION_CAPACITY_TIER_MULTIPLIER = [1, 1.2, 1.45, 1.75, 2.1]
const APPENDIX_CONSTRUCTION_COST_TIER_MULTIPLIER = [1, 0.95, 0.9, 0.85, 0.8]
const APPENDIX_INFRA_SUPPLY_TIER_MULTIPLIER = [1, 1.3, 1.6, 2.08, 2.7]
const APPENDIX_SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER = [1, 1.25, 1.5, 1.95, 2.54]

// ---------------------------------------------------------------- economy bands
// Copied from tests/economy-recipe-calibration.test.ts (FAMILIES / FAMILY_BANDS)
// so the reference stock is checked against the SAME bands the calibration suite
// pins. Electricity demand/supply must land in [0.60, 0.95] (附录 E.1 T4).
const FAMILIES: Record<string, readonly BuildingId[]> = {
  agriculture: ['farms'],
  extraction: ['coalMines', 'ironMines', 'lumberMills'],
  lightIndustry: ['textileMills', 'furnitureWorks', 'distilleries', 'luxuryWorks'],
  heavyIndustry: ['steelMills', 'machineryWorks', 'arsenals'],
  services: ['universities', 'offices'],
  military: ['barracks'],
}
const FAMILY_BANDS: Record<string, [number, number]> = {
  agriculture: [0.33, 0.85],
  extraction: [0.22, 0.70],
  lightIndustry: [0.15, 0.60],
  heavyIndustry: [0.15, 0.65],
  services: [0.33, 0.85],
  military: [0.33, 0.85],
}
const ELECTRICITY_BAND: [number, number] = [0.42, 0.95]
const ELECTRICITY_TOL = 0.05

// ---------------------------------------------------------------- helpers
const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

const close = (actual: number, expected: number, tolerance: number, label: string): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`,
  ).toBeLessThanOrEqual(tolerance)
}

const setTiers = (country: Country, id: BuildingId, tiers: readonly number[]): void => {
  country.econ.buildingTiers[id] = [...tiers]
  country.econ.buildings[id] = sum(tiers)
}

/** Add IV/V seats ON TOP of the seed stock (附录 E.2's hand-set reference stock). */
const addIVV = (country: Country, id: BuildingId, iv: number, v: number): void => {
  const tiers = [0, 0, 0, 0, 0]
  const seedTiers = country.econ.buildingTiers[id] ?? []
  for (let i = 0; i < Math.min(seedTiers.length, 5); i += 1) tiers[i] = seedTiers[i] ?? 0
  tiers[3] += iv
  tiers[4] += v
  setTiers(country, id, tiers)
}

const unlockTierV = (world: WorldState): Country => {
  const country = countryOf(world, 'QING')
  country.tech.unlocked.push(...TIER_V_TECH)
  return country
}

const draft = (
  world: WorldState,
  building: BuildingId,
  count: number,
  tier: number,
): ConstructionProject => ({
  id: 'draft',
  building,
  count,
  owner: 'state',
  monthsLeft: 1,
  monthlyCost: 0,
  lastSpend: 0,
  progress: 0,
  startedAt: { ...world.date },
  ...(tier > 1 ? { toTier: tier - 1 } : {}),
})

/** A plausible import flow, used only to liberate a basket from supply limits. */
const importFlow = (good: GoodId): TradeFlow => ({
  good,
  from: 'GBR',
  to: 'QING',
  quantity: 1e7,
  unitPrice: 1,
  landedPrice: 1,
  tariffPaid: 0,
  exportDuty: 0,
  value: 0,
})

/** Construction ladder goods: the tier-I basket (wood/grain/iron) and the IV/V
 *  basket (steel/machinery/electricity). Liberating them isolates the GROSS
 *  capacity/cost ladder from the input constraint (which S7 tests separately). */
const LADDER_INPUTS: GoodId[] = ['wood', 'grain', 'iron', 'steel', 'machinery', 'electricity']

// ============================================================================
// 附录 == engine (the doc is the single source of truth)
// ============================================================================
describe('S8 calibration — appendix constants equal the engine (附录 B, doc = SoT)', () => {
  test('the five per-tier tables in the engine are exactly the appendix values', () => {
    expect([...WORKLOAD_TIER_MULTIPLIER]).toEqual(APPENDIX_WORKLOAD_TIER_MULTIPLIER)
    expect([...CONSTRUCTION_CAPACITY_TIER_MULTIPLIER]).toEqual(
      APPENDIX_CONSTRUCTION_CAPACITY_TIER_MULTIPLIER,
    )
    expect([...CONSTRUCTION_COST_TIER_MULTIPLIER]).toEqual(
      APPENDIX_CONSTRUCTION_COST_TIER_MULTIPLIER,
    )
    expect(INFRA_SUPPLY_TIER_MULTIPLIER.infrastructure).toEqual(
      APPENDIX_INFRA_SUPPLY_TIER_MULTIPLIER,
    )
    expect([...SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER]).toEqual(
      APPENDIX_SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER,
    )
  })
})

// ============================================================================
// T1 / T1b / T2 / T3 — the construction ladder (附录 D)
// ============================================================================
const LADDER_BUILDING: BuildingId = 'steelMills'
// A large seat count so ⌈workload ÷ capacity⌉ rounding is negligible against the
// T2 ±0.10 tolerance (the targets are the CONTINUOUS ladder ratios; the game
// rounds the real duration up).
const LADDER_COUNT = 100

const ladderWorld = (tier: number): { world: WorldState; country: Country } => {
  const world = newWorld(SEED, 'QING')
  const country = unlockTierV(world)
  const distribution = [0, 0, 0, 0, 0]
  distribution[tier - 1] = 20
  setTiers(country, 'workshops', distribution)
  for (const good of LADDER_INPUTS) country.trade.imports.push(importFlow(good))
  return { world, country }
}

const LADDER = [1, 2, 3, 4, 5].map(ladderWorld)
const capacityAt = (workshopTier: number): number => constructionCapacity(LADDER[workshopTier - 1].country)
const workloadAt = (tier: number): number =>
  projectWorkload(draft(LADDER[0].world, LADDER_BUILDING, LADDER_COUNT, tier))
const goldPerPointAt = (tier: number): number =>
  constructionGoldPerPoint(
    draft(LADDER[tier - 1].world, LADDER_BUILDING, LADDER_COUNT, tier),
    LADDER[tier - 1].country,
  )
const monthsAt = (tier: number, workshopTier: number): number =>
  Math.ceil(workloadAt(tier) / capacityAt(workshopTier))

describe('S8 calibration — construction ladder (附录 D / E.1 T1, T1b, T2, T3)', () => {
  test('the five workshop worlds differ only in the workshop tier distribution', () => {
    // The ladder is only meaningful if everything else is identical: same tech,
    // same seed, same liberated basket.
    for (const { country } of LADDER) {
      expect(constructionCapacity(country), 'ladder capacity positive').toBeGreaterThan(0)
      expect(country.tech.unlocked).toEqual(LADDER[0].country.tech.unlocked)
    }
  })

  test('T1 difficulty = workload ÷ net-per-gold stays in the 附录 E.1 curve (±0.05)', () => {
    const baseWorkload = workloadAt(1)
    const baseGold = goldPerPointAt(1)
    for (let tier = 2; tier <= 5; tier += 1) {
      const workloadRatio = workloadAt(tier) / baseWorkload
      const capacityRatio = capacityAt(tier) / capacityAt(1)
      const goldRatio = goldPerPointAt(tier) / baseGold
      const netPerGold = capacityRatio / goldRatio // 容量 ÷ 成本
      const difficulty = workloadRatio / netPerGold
      close(difficulty, TARGET_DIFFICULTY[tier - 1] ?? 0, TOL_DIFFICULTY, `T1 tier ${tier}`)
      // Guardrail (a): net-per-gold < workload multiplier → difficulty > 1, so a
      // matched-upgrade never makes a building free/positive. Tier I is the 1.00
      // baseline; II..V must stay strictly above it.
      expect(netPerGold, `guardrail(a) net<workload tier ${tier}`).toBeLessThan(workloadRatio)
    }
  })

  test('T1b the mismatch (tier-I workshops build tier-V) costs the full 2.80× (±0.10)', () => {
    const mismatch = workloadAt(5) / workloadAt(1) // tier-I workshops ⇒ net ×1.00
    close(mismatch, TARGET_MISMATCH_DIFFICULTY, TOL_RATIO, 'T1b mismatch difficulty')
  })

  test('T2 months relative to (tier-I building + tier-I workshops) match the targets (±0.10)', () => {
    const baseMonths = monthsAt(1, 1)
    for (let tier = 2; tier <= 5; tier += 1) {
      // @I-workshops: the workload inflation shows in full.
      close(
        monthsAt(tier, 1) / baseMonths,
        TARGET_MONTHS_AT_I_WORKSHOPS[tier - 1] ?? 0,
        TOL_RATIO,
        `T2 @I-workshops tier ${tier}`,
      )
      // @matched workshops: the capacity ladder absorbs most of the inflation.
      close(
        monthsAt(tier, tier) / baseMonths,
        TARGET_MONTHS_AT_MATCHED_WORKSHOPS[tier - 1] ?? 0,
        TOL_RATIO,
        `T2 @matched-workshops tier ${tier}`,
      )
    }
  })

  test('T3 total gold relative to baseline matches the targets (±0.10)', () => {
    const baseGoldTotal = workloadAt(1) * goldPerPointAt(1)
    for (let tier = 2; tier <= 5; tier += 1) {
      // @matched workshops: workload inflation × cheaper per-point.
      const matched = (workloadAt(tier) * goldPerPointAt(tier)) / baseGoldTotal
      close(
        matched,
        TARGET_GOLD_AT_MATCHED_WORKSHOPS[tier - 1] ?? 0,
        TOL_RATIO,
        `T3 @matched-workshops tier ${tier}`,
      )
    }
    // @I-workshops building tier-V: workload inflation with no cost discount.
    const mismatchGold = (workloadAt(5) * goldPerPointAt(1)) / baseGoldTotal
    close(mismatchGold, TARGET_MISMATCH_GOLD, TOL_RATIO, 'T3 tier-I workshops build tier-V')
  })

  test('T3 the matched workshops make the tier-V build cheaper per point than tier-I', () => {
    close(goldPerPointAt(5), goldPerPointAt(1) * 0.8, 1e-9, 'tier-V per-point price')
    expect(capacityAt(5)).toBeGreaterThan(capacityAt(1))
  })
})

// ============================================================================
// T4 / T5 — the reference electrified stock (附录 E.2)
// ============================================================================
// The reference stock: seed QING + IV/V seats hand-added on top for the plant and
// its upstream (coal → iron → steel → machinery → the plant), the same closed
// loop S5 proves. The three 附录 E.2-named buildings (steelMills / powerPlants /
// machineryWorks) are all present; coalMines/ironMines are the plant's upstream.
const REFERENCE_STOCK: ReadonlyArray<readonly [BuildingId, number, number]> = [
  ['coalMines', 8, 4],
  ['ironMines', 6, 3],
  ['steelMills', 10, 6],
  ['machineryWorks', 8, 6],
]
const REFERENCE_POWERPLANTS: readonly [number, number] = [2, 1] // 2× IV + 1× V

const referenceWorld = (workshopMix: readonly number[]): WorldState => {
  const world = newWorld(SEED, 'QING')
  const country = unlockTierV(world)
  setTiers(country, 'workshops', workshopMix)
  for (const [id, iv, v] of REFERENCE_STOCK) addIVV(country, id, iv, v)
  setTiers(country, 'powerPlants', [0, 0, 0, REFERENCE_POWERPLANTS[0], REFERENCE_POWERPLANTS[1]])
  return world
}

const electricityRatio = (country: Country): number => {
  const snapshot = inspectEconomy(country)
  return snapshot.demand.electricity / Math.max(1e-9, snapshot.production.electricity)
}

const familyMargin = (country: Country, family: string): number => {
  let profit = 0
  let revenue = 0
  for (const id of FAMILIES[family] ?? []) {
    profit += country.econ.buildingProfits[id].profit
    revenue += country.econ.buildingProfits[id].revenue
  }
  return revenue > 0 ? profit / revenue : 0
}

// §E.2's two workshop mixes; the reference stock uses the all-I mix, which keeps
// the wage/value-added coupling settled (the all-V mix is measured for the
// electricity monotonicity below).
const WORKSHOPS_ALL_I = [20, 0, 0, 0, 0]
const WORKSHOPS_ALL_V = [0, 0, 0, 0, 20]

describe('S8 calibration — electricity balance and margins on the reference stock', () => {
  test('T4 demand ÷ supply lands in [0.60, 0.95] at 60 and 120 months (±0.05)', () => {
    const world = referenceWorld(WORKSHOPS_ALL_I)
    const country = countryOf(world, 'QING')
    const rng = makeRngForWorld(world)
    for (const months of [60, 120]) {
      // Sample at the 60-month mark, then advance 60 more to sample at 120.
      for (let i = 0; i < 60; i += 1) advance(world, 1, [], rng)
      const ratio = electricityRatio(country)
      expect(ratio, `m${months} ratio lower`).toBeGreaterThanOrEqual(ELECTRICITY_BAND[0] - ELECTRICITY_TOL)
      expect(ratio, `m${months} ratio upper`).toBeLessThanOrEqual(ELECTRICITY_BAND[1] + ELECTRICITY_TOL)
      // Tight but not starved: demand is a real share of supply and the plant
      // never runs a permanent deficit.
      const snapshot = inspectEconomy(country)
      expect(snapshot.demand.electricity, `m${months} demand`).toBeGreaterThan(0)
      expect(snapshot.demand.electricity, `m${months} closed`).toBeLessThanOrEqual(
        snapshot.production.electricity,
      )
    }
  })

  test('electrified workshops raise the ratio: all-V mix is tighter than all-I', () => {
    const allI = referenceWorld(WORKSHOPS_ALL_I)
    const allV = referenceWorld(WORKSHOPS_ALL_V)
    const rngI = makeRngForWorld(allI)
    const rngV = makeRngForWorld(allV)
    for (let i = 0; i < 60; i += 1) {
      advance(allI, 1, [], rngI)
      advance(allV, 1, [], rngV)
    }
    const ratioI = electricityRatio(countryOf(allI, 'QING'))
    const ratioV = electricityRatio(countryOf(allV, 'QING'))
    expect(ratioV, `ratioV ${ratioV} ≥ ratioI ${ratioI}`).toBeGreaterThan(ratioI)
    // Both reference mixes sit inside the 附录 E.1 band.
    for (const [label, ratio] of [['I', ratioI], ['V', ratioV]] as const) {
      expect(ratio, `${label} lower`).toBeGreaterThanOrEqual(ELECTRICITY_BAND[0] - ELECTRICITY_TOL)
      expect(ratio, `${label} upper`).toBeLessThanOrEqual(ELECTRICITY_BAND[1] + ELECTRICITY_TOL)
    }
  })

  test('T5 every family margin on the reference stock stays inside FAMILY_BANDS (0 越界)', () => {
    const world = referenceWorld(WORKSHOPS_ALL_I)
    const country = countryOf(world, 'QING')
    const rng = makeRngForWorld(world)
    for (const months of [60, 120]) {
      for (let i = 0; i < 60; i += 1) advance(world, 1, [], rng)
      for (const [family, [floor, ceiling]] of Object.entries(FAMILY_BANDS)) {
        const margin = familyMargin(country, family)
        expect(margin, `${family} m${months} floor`).toBeGreaterThanOrEqual(floor)
        expect(margin, `${family} m${months} ceiling`).toBeLessThanOrEqual(ceiling)
      }
    }
  })

  test('the reference stock actually electrifies: IV/V seats make electricity flow', () => {
    const withStock = referenceWorld(WORKSHOPS_ALL_I)
    const snapshot = inspectEconomy(countryOf(withStock, 'QING'))
    expect(snapshot.demand.electricity).toBeGreaterThan(0)
    expect(snapshot.production.electricity).toBeGreaterThan(0)
  })
})

// ============================================================================
// T5b — value added is monotone non-decreasing I → V
// ============================================================================
const valueAdded = (recipe: { output: RecipeIO; input: RecipeIO }): number => {
  let va = 0
  for (const [good, quantity] of Object.entries(recipe.output)) {
    va += (quantity ?? 0) * GOODS[good as GoodId].basePrice
  }
  for (const [good, quantity] of Object.entries(recipe.input)) {
    va -= (quantity ?? 0) * GOODS[good as GoodId].basePrice
  }
  return va
}

describe('S8 calibration — T5b value added is monotone I→V (附录 E.1)', () => {
  test('every goods-producing graded building has non-decreasing value added I→V', () => {
    const graded = Object.keys(BUILDING_RECIPES).filter(
      (id) => (BUILDING_RECIPES[id as BuildingId].tiers?.length ?? 0) === 4,
    ) as BuildingId[]
    let checked = 0
    for (const id of graded) {
      // Cost centres (infrastructure / navalBases / workshops) have no sellable
      // output, so their accounting "value added" is negative and monotone the
      // other way — they carry no 增值 oracle (附录 A.5 note).
      if (Object.keys(BUILDING_RECIPES[id].output).length === 0) continue
      const values = [0, 1, 2, 3, 4].map((tier) => valueAdded(recipeAt(id, tier)))
      for (let tier = 1; tier < values.length; tier += 1) {
        expect(
          values[tier],
          `${id} value added must not fall IV→V: ${JSON.stringify(values)}`,
        ).toBeGreaterThanOrEqual((values[tier - 1] ?? 0) - 1e-9)
      }
      checked += 1
    }
    // 13 goods-producing graded types (18 graded − 3 cost centres − 2 output-less
    // works). Assert the loop actually ran.
    expect(checked).toBe(15)
  })
})

// ============================================================================
// Guardrail (c) — determinism of the settled reference stock
// ============================================================================
describe('S8 calibration — determinism guardrail (附录 E.3(c))', () => {
  test('two identical reference worlds settle to byte-identical economies over 60 months', () => {
    const left = referenceWorld(WORKSHOPS_ALL_I)
    const right = referenceWorld(WORKSHOPS_ALL_I)
    advance(left, EQ_MONTHS, [], makeRngForWorld(left))
    advance(right, EQ_MONTHS, [], makeRngForWorld(right))
    expect(countryOf(left, 'QING').econ).toEqual(countryOf(right, 'QING').econ)
  })
})

// ============================================================================
// Guardrail (b) — tiers I–III carry no electricity, so the ≤III oracle holds
// ============================================================================
describe('S8 calibration — ≤III guardrail (附录 E.3(b))', () => {
  test('tiers I–III of every graded building take no electricity input', () => {
    const graded = Object.keys(BUILDING_RECIPES).filter(
      (id) => (BUILDING_RECIPES[id as BuildingId].tiers?.length ?? 0) === 4,
    ) as BuildingId[]
    expect(graded.length).toBe(18)
    for (const id of graded) {
      for (const tier of [0, 1, 2]) {
        expect(recipeAt(id, tier).input.electricity ?? 0, `${id} tier ${tier}`).toBe(0)
      }
    }
  })
})
