import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_IDS,
  BUILDINGS,
  INFRA_BUILDING_IDS,
  INFRA_MULT_FLOOR,
  INFRA_SUPPLY,
  INFRA_UPKEEP,
  infrastructureDemand,
  infrastructureMultiplier,
  infrastructureStats,
  infrastructureSupply,
  infrastructureUpkeep,
  makeRngForWorld,
  refreshInfrastructure,
} from '../engine/data'
import { completeBuilding } from '../engine/construction'
import { computeProduction } from '../engine/economy'
import { advance, inspectEconomy, newWorld } from '../engine/sim'
import type { BuildingId, Country, WorldState } from '../types'

// Plan 0011 F5 / ADR 0026: ONE unified national infrastructure pool. Plan 0014 /
// ADR 0029 merged railroads/ports/telegraphs into the single `infrastructure`
// building (canals deleted) behind the `INFRA_BUILDING_IDS` seam. Providers
// supply, every building type draws (`infrastructureNeed`), a linear shortfall
// debuff scales all output, and the network consumes materials + services.

const PROVIDER: BuildingId = 'infrastructure'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const clone = (c: Country): Country => JSON.parse(JSON.stringify(c)) as Country

/** A country with every building count zeroed, for controlled supply/demand. */
const blank = (c: Country): Country => {
  const out = clone(c)
  for (const id of BUILDING_IDS) out.econ.buildings[id] = 0
  return out
}

const set = (c: Country, id: BuildingId, count: number): Country => {
  c.econ.buildings[id] = count
  return c
}

