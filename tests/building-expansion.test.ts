import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  INFRA_BUILDING_IDS,
  INFRA_SUPPLY,
  infrastructureSupply,
  INVESTMENT_DEMAND,
  makeRngForWorld,
} from '../engine/data'
import {
  CAPACITY_COST,
  BUILDING_COST_ADDEND,
  BUILDING_COST_MULTIPLIER,
  completeBuilding,
} from '../engine/construction'
import { applyDecision, newWorld } from '../engine/sim'
import type { BuildingId, Country, WorldState } from '../types'

// Plan 0011 F4 added five buildings; plan 0014 / ADR 0029 then deleted canals and
// merged railroads/ports/telegraphs into the single `infrastructure` building.
// This file now covers the three surviving F4 buildings plus the merge.
//   schools    = primary education (services output + literacy on completion)
//   forts      = military (small arms output)
//   navalYards = military (small machinery output)
//   infrastructure = the merged unified-infrastructure provider (cost centre)
const NEW_BUILDINGS: BuildingId[] = ['schools', 'forts', 'navalYards', 'navalBases']

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

describe('F4 building expansion (schools / forts / navalYards) + plan 0014 merge', () => {
  test('the surviving F4 ids and the merged infrastructure id live in every BuildingId table', () => {
    expect(BUILDING_IDS.length).toBe(23)
    const tables: Record<string, Record<string, unknown>> = {
      BUILDINGS: BUILDINGS as unknown as Record<string, unknown>,
      BUILDING_RECIPES: BUILDING_RECIPES as unknown as Record<string, unknown>,
      BUILDING_OUTPUT: BUILDING_OUTPUT as unknown as Record<string, unknown>,
      INVESTMENT_DEMAND: INVESTMENT_DEMAND as unknown as Record<string, unknown>,
      CAPACITY_COST: CAPACITY_COST as unknown as Record<string, unknown>,
      BUILDING_COST_MULTIPLIER: BUILDING_COST_MULTIPLIER as unknown as Record<string, unknown>,
      BUILDING_COST_ADDEND: BUILDING_COST_ADDEND as unknown as Record<string, unknown>,
    }
    for (const [name, table] of Object.entries(tables)) {
      for (const id of [...NEW_BUILDINGS, ...INFRA_BUILDING_IDS]) {
        expect(table[id], `${name} is missing ${id}`).toBeDefined()
      }
    }
  })

  test('metadata (name / cost / capacity) matches the plan table', () => {
    expect(BUILDINGS.schools.name).toBe('学校')
    expect(BUILDINGS.forts.name).toBe('要塞')
    expect(BUILDINGS.navalYards.name).toBe('船坞')
    expect(BUILDINGS.infrastructure.name).toBe('基础设施')

    expect(BUILDINGS.schools.cost).toBe(2)
    expect(BUILDINGS.forts.cost).toBe(4)
    expect(BUILDINGS.navalYards.cost).toBe(5)
    expect(BUILDINGS.infrastructure.cost).toBe(5)

    expect(CAPACITY_COST.schools).toBe(1)
    expect(CAPACITY_COST.forts).toBe(2)
    expect(CAPACITY_COST.navalYards).toBe(2.5)
    expect(CAPACITY_COST.infrastructure).toBe(3)
  })

  test('recipes: schools supply services, forts/navalYards are small military producers, infrastructure is a no-output cost centre', () => {
    // schools — the one new service producer, market-access gated like farms.
    expect(BUILDING_RECIPES.schools.output).toEqual({ services: 0.1 })
    expect(BUILDING_RECIPES.schools.gates?.access).toBe(true)

    // infrastructure — no goods output (unified-infrastructure cost centre) but
    // it still consumes construction inputs (steel + wood).
    expect(Object.keys(BUILDING_RECIPES.infrastructure.output)).toEqual([])
    expect(Object.keys(BUILDING_RECIPES.infrastructure.input).length).toBeGreaterThan(0)

    // forts / navalYards — military output. PT-066: the yard now lays down
    // hulls (`ships`, a tradeable good) instead of a token amount of machinery.
    expect(BUILDING_RECIPES.forts.output).toEqual({ arms: 0.08 })
    expect(BUILDING_RECIPES.navalYards.output).toEqual({ ships: 0.5, machinery: 0.03 })
    // navalBases — consumes hulls, produces no goods of its own.
    expect(Object.keys(BUILDING_RECIPES.navalBases.output)).toEqual([])
    expect(BUILDING_RECIPES.navalBases.input).toEqual({ ships: 0.5 })
    expect(BUILDING_RECIPES.forts.gates?.tech).toBe(true)
    expect(BUILDING_RECIPES.forts.gates?.industrial).toBe(true)
    expect(BUILDING_RECIPES.navalYards.gates?.tech).toBe(true)
    expect(BUILDING_RECIPES.navalYards.gates?.industrial).toBe(true)
  })

  test('public/military/infrastructure works carry an empty private-investment signal', () => {
    for (const id of [...NEW_BUILDINGS, ...INFRA_BUILDING_IDS]) {
      expect(Object.keys(BUILDING_OUTPUT[id]).length, `${id} output signal`).toBe(0)
    }
  })

  test('completion side effects apply (schools literacy; infrastructure supply + market access)', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')

    const literacyBefore = qing.pops.literacy
    completeBuilding(qing, 'schools', 5)
    close(qing.pops.literacy, literacyBefore + 5 * 0.002)

    // Plan 0014: the merged infrastructure building supplies the unified pool and
    // keeps the providers' market-access side effect (single coefficient table).
    const accessBefore = qing.econ.marketAccess
    const supplyBefore = infrastructureSupply(qing)
    const infraBefore = qing.econ.buildings.infrastructure
    completeBuilding(qing, 'infrastructure', 3)
    close(qing.econ.marketAccess, accessBefore + 3 * 0.019)
    close(infrastructureSupply(qing), supplyBefore + 3 * (INFRA_SUPPLY.infrastructure ?? 0))

    // Counts advanced too.
    expect(qing.econ.buildings.schools).toBe(5)
    expect(qing.econ.buildings.infrastructure).toBe(infraBefore + 3)
  })

  test('forts/navalYards have no completion side effect beyond their output', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    const moraleBefore = qing.military.morale
    const navyBefore = qing.military.navy
    const transportBefore = qing.econ.transportInfrastructure
    completeBuilding(qing, 'forts', 2)
    completeBuilding(qing, 'navalYards', 2)
    // No military-stat or infrastructure side effect was invented for them.
    close(qing.military.morale, moraleBefore)
    close(qing.military.navy, navyBefore)
    close(qing.econ.transportInfrastructure, transportBefore)
    expect(qing.econ.buildings.forts).toBe(2)
    expect(qing.econ.buildings.navalYards).toBe(2)
  })

  test('the build action accepts the surviving types and the merged infrastructure', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    const buildable = [...NEW_BUILDINGS, ...INFRA_BUILDING_IDS]
    for (const id of buildable) {
      const result = applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: id, count: 1 } },
        makeRngForWorld(world),
      )
      expect(result.ok, `build ${id}`).toBe(true)
    }
    const stateSlots = qing.econ.constructionQueue.filter(one => one.owner === 'state')
    expect(stateSlots.map(slot => slot.building).sort()).toEqual([...buildable].sort())
  })

  test('the world carries the merged roster at version 12', () => {
    const world = newWorld(9100, 'QING')
    expect(world.version).toBe(14)
    expect(BUILDING_IDS.length).toBe(23)
    for (const gone of ['railroads', 'ports', 'canals', 'telegraphs']) {
      expect(BUILDING_IDS as string[]).not.toContain(gone)
    }
  })
})
