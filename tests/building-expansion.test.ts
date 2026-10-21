import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  BUILDING_TIME,
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

// Plan 0011 F4: five new buildings that complete the 22-type roster.
// schools  = primary education (services output + literacy on completion)
// canals   = infrastructure provider (transitional transport side effect; F5 supply)
// telegraphs = infrastructure provider (transitional transport side effect; F5 supply)
// forts    = military (small arms output)
// navalYards = military (small machinery output)
const NEW_BUILDINGS: BuildingId[] = ['schools', 'canals', 'telegraphs', 'forts', 'navalYards']

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

describe('F4 building expansion: schools / canals / telegraphs / forts / navalYards', () => {
  test('the five ids live in every BuildingId table', () => {
    expect(BUILDING_IDS.length).toBe(22)
    const tables: Record<string, Record<string, unknown>> = {
      BUILDINGS: BUILDINGS as unknown as Record<string, unknown>,
      BUILDING_RECIPES: BUILDING_RECIPES as unknown as Record<string, unknown>,
      BUILDING_TIME: BUILDING_TIME as unknown as Record<string, unknown>,
      BUILDING_OUTPUT: BUILDING_OUTPUT as unknown as Record<string, unknown>,
      INVESTMENT_DEMAND: INVESTMENT_DEMAND as unknown as Record<string, unknown>,
      CAPACITY_COST: CAPACITY_COST as unknown as Record<string, unknown>,
      BUILDING_COST_MULTIPLIER: BUILDING_COST_MULTIPLIER as unknown as Record<string, unknown>,
      BUILDING_COST_ADDEND: BUILDING_COST_ADDEND as unknown as Record<string, unknown>,
    }
    for (const [name, table] of Object.entries(tables)) {
      for (const id of NEW_BUILDINGS) {
        expect(table[id], `${name} is missing ${id}`).toBeDefined()
      }
    }
  })

  test('metadata (name / cost / time / capacity) matches the plan table', () => {
    expect(BUILDINGS.schools.name).toBe('学校')
    expect(BUILDINGS.canals.name).toBe('运河')
    expect(BUILDINGS.telegraphs.name).toBe('电报')
    expect(BUILDINGS.forts.name).toBe('要塞')
    expect(BUILDINGS.navalYards.name).toBe('船坞')

    expect(BUILDINGS.schools.cost).toBe(2)
    expect(BUILDINGS.canals.cost).toBe(6)
    expect(BUILDINGS.telegraphs.cost).toBe(4)
    expect(BUILDINGS.forts.cost).toBe(4)
    expect(BUILDINGS.navalYards.cost).toBe(5)

    expect(BUILDING_TIME.schools).toBe(3)
    expect(BUILDING_TIME.canals).toBe(6)
    expect(BUILDING_TIME.telegraphs).toBe(2)
    expect(BUILDING_TIME.forts).toBe(4)
    expect(BUILDING_TIME.navalYards).toBe(5)

    expect(CAPACITY_COST.schools).toBe(1)
    expect(CAPACITY_COST.canals).toBe(3)
    expect(CAPACITY_COST.telegraphs).toBe(1.5)
    expect(CAPACITY_COST.forts).toBe(2)
    expect(CAPACITY_COST.navalYards).toBe(2.5)
  })

  test('recipes: schools supply services, canals/telegraphs are no-output cost centres, forts/navalYards are small military producers', () => {
    // schools — the one new service producer, market-access gated like farms.
    expect(BUILDING_RECIPES.schools.output).toEqual({ services: 0.1 })
    expect(BUILDING_RECIPES.schools.gates?.access).toBe(true)

    // canals / telegraphs — no goods output (infrastructure cost centres).
    expect(Object.keys(BUILDING_RECIPES.canals.output)).toEqual([])
    expect(Object.keys(BUILDING_RECIPES.telegraphs.output)).toEqual([])
    // …they still consume construction inputs.
    expect(Object.keys(BUILDING_RECIPES.canals.input).length).toBeGreaterThan(0)
    expect(Object.keys(BUILDING_RECIPES.telegraphs.input).length).toBeGreaterThan(0)

    // forts / navalYards — small military output.
    expect(BUILDING_RECIPES.forts.output).toEqual({ arms: 0.03 })
    expect(BUILDING_RECIPES.navalYards.output).toEqual({ machinery: 0.1 })
    expect(BUILDING_RECIPES.forts.gates?.tech).toBe(true)
    expect(BUILDING_RECIPES.forts.gates?.industrial).toBe(true)
    expect(BUILDING_RECIPES.navalYards.gates?.tech).toBe(true)
    expect(BUILDING_RECIPES.navalYards.gates?.industrial).toBe(true)
  })

  test('new buildings are public/military works: empty private-investment signal', () => {
    for (const id of NEW_BUILDINGS) {
      expect(Object.keys(BUILDING_OUTPUT[id]).length, `${id} output signal`).toBe(0)
    }
  })

  test('completion side effects apply (schools literacy; canals/telegraphs supply + market access)', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')

    const literacyBefore = qing.pops.literacy
    completeBuilding(qing, 'schools', 5)
    close(qing.pops.literacy, literacyBefore + 5 * 0.002)

    // Plan 0011 F5: canals/telegraphs no longer bump a transport scalar; they
    // supply the unified infrastructure pool, while keeping their market access.
    const accessBefore = qing.econ.marketAccess
    const supplyBefore = infrastructureSupply(qing)
    completeBuilding(qing, 'canals', 3)
    close(qing.econ.marketAccess, accessBefore + 3 * 0.01)
    close(infrastructureSupply(qing), supplyBefore + 3 * (INFRA_SUPPLY.canals ?? 0))

    const access2 = qing.econ.marketAccess
    completeBuilding(qing, 'telegraphs', 4)
    close(qing.econ.marketAccess, access2 + 4 * 0.005)
    close(
      infrastructureSupply(qing),
      supplyBefore + 3 * (INFRA_SUPPLY.canals ?? 0) + 4 * (INFRA_SUPPLY.telegraphs ?? 0),
    )

    // Counts advanced too.
    expect(qing.econ.buildings.schools).toBe(5)
    expect(qing.econ.buildings.canals).toBe(3)
    expect(qing.econ.buildings.telegraphs).toBe(4)
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

  test('the build action accepts all five new types', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    for (const id of NEW_BUILDINGS) {
      const result = applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: id, count: 1 } },
        makeRngForWorld(world),
      )
      expect(result.ok, `build ${id}`).toBe(true)
    }
    const stateSlots = qing.econ.constructionQueue.filter(one => one.owner === 'state')
    expect(stateSlots.map(slot => slot.building).sort()).toEqual([...NEW_BUILDINGS].sort())
  })

  test('the world stays at version 11', () => {
    const world = newWorld(9100, 'QING')
    expect(world.version).toBe(11)
  })
})
