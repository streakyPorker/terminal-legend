import type { Bureaucracy, BuildingId, Country, GoodId, Resources } from '../../types'
import { applyModifiers } from '../modifiers'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_RECIPES,
  INDUSTRIAL_BUILDING_IDS,
  INFRA_BUILDING_IDS,
  INFRA_MULT_FLOOR,
  INFRA_SUPPLY,
  INFRA_UPKEEP,
} from './buildings'
import { RESOURCE_IDS, RESOURCE_MAP } from './goods'
import { UNEMPLOYMENT_LABOR_PENALTY, UNEMPLOYMENT_MAX, UNEMPLOYMENT_MIN } from '../config/society'

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export type InfrastructureStats = {
  supply: number
  demand: number
  ratio: number
  multiplier: number
  level: number
}

/** Σ provider buildings × supply coefficient, over the `INFRA_BUILDING_IDS` seam. */
export function infrastructureSupply(country: Country): number {
  let supply = 0
  for (const id of INFRA_BUILDING_IDS) {
    const coefficient = INFRA_SUPPLY[id]
    if (coefficient === undefined) continue
    supply += (country.econ.buildings[id] ?? 0) * coefficient
  }
  return supply
}

/**
 * Total infrastructure buildings in a country (plan 0014). The port-derived
 * flows (tariff income, import/route capacity, prestige) read this instead of
 * the deleted `ports` count, over the same `INFRA_BUILDING_IDS` seam.
 */
export function infrastructureCount(country: Country): number {
  let total = 0
  for (const id of INFRA_BUILDING_IDS) total += country.econ.buildings[id] ?? 0
  return total
}

/** Σ all buildings × `infrastructureNeed`. */
export function infrastructureDemand(country: Country): number {
  let demand = 0
  for (const id of BUILDING_IDS) {
    demand += (country.econ.buildings[id] ?? 0) * BUILDINGS[id].infrastructureNeed
  }
  return demand
}

export function infrastructureStats(country: Country): InfrastructureStats {
  const supply = infrastructureSupply(country)
  const demand = infrastructureDemand(country)
  const ratio = demand > 0 ? supply / demand : 1
  return {
    supply,
    demand,
    ratio,
    multiplier: ratio >= 1 ? 1 : clampValue(ratio, INFRA_MULT_FLOOR, 1),
    level: clampValue(100 * ratio, 0, 100),
  }
}

/** Production multiplier read from the *stored* level (one-month lag, ADR 0022). */
export function infrastructureMultiplier(level: number): number {
  const bounded = clampValue(level, 0, 100)
  return bounded >= 100 ? 1 : clampValue(bounded / 100, INFRA_MULT_FLOOR, 1)
}

/** Writes the derived unified level back onto the country (month end / completion). */
export function refreshInfrastructure(country: Country): void {
  country.econ.transportInfrastructure = infrastructureStats(country).level
}

/** Goods the infrastructure network consumes this month. */
export function infrastructureUpkeep(country: Country): Partial<Record<GoodId, number>> {
  const { supply, level } = infrastructureStats(country)
  const out: Partial<Record<GoodId, number>> = {}
  for (const [good, perSupply] of Object.entries(INFRA_UPKEEP.throughput) as [
    GoodId,
    number,
  ][]) {
    out[good] = (out[good] ?? 0) + supply * perSupply
  }
  for (const [good, perLevel] of Object.entries(INFRA_UPKEEP.admin) as [GoodId, number][]) {
    out[good] = (out[good] ?? 0) + (level / 100) * perLevel
  }
  return out
}

/** Total industrial buildings in a country (the F3 successor to `factories`). */
export function industrialBuildingCount(country: Country): number {
  let total = 0
  for (const id of INDUSTRIAL_BUILDING_IDS) total += country.econ.buildings[id] ?? 0
  return total
}

const GOVERNMENT_BUREAUCRACY_BONUS: Record<string, number> = {
  专制君主制: -5,
  君主立宪制: 8,
  共和制: 10,
  民主制: 12,
  寡头制: -2,
}

