import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_IDS,
  BUILDING_RECIPES,
  GOODS,
  effectiveCount,
  makeRngForWorld,
  recipeAt,
} from '../engine/data'
import { TRADABLE_GOODS } from '../engine/trade'
import { advance, applyDecision, inspectEconomy, newWorld } from '../engine/sim'
import type { BuildingId, Country, WorldState } from '../types'

// ============================================================================
// Plan 0016 §S5 — economic regression, bootstrap and electricity satisfiability.
//
// Electricity is a NON_TRADABLE IV/V-grade input (ADR 0032 §2), so a country can
// only feed its electrified seats from its own `powerPlants`. The plant's own
// upstream (coalMines / ironMines / steelMills / machineryWorks at IV/V) ALSO
// draws electricity, so supply and demand are simultaneous. This fixture proves
// three things the slice names:
//
//   A. from-scratch closed-loop balance — there EXISTS a seat set where
//      Σ electricity supply ≥ Σ electricity demand, and the demand genuinely
//      includes the plant's own upstream (loop closure);
//   B. a viable bootstrap order — I/II/III steel & machinery need no
//      electricity, `powerPlants` never consumes it, so "build ≤III → build the
//      plant → electrify" cannot deadlock (each earlier step is electricity-free);
//   C. a fixed-horizon regression — 60/120 months on a reproducible fixture with
//      manual IV/V seats keeps the balance closed and every family margin inside
//      the economy-recipe-calibration bands (copied below, that suite exports none).
// ============================================================================

const SEED = 9100
// The era-4 industrial nodes give `unlockTier … 4/5` to all 17 graded buildings
// (plan 0016 §S2/S3), so `maxUnlockedTier(qing, ·) === 5`.
const TIER_V_TECH = ['general-1880', 'industry-4', 'industry-6', 'industry-7']

// The 17 buildings plan 0016 grades to IV/V; `powerPlants`/`farms` are graded but
// deliberately never consume electricity.
const ELECTRIFIED: BuildingId[] = [
  'coalMines',
  'ironMines',
  'lumberMills',
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
  'infrastructure',
  'navalYards',
  'navalBases',
  'farms',
  'chemicalWorks',
  'powerPlants',
  'locomotiveWorks',
]

// Copied from tests/economy-recipe-calibration.test.ts (FAMILIES / FAMILY_BANDS)
// so the horizon fixture checks the SAME bands the calibration suite pins.
const FAMILIES: Record<string, readonly BuildingId[]> = {
  agriculture: ['farms'],
  extraction: ['coalMines', 'ironMines', 'lumberMills'],
  lightIndustry: ['textileMills', 'furnitureWorks', 'distilleries', 'luxuryWorks'],
  heavyIndustry: ['steelMills', 'machineryWorks', 'arsenals'],
  services: ['universities', 'offices'],
  military: ['barracks'],
}
const FAMILY_BANDS: Record<string, [number, number]> = {
  agriculture: [0.36, 0.62],
  extraction: [0.33, 0.62],
  lightIndustry: [0.04, 0.25],
  heavyIndustry: [0.0, 0.36],
  services: [0.30, 0.58],
  military: [0.37, 0.65],
}

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected), `expected ${expected}, got ${actual}`).toBeLessThan(1e-9)
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

/** A fresh world whose player already holds tier V, with a war chest to order. */
const tierVWorld = (): WorldState => {
  const world = newWorld(SEED, 'QING')
  const qing = countryOf(world, 'QING')
  qing.tech.unlocked.push(...TIER_V_TECH)
  qing.econ.treasury = 1e7
  return world
}

/** Zero every building so only the hand-set electricity chain remains. */
const zeroBuildings = (country: Country): void => {
  for (const id of BUILDING_IDS) {
    country.econ.buildingTiers[id] = [0]
    country.econ.buildings[id] = 0
    country.econ.buildingProfits[id].utilization = 1
  }
}

