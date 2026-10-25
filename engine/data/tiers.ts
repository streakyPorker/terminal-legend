import type { BuildingId, Country, GoodId } from '../../types'
import { BUILDING_RECIPES } from './buildings'
import type { BuildingRecipe, RecipeIO } from './buildings'

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
 * Tier-count-weighted recipe: a drop-in for `BUILDING_RECIPES[id]` (plan 0015
 * §S1). Every tier present in `buildingTiers[id]` contributes its own
 * `recipeAt` basket weighted by that tier's share of the total, and the labor
 * coefficient is blended the same way. `gates`/`outputGates`/`outputModifier`
 * are preserved from tier I, so with only tier I the returned recipe equals the
 * base recipe exactly (`w = 1`, coefficients unchanged) — the behaviour-neutral
 * identity that lets the settlement read through here before any II/III tier
 * exists.
 */
export function mixedRecipe(country: Country, id: BuildingId): BuildingRecipe {
  const counts = country.econ.buildingTiers?.[id] ?? [country.econ.buildings[id] ?? 0]
  const total = counts.reduce((sum, n) => sum + n, 0)
  const base = BUILDING_RECIPES[id]
  if (total <= 0) return base
  const output: RecipeIO = {}
  const input: RecipeIO = {}
  let labor = 0
  for (let tier = 0; tier < counts.length; tier += 1) {
    const count = counts[tier]
    if (count <= 0) continue
    // tier 0 → tier I (the base recipe); tier 1 → tiers[0] (II); tier 2 → tiers[1] (III).
    const recipe = recipeAt(id, tier)
    const weight = count / total
    for (const [good, value] of Object.entries(recipe.output) as [GoodId, number][]) {
      output[good] = (output[good] ?? 0) + value * weight
    }
    for (const [good, value] of Object.entries(recipe.input) as [GoodId, number][]) {
      input[good] = (input[good] ?? 0) + value * weight
    }
    labor += recipe.labor * weight
  }
  return { ...base, output, input, labor }
}

/** Rebuild `buildings[id]` as Σ tiers, preserving `Σ buildingTiers[id] === buildings[id]`. */
const rebuildBuildingCount = (country: Country, id: BuildingId, tiers: readonly number[]): void => {
  country.econ.buildings[id] = tiers.reduce((total, n) => total + n, 0)
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
  rebuildBuildingCount(country, id, tiers)
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
  rebuildBuildingCount(country, id, tiers)
}