const GOVERNMENT_CEILING_BONUS: Record<string, number> = {
  专制君主制: 10,
  君主立宪制: 20,
  共和制: 25,
  民主制: 30,
  寡头制: 12,
  神权制: 15,
}

export function administrativeCapacityFor(
  literacy: number,
  bureaucracySpending: number,
): number {
  return clampValue(20 + literacy * 40 + bureaucracySpending * 2, 0, 100)
}

/**
 * Bureaucratic effectiveness and the four constraints it feeds. With
 * `smooth` the score moves 15% toward its target (monthly); without it the
 * score snaps to the target (new worlds and migration).
 */
export function deriveBureaucracy(country: Country, smooth: boolean): Bureaucracy {
  const type = country.government.type
  const administrativeCapacity = applyModifiers(
    country,
    'administrativeCapacity',
    country.econ.administrativeCapacity,
  )
  const raw =
    0.30 * (country.econ.spending.bureaucracy * 10) +
    0.28 * (country.pops.literacy * 100) +
    0.18 * administrativeCapacity +
    0.14 * (GOVERNMENT_BUREAUCRACY_BONUS[type] ?? 0) +
    0.10 * (100 - country.pops.radicals)
  const ceiling = clampValue(
    applyModifiers(
      country,
      'bureaucracyCeiling',
      20 + country.econ.buildings.offices * 3 + (GOVERNMENT_CEILING_BONUS[type] ?? 0),
    ),
    20,
    100,
  )
  const target = clampValue(applyModifiers(country, 'bureaucracy', raw), 0, ceiling)
  const previous = country.bureaucracy?.score ?? target
  const score = smooth ? previous + (target - previous) * 0.15 : target
  return {
    score,
    ceiling,
    actionBudget: clampValue(1 + Math.floor(score / 25), 1, 5),
    fundEfficiency: clampValue(0.5 + score / 200, 0.5, 1),
    delayChance: clampValue(0.35 - score / 300, 0, 0.35),
    infoDistortion: clampValue(0.30 - score / 350, 0, 0.30),
  }
}

/**
 * Industry that absorbs labour for the unemployment curve. Workshops are not
 * factories (they produce construction points, not goods), so they stay out of
 * `INDUSTRIAL_BUILDING_IDS`; but a building site does employ people, so count
 * them here as a construction-sector absorber (PT-048).
 */
export function unemploymentIndustryCount(country: Country): number {
  return industrialBuildingCount(country) + (country.econ.buildings.workshops ?? 0)
}

/** Unemployment follows industry, literacy and unrest (plan §7.4). */
/**
 * The unemployment model's components, exposed so `v3_inspect labor` can show
 * *why* the target sits where it does instead of guessing (PT-047). All terms
 * are the raw addends of the curve; `curve` and `rawTarget` are the two clamps
 * the model applies, in order.
 */
export type UnemploymentBreakdown = {
  /** Flat floor of the curve. */
  base: number
  /** Industry failing to absorb the population: `(1 − industryCount/(popFactor·3))·30`. */
  industry: number
  /** Unrest push: `radicals · 0.15`. */
  radicals: number
  /** Literacy pull, always ≤ 0: `−literacy · 10`. */
  literacy: number
  /** Low labour-utilisation penalty added after the curve clamp (plan 0003 §0.1). */
  laborPenalty: number
  /** `clamp(base + industry + radicals + literacy, 0, 30)` — exactly `deriveUnemployment`. */
  curve: number
  /** The month's target before modifiers: `clamp(curve + laborPenalty, 0, 30)`. */
  rawTarget: number
}

/**
 * Decompose the unemployment target into its additive terms. This is the single
 * source of the curve: `deriveUnemployment` reads `.curve` from here, so the
 * displayed decomposition and the settlement can never drift (PT-047).
 */
