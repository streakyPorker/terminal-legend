import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_IDS, BUILDING_RECIPES, applyBuildingDecay, applyBuildingDelta, recipeAt } from '../engine/data'
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
    expect(recipeAt('farms', 1)).toBe(BUILDING_RECIPES.farms)
    expect(recipeAt('farms', 3)).toBe(BUILDING_RECIPES.farms)
  })

  test('an out-of-range tier falls back to tier I', () => {
    expect(recipeAt('steelMills', 5)).toBe(BUILDING_RECIPES.steelMills)
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
})
