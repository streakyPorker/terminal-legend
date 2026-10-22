import type { Country, GameDate, GoodId, WorldState } from '../../types'
import { GOODS, GOOD_IDS, type RecipeIO } from '../data'
import { effectiveSupply } from '../trade'

/** Optional filters, currently only used by the `log` section. */
export type InspectOptions = {
  /** `log`: only entries of this log kind (e.g. `war`, `tech`, `economy`). */
  kind?: string
  /** `log`: only entries whose `countryId` matches this id. */
  country?: string
  /** `log`: how many trailing entries to return (default 20, clamped 1..100). */
  limit?: number
}

export const n = (value: number, digits = 1): string => {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  return `${rounded}`
}

export const signed = (value: number, digits = 1): string =>
  `${value >= 0 ? '+' : ''}${n(value, digits)}`

export const pct = (value: number, digits = 1): string => `${n(value * 100, digits)}%`

export const monthsBefore = (date: GameDate, months: number): GameDate => {
  const index = date.year * 12 + (date.month - 1) - months
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export const fmtDate = (date: GameDate): string =>
  `${date.year}.${String(date.month).padStart(2, '0')}`

export const warFor = (world: WorldState, id: string): boolean =>
  world.wars.some(war => war.attackers.includes(id) || war.defenders.includes(id))

export const warBetween = (world: WorldState, a: string, b: string): boolean =>
  world.wars.some(
    war =>
      (war.attackers.includes(a) && war.defenders.includes(b)) ||
      (war.defenders.includes(a) && war.attackers.includes(b)),
  )

/** `粮食 0.3、木材 0.04` — a recipe basket, or `无` when empty. */
export const basket = (io: RecipeIO): string => {
  const parts = GOOD_IDS.filter(id => (io[id] ?? 0) !== 0).map(
    id => `${GOODS[id].name} ${n(io[id] ?? 0, 3)}`,
  )
  return parts.length === 0 ? '无' : parts.join('、')
}

/**
 * This month's cleared import/export quantities per good, read from
 * `Country.trade` (the settlement snapshot written by `recordTrade`). Display
 * only — never mutates. PT-040: the market section needs imports/exports to
 * explain why a good priced at its benchmark can still read as "short".
 */
export function tradeFlows(country: Country): {
  imports: Record<GoodId, number>
  exports: Record<GoodId, number>
} {
  const imports = {} as Record<GoodId, number>
  const exports = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) {
    imports[id] = 0
    exports[id] = 0
  }
  for (const flow of country.trade.imports) imports[flow.good] += flow.quantity
  for (const flow of country.trade.exports) exports[flow.good] += flow.quantity
  return { imports, exports }
}

/**
 * Effective supply for display: domestic output + imports − exports (plan
 * 0004 §2.1). The price engine already prices on this, so the market section
 * must judge "short/surplus" on it too (PT-040).
 */
export function effectiveSupplyFor(
  production: Record<GoodId, number>,
  country: Country,
): Record<GoodId, number> {
  const flows = tradeFlows(country)
  return effectiveSupply(production, flows.imports, flows.exports)
}
