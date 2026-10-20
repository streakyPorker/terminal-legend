import { describe, expect, test } from 'claude-code/testing'
import { GOOD_IDS, makeRngForWorld } from '../engine/data'
import { advance, inspectEconomy, newWorld } from '../engine/sim'
import type { GoodId, WorldState } from '../types'

const rngFor = (world: WorldState) => makeRngForWorld(world)

type GlobalMarket = Record<GoodId, { bid: number; offer: number }>

/** Aggregates this month's production and demand across every country. */
function globalMarket(world: WorldState): GlobalMarket {
  const out = {} as GlobalMarket
  for (const id of GOOD_IDS) out[id] = { bid: 0, offer: 0 }
  for (const country of Object.values(world.countries)) {
    const market = inspectEconomy(country)
    for (const id of GOOD_IDS) {
      const surplus = (market.production[id] ?? 0) - (market.demand[id] ?? 0)
      if (surplus > 1e-9) out[id].offer += surplus
      else if (surplus < -1e-9) out[id].bid += -surplus
    }
  }
  return out
}

describe('E1 world-trade calibration (plan 0007)', () => {
  test('the 24-month baseline has grain, wood and machinery on both sides of the market', async () => {
    const world = newWorld(9100, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const months = 24
    const bothSides: Record<GoodId, number> = {} as Record<GoodId, number>
    for (const id of GOOD_IDS) bothSides[id] = 0
    let qingExportMonths = 0
    let qingFarmExportMonths = 0

    for (let month = 0; month < months; month += 1) {
      advance(world, 1, [], rngFor(world))
      const market = globalMarket(world)
      for (const id of GOOD_IDS) {
        if (market[id].bid > 1e-9 && market[id].offer > 1e-9) bothSides[id] += 1
      }
      if (qing.trade.exportValue > 1e-9) qingExportMonths += 1
      const farmExports = qing.trade.exports
        .filter(flow => flow.good === 'grain' || flow.good === 'wood')
        .reduce((sum, flow) => sum + flow.value, 0)
      if (farmExports > 1e-9) qingFarmExportMonths += 1
    }

    // The pre-calibration baseline had zero bids for grain and zero offers for
    // machinery. Both sides must now exist for most of the run.
    expect(bothSides.grain).toBeGreaterThanOrEqual(months - 2)
    expect(bothSides.wood).toBeGreaterThanOrEqual(months - 2)
    expect(bothSides.machinery).toBeGreaterThanOrEqual(months - 2)

    // QING must be able to sell something: farm exports are the point of the
    // plan's "export grain and wood" strategy.
    expect(qingExportMonths).toBeGreaterThanOrEqual(months - 2)
    expect(qingFarmExportMonths).toBeGreaterThanOrEqual(months - 2)

    for (const country of Object.values(world.countries)) {
      expect(Number.isFinite(country.econ.gdp)).toBe(true)
      expect(Number.isFinite(country.econ.treasury)).toBe(true)
      expect(Number.isFinite(country.trade.exportValue)).toBe(true)
      expect(Number.isFinite(country.trade.importValue)).toBe(true)
    }
  })
})
