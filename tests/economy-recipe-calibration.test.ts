import { describe, expect, test } from 'claude-code/testing'
import { ARTISAN_OUTPUT, BUILDING_IDS, GOODS, makeRngForWorld } from '../engine/data'
import { advance, computeEconomy, inspectEconomy, newWorld } from '../engine/sim'
import type { GoodId, WorldState } from '../types'

// Plan 0008 B5 (plan §5) calibration gates. Baseline: seed 9100, 84 months,
// no player/AI decisions, matching the other baseline suites.
const BASELINE_SEED = 9100
const MONTHS = 84

// "Major nations" per plan §5's gate list (QING is the player and is checked
// separately through the export/opium gates).
const MAJORS = ['GBR', 'FRA', 'PRU', 'RUS', 'AUS', 'USA', 'JAP'] as const

// Building types that actually produce a good. Railroads/ports/workshops have
// no tradeable output (infrastructure / construction points), so they are
// expected to show no operating profit and are excluded from the "no permanently
// unprofitable type" gate.
const PRODUCTION_BUILDINGS = [
  'farms',
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
  'barracks',
  'universities',
  'offices',
] as const

// Plan 0011 F3: the seven single/few-output industrial buildings replacing the
// bundled `factories`. Aggregated for the reference-point margin gate.
const INDUSTRIAL_BUILDINGS = [
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
] as const

const GOOD_IDS_ALL = Object.keys(GOODS) as GoodId[]

// Goods the plan requires to trade on both sides at least once per 12 months.
const TWO_SIDED_GOODS: GoodId[] = ['grain', 'wood', 'coal', 'iron', 'fabric', 'machinery', 'steel']

// Consumer goods the plan allows to be either two-sided or "intentionally
// local" (plan §5 / PT-002). B5 picks local: artisans supply them everywhere, so
// real two-sided trade would require strangling the handicraft sector, which
// collapses agrarian real income and starves the opium-crisis gates.
const LOCAL_CONSUMER_GOODS: GoodId[] = ['clothes', 'liquor', 'furniture']

type GlobalMarket = Record<GoodId, { bid: number; offer: number }>

function globalMarket(world: WorldState): GlobalMarket {
  const out = {} as GlobalMarket
  for (const id of GOOD_IDS_ALL) out[id] = { bid: 0, offer: 0 }
  for (const country of Object.values(world.countries)) {
    const market = inspectEconomy(country)
    for (const id of GOOD_IDS_ALL) {
      const surplus = (market.production[id] ?? 0) - (market.demand[id] ?? 0)
      if (surplus > 1e-9) out[id].offer += surplus
      else if (surplus < -1e-9) out[id].bid += -surplus
    }
  }
  return out
}

const rngFor = (world: WorldState) => makeRngForWorld(world)

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