/** Set a building's full 5-long tier array (index 0 = tier I) and sync Σ. */
const setTiers = (country: Country, id: BuildingId, tiers: readonly number[]): void => {
  country.econ.buildingTiers[id] = [...tiers]
  country.econ.buildings[id] = sum(tiers)
}

/** Right-pad the seed's tier array to length 5, then add IV/V seats on top. */
const electrify = (country: Country, id: BuildingId, iv: number, v: number): void => {
  const tiers = [0, 0, 0, 0, 0]
  const seed = country.econ.buildingTiers[id] ?? []
  for (let i = 0; i < Math.min(seed.length, 5); i += 1) tiers[i] = seed[i] ?? 0
  tiers[3] += iv
  tiers[4] += v
  setTiers(country, id, tiers)
}

/** Tier recipe without going through `mixedRecipe` (independent oracle). */
const recipeAtTier = (id: BuildingId, tierIndex: number) =>
  tierIndex <= 0 ? BUILDING_RECIPES[id] : recipeAt(id, tierIndex)

/** Seat-weighted electricity coefficient, independently of `mixedRecipe`. */
const blendedElectricity = (id: BuildingId, tiers: readonly number[]): number => {
  const total = sum(tiers)
  if (total <= 0) return 0
  return sum(tiers.map((count, tier) => count * (recipeAtTier(id, tier).input.electricity ?? 0))) / total
}

/** Hand-calculated electricity demand: effectiveCount(Σ) × utilisation × coefficient. */
const expectedElectricityDemand = (
  country: Country,
  chain: Record<string, readonly number[]>,
): number =>
  sum(
    Object.entries(chain).map(([id, tiers]) => {
      const seats = sum(tiers)
      const utilization = country.econ.buildingProfits[id as BuildingId].utilization
      return effectiveCount(seats) * utilization * blendedElectricity(id as BuildingId, tiers)
    }),
  )

/** Operating margin of a family, from the stored settlement snapshot. */
const familyMargin = (country: Country, family: string): number => {
  let profit = 0
  let revenue = 0
  for (const id of FAMILIES[family]) {
    profit += country.econ.buildingProfits[id].profit
    revenue += country.econ.buildingProfits[id].revenue
  }
  return revenue > 0 ? profit / revenue : 0
}

/** The closed-loop chain: the plant AND the upstream it feeds are all IV/V. */
const CLOSED_LOOP: Record<string, number[]> = {
  coalMines: [0, 0, 0, 8, 4],
  ironMines: [0, 0, 0, 6, 3],
  steelMills: [0, 0, 0, 10, 6],
  machineryWorks: [0, 0, 0, 8, 4],
  powerPlants: [0, 0, 0, 2, 1],
}

