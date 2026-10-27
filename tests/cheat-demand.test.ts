import { describe, expect, test } from 'claude-code/testing'
import { applyCheat } from '../engine/cheat'
import { inspectEconomy } from '../engine/economy'
import { newWorld } from '../engine/sim'

const countryOf = (world: ReturnType<typeof newWorld>, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

/**
 * PT-097: the GM needs a lever on one good's demand — either for a single power
 * (a boycott, a fashion) or for the whole world (a change in taste).
 */
describe('v3_cheat demand (PT-097)', () => {
  test('a country-scoped level lifts only that country, by the exact amount', () => {
    const world = newWorld(9701, 'QING')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingBefore = inspectEconomy(qing).demand.luxury
    const gbrBefore = inspectEconomy(gbr).demand.luxury

    const result = applyCheat(world, {
      action: 'demand',
      good: 'luxury',
      amount: 120,
      country: 'QING',
    })
    expect(result.ok).toBe(true)

    // A base level is a quantity: demand rises by exactly the amount asked.
    expect(Math.abs(inspectEconomy(qing).demand.luxury - qingBefore - 120)).toBeLessThan(1e-6)
    // The other power is untouched.
    expect(Math.abs(inspectEconomy(gbr).demand.luxury - gbrBefore)).toBeLessThan(1e-9)
  })

  test('omitting country applies the nudge to every power', () => {
    const world = newWorld(9702, 'QING')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingBefore = inspectEconomy(qing).demand.luxury
    const gbrBefore = inspectEconomy(gbr).demand.luxury

    const result = applyCheat(world, { action: 'demand', good: 'luxury', amount: 80 })
    expect(result.ok).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.luxury - qingBefore - 80)).toBeLessThan(1e-6)
    expect(Math.abs(inspectEconomy(gbr).demand.luxury - gbrBefore - 80)).toBeLessThan(1e-6)
  })

  test('a negative level cuts demand, 0 clears it, and an unknown good is refused', () => {
    const world = newWorld(9703, 'QING')
    const qing = countryOf(world, 'QING')
    const before = inspectEconomy(qing).demand.grain

    expect(
      applyCheat(world, { action: 'demand', good: 'grain', amount: -200, country: 'QING' }).ok,
    ).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.grain - (before - 200))).toBeLessThan(1e-6)

    // Setting 0 clears the standing level.
    expect(
      applyCheat(world, { action: 'demand', good: 'grain', amount: 0, country: 'QING' }).ok,
    ).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.grain - before)).toBeLessThan(1e-6)

    const refused = applyCheat(world, { action: 'demand', good: 'nonsense', amount: 10 })
    expect(refused.ok).toBe(false)
  })
})