export function unemploymentBreakdown(country: Country): UnemploymentBreakdown {
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  const base = 4
  const industry =
    (1 - unemploymentIndustryCount(country) / Math.max(1, popFactor * 3)) * 30
  const radicals = country.pops.radicals * 0.15
  const literacy = -country.pops.literacy * 10
  const curve = clampValue(base + industry + radicals + literacy, 0, 30)
  const laborPenalty = (1 - country.econ.laborUtilization) * UNEMPLOYMENT_LABOR_PENALTY
  const rawTarget = clampValue(curve + laborPenalty, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
  return { base, industry, radicals, literacy, laborPenalty, curve, rawTarget }
}

export function deriveUnemployment(country: Country): number {
  return unemploymentBreakdown(country).curve
}

export type LaborStats = {
  /** Ten-thousands of workers the building stock wants, weighted by utilisation. */
  demand: number
  /** Ten-thousands of available workers. */
  force: number
  /** Share of the population inside the counted labour pool (0.35..0.85). */
  participation: number
  /** Raw demand/force ratio; can be far below 0.5 in agrarian economies. */
  raw: number
  /** 0.5..1, plan 0003 §0.1's stability floor. */
  utilization: number
}

/**
 * Share of the population that belongs to the **counted** labour pool.
 *
 * Farms are the reservoir: subsistence peasants sit outside the counted pool
 * until agriculture and literacy improve enough to release them. Their
 * productivity is proxied by the tech era (tech gates farm output), and
 * literacy is the other release valve. This is the design core — the pool only
 * grows with progress, and every building the player raises draws from it, so
 * industry has to exist to match the people who join.
 */
export function laborParticipation(country: Country): number {
  const literacy = country.pops.literacy
  const era = country.tech.era
  return clampValue(0.58 + literacy * 0.25 + (era - 1) * 0.02, 0.35, 0.85)
}

/**
 * Last month's stored operating rate for a building type (ADR 0022). Labour
 * demand reads this, so an idle/loss-making sector sheds workers with the same
 * one-month lag the production gate uses. A missing or corrupt value falls back
 * to full utilisation. Mirrors `storedUtilization` in `engine/economy.ts`.
 */
function storedUtilization(country: Country, id: BuildingId): number {
  const value = country.econ.buildingProfits?.[id]?.utilization
  return Number.isFinite(value) ? clampValue(value, 0, 1) : 1
}

/**
 * Labour demand from the building stock and the available labour force (0007
 * E8). Each type contributes `labor × count × utilization`, where `utilization`
 * is *last month's* stored operating rate — the same field and lag the
 * production gate reads (ADR 0022). Profit therefore reaches employment: an
 * idle or losing sector releases labour, giving unemployment a sectoral source.
 * With every type at full utilisation this collapses to the pre-E8
 * `Σ(labor × count)`. Utilisation is clamped at 0.5 so an agrarian economy with
 * a vast peasantry does not read as 95% idle; the floor is the plan's bound.
 */
export function deriveLabor(country: Country): LaborStats {
  const b = country.econ.buildings
  let demand = 0
  for (const id of BUILDING_IDS) {
    demand += BUILDING_RECIPES[id].labor * (b[id] ?? 0) * storedUtilization(country, id)
  }
  const participation = laborParticipation(country)
  const force = country.pops.total * participation
  const raw = demand / Math.max(1, force)
  const utilization = clampValue(raw, 0.5, 1)
  return { demand, force, participation, raw, utilization }
}

/**
 * Static resource multiplier for one good: endowments map through
 * `RESOURCE_MAP`, each point of endowment moves the good ±0.3 and the final
 * multiplier is clamped to 0.7..1.3 (plan 0003 §5).
 */
export function resourceMultiplier(
  endowment: Resources,
  good: GoodId,
): number {
  let factor = 0
  for (const id of RESOURCE_IDS) {
    const weight = RESOURCE_MAP[id].goods[good]
    if (weight === undefined) continue
    factor += weight * ((endowment[id] - 50) / 50) * 0.3
  }
  return clampValue(1 + factor, 0.7, 1.3)
}

/**
 * Effective building count after scale diminishing returns. Capacity grows as
 * count^0.98, so a large stock yields slightly less per building.
 */
export function effectiveCount(count: number): number {
  return count <= 0 ? 0 : count ** 0.98
}
