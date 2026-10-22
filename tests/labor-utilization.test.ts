import { describe, expect, test } from 'claude-code/testing'
import type { Country } from '../types'
import { BUILDING_IDS, BUILDING_RECIPES, deriveLabor, makeRngForWorld } from '../engine/data'
import { inspectWorld } from '../engine/inspect'
import { advance, newWorld } from '../engine/sim'

// 0007 E8: labour demand is weighted by last month's stored utilisation, so an
// idle/loss-making sector releases labour and unemployment gains a sectoral
// source. These tests pin the invariant (full utilisation reproduces the old
// Σ(labor × count)) and the two new behaviours (halving, idle shedding).

/** The pre-E8 labour demand: `Σ(labor × count)`, no utilisation weight. */
const fullCapacityDemand = (country: Country): number =>
  BUILDING_IDS.reduce(
    (sum, id) => sum + BUILDING_RECIPES[id].labor * (country.econ.buildings[id] ?? 0),
    0,
  )

const pinAllFull = (country: Country): void => {
  for (const id of BUILDING_IDS) country.econ.buildingProfits[id].utilization = 1
}

/** Force the demand/force ratio into the 0.5..1 clamp band so a sector drop moves it. */
const setWorkforceForBand = (country: Country, rawTarget: number): void => {
  const force = fullCapacityDemand(country) / rawTarget
  country.pops.peasants = force / 0.6
  country.pops.workers = 0
  country.pops.artisans = 0
  country.pops.total = country.pops.peasants
}

describe('labour demand × utilisation (0007 E8)', () => {
  test('(invariant) full utilisation reproduces Σ(labor × count) exactly', async () => {
    const world = newWorld(301, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    pinAllFull(qing)
    expect(deriveLabor(qing).demand).toBe(fullCapacityDemand(qing))
  })

  test('(halving) a type at half utilisation contributes half its labour', async () => {
    const world = newWorld(302, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    pinAllFull(gbr)
    const before = deriveLabor(gbr).demand
    const contribution = BUILDING_RECIPES.textileMills.labor * gbr.econ.buildings.textileMills
    gbr.econ.buildingProfits.textileMills.utilization = 0.5
    const after = deriveLabor(gbr).demand
    expect(Math.abs(before - after - contribution * 0.5)).toBeLessThan(1e-9)
  })

  test('(idle) a half-idle sector raises derived unemployment vs full utilisation', async () => {
    const control = newWorld(303, 'GBR')
    const idle = newWorld(303, 'GBR')
    const full = control.countries.GBR
    const half = idle.countries.GBR
    expect(full).toBeDefined()
    expect(half).toBeDefined()
    if (full === undefined || half === undefined) return
    for (const country of [full, half]) setWorkforceForBand(country, 0.8)
    for (let month = 0; month < 3; month += 1) {
      // Re-pin each month: the settlement overwrites buildingProfits at month end,
      // and the demand read happens before that write (one-month lag, ADR 0022).
      setWorkforceForBand(full, 0.8)
      setWorkforceForBand(half, 0.8)
      pinAllFull(full)
      pinAllFull(half)
      half.econ.buildingProfits.textileMills.utilization = 0.5
      advance(control, 1, [], makeRngForWorld(control))
      advance(idle, 1, [], makeRngForWorld(idle))
    }
    expect(half.econ.laborRawUtilization).toBeLessThan(full.econ.laborRawUtilization)
    expect(half.econ.laborDemand).toBeLessThan(full.econ.laborDemand)
    expect(half.econ.unemployment).toBeGreaterThan(full.econ.unemployment)
  })

  test('(inspect) v3_inspect labor surfaces the idle-sector labour release', async () => {
    const world = newWorld(304, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    gbr.econ.buildingProfits.textileMills.utilization = 0.5
    advance(world, 1, [], makeRngForWorld(world))
    const text = inspectWorld(world, 'labor')
    expect(text).toContain('部门来源')
    expect(text).toContain('纺织厂')
    expect(text).toContain('释放劳力')
  })
})
