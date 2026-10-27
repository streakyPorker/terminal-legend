import { describe, expect, test } from 'claude-code/testing'
import { applyCheat } from '../engine/cheat'
import { makeRngForWorld } from '../engine/data'
import { advance } from '../engine/sim'
import { inspectEconomy } from '../engine/economy'
import { constructionLoad } from '../engine/sim'
import { POP_FACTOR_DIVISOR, POP_FACTOR_MIN } from '../engine/config/economy'
import { newWorld } from '../engine/sim'

const countryOf = (world: ReturnType<typeof newWorld>, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const popFactorOf = (country: ReturnType<typeof countryOf>): number =>
  Math.max(POP_FACTOR_MIN, country.pops.total / POP_FACTOR_DIVISOR)

/**
 * PT-097: demand reads `(model + popFactor × x + a) × (1 + pct)`. The GM can set
 * any of the three per good, for one power or for the whole world.
 */
describe('v3_cheat constructionEfficiency allocation (PT-113)', () => {
  test('the queue reserves work ÷ efficiency points, not the raw workload', () => {
    const world = newWorld(9740, 'QING')
    const qing = countryOf(world, 'QING')
    const queueOne = () => {
      qing.econ.constructionQueue = [
        {
          id: 'eff-load',
          building: 'infrastructure' as const,
          count: 5,
          owner: 'state' as const,
          monthsLeft: 1,
          monthlyCost: 2,
          lastSpend: 0,
          progress: 0,
          startedAt: { ...world.date },
        },
      ]
    }
    queueOne()
    const plain = constructionLoad(qing).requested
    expect(applyCheat(world, { action: 'constructionEfficiency', value: 2, country: 'QING' }).ok)
      .toBe(true)
    queueOne()
    const fast = constructionLoad(qing).requested
    expect(plain).toBeGreaterThan(0)
    // Twice the yield per point means the same order reserves half the points.
    expect(Math.abs(fast - plain / 2)).toBeLessThan(1e-6)
  })
})

describe('v3_cheat demand (PT-097)', () => {
  test('x scales with population; a is a constant', () => {
    const world = newWorld(9701, 'QING')
    const qing = countryOf(world, 'QING')
    const before = inspectEconomy(qing).demand.luxury
    const popFactor = popFactorOf(qing)

    expect(
      applyCheat(world, { action: 'demand', good: 'luxury', amount: 0.5, flat: 10, country: 'QING' }).ok,
    ).toBe(true)
    const after = inspectEconomy(qing).demand.luxury
    expect(Math.abs(after - before - (popFactor * 0.5 + 10))).toBeLessThan(1e-3)
  })

  test('the percentage knob multiplies the whole sum and can be combined', () => {
    const world = newWorld(9702, 'QING')
    const qing = countryOf(world, 'QING')
    const before = inspectEconomy(qing).demand.luxury
    expect(
      applyCheat(world, { action: 'demand', good: 'luxury', flat: 20, value: 50, country: 'QING' })
        .ok,
    ).toBe(true)
    const after = inspectEconomy(qing).demand.luxury
    expect(Math.abs(after - (before + 20) * 1.5)).toBeLessThan(1e-3)
  })

  test('unscoped applies world-wide and 0 clears each knob', () => {
    const world = newWorld(9703, 'QING')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingBefore = inspectEconomy(qing).demand.grain
    const gbrBefore = inspectEconomy(gbr).demand.grain

    // PT-098: countries carry a national baseline `a`; setting the knob replaces
    // it, so the delta is (25 − previous a).
    const qingOld = qing.econ.demandFlat?.grain ?? 0
    const gbrOld = gbr.econ.demandFlat?.grain ?? 0
    expect(applyCheat(world, { action: 'demand', good: 'grain', flat: 25 }).ok).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.grain - qingBefore - (25 - qingOld))).toBeLessThan(1e-6)
    expect(Math.abs(inspectEconomy(gbr).demand.grain - gbrBefore - (25 - gbrOld))).toBeLessThan(1e-6)

    // Clearing restores the model value (no national baseline for QING grain in
    // this fixture) — so compare against the pre-cheat demand minus the old a.
    expect(applyCheat(world, { action: 'demand', good: 'grain', flat: 0 }).ok).toBe(true)
    expect(Math.abs(inspectEconomy(qing).demand.grain - (qingBefore - qingOld))).toBeLessThan(1e-6)

    expect(applyCheat(world, { action: 'demand', good: 'nonsense', flat: 1 }).ok).toBe(false)
    expect(applyCheat(world, { action: 'demand', good: 'grain' }).ok).toBe(false)
  })
})