describe('S5 closed-loop electricity balance from scratch (plan 0016 §S5)', () => {
  test('a seat set exists where supply ≥ demand, and demand is the hand-calculated loop', () => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    zeroBuildings(qing)
    for (const [id, tiers] of Object.entries(CLOSED_LOOP)) setTiers(qing, id as BuildingId, tiers)

    const snap = inspectEconomy(qing)
    // The demand is charged on effectiveCount(Σ) × utilisation × blended tier
    // coefficient — recomputed here without touching `mixedRecipe`.
    close(snap.demand.electricity, expectedElectricityDemand(qing, CLOSED_LOOP))
    expect(snap.demand.electricity).toBeGreaterThan(0)
    expect(snap.production.electricity).toBeGreaterThan(0)
    // Closed: the plants cover every upstream + production seat, no deficit.
    expect(snap.demand.electricity).toBeLessThanOrEqual(snap.production.electricity)
  })

  test('loop closure: the plant upstream draws electricity, and only plants supply it', () => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    zeroBuildings(qing)
    for (const [id, tiers] of Object.entries(CLOSED_LOOP)) setTiers(qing, id as BuildingId, tiers)

    // Control: same seat totals, but the two mining upstream types sit at tier I.
    const control = tierVWorld()
    const other = countryOf(control, 'QING')
    zeroBuildings(other)
    for (const [id, tiers] of Object.entries(CLOSED_LOOP)) setTiers(other, id as BuildingId, tiers)
    setTiers(other, 'coalMines', [12])
    setTiers(other, 'ironMines', [9])

    const delta = inspectEconomy(qing).demand.electricity - inspectEconomy(other).demand.electricity
    const upstream = ['coalMines', 'ironMines'] as const
    close(
      delta,
      sum(
        upstream.map(
          id => effectiveCount(sum(CLOSED_LOOP[id] ?? [])) * blendedElectricity(id, CLOSED_LOOP[id] ?? []),
        ),
      ),
    )
    expect(delta).toBeGreaterThan(0)

    // Remove the plants: supply is exactly 0 while the demand is unchanged — the
    // plant is the sole supplier and electricity cannot be imported.
    const noPlants = tierVWorld()
    const bare = countryOf(noPlants, 'QING')
    zeroBuildings(bare)
    for (const [id, tiers] of Object.entries(CLOSED_LOOP)) {
      if (id !== 'powerPlants') setTiers(bare, id as BuildingId, tiers)
    }
    setTiers(bare, 'powerPlants', [0])
    const bareSnap = inspectEconomy(bare)
    expect(bareSnap.production.electricity).toBe(0)
    close(bareSnap.demand.electricity, inspectEconomy(qing).demand.electricity)
    expect(TRADABLE_GOODS).not.toContain('electricity')
  })
})

describe('S5 viable bootstrap order (plan 0016 §S5)', () => {
  test('tiers I–III of the 17 graded buildings consume no electricity', () => {
    for (const id of ELECTRIFIED) {
      for (let tier = 0; tier <= 2; tier += 1) {
        expect(
          recipeAtTier(id, tier).input.electricity ?? 0,
          `${id} tier ${tier} electricity`,
        ).toBe(0)
      }
    }
  })

  test('powerPlants and farms never consume electricity; heavy IV/V do', () => {
    for (let tier = 0; tier <= 4; tier += 1) {
      expect(recipeAtTier('powerPlants', tier).input.electricity ?? 0, `plant tier ${tier}`).toBe(0)
      expect(recipeAtTier('farms', tier).input.electricity ?? 0, `farms tier ${tier}`).toBe(0)
    }
    expect(recipeAtTier('steelMills', 3).input.electricity ?? 0).toBeGreaterThan(0)
    expect(recipeAtTier('steelMills', 4).input.electricity ?? 0).toBeGreaterThan(0)
  })

  test('≤III steel/machinery needs no electricity; the plant supplies it before electrifying', () => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    zeroBuildings(qing)
    // Step 1 — build the electrification upstream at tier III. No electricity
    // input exists yet, so this step cannot depend on the plant.
    setTiers(qing, 'coalMines', [0, 0, 12])
    setTiers(qing, 'ironMines', [0, 0, 9])
    setTiers(qing, 'steelMills', [0, 0, 8])
    setTiers(qing, 'machineryWorks', [0, 0, 6])
    let snap = inspectEconomy(qing)
    expect(snap.demand.electricity).toBe(0)
    expect(snap.production.electricity).toBe(0)

    // Step 2 — build the plant: it supplies electricity without consuming any.
    setTiers(qing, 'powerPlants', [0, 0, 0, 2, 1])
    snap = inspectEconomy(qing)
    expect(snap.production.electricity).toBeGreaterThan(0)
    expect(snap.demand.electricity).toBe(0)

    // Step 3 — electrify: now demand appears and is covered.
    setTiers(qing, 'steelMills', [0, 0, 0, 10, 6])
    snap = inspectEconomy(qing)
    expect(snap.demand.electricity).toBeGreaterThan(0)
    expect(snap.demand.electricity).toBeLessThanOrEqual(snap.production.electricity)
  })
})

