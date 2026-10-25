import { describe, expect, test } from 'claude-code/testing'
import { deriveBureaucracy, makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'
import { parseWorld } from '../engine/save'

// Split out of `first-slice.test.ts` (plan 0012 S6): the types / data / save
// migration half of the M1 slice.

// ---------------------------------------------------------------- M1

describe('M1 types, data and migration', () => {
  test('a new world is current-version with split infrastructure and bureaucracy', async () => {
    const world = newWorld(1, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    expect(world.version).toBe(14)
    expect(world.ironman).toBe(false)
    expect(world.secretary.delegation).toEqual({
      internal: false,
      diplomacy: false,
      months: 1,
    })
    // Plan 0014: the field is still the DERIVED unified infrastructure level
    // (clamp(100 × supply/demand, 0, 100)). QING's folded seed supply (17.28,
    // from 8 infrastructure buildings) exceeds its demand (15.44), so it starts
    // at full level.
    expect(qing.econ.transportInfrastructure).toBe(100)
    expect(qing.econ.administrativeCapacity).toBe(20 + 0.12 * 40 + 4 * 2)
    expect(qing.econ.buildings.offices).toBe(4)
    expect(qing.econ.constructionQueue).toEqual([])
    expect('infrastructure' in qing.econ).toBe(false)
    expect(qing.bureaucracy.score).toBeGreaterThanOrEqual(0)
    expect(qing.bureaucracy.ceiling).toBeGreaterThanOrEqual(20)
    expect(qing.bureaucracy.actionBudget).toBeGreaterThanOrEqual(1)
  })

  test('bureaucracy follows spending, literacy, capacity and offices', async () => {
    const world = newWorld(2, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    gbr.government.type = '专制君主制'
    gbr.pops.literacy = 0
    gbr.pops.radicals = 100
    gbr.econ.spending.bureaucracy = 0
    gbr.econ.administrativeCapacity = 0
    gbr.econ.buildings.offices = 0

    const bare = deriveBureaucracy(gbr, false)
    expect(bare.score).toBe(0)
    expect(bare.ceiling).toBe(30)
    expect(bare.actionBudget).toBe(1)
    expect(bare.fundEfficiency).toBe(0.5)
    expect(bare.delayChance).toBe(0.35)
    expect(bare.infoDistortion).toBe(0.3)

    gbr.econ.buildings.offices = 4
    gbr.econ.administrativeCapacity = 40
    const staffed = deriveBureaucracy(gbr, false)
    expect(staffed.ceiling).toBe(42)
    expect(staffed.score).toBeGreaterThan(bare.score)
    expect(staffed.fundEfficiency).toBeGreaterThan(bare.fundEfficiency)
  })

  test('a monthly advance smooths bureaucracy toward its target', async () => {
    const world = newWorld(3, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const before = fra.bureaucracy.score
    advance(world, 1, [], makeRngForWorld(world))
    expect(Number.isFinite(fra.bureaucracy.score)).toBe(true)
    expect(fra.bureaucracy.score).not.toBe(before)
  })

  test('only the current save shape loads', async () => {
    const fresh = newWorld(4, 'AUS')
    expect(parseWorld(JSON.parse(JSON.stringify(fresh)))).toBeDefined()

    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>
    old.version = 1
    expect(parseWorld(old)).toBeUndefined()
    old.version = 2
    expect(parseWorld(old)).toBeUndefined()
  })

  test('a corrupt save is rejected', async () => {
    expect(parseWorld({})).toBeUndefined()
    expect(parseWorld('nope')).toBeUndefined()
    expect(parseWorld({ version: 14, tick: 0, date: {}, countries: {} })).toBeUndefined()
  })
})
