import type { Country, GameDate, GoodId, WarGoal } from '../types'
import { BUILDING_IDS, GOOD_IDS, GOODS, WAR_GOAL_NAMES } from './data'
import { TECH_MULTIPLIER_BLOCK } from './config/blocks/tech'
import { scaleProduct } from './scale'

/**
 * Shared internal helpers for the simulation modules. These are the small,
 * dependency-free primitives that the economy / construction / investment /
 * diplomacy / country / world modules all reach for; keeping them in one place
 * avoids a cycle between the feature modules and keeps the call graph acyclic.
 */

export type Decision = {
  countryId: string
  action: string
  params: Record<string, string | number | boolean | undefined>
  narrative?: string
}

export const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

const sumParts = (parts: Record<string, number>): number =>
  Object.values(parts).reduce((sum, value) => sum + value, 0)

/** The applied share of a raw part after the `income`/`expense` modifier. */
const appliedPart = (raw: number, rawTotal: number, total: number): number =>
  rawTotal > 0 ? raw * (total / rawTotal) : 0

export { sumParts, appliedPart }

/** Numeric parameter with a finite fallback; model output can be a string. */
const num = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A validated GoodId, or undefined; the cast is safe because of the check. */
const asGood = (value: string): GoodId | undefined =>
  (GOOD_IDS as readonly string[]).includes(value) ? (value as GoodId) : undefined

const WAR_GOALS = Object.keys(WAR_GOAL_NAMES) as WarGoal[]

/** An unknown or absent goal falls back to `reparations` (plan §5). */
const asWarGoal = (value: unknown): WarGoal => {
  const id = String(value)
  return (WAR_GOALS as readonly string[]).includes(id) ? (id as WarGoal) : 'reparations'
}

export { num, asGood, asWarGoal }

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function advanceDate(date: GameDate): GameDate {
  const month = date.month === 12 ? 1 : date.month + 1
  const year = date.month === 12 ? date.year + 1 : date.year
  return { year, month }
}

export function dateDistance(a: GameDate, b: GameDate): number {
  return (a.year - b.year) * 12 + (a.month - b.month)
}

const techMultiplier = (country: Country): number =>
  scaleProduct(country, TECH_MULTIPLIER_BLOCK.scales_with)

export { techMultiplier }

/**
 * Additive good/building fields (PT-066): a save written before `ships` /
 * `navalBases` existed has no entry in the per-good maps or the building
 * count record. Fill them in place with neutral values so the running game
 * keeps working — no world-version bump, so a live save is not discarded.
 */
export function ensureGoodsFields(country: Country): void {
  const buildings = country.econ.buildings as Record<string, number>
  for (const id of BUILDING_IDS) {
    if (typeof buildings[id] !== 'number') buildings[id] = 0
  }
  const prices = country.econ.prices as Record<string, number>
  const goods = country.econ.goods as Record<string, number>
  for (const id of GOOD_IDS) {
    if (typeof prices[id] !== 'number' || !Number.isFinite(prices[id])) {
      prices[id] = GOODS[id].basePrice
    }
    if (typeof goods[id] !== 'number' || !Number.isFinite(goods[id])) {
      goods[id] = 0
    }
  }
}

/**
 * Additive v7 fields: a world loaded before the construction sector existed
 * has no `workshops` count or rent field. Fill them once in place so the
 * running game (not just a reloaded save) gets a working construction sector.
 */
export function ensureConstructionFields(country: Country): void {
  const buildings = country.econ.buildings as Record<string, number>
  if (typeof buildings.workshops !== 'number') {
    buildings.workshops = 1
  }
  if (typeof country.econ.lastConstructionRent !== 'number') {
    country.econ.lastConstructionRent = 0
  }
  if (typeof country.econ.lastIncomeOther !== 'number') {
    country.econ.lastIncomeOther = 0
  }
  if (typeof country.econ.lastPrivateStartTick !== 'number') {
    country.econ.lastPrivateStartTick = -999
  }
  if (
    typeof country.econ.lastConstructionDemand !== 'object' ||
    country.econ.lastConstructionDemand === null
  ) {
    country.econ.lastConstructionDemand = {}
  }
}
