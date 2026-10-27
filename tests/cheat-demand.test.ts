import { describe, expect, test } from 'claude-code/testing'
import { applyCheat } from '../engine/cheat'
import { inspectEconomy } from '../engine/economy'
import { POP_FACTOR_DIVISOR, POP_FACTOR_MIN } from '../engine/config/economy'
import { newWorld } from '../engine/sim'

const countryOf = (world: ReturnType<typeof newWorld>, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

/**
 * PT-097: the GM needs a lever on one good's demand — for a single power (a
 * boycott, a fashion) or for the whole world. Demand is `popFactor × per-capita
 * base`, so the absolute knob is per popFactor and scales with population; the
 * percentage knob scales that good's whole demand.
 */
describe('v3_cheat demand (PT-097)', () => {
  test('the absolute knob is per popFactor, so it scales with population', () => {
    const world = newWorld(9701, 'QING')
    const qing = countryOf(world, 'QING')
    const before = inspectEconomy(qing).demand.luxury
    expect(applyCheat(world, { action: 'demand', good: 'luxury', amount: 0.5, country: 'QING' }).ok).toBe(true)
    const after = inspectEconomy(qing).demand.luxury
    const popFactor = Math.max(POP_FACTOR_MIN, qing.pops.total / POP_FACTOR_DIVISOR)
    expect(after - before).toBeGreaterThan(0)
    // The lift tracks population, not a flat number of units.
    expect(Math.abs(after - before - popFactor * 0.5)).toBeLessThan(1e-3)
  })

  test('the percentage knob scales that good only, world-wide when unscoped', () => {
    const world = newWorld(9702, 'QING')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingBefore = inspectEconomy(qing).demand.luxury
    const grainBefore = inspectEconomy(qing).demand.grain
    expect(applyCheat(world, { action: 'demand', good: 'luxury', value: 50 }).ok).toBe(true)
    expect(inspectEconomy(qing).demand.luxury).toBeGreaterThan(qingBefore)
    // Another good in the same country is untouched.
    expect(Math.abs(inspectEconomy(qing).demand.grain - grainBefore)).toBeLessThan(1e-9)
    // Unscoped applies to every power.
    expect(inspectEconomy(gbr).demand.luxury).toBeGreaterThan(0)
  })

  test('both knobs may be set together, 0 clears each, unknown input is refused', () => {
    const world = newWorld(9703, 'QING')
    const qing = countryOf(world, 'QING')
    const before = inspectEconomy(qing).demand.grain
    expect(
      applyCheat(world, { action: 'demand', good: 'grain', amount: 0.2, value: 25, country: 'QING' })
        .ok,
    ).toBe(true)
    expect(inspectEconomy(qing).demand.grain).toBeGreaterThan(before)
    expect(
      applyCheat(world, { action: 'demand', good: 'grain', amount: 0, value: 0, country: 'QING' }).ok,
    ).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.grain - before)).toBeLessThan(1e-6)

    expect(applyCheat(world, { action: 'demand', good: 'nonsense', amount: 1 }).ok).toBe(false)
    expect(applyCheat(world, { action: 'demand', good: 'grain' }).ok).toBe(false)
  })
})
