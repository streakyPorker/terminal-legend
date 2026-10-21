import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld, resourceMultiplier } from '../engine/data'
import { advance, clone, computeEconomy, newWorld } from '../engine/sim'
import type { WorldState } from '../types'

// Split out of `economic-loop.test.ts` (plan 0012 S6): resource endowments and
// the 0.7..1.3 multiplier band.

const qingOf = (world: WorldState) => world.countries.QING

describe('E3 resource endowments', () => {
  test('resource multipliers follow endowments and stay in 0.7..1.3', async () => {
    const world = newWorld(109, 'QING')
    const qing = qingOf(world)
    const japan = world.countries.JAP
    const prussia = world.countries.PRU
    expect(qing).toBeDefined()
    expect(japan).toBeDefined()
    expect(prussia).toBeDefined()
    if (qing === undefined || japan === undefined || prussia === undefined) return

    expect(resourceMultiplier(prussia.econ.resources, 'coal')).toBeGreaterThan(1.15)
    expect(resourceMultiplier(japan.econ.resources, 'coal')).toBeLessThan(0.9)
    for (const country of [qing, japan, prussia]) {
      for (const id of ['grain', 'wood', 'coal', 'iron', 'clothes'] as const) {
        const value = resourceMultiplier(country.econ.resources, id)
        expect(value).toBeGreaterThanOrEqual(0.7)
        expect(value).toBeLessThanOrEqual(1.3)
      }
    }
  })

  test('identical countries with different coal endowments diverge', async () => {
    const rich = newWorld(110, 'PRU')
    const poor = clone(rich)
    const richCountry = rich.countries.PRU
    const poorCountry = poor.countries.PRU
    expect(richCountry).toBeDefined()
    expect(poorCountry).toBeDefined()
    if (richCountry === undefined || poorCountry === undefined) return
    richCountry.econ.resources.coal = 100
    poorCountry.econ.resources.coal = 20
    for (const country of [richCountry, poorCountry]) {
      country.econ.prices.coal = 4
      country.econ.buildings.coalMines = 40
    }
    const richBefore = computeEconomy(richCountry).production.coal
    const poorBefore = computeEconomy(poorCountry).production.coal
    expect(richBefore).toBeGreaterThan(poorBefore * 1.4)

    advance(rich, 24, [], makeRngForWorld(rich))
    advance(poor, 24, [], makeRngForWorld(poor))
    expect(richCountry.econ.goods.coal).toBeGreaterThan(poorCountry.econ.goods.coal)
  })
})
