import type { Country, GoodId, ResourceId, Resources } from '../types'
import { RESOURCE_IMPORT_BONUS_MAX, RESOURCE_IMPORT_BONUS_SCALE } from './config/trade'

/**
 * Resource-endowment readings, extracted to a leaf so the block engine's read
 * path (`engine/scale.ts`) can compute the C7 industrial gate without importing
 * `engine/trade.ts` (which would close a module-init cycle back into `data`).
 * `engine/trade.ts` re-exports these, so `from './trade'` is unchanged.
 */

/** Which resource each imported good feeds; farmland has no imported good. */
export const RESOURCE_IMPORT_GOOD: Record<ResourceId, GoodId | undefined> = {
  farmland: undefined,
  timber: 'wood',
  coal: 'coal',
  iron: 'iron',
}

/**
 * Effective endowment bonus from imports (plan §2.6): the import share of
 * available supply, scaled and capped at +15 points. Derived only — it never
 * writes back into `econ.resources`.
 */
export function resourceImportBonus(imports: number, domesticProduction: number): number {
  const share = imports / Math.max(1, domesticProduction + imports)
  return Math.min(RESOURCE_IMPORT_BONUS_MAX, Math.max(0, share * RESOURCE_IMPORT_BONUS_SCALE))
}

/** Effective endowments after last month's imports; the base array is untouched. */
export function effectiveResources(country: Country): Resources {
  const out: Resources = { ...country.econ.resources }
  for (const [resource, good] of Object.entries(RESOURCE_IMPORT_GOOD) as [
    ResourceId,
    GoodId | undefined,
  ][]) {
    if (good === undefined) continue
    const bonus = resourceImportBonus(
      country.econ.resourceImports[resource] ?? 0,
      country.econ.goods[good] ?? 0,
    )
    out[resource] = Math.min(100, Math.max(0, out[resource] + bonus))
  }
  return out
}
