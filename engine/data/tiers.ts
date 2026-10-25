import type { BuildingId, Country } from '../../types'
import { BUILDING_RECIPES } from './buildings'
import type { BuildingRecipe } from './buildings'

/**
 * The active recipe for a building at a given tier (plan 0015 §S1).
 *
 * `BUILDING_RECIPES[id]` IS tier I, so `tier <= 0` returns it directly. For
 * `tier ≥ 1` the matching `tiers[tier - 1]` (II = 0, III = 1) is returned; an
 * untiered building — or an out-of-range tier — falls back to tier I. This is
 * the single accessor every consumer reads, so tier-I behaviour is unchanged.
 */
export function recipeAt(id: BuildingId, tier: number): BuildingRecipe {
  const base = BUILDING_RECIPES[id]
  if (tier <= 0) return base
  return base.tiers?.[tier - 1] ?? base
}

/**
 * The ONE mutator for `buildingTiers`/`buildings` (plan 0015 §S1). `buildingTiers`
 * is the per-tier seat distribution and `buildings[id]` is always its Σ, so every
 * write path (completion / upgrade / decay / mandate) goes through here.
 *
 * Pads the tier array to `tier + 1` with zeros, adds `delta` to that tier
 * floored at 0, then rebuilds `buildings[id]` from the sum.
 */
export function applyBuildingDelta(
  country: Country,
  id: BuildingId,
  tier: number,
  delta: number,
): void {
  const tiers = country.econ.buildingTiers[id]
  while (tiers.length <= tier) tiers.push(0)
  tiers[tier] = Math.max(0, (tiers[tier] ?? 0) + delta)
  country.econ.buildings[id] = tiers.reduce((total, n) => total + n, 0)
}

/**
 * Scales EVERY tier of a building by `factor` (fractions allowed — this is the
 * wear/idling path), then rebuilds `buildings[id]` from the sum, so the
 * `Σ buildingTiers[id] === buildings[id]` identity holds after decay too.
 */
export function applyBuildingDecay(country: Country, id: BuildingId, factor: number): void {
  const tiers = country.econ.buildingTiers[id]
  for (let tier = 0; tier < tiers.length; tier += 1) {
    tiers[tier] = (tiers[tier] ?? 0) * factor
  }
  country.econ.buildings[id] = tiers.reduce((total, n) => total + n, 0)
}