describe('v3_cheat legitimacy (PT-100)', () => {
  test('moves the stock directly and clamps at 0..100', () => {
    const world = newWorld(9710, 'QING')
    const qing = countryOf(world, 'QING')
    const before = qing.government.legitimacy
    expect(applyCheat(world, { action: 'legitimacy', amount: 20, country: 'QING' }).ok).toBe(true)
    expect(Math.abs(qing.government.legitimacy - (before + 20))).toBeLessThan(1e-9)
    expect(applyCheat(world, { action: 'legitimacy', amount: 500, country: 'QING' }).ok).toBe(true)
    expect(qing.government.legitimacy).toBe(100)
    expect(applyCheat(world, { action: 'legitimacy', amount: -500, country: 'QING' }).ok).toBe(true)
    expect(qing.government.legitimacy).toBe(0)
  })
})

describe('v3_cheat prices (PT-105)', () => {
  test('raises the targeted country price level against an identical control', () => {
    const control = newWorld(9720, 'QING')
    const cheated = newWorld(9720, 'QING')
    expect(applyCheat(cheated, { action: 'prices', value: 50, country: 'GBR' }).ok).toBe(true)
    expect(countryOf(cheated, 'GBR').econ.priceLevel).toBe(50)
    // Scoped: the player is untouched.
    expect(countryOf(cheated, 'QING').econ.priceLevel).toBeUndefined()

    advance(control, 6, [], makeRngForWorld(control))
    advance(cheated, 6, [], makeRngForWorld(cheated))
    const gbrControl = countryOf(control, 'GBR').econ.prices.luxury
    const gbrCheated = countryOf(cheated, 'GBR').econ.prices.luxury
    // The level shift is standing, so the cheated Britain prices higher.
    expect(gbrCheated).toBeGreaterThan(gbrControl)

    expect(applyCheat(cheated, { action: 'prices', value: 0, country: 'GBR' }).ok).toBe(true)
    expect(countryOf(cheated, 'GBR').econ.priceLevel).toBeUndefined()
  })
})

describe('v3_cheat constructionEfficiency (PT-108)', () => {
  test('the same points buy more work when efficiency is raised', () => {
    const control = newWorld(9730, 'QING')
    const boosted = newWorld(9730, 'QING')
    const project = (world: ReturnType<typeof newWorld>) => ({
      id: 'eff-1',
      building: 'textileMills' as const,
      count: 50,
      owner: 'state' as const,
      monthsLeft: 4,
      monthlyCost: 2,
      lastSpend: 0,
      progress: 0,
      startedAt: { ...world.date },
    })
    const a = countryOf(control, 'QING')
    const b = countryOf(boosted, 'QING')
    for (const [world, country] of [[control, a], [boosted, b]] as const) {
      country.econ.treasury = 1e6
      country.econ.constructionQueue = [project(world)]
    }
    expect(applyCheat(boosted, { action: 'constructionEfficiency', value: 2, country: 'QING' }).ok)
      .toBe(true)

    advance(control, 1, [], makeRngForWorld(control))
    advance(boosted, 1, [], makeRngForWorld(boosted))
    const plain = a.econ.constructionQueue[0]?.progress ?? 1
    const fast = b.econ.constructionQueue[0]?.progress ?? 1
    expect(fast).toBeGreaterThan(plain)
    expect(fast).toBeGreaterThan(plain * 1.5)
  })
})