describe('B5 recipe calibration gates (plan 0008 §5)', () => {
  test('no country pins any good at the 0.25×/4× base bound for more than 3 months', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    const streak: Record<string, number> = {}
    const offenders: string[] = []
    for (let month = 1; month <= MONTHS; month += 1) {
      advance(world, 1, [], rngFor(world))
      for (const country of Object.values(world.countries)) {
        for (const id of GOOD_IDS_ALL) {
          const base = GOODS[id].basePrice
          const price = country.econ.prices[id]
          const atBound = price <= base * 0.25 * 1.001 || price >= base * 4 * 0.999
          const key = `${country.id}:${id}`
          streak[key] = atBound ? (streak[key] ?? 0) + 1 : 0
          if (streak[key] > 3 && !offenders.includes(key)) offenders.push(key)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('grain/wood/coal/iron/fabric/machinery are two-sided at least once every 12 months', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    const windows = Math.ceil(MONTHS / 12)
    const perWindow: Record<string, number[]> = {}
    for (const id of TWO_SIDED_GOODS) perWindow[id] = new Array(windows).fill(0)
    for (let month = 1; month <= MONTHS; month += 1) {
      advance(world, 1, [], rngFor(world))
      const market = globalMarket(world)
      const bucket = Math.floor((month - 1) / 12)
      for (const id of TWO_SIDED_GOODS) {
        if (market[id].bid > 1e-9 && market[id].offer > 1e-9) perWindow[id][bucket] += 1
      }
    }
    for (const id of TWO_SIDED_GOODS) {
      for (let bucket = 0; bucket < windows; bucket += 1) {
        expect(perWindow[id][bucket]).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test('every major has a profitable production building at start and at month 24', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    const atStart: Record<string, string[]> = {}
    const atMonth24: Record<string, string[]> = {}
    for (let month = 1; month <= 24; month += 1) {
      advance(world, 1, [], rngFor(world))
      const won = (countryId: string): string[] => {
        const country = countryOf(world, countryId)
        return PRODUCTION_BUILDINGS.filter(id => country.econ.buildingProfits[id].profit > 0)
      }
      if (month === 1) for (const id of MAJORS) atStart[id] = won(id)
      if (month === 24) for (const id of MAJORS) atMonth24[id] = won(id)
    }
    for (const id of MAJORS) {
      expect(atStart[id].length).toBeGreaterThanOrEqual(1)
      expect(atMonth24[id].length).toBeGreaterThanOrEqual(1)
    }
  })

  test('no production building type is permanently unprofitable for every country', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    const everProfitable: Record<string, boolean> = {}
    for (const id of PRODUCTION_BUILDINGS) everProfitable[id] = false
    for (let month = 1; month <= 24; month += 1) {
      advance(world, 1, [], rngFor(world))
      for (const country of Object.values(world.countries)) {
        for (const id of PRODUCTION_BUILDINGS) {
          if (country.econ.buildingProfits[id].profit > 0) everProfitable[id] = true
        }
      }
    }
    for (const id of PRODUCTION_BUILDINGS) expect(everProfitable[id]).toBe(true)
  })

  test('industrial margin lands in the 5–20% band at the reference operating point', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    const aggregate = (): { profit: number; revenue: number; perCountry: Record<string, number> } => {
      let profit = 0
      let revenue = 0
      const perCountry: Record<string, number> = {}
      for (const id of MAJORS) {
        let countryProfit = 0
        let countryRevenue = 0
        for (const building of INDUSTRIAL_BUILDINGS) {
          const row = countryOf(world, id).econ.buildingProfits[building]
          countryProfit += row.profit
          countryRevenue += row.revenue
        }
        profit += countryProfit
        revenue += countryRevenue
        perCountry[id] = countryRevenue > 0 ? countryProfit / countryRevenue : 0
      }
      return { profit, revenue, perCountry }
    }

    let sample24: ReturnType<typeof aggregate> | undefined
    let sample84: ReturnType<typeof aggregate> | undefined
    for (let month = 1; month <= MONTHS; month += 1) {
      advance(world, 1, [], rngFor(world))
      if (month === 24) sample24 = aggregate()
      if (month === MONTHS) sample84 = aggregate()
    }
    // The reference point is the production-weighted aggregate across the major
    // nations (plan §5 lets the reference be "the seed average"): the industrial
    // buildings that actually exist, where they exist. Individual countries
    // spread wider — the resource-rich, low-wage economies (RUS/JAP/QING) run
    // above the band, which is expected — but the aggregate, and the industrial
    // core's stock, must sit in the meaningful 5–20% band. Each must at least be
    // profitable.
    expect(sample24).toBeDefined()
    expect(sample84).toBeDefined()
    if (sample24 === undefined || sample84 === undefined) return
    for (const sample of [sample24, sample84]) {
      const margin = sample.profit / sample.revenue
      expect(margin).toBeGreaterThanOrEqual(0.05)
      expect(margin).toBeLessThanOrEqual(0.2)
      for (const id of MAJORS) expect(sample.perCountry[id]).toBeGreaterThan(0)
    }
    // The industrial core that PT-002/B3 was about must itself clear the band.
    for (const id of ['GBR', 'FRA', 'PRU'] as const) {
      expect(sample24.perCountry[id]).toBeGreaterThanOrEqual(0.05)
      expect(sample24.perCountry[id]).toBeLessThanOrEqual(0.2)
    }
  })

  test('consumer goods are documented as intentionally local (artisan self-supply)', async () => {
    // Plan §5's other allowed resolution for PT-002. Assert the documentation is
    // real: every country supplies these goods from its own artisans.
    for (const id of LOCAL_CONSUMER_GOODS) expect(ARTISAN_OUTPUT[id] ?? 0).toBeGreaterThan(0)
    const world = newWorld(BASELINE_SEED, 'QING')
    for (let month = 1; month <= 12; month += 1) advance(world, 1, [], rngFor(world))
    for (const country of Object.values(world.countries)) {
      for (const id of LOCAL_CONSUMER_GOODS) {
        expect(inspectEconomy(country).production[id] ?? 0).toBeGreaterThan(0)
      }
    }
  })

  test('QING exports at least 5 gold/month by month 12 (E1 goal)', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    for (let month = 1; month <= 12; month += 1) advance(world, 1, [], rngFor(world))
    expect(countryOf(world, 'QING').trade.exportValue).toBeGreaterThanOrEqual(5)
  })

  test('wages + profits close on real GDP, and C + I + G + NX equals GDP exactly', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    for (let month = 1; month <= MONTHS; month += 1) {
      advance(world, 1, [], rngFor(world))
      for (const country of Object.values(world.countries)) {
        const snap = computeEconomy(country)
        const components = country.econ.gdpComponents
        expect(Math.abs(components.c + components.i + components.g + components.nx - country.econ.gdp)).toBeLessThan(1e-6)
        expect(Math.abs(snap.wages + snap.profits - snap.realGdp)).toBeLessThan(1e-6)
        const ratio = (snap.wages + snap.profits) / snap.realGdp
        expect(ratio).toBeGreaterThanOrEqual(0.5)
        expect(ratio).toBeLessThanOrEqual(1.5)
      }
    }
  })

  test('every production building type still reconciles its wage split to the national bill', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    advance(world, 1, [], rngFor(world))
    for (const id of MAJORS) {
      const country = countryOf(world, id)
      const snap = computeEconomy(country)
      let sumWages = 0
      for (const building of BUILDING_IDS) sumWages += snap.buildingProfits[building].wages
      expect(Math.abs(sumWages - snap.wages)).toBeLessThan(1e-6)
    }
  })
})