const close = (actual: number, expected: number, eps = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

// Pre-merge (World v11) 1836 infrastructure ratios, computed from the same seed
// counts under the four-provider model (railroads 2.5 / ports 1.1 / canals 1.6 /
// telegraphs 0.7 supply; need railroad 0.08 / port 0.12 / canal 0.05 /
// telegraph 0.06). The merge must keep every country within 5% of these.
const PRE_MERGE_RATIO: Record<string, number> = {
  QING: 1.0973,
  GBR: 2.3041,
  FRA: 1.552,
  PRU: 1.1485,
  RUS: 1.1388,
  AUS: 1.1981,
  USA: 1.776,
  JAP: 1.2717,
  OTT: 1.2644,
  SPA: 1.6944,
}

describe('unified infrastructure pool (plan 0011 F5 / plan 0014 merge)', () => {
  test('the INFRA_BUILDING_IDS seam names the sole provider and every infra table covers it', () => {
    expect(INFRA_BUILDING_IDS).toEqual(['infrastructure'])
    for (const id of INFRA_BUILDING_IDS) {
      expect(BUILDING_IDS, `${id} is a real building`).toContain(id)
      expect(INFRA_SUPPLY[id], `${id} supply`).toBeGreaterThan(0)
      expect(BUILDINGS[id].infrastructureNeed, `${id} need`).toBeGreaterThanOrEqual(0)
    }
    // The four pre-merge providers are gone entirely.
    for (const gone of ['railroads', 'ports', 'canals', 'telegraphs']) {
      expect(BUILDING_IDS as string[]).not.toContain(gone)
    }
    expect(BUILDING_IDS.length).toBe(20)
  })

  test('every building type declares an infrastructureNeed', () => {
    for (const id of BUILDING_IDS) {
      expect(Number.isFinite(BUILDINGS[id].infrastructureNeed), `${id}`).toBe(true)
      expect(BUILDINGS[id].infrastructureNeed).toBeGreaterThanOrEqual(0)
    }
    // Heavy industry draws more than light industry, which draws more than farms.
    expect(BUILDINGS.steelMills.infrastructureNeed).toBeGreaterThan(
      BUILDINGS.textileMills.infrastructureNeed,
    )
    expect(BUILDINGS.textileMills.infrastructureNeed).toBeGreaterThan(
      BUILDINGS.farms.infrastructureNeed,
    )
    expect(BUILDINGS.farms.infrastructureNeed).toBe(0)
  })

  test('supply sums each provider building × its coefficient', () => {
    const world = newWorld(9200, 'QING')
    const c = blank(countryOf(world, 'QING'))
    set(c, PROVIDER, 4)
    const expected = 4 * (INFRA_SUPPLY[PROVIDER] ?? 0)
    close(infrastructureSupply(c), expected)
    // A non-provider building adds no supply.
    set(c, 'farms', 500)
    close(infrastructureSupply(c), expected)
  })

  test('demand sums every building type × its need', () => {
    const world = newWorld(9201, 'QING')
    const c = blank(countryOf(world, 'QING'))
    set(c, 'coalMines', 4)
    set(c, 'steelMills', 2)
    set(c, 'farms', 1000) // need 0 → contributes nothing
    const expected =
      4 * BUILDINGS.coalMines.infrastructureNeed + 2 * BUILDINGS.steelMills.infrastructureNeed
    close(infrastructureDemand(c), expected)
  })

  test('ratio and multiplier: surplus never rewards, a shortfall is linear, floored', () => {
    const world = newWorld(9202, 'QING')
    const base = countryOf(world, 'QING')

    // 1 infrastructure building against 40 coal mines, plus its own draw.
    const half = set(set(blank(base), PROVIDER, 1), 'coalMines', 40)
    const supply = 1 * (INFRA_SUPPLY[PROVIDER] ?? 0)
    const demand =
      40 * BUILDINGS.coalMines.infrastructureNeed + 1 * BUILDINGS[PROVIDER].infrastructureNeed
    let stats = infrastructureStats(half)
    close(stats.supply, supply)
    close(stats.demand, demand)
    close(stats.ratio, supply / demand)
    // Below 1, the multiplier is exactly the ratio (linear shortfall).
    close(stats.multiplier, supply / demand)
    close(stats.level, 100 * (supply / demand))

    // No provider at all → ratio 0 → clamped to the floor.
    const starved = set(blank(base), 'coalMines', 40)
    stats = infrastructureStats(starved)
    close(stats.ratio, 0)
    close(stats.multiplier, INFRA_MULT_FLOOR)
    close(stats.level, 0)

    // A large surplus → ratio > 1 → multiplier 1 (only-fail, no reward).
    const rich = set(set(blank(base), PROVIDER, 40), 'coalMines', 40)
    stats = infrastructureStats(rich)
    expect(stats.ratio).toBeGreaterThan(1)
    close(stats.multiplier, 1)
    close(stats.level, 100)

    // No demand at all → ratio 1 by definition (no division by zero).
    const empty = blank(base)
    stats = infrastructureStats(empty)
    close(stats.ratio, 1)
    close(stats.multiplier, 1)
    close(stats.level, 100)
  })

  test('the multiplier reads the stored 0..100 level with a floor', () => {
    close(infrastructureMultiplier(100), 1)
    close(infrastructureMultiplier(150), 1) // above the band, still no reward
    close(infrastructureMultiplier(50), 0.5)
    close(infrastructureMultiplier(20), INFRA_MULT_FLOOR)
    close(infrastructureMultiplier(0), INFRA_MULT_FLOOR)
  })

  test('the shortfall debuff scales every building output (grain: farms only)', () => {
    const world = newWorld(9203, 'FRA')
    const full = clone(countryOf(world, 'FRA'))
    full.econ.transportInfrastructure = 100
    const half = clone(countryOf(world, 'FRA'))
    half.econ.transportInfrastructure = 50
    const floored = clone(countryOf(world, 'FRA'))
    floored.econ.transportInfrastructure = 10

    const base = computeProduction(full).grain
    close(computeProduction(half).grain, base * 0.5, 1e-6)
    // Below the floor the debuff cannot bite harder than 0.35.
    close(computeProduction(floored).grain, base * INFRA_MULT_FLOOR, 1e-6)
  })

  test('infrastructure upkeep consumes throughput materials and administrative services', () => {
    const world = newWorld(9204, 'GBR')
    const c = set(blank(countryOf(world, 'GBR')), PROVIDER, 10)
    const supply = 10 * (INFRA_SUPPLY[PROVIDER] ?? 0)
    const upkeep = infrastructureUpkeep(c)
    close(upkeep.wood ?? 0, supply * (INFRA_UPKEEP.throughput.wood ?? 0))
    close(upkeep.coal ?? 0, supply * (INFRA_UPKEEP.throughput.coal ?? 0))
    close(
      upkeep.services ?? 0,
      supply * (INFRA_UPKEEP.throughput.services ?? 0) + 1 * (INFRA_UPKEEP.admin.services ?? 0),
    )
    // The upkeep is booked as an intermediate demand (services included), so a
    // world with infrastructure demands more wood/coal/services than a blank one.
    const withInfra = inspectEconomy(c).demand
    const withoutInfra = inspectEconomy(blank(c)).demand
    expect(withInfra.wood).toBeGreaterThan(withoutInfra.wood)
    expect(withInfra.coal).toBeGreaterThan(withoutInfra.coal)
    expect(withInfra.services).toBeGreaterThan(withoutInfra.services)
  })

  test('transportInfrastructure is the DERIVED unified level, not an accumulated scalar', () => {
    const world = newWorld(9205, 'QING')
    const qing = countryOf(world, 'QING')
    // At creation the field already equals the model's level.
    close(qing.econ.transportInfrastructure, infrastructureStats(qing).level)
    // The old separate `infrastructure` scalar field never existed and still does not.
    expect('infrastructure' in qing.econ).toBe(false)

    // A low-infrastructure country: completing infrastructure raises supply and
    // the derived level; removing it drops them back (no accumulation).
    const low = blank(qing)
    set(low, 'coalMines', 40) // demand 6, supply 0 → level 0
    refreshInfrastructure(low)
    close(low.econ.transportInfrastructure, 0)
    const supplyBefore = infrastructureSupply(low)
    const levelBefore = low.econ.transportInfrastructure
    completeBuilding(low, PROVIDER, 1)
    close(infrastructureSupply(low), supplyBefore + (INFRA_SUPPLY[PROVIDER] ?? 0))
    expect(low.econ.transportInfrastructure).toBeGreaterThan(levelBefore)
    completeBuilding(low, PROVIDER, -1)
    close(infrastructureSupply(low), supplyBefore)
    close(low.econ.transportInfrastructure, levelBefore)
  })

  test('two same-seed worlds keep identical infrastructure over 60 months', () => {
    const a = newWorld(9210, 'QING')
    const b = newWorld(9210, 'QING')
    for (let month = 0; month < 60; month += 1) {
      advance(a, 1, [], makeRngForWorld(a))
      advance(b, 1, [], makeRngForWorld(b))
    }
    for (const id of Object.keys(a.countries)) {
      close(countryOf(a, id).econ.transportInfrastructure, countryOf(b, id).econ.transportInfrastructure)
    }
  })

  test('the seed baseline does not accidentally debuff the major economies', () => {
    const world = newWorld(9100, 'QING')
    for (const id of ['QING', 'GBR', 'FRA', 'PRU', 'USA']) {
      const stats = infrastructureStats(countryOf(world, id))
      expect(stats.multiplier, `${id} multiplier`).toBe(1)
    }
  })

  test('the 1836 infra ratio stays within 5% of the pre-merge (v11) baseline', () => {
    const world = newWorld(9100, 'QING')
    for (const [id, before] of Object.entries(PRE_MERGE_RATIO)) {
      const after = infrastructureStats(countryOf(world, id)).ratio
      const delta = Math.abs(after - before) / before
      expect(delta, `${id}: ${before} → ${after}`).toBeLessThan(0.05)
    }
  })
})
