import { describe, expect, test } from 'claude-code/testing'
import {
  GOODS,
  INFRA_SUPPLY,
  buildableBuildingIds,
  consumerBasket,
  electricityOutputMultiplier,
  infrastructureSupply,
  isBuildingUnlocked,
  makeRngForWorld,
  recipeAt,
  tierWeightedMultiplier,
} from '../engine/data'
import { SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER } from '../engine/config/military'
import { TRADABLE_GOODS } from '../engine/trade'
import {
  advance,
  applyDecision,
  inspectEconomy,
  newWorld,
  randomDecision,
} from '../engine/sim'
import type { Rng } from '../engine/rng'
import type { BuildingId, Country, GoodId, TradeFlow, WorldState } from '../types'

// ============================================================================
// Plan 0015 §S4 — the three new works (chemicalWorks / powerPlants /
// locomotiveWorks) and the three new goods (chemicals / electricity /
// locomotives). Acceptance per the plan's S4「验收」list and ADR 0031 §6.
// ============================================================================

const NEW_BUILDINGS: BuildingId[] = ['chemicalWorks', 'powerPlants', 'locomotiveWorks']

// FAMILY_BANDS.heavyIndustry (tests/economy-recipe-calibration.test.ts): the
// family the three new works belong to.
const HEAVY_BAND: [number, number] = [0, 0.36]

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const clone = (country: Country): Country =>
  JSON.parse(JSON.stringify(country)) as Country

const close = (actual: number, expected: number, eps = 1e-9): void => {
  expect(Math.abs(actual - expected), `expected ${expected}, got ${actual}`).toBeLessThan(eps)
}

const basketElasticitySum = (basket: { goods: GoodId[]; elasticity: Record<GoodId, number> }): number => {
  let total = 0
  for (const good of basket.goods) total += basket.elasticity[good] ?? 0
  return total
}

const electricityFlow = (country: Country): TradeFlow => ({
  good: 'electricity',
  from: 'GBR',
  to: country.id,
  quantity: 1e6,
  unitPrice: 1,
  landedPrice: 1,
  tariffPaid: 0,
  exportDuty: 0,
  value: 0,
})

describe('S4 chemicals demand enters the basket only after industry-5 (plan 0015 §S4)', () => {
  test('demand is 0 and chemicals is absent before the shift; present and Σ elasticity === 1 after', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    // Guarantee a positive supernumerary income so the discretionary term is real.
    qing.econ.wages = 5000
    qing.econ.profits = 2000

    const before = consumerBasket(qing)
    expect(before.goods).not.toContain('chemicals')
    close(basketElasticitySum(before), 1)
    expect(inspectEconomy(qing).demand.chemicals).toBe(0)

    qing.tech.unlocked.push('industry-5')

    const after = consumerBasket(qing)
    expect(after.goods).toContain('chemicals')
    expect(after.elasticity.chemicals ?? 0).toBeGreaterThan(0)
    close(basketElasticitySum(after), 1)
    expect(inspectEconomy(qing).demand.chemicals).toBeGreaterThan(0)
  })
})

describe('S4 electricity: non-tradable, and only self-production gives the output bonus (plan 0015 §S4)', () => {
  test('electricity is not tradable; a self-producer gets the bonus, an importer does not', () => {
    expect(TRADABLE_GOODS).not.toContain('electricity')

    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    expect(electricityOutputMultiplier(qing)).toBe(1)
    const baseGrain = inspectEconomy(qing).production.grain

    // A country that owns power plants gets the global multiplier on every output.
    const producer = clone(qing)
    producer.econ.buildings.powerPlants = 10
    producer.econ.buildingTiers.powerPlants = [10]
    expect(electricityOutputMultiplier(producer)).toBeGreaterThan(1)
    close(inspectEconomy(producer).production.grain, baseGrain * 1.2, 1e-6)

    // Electricity that arrives by trade never counts: an importer with no plants
    // gets exactly the baseline output.
    const importer = clone(qing)
    importer.trade.imports = [electricityFlow(importer)]
    expect(electricityOutputMultiplier(importer)).toBe(1)
    close(inspectEconomy(importer).production.grain, baseGrain, 1e-9)
  })
})

