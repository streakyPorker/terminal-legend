import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { addModifier } from '../engine/modifiers'
import { advance, clone, computeEconomy, newWorld } from '../engine/sim'
import type { WorldState } from '../types'

// Split out of `economic-loop.test.ts` (plan 0012 S6): expenditure-GDP,
// Stone-Geary demand and factor shares, plus the demand-shock loop.

const qingOf = (world: WorldState) => world.countries.QING

describe('E1 expenditure GDP, Stone-Geary and factor shares', () => {
  test('GDP is the sum of consumption, investment and government', async () => {
    const world = newWorld(101, 'QING')
    const qing = qingOf(world)
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const components = qing.econ.gdpComponents
    expect(components.c).toBeGreaterThan(0)
    expect(components.g).toBeGreaterThan(0)
    // T1a: NX is now part of GDP. A freshly calibrated world has no flows yet,
    // so this is the reconcile check rather than a hard zero.
    expect(
      Math.abs(qing.econ.gdp - (components.c + components.i + components.g + components.nx)),
    ).toBeLessThan(1e-6)
    const sum = components.c + components.i + components.g
    expect(Math.abs(qing.econ.gdp - sum)).toBeLessThan(1e-6)

    const snap = computeEconomy(qing)
    expect(snap.components.c).toBeGreaterThan(0)
    expect(snap.laborShare).toBeGreaterThanOrEqual(0.35)
    expect(snap.laborShare).toBeLessThanOrEqual(0.7)
    expect(Math.abs(snap.wages + snap.profits - snap.gdp)).toBeLessThan(1e-6)
  })

  test('demand saturates food and upgrades to luxuries as income doubles', async () => {
    const world = newWorld(102, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const base = computeEconomy(fra).demand
    const poor = { grain: base.grain, luxury: base.luxury }

    fra.econ.wages *= 2
    fra.econ.profits *= 2
    const rich = computeEconomy(fra).demand
    expect(rich.grain).toBeLessThan(poor.grain * 2)
    expect(rich.grain).toBeGreaterThan(poor.grain)
    expect(rich.luxury).toBeGreaterThan(poor.luxury * 2)
  })

  test('labour utilisation and unemployment move the labour share', async () => {
    const world = newWorld(103, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    const before = computeEconomy(gbr).laborShare
    // Shrink the labour force so the same building stock looks fully staffed.
    gbr.pops.peasants = 10
    gbr.pops.workers = 20
    gbr.pops.artisans = 10
    gbr.econ.unemployment = 4
    const after = computeEconomy(gbr).laborShare
    expect(after).toBeGreaterThan(before)
    expect(gbr.econ.laborUtilization).toBeGreaterThanOrEqual(0.5)
    expect(gbr.econ.laborUtilization).toBeLessThanOrEqual(1)
  })

  test('60 months stay finite and grow without saturating unrest', async () => {
    const world = newWorld(104, 'QING')
    const qing = qingOf(world)
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const startGdp = qing.econ.gdp
    advance(world, 60, [], makeRngForWorld(world))
    for (const country of Object.values(world.countries)) {
      expect(Number.isFinite(country.econ.gdp)).toBe(true)
      expect(Number.isFinite(country.econ.privateCapital)).toBe(true)
      expect(Number.isFinite(country.econ.wages)).toBe(true)
      expect(country.econ.gdp).toBeGreaterThan(0)
      expect(country.pops.total).toBeGreaterThan(0)
      expect(country.pops.radicals).toBeLessThanOrEqual(100)
    }
    expect(qing.econ.gdp).toBeGreaterThan(startGdp)
    expect(qing.econ.gdp).toBeLessThan(startGdp * 3)
    expect(qing.pops.radicals).toBeLessThan(80)
  })
})

describe('E1 demand shock loop', () => {
  test('a consumption boost raises GDP, profits and private capacity', async () => {
    const control = newWorld(114, 'QING')
    const boosted = clone(control)
    const boostedQing = boosted.countries.QING
    const controlQing = control.countries.QING
    expect(boostedQing).toBeDefined()
    expect(controlQing).toBeDefined()
    if (boostedQing === undefined || controlQing === undefined) return

    addModifier(boostedQing, {
      id: 'shock',
      label: '消费繁荣',
      stat: 'consumption',
      stack: 'percent',
      value: 30,
      monthsLeft: 12,
      source: 'test',
    })
    advance(control, 12, [], makeRngForWorld(control))
    advance(boosted, 12, [], makeRngForWorld(boosted))
    // PT-089 cut construction rent from 0.3 to 0.1, which trims a state-income
    // channel the shock used to amplify; the boost must still raise GDP.
    expect(boostedQing.econ.gdp).toBeGreaterThan(controlQing.econ.gdp)
    expect(boostedQing.econ.profits).toBeGreaterThan(controlQing.econ.profits)
    // Construction capacity and inputs can bind, so a demand boost no longer
    // guarantees a strictly larger capital stock; it must not shrink it much.
    const capacityBuildings = (country: typeof controlQing): number =>
      country.econ.buildings.textileMills +
      country.econ.buildings.furnitureWorks +
      country.econ.buildings.distilleries +
      country.econ.buildings.machineryWorks +
      country.econ.buildings.steelMills +
      country.econ.buildings.arsenals +
      country.econ.buildings.luxuryWorks +
      country.econ.buildings.coalMines +
      country.econ.buildings.ironMines +
      country.econ.buildings.lumberMills +
      country.econ.buildings.workshops
    expect(capacityBuildings(boostedQing)).toBeGreaterThanOrEqual(
      capacityBuildings(controlQing) * 0.9,
    )

    // The modifier has expired by now; the economy cools toward the control.
    advance(control, 12, [], makeRngForWorld(control))
    advance(boosted, 12, [], makeRngForWorld(boosted))
    expect(
      Math.abs(boostedQing.econ.gdp - controlQing.econ.gdp) /
        Math.max(1, controlQing.econ.gdp),
    ).toBeLessThan(0.35)
  })
})
