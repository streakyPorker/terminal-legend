import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_IDS,
  BUILDING_RECIPES,
  applyBuildingDecay,
  applyBuildingDelta,
  mixedRecipe,
  recipeAt,
} from '../engine/data'
import { newWorld } from '../engine/sim'
import type { BuildingId, Country, WorldState } from '../types'

// ============================================================================
// Plan 0015 §S1 — `recipeAt` accessor and the ONE building-count mutator.
//
// `buildingTiers` is the座数分布; `buildings` is its Σ. Every write path
// (completion / upgrade / decay / mandate) must go through `applyBuildingDelta`
// or `applyBuildingDecay` so `Σ buildingTiers[id] === buildings[id]` never drifts.
// ============================================================================

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

describe('recipeAt: tier → recipe accessor', () => {
  test('tier 0 (and any tier ≤ 0) returns the tier-I BUILDING_RECIPES entry', () => {
    expect(recipeAt('steelMills', 0)).toBe(BUILDING_RECIPES.steelMills)
    expect(recipeAt('steelMills', -1)).toBe(BUILDING_RECIPES.steelMills)
  })

  test('tier 1 / 2 / 3 / 4 return the matching stored tier, for a tiered building', () => {
    expect(recipeAt('steelMills', 1)).toBe(BUILDING_RECIPES.steelMills.tiers?.[0])
    expect(recipeAt('steelMills', 2)).toBe(BUILDING_RECIPES.steelMills.tiers?.[1])
    expect(recipeAt('steelMills', 3)).toBe(BUILDING_RECIPES.steelMills.tiers?.[2])
    expect(recipeAt('steelMills', 4)).toBe(BUILDING_RECIPES.steelMills.tiers?.[3])
  })

  test('an untiered building falls back to tier I at any tier', () => {
    expect(recipeAt('schools', 1)).toBe(BUILDING_RECIPES.schools)
    expect(recipeAt('schools', 3)).toBe(BUILDING_RECIPES.schools)
  })

  test('an out-of-range tier falls back to tier I', () => {
    expect(recipeAt('steelMills', 5)).toBe(BUILDING_RECIPES.steelMills)
  })

  test('S3: farms and the three new works serve their stored II–V tiers', () => {
    for (const id of ['farms', 'chemicalWorks', 'powerPlants', 'locomotiveWorks'] as const) {
      expect(recipeAt(id, 1)).toBe(BUILDING_RECIPES[id].tiers?.[0])
      expect(recipeAt(id, 2)).toBe(BUILDING_RECIPES[id].tiers?.[1])
      expect(recipeAt(id, 4)).toBe(BUILDING_RECIPES[id].tiers?.[3])
    }
  })

  test('S3: mixedRecipe reads tier IV of the new buildings (length-agnostic)', () => {
    const world = newWorld(9204, 'QING')
    const country = countryOf(world, 'QING')
    for (const id of ['farms', 'chemicalWorks', 'powerPlants', 'locomotiveWorks'] as const) {
      country.econ.buildingTiers[id] = [0, 0, 0, 3]
      country.econ.buildings[id] = 3
      const mixed = mixedRecipe(country, id)
      expect(mixed.output, `${id} output`).toEqual(BUILDING_RECIPES[id].tiers?.[2]?.output)
      expect(mixed.input, `${id} input`).toEqual(BUILDING_RECIPES[id].tiers?.[2]?.input)
      expect(mixed.labor, `${id} labor`).toBe(BUILDING_RECIPES[id].tiers?.[2]?.labor)
    }
  })
})

describe('applyBuildingDelta / applyBuildingDecay: Σ tiers ≡ buildings', () => {
  test('delta pads the tier array, floors at 0, and keeps the Σ identity', () => {
    const world = newWorld(9200, 'QING')
    const country = countryOf(world, 'QING')
    const id: BuildingId = 'steelMills'

    // Fresh world: one tier (I) holding the whole count.
    const initial = country.econ.buildings[id]
    expect(country.econ.buildingTiers[id].length).toBe(1)
    expect(country.econ.buildingTiers[id][0]).toBe(initial)

    // Growing at a not-yet-existing tier pads with zeros.
    applyBuildingDelta(country, id, 2, 5)
    expect(country.econ.buildingTiers[id].length).toBe(3)
    expect(country.econ.buildingTiers[id][2]).toBe(5)
    expect(country.econ.buildingTiers[id][1]).toBe(0)
    expect(country.econ.buildingTiers[id][0]).toBe(initial)
    expect(country.econ.buildings[id]).toBe(initial + 5)

    // Shrinking past zero floors at 0 rather than going negative.
    applyBuildingDelta(country, id, 1, -1000)
    expect(country.econ.buildingTiers[id][1]).toBe(0)
    expect(sum(country.econ.buildingTiers[id])).toBe(country.econ.buildings[id])
  })

  test('decay scales every tier (fractions allowed) and keeps the Σ identity', () => {
    const world = newWorld(9201, 'QING')
    const country = countryOf(world, 'QING')
    const id: BuildingId = 'textileMills'

    applyBuildingDelta(country, id, 1, 4)
    const before = [...country.econ.buildingTiers[id]]
    applyBuildingDecay(country, id, 0.5)
    for (let tier = 0; tier < before.length; tier += 1) {
      expect(country.econ.buildingTiers[id][tier]).toBe((before[tier] ?? 0) * 0.5)
    }
    expect(sum(country.econ.buildingTiers[id])).toBe(country.econ.buildings[id])
  })

  test('Σ buildingTiers[id] === buildings[id] holds for every building, after each write', () => {
    const world = newWorld(9202, 'QING')
    const country = countryOf(world, 'QING')

    for (const id of BUILDING_IDS) {
      applyBuildingDelta(country, id, 1, 3)
      expect(sum(country.econ.buildingTiers[id]), `${id} after delta`).toBe(
        country.econ.buildings[id],
      )
      applyBuildingDecay(country, id, 0.5)
      expect(sum(country.econ.buildingTiers[id]), `${id} after decay`).toBe(
        country.econ.buildings[id],
      )
    }
  })

  test('S3: the new tiered buildings accept a delta at tier IV and keep the Σ identity', () => {
    const world = newWorld(9203, 'QING')
    const country = countryOf(world, 'QING')
    for (const id of ['farms', 'chemicalWorks', 'powerPlants', 'locomotiveWorks'] as const) {
      applyBuildingDelta(country, id, 4, 2)
      expect(country.econ.buildingTiers[id].length, `${id} pads to V`).toBe(5)
      expect(country.econ.buildingTiers[id][4], `${id} IV seats`).toBe(2)
      expect(sum(country.econ.buildingTiers[id]), `${id} Σ`).toBe(country.econ.buildings[id])
    }
  })
})
