import { describe, expect, test } from 'claude-code/testing'
import type { Country } from '../types'
import { BUILDING_IDS, BUILDING_RECIPES, deriveLabor, deriveUnemployment, makeRngForWorld, unemploymentBreakdown } from '../engine/data'
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

  test('(workshops) a workshop site hires labour like any other building (PT-048)', async () => {
    const world = newWorld(304, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    pinAllFull(qing)
    const before = deriveLabor(qing).demand
    qing.econ.buildings.workshops += 5
    const gained = deriveLabor(qing).demand - before
    expect(Math.abs(gained - 5 * BUILDING_RECIPES.workshops.labor)).toBeLessThan(1e-9)
    expect(gained).toBeGreaterThan(0)
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

// PT-047: the old line printed raw utilisation as "缺口 points" and subtracted
// it from unemployment, so a material 18% printed "结构性部分约 0" — nonsense.
// These tests lock the real decomposition and the corrected display.
describe('unemployment decomposition (PT-047)', () => {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value))

  test('(breakdown) components reconstruct the curve and the clamped target', async () => {
    const world = newWorld(305, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    advance(world, 6, [], makeRngForWorld(world))
    const u = unemploymentBreakdown(qing)
    const curve = clamp(u.base + u.industry + u.radicals + u.literacy, 0, 30)
    expect(Math.abs(u.curve - curve)).toBeLessThan(1e-9)
    expect(Math.abs(u.rawTarget - clamp(curve + u.laborPenalty, 0, 30))).toBeLessThan(1e-9)
    // deriveUnemployment reads the same breakdown, so model and display cannot drift.
    expect(Math.abs(deriveUnemployment(qing) - u.curve)).toBeLessThan(1e-9)
  })

  test('(breakdown) tracks radicals and literacy terms, not just the industry term', async () => {
    const world = newWorld(307, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    const before = unemploymentBreakdown(gbr)
    gbr.pops.radicals += 10
    gbr.pops.literacy = Math.min(1, gbr.pops.literacy + 0.2)
    const after = unemploymentBreakdown(gbr)
    expect(Math.abs(after.radicals - before.radicals - 1.5)).toBeLessThan(1e-9)
    expect(Math.abs(after.literacy - before.literacy + 2)).toBeLessThan(1e-9)
    expect(Math.abs(deriveUnemployment(gbr) - after.curve)).toBeLessThan(1e-9)
  })

  test('(inspect) the labor section states raw ratio as a share, not gap points', async () => {
    const world = newWorld(306, 'QING')
    advance(world, 8, [], makeRngForWorld(world))
    const text = inspectWorld(world, 'labor')
    // The contradiction is gone: no "structural part ≈ 0" and no "gap points".
    expect(text).not.toContain('结构性部分')
    expect(text).not.toContain('对应缺口')
    expect(text).toContain('原始需求占比')
    expect(text).toContain('非失业缺口')
    // The real driver (components + smoothed stock) is now surfaced.
    expect(text).toContain('本月目标')
    expect(text).toContain('平滑存量')
    expect(text).toContain('工业吸纳不足')
    expect(text).toContain('劳动力利用率罚项')
  })
})