describe('S4 per-tier coefficients: infrastructure supply and naval-base training (plan 0015 §S4)', () => {
  test('III-tier infrastructure supplies more than II, which supplies more than I', () => {
    const world = newWorld(9100, 'QING')
    const base = countryOf(world, 'QING')
    const coefficient = INFRA_SUPPLY.infrastructure ?? 0
    const supply = (tiers: number[]): number => {
      const country = clone(base)
      country.econ.buildings.infrastructure = 10
      country.econ.buildingTiers.infrastructure = tiers
      return infrastructureSupply(country)
    }
    const tierI = supply([10])
    const tierII = supply([0, 10])
    const tierIII = supply([0, 0, 10])
    close(tierI, 10 * coefficient)
    close(tierII, tierI * 1.3)
    close(tierIII, tierI * 1.6)
    expect(tierIII).toBeGreaterThan(tierII)
    expect(tierII).toBeGreaterThan(tierI)
    // A mixed distribution blends the multiplier by seat share.
    close(supply([5, 5]), 10 * coefficient * 1.15)
  })

  test('naval-base training rate scales II > I and III > II, seat-weighted', () => {
    const world = newWorld(9100, 'QING')
    const base = countryOf(world, 'QING')
    const rate = (tiers: number[]): number => {
      const country = clone(base)
      country.econ.buildings.navalBases = 10
      country.econ.buildingTiers.navalBases = tiers
      return tierWeightedMultiplier(country, 'navalBases', SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER)
    }
    close(rate([10]), 1)
    close(rate([0, 10]), 1.25)
    close(rate([0, 0, 10]), 1.5)
    expect(rate([0, 0, 10])).toBeGreaterThan(rate([0, 10]))
    expect(rate([0, 10])).toBeGreaterThan(rate([10]))
  })

  test('end to end: a tier-III base commissions more hulls than a tier-II, which beats tier-I', () => {
    const gained = (tiers: number[]): number => {
      const world = newWorld(71, 'QING')
      const qing = countryOf(world, 'QING')
      qing.econ.buildings.navalYards = 200
      qing.econ.buildingTiers.navalYards = [200]
      qing.econ.buildings.navalBases = 10
      qing.econ.buildingTiers.navalBases = tiers
      qing.military.navy = 0
      advance(world, 1, [], makeRngForWorld(world))
      return qing.military.navy
    }
    expect(gained([0, 0, 10])).toBeGreaterThan(gained([0, 10]))
    expect(gained([0, 10])).toBeGreaterThan(gained([10]))
  })
})

describe('S4 new buildings are gated across every build path (plan 0015 §S4 / ADR 0031 §9.2)', () => {
  test('player / AI list / private-investment seam reject pre-unlock and accept post-unlock', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 100000

    for (const id of NEW_BUILDINGS) {
      expect(isBuildingUnlocked(qing, id), `${id} pre-unlock`).toBe(false)
      // `buildableBuildingIds` is the shared seam the AI list (actions/random.ts)
      // and the private-investment candidate filter (investment.ts) both use.
      expect(buildableBuildingIds(qing)).not.toContain(id)
      const result = applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: id, count: 1 } },
        makeRngForWorld(world),
      )
      expect(result.ok, `player build ${id} pre-unlock`).toBe(false)
      expect(result.text).toContain('解锁')
    }

    // The deterministic AI fallback never returns a locked work.
    const rng: Rng = {
      next: () => 0,
      int: () => 0,
      range: (min: number) => min,
      chance: (probability: number) => probability === 0.45,
      pick: <T>(items: readonly T[]): T => items[items.length - 1] as T,
    }
    const decision = randomDecision(world, qing, rng)
    expect(decision?.action).toBe('build')
    if (decision !== undefined) {
      const chosen = String(decision.params.building) as BuildingId
      expect(isBuildingUnlocked(qing, chosen), `AI chose locked ${chosen}`).toBe(true)
      expect(applyDecision(world, decision, makeRngForWorld(world)).ok).toBe(true)
    }

    // Unlocking the source nodes admits them to every path.
    qing.tech.unlocked.push('industry-5', 'industry-4')
    for (const id of NEW_BUILDINGS) {
      expect(isBuildingUnlocked(qing, id), `${id} post-unlock`).toBe(true)
      expect(buildableBuildingIds(qing)).toContain(id)
      const result = applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: id, count: 1 } },
        makeRngForWorld(world),
      )
      expect(result.ok, `player build ${id} post-unlock`).toBe(true)
    }
  })
})

describe('S4 new-building tier-I gross margin on a post-unlock steady fixture (review M13)', () => {
  // Fixture: the source nodes are unlocked, each work holds tier-I seats, and
  // prices are the reference (base) vector — the same basis appendix B uses for
  // its check values. Gross margin = (revenue − input cost) / revenue, the
  // quantity "output:input ratios" set. It must sit in the heavy-industry band.
  const grossMargin = (id: BuildingId): number => {
    const recipe = recipeAt(id, 0)
    let revenue = 0
    let inputCost = 0
    for (const [good, quantity] of Object.entries(recipe.output)) {
      revenue += (quantity ?? 0) * GOODS[good as GoodId].basePrice
    }
    for (const [good, quantity] of Object.entries(recipe.input)) {
      inputCost += (quantity ?? 0) * GOODS[good as GoodId].basePrice
    }
    return (revenue - inputCost) / revenue
  }

  test('each new work keeps its base-price gross margin inside the heavy-industry band', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.tech.unlocked.push('industry-5', 'industry-4')
    for (const id of NEW_BUILDINGS) {
      expect(isBuildingUnlocked(qing, id), `${id} unlocked in fixture`).toBe(true)
      qing.econ.buildings[id] = 10
      qing.econ.buildingTiers[id] = [10]
      expect(qing.econ.buildingTiers[id], `${id} tier-I only`).toEqual([10])

      const margin = grossMargin(id)
      expect(margin, `${id} gross margin`).toBeGreaterThanOrEqual(HEAVY_BAND[0])
      expect(margin, `${id} gross margin`).toBeLessThanOrEqual(HEAVY_BAND[1])
    }
  })
})
