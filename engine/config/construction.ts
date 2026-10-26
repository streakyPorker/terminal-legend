import type { BuildingId } from '../../types'

/**
 * Construction config: workshop output, per-slot ceilings, workload/cost
 * dials and the completion side effects (plan 0009 §9 D1). Leaf module
 * (imports only the `BuildingId` type).
 */

/** Construction points one workshop produces per month before input limits. */
export const WORKSHOP_CAPACITY_OUTPUT = 4

/** Construction points a project needs each month, per building in the slot. */
export const CAPACITY_COST: Record<BuildingId, number> = {
  farms: 0.5,
  coalMines: 1,
  ironMines: 1,
  lumberMills: 0.8,
  textileMills: 2,
  furnitureWorks: 1.5,
  distilleries: 1.5,
  machineryWorks: 2.5,
  steelMills: 2.5,
  arsenals: 2,
  luxuryWorks: 2,
  schools: 1,
  infrastructure: 3,
  forts: 2,
  navalYards: 2.5,
  universities: 2,
  barracks: 1,
  offices: 1,
  workshops: 1.5,
  navalBases: 2,
  // Plan 0015 S4: the three new works sit in the heavy-industry band.
  chemicalWorks: 2.5,
  powerPlants: 3,
  locomotiveWorks: 2.5,
}

/** Private builders do this share of a slot's work with their own organisation. */
export const PRIVATE_OWN_CAPACITY_SHARE = 0.5
/** Gold the state charges per rented construction point. */
export const CONSTRUCTION_RENT_PER_POINT = 0.3
/** A slot may hold at most this many buildings. */
export const MAX_BUILDINGS_PER_SLOT = 5
/**
 * Cap on `slots` in one `x*y` build order (PT-078). Each slot becomes its own
 * queue entry so the earlier ones finish and start working while the rest are
 * still building — the aggregation is only a convenience at the tool seam.
 */
export const MAX_BUILD_SLOTS = 50
/** Total workload per unit of monthly point requirement. */
export const WORKLOAD_MULTIPLIER = 30
/**
 * Plan 0015 §S2 / ADR 0031 §5: an UPGRADE (`kind: 'upgrade'`) is a
 * retrofit of existing seats, so it needs this share of the same-tier new-build
 * workload. The ADR caps it at 60%; the frozen rule value is 50%. The unit price
 * is unchanged (still `CONSTRUCTION_COST_PER_POINT`), so an upgrade is cheaper
 * only because it is smaller, never because it is discounted.
 */
export const UPGRADE_WORKLOAD_SHARE = 0.5
/**
 * Plan 0016 §S7 / ADR 0032 §6: the workshops ARE now upgradable. This
 * **Supersedes plan 0015 §S2 / ADR 0031 §5**'s guard — the self-acceleration
 * loop (upgrade workshops → more points → faster upgrades) is intentionally kept
 * as the growth engine, bounded by the advanced-material / non-tradable
 * electricity draw, the per-point cost curve, the five-seat slot cap and the
 * rule that an upgrade's workload never produces construction points. Empty.
 */
export const NON_UPGRADABLE_BUILDINGS: BuildingId[] = []
/** Base gold paid per construction-workload point. */
export const CONSTRUCTION_COST_PER_POINT = 0.2
/**
 * Plan 0016 §S7 / 附录 B: seat-weighted per-tier multiplier on a workshop's
 * construction-point output (index 0 = tier I = 1). Blended by seat share via
 * `tierWeightedMultiplier(country, 'workshops', …)`, so a country on tier-I
 * workshops (and the 1836 baseline, which never leaves tier I) is unchanged.
 */
export const CONSTRUCTION_CAPACITY_TIER_MULTIPLIER: readonly number[] = [1, 1.2, 1.45, 1.75, 2.1]
/**
 * Plan 0016 §S7 / 附录 B: seat-weighted per-tier multiplier on the gold cost per
 * construction point — a higher-grade workshop builds cheaper (tier I = 1).
 */
export const CONSTRUCTION_COST_TIER_MULTIPLIER: readonly number[] = [1, 0.95, 0.9, 0.85, 0.8]
/**
 * Plan 0016 §S1/S7 / 附录 B: per-tier multiplier on a NEW-BUILD's workload
 * (`projectWorkload`). An upgrade is `UPGRADE_WORKLOAD_SHARE × the same-tier
 * new-build workload`, so it inherits this inflation (an upgrade to a higher tier
 * is dearer). Tier I = 1.
 */
export const WORKLOAD_TIER_MULTIPLIER: readonly number[] = [1, 1.3, 1.7, 2.2, 2.8]
/** Per-building gold tuning; v1 is 1 for every type. */
export const BUILDING_COST_MULTIPLIER: Record<BuildingId, number> = {
  farms: 1,
  coalMines: 1,
  ironMines: 1,
  lumberMills: 1,
  textileMills: 1,
  furnitureWorks: 1,
  distilleries: 1,
  machineryWorks: 1,
  steelMills: 1,
  arsenals: 1,
  luxuryWorks: 1,
  schools: 1,
  infrastructure: 1,
  forts: 1,
  navalYards: 1,
  universities: 1,
  barracks: 1,
  offices: 1,
  workshops: 1,
  navalBases: 1,
  // Plan 0015 S4: unit gold multiplier is 1, like every other type.
  chemicalWorks: 1,
  powerPlants: 1,
  locomotiveWorks: 1,
}
/** Per-building fixed gold addend; v1 is 0 for every type. */
export const BUILDING_COST_ADDEND: Record<BuildingId, number> = {
  farms: 0,
  coalMines: 0,
  ironMines: 0,
  lumberMills: 0,
  textileMills: 0,
  furnitureWorks: 0,
  distilleries: 0,
  machineryWorks: 0,
  steelMills: 0,
  arsenals: 0,
  luxuryWorks: 0,
  schools: 0,
  infrastructure: 0,
  forts: 0,
  navalYards: 0,
  universities: 0,
  barracks: 0,
  offices: 0,
  workshops: 0,
  navalBases: 0,
  // Plan 0015 S4: fixed gold addend is 0, like every other type.
  chemicalWorks: 0,
  powerPlants: 0,
  locomotiveWorks: 0,
}

/** Workshop capacity access curve: base + marketAccess × slope (retired gate). */
export const CONSTRUCTION_ACCESS_BASE = 0.55
export const CONSTRUCTION_ACCESS_SLOPE = 0.9
/** Planning-aid horizon for `constructionSchedule`, in months. */
export const CONSTRUCTION_SCHEDULE_MONTHS = 60

/** Completion side effects. */
/**
 * Market access each infrastructure building adds on completion (plan 0014).
 * Keyed by `INFRA_BUILDING_IDS` member so a future re-split stays data-only. The
 * value preserves the pre-merge market-access total over the folded infra stock
 * (old per-building weights: railroad 0.02 / port 0.01 / canal 0.01 / telegraph
 * 0.005).
 */
export const INFRA_MARKET_ACCESS: Partial<Record<BuildingId, number>> = {
  infrastructure: 0.019,
}
export const SCHOOL_LITERACY_GAIN = 0.002
export const UNIVERSITY_ADMIN_CAPACITY = 0.5
export const OFFICE_ADMIN_CAPACITY = 1
/** Ceiling on administrative capacity the completion side effects clamp to. */
export const ADMIN_CAPACITY_MAX = 100