describe('S5 fixed-horizon regression: balance, bands and determinism (plan 0016 §S5)', () => {
  // Reproducible fixture: seed 9100 + tier-V tech; IV/V seats added ON TOP of the
  // seed stock for the chain, with two IV + two V power plants to cover them.
  const horizonWorld = (): WorldState => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    electrify(qing, 'coalMines', 8, 4)
    electrify(qing, 'ironMines', 6, 3)
    electrify(qing, 'steelMills', 10, 6)
    electrify(qing, 'machineryWorks', 8, 4)
    setTiers(qing, 'powerPlants', [0, 0, 0, 2, 2])
    return world
  }

  test('60 and 120 months keep supply ≥ demand, a live price, and every family in band', () => {
    for (const months of [60, 120]) {
      const world = horizonWorld()
      const qing = countryOf(world, 'QING')
      const rng = makeRngForWorld(world)
      for (let month = 0; month < months; month += 1) advance(world, 1, [], rng)

      const snap = inspectEconomy(qing)
      expect(snap.demand.electricity, `m${months} demand`).toBeGreaterThan(0)
      expect(snap.production.electricity, `m${months} supply`).toBeGreaterThan(0)
      // Closed at the horizon: no permanent electricity deficit.
      expect(snap.demand.electricity, `m${months} closed`).toBeLessThanOrEqual(
        snap.production.electricity,
      )
      // Not a permanent shortage: the price never pins at the ceiling bound.
      const price = qing.econ.prices.electricity
      expect(price, `m${months} price floor`).toBeGreaterThan(0)
      expect(price, `m${months} price ceiling`).toBeLessThan(GOODS.electricity.basePrice * 4)

      for (const [family, [floor, ceiling]] of Object.entries(FAMILY_BANDS)) {
        const margin = familyMargin(qing, family)
        expect(margin, `${family} m${months} floor`).toBeGreaterThanOrEqual(floor)
        expect(margin, `${family} m${months} ceiling`).toBeLessThanOrEqual(ceiling)
      }
    }
  })

  test('two identical fixtures stay economically identical over 60 months', () => {
    const left = horizonWorld()
    const right = horizonWorld()
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    expect(countryOf(left, 'QING').econ).toEqual(countryOf(right, 'QING').econ)
  })
})

describe('S5 soft hint: IV/V orders warn when the country has no electricity (plan 0016 §S5)', () => {
  test('no supply warns on IV/V build and upgrade, but never blocks; ≤III stays silent', () => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    expect(inspectEconomy(qing).production.electricity).toBe(0)
    const rng = makeRngForWorld(world)

    const buildIV = applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'steelMills', count: 1, tier: 4 } },
      rng,
    )
    expect(buildIV.ok).toBe(true)
    expect(buildIV.text).toContain('无电力供给')

    const buildII = applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'steelMills', count: 1, tier: 2 } },
      rng,
    )
    expect(buildII.ok).toBe(true)
    expect(buildII.text).not.toContain('无电力供给')

    const upgradeV = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'upgrade',
        params: { building: 'steelMills', fromTier: 1, toTier: 5, count: 1 },
      },
      rng,
    )
    expect(upgradeV.ok).toBe(true)
    expect(upgradeV.text).toContain('无电力供给')

    const upgradeII = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'upgrade',
        params: { building: 'machineryWorks', fromTier: 1, toTier: 2, count: 1 },
      },
      rng,
    )
    expect(upgradeII.ok).toBe(true)
    expect(upgradeII.text).not.toContain('无电力供给')
  })

  test('a country with a running power plant gets no warning', () => {
    const world = tierVWorld()
    const qing = countryOf(world, 'QING')
    setTiers(qing, 'powerPlants', [0, 0, 0, 1, 0])
    qing.econ.buildingProfits.powerPlants.utilization = 1
    expect(inspectEconomy(qing).production.electricity).toBeGreaterThan(0)

    const result = applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'steelMills', count: 1, tier: 4 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(result.text).not.toContain('无电力供给')
  })
})
