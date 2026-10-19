import { describe, expect, test } from 'claude-code/testing'
import { deriveBureaucracy } from '../engine/data'
import { advance, newWorld } from '../engine/sim'
import { migrateWorld } from '../engine/save'
import { makeRngForWorld } from '../engine/data'
import type { Country, WorldState } from '../types'

// ---------------------------------------------------------------- M1

describe('M1 types, data and migration', () => {
  test('a new world is version 2 with split infrastructure and bureaucracy', async () => {
    const world = newWorld(1, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    expect(world.version).toBe(2)
    expect(world.ironman).toBe(false)
    expect(world.secretary.delegation).toEqual({
      internal: false,
      diplomacy: false,
      months: 1,
    })
    expect(qing.econ.transportInfrastructure).toBe(25)
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

  test('a v1 save migrates to a playable v2 world', async () => {
    const fresh = newWorld(4, 'AUS')
    const v1 = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown> & {
      countries: Record<string, Country & { econ: Record<string, unknown> }>
    }
    v1.version = 1
    delete v1.secretary
    delete v1.ironman
    for (const country of Object.values(v1.countries)) {
      const econ = country.econ
      econ.infrastructure = econ.transportInfrastructure
      delete econ.transportInfrastructure
      delete econ.administrativeCapacity
      delete econ.constructionQueue
      delete (country as Record<string, unknown>).bureaucracy
      delete (country.econ.buildings as Record<string, unknown>).offices
    }

    const migrated = migrateWorld(v1) as WorldState
    expect(migrated).toBeDefined()
    expect(migrated.version).toBe(2)
    expect(migrated.ironman).toBe(false)
    expect(migrated.secretary.delegation.months).toBe(1)

    const aus = migrated.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    expect('infrastructure' in aus.econ).toBe(false)
    expect(aus.econ.transportInfrastructure).toBe(45)
    expect(aus.econ.administrativeCapacity).toBe(
      20 + aus.pops.literacy * 40 + aus.econ.spending.bureaucracy * 2,
    )
    expect(aus.econ.buildings.offices).toBe(0)
    expect(aus.econ.constructionQueue).toEqual([])
    expect(aus.bureaucracy.ceiling).toBeGreaterThanOrEqual(20)
    expect(Number.isFinite(aus.econ.unemployment)).toBe(true)

    advance(migrated, 2, [], makeRngForWorld(migrated))
    expect(migrated.date).toEqual({ year: 1836, month: 3 })
    expect(Number.isFinite(migrated.countries.AUS?.econ.gdp ?? NaN)).toBe(true)
  })

  test('a corrupt save is rejected', async () => {
    expect(migrateWorld({})).toBeUndefined()
    expect(migrateWorld('nope')).toBeUndefined()
    expect(migrateWorld({ version: 9, tick: 0, date: {}, countries: {} })).toBeUndefined()
  })
})
