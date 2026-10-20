import type { Country, GoodId, TradeFlow } from '../types'
import { GOODS, GOOD_IDS, REGION_COST } from './data'

export { REGION_COST }

/** How many candidate exporters one importer may draw on per good (plan §2.2). */
export const TOP_PARTNERS = 6
/** Relations below this cut a partner out of the candidate list (plan §1.2). */
export const RELATION_CUTOFF = -50

/** Services are the one good that never crosses a border (plan §0). */
const NON_TRADABLE: GoodId[] = ['services']

/** Every good except services, in the canonical GOOD_IDS order. */
export const TRADABLE_GOODS: GoodId[] = GOOD_IDS.filter(id => !NON_TRADABLE.includes(id))

/** Domestic production and demand for one country, snapshotted before clearing. */
export type MarketSnapshot = {
  production: Record<GoodId, number>
  demand: Record<GoodId, number>
}

/** The full result of one month's global clearing, keyed by country id. */
export type TradeBalance = {
  flows: TradeFlow[]
  exportQty: Record<string, Record<GoodId, number>>
  importQty: Record<string, Record<GoodId, number>>
  /** Gold at the exporter's unit price, for display (plan §1.3). */
  exportValue: Record<string, number>
  importValue: Record<string, number>
  /** Net exports at base prices, feeding gdpComponents.nx (plan §2.5). */
  nx: Record<string, number>
}

function zeroQuantities(): Record<GoodId, number> {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Relations are read from the importer's perspective (plan §1.2). */
function relationOf(importer: Country, exporterId: string): number {
  return importer.diplo.relations[exporterId] ?? 0
}

/**
 * Landed cost of one good delivered from `from` to `to` (plan §1.2): the
 * exporter's domestic price marked up by the importer's tariff, region
 * transport cost, market access, transport infrastructure and relation risk.
 */
export function landedPrice(from: Country, to: Country, good: GoodId): number {
  const regionCost = REGION_COST[from.region][to.region]
  const accessFactor = 1.15 - to.econ.marketAccess * 0.25
  const transportFactor = 1.2 - to.econ.transportInfrastructure / 500
  const relationRisk = 1 + Math.max(0, -relationOf(to, from.id)) / 200
  return (
    from.econ.prices[good] *
    (1 + to.econ.tariff / 100) *
    regionCost *
    accessFactor *
    transportFactor *
    relationRisk
  )
}

/** Effective supply: domestic output plus imports minus exports (plan §2.1 step 7). */
export function effectiveSupply(
  production: Record<GoodId, number>,
  imports: Record<GoodId, number>,
  exports: Record<GoodId, number>,
): Record<GoodId, number> {
  const out = zeroQuantities()
  for (const id of GOOD_IDS) {
    out[id] = Math.max(0, production[id] + (imports[id] ?? 0) - (exports[id] ?? 0))
  }
  return out
}

type Pair = { importer: Country; exporter: Country; landed: number }

/**
 * Clears one tradable good globally (plan §2.2). Offers are each exporter's
 * surplus, bids each importer's need; every importer sees at most its six
 * cheapest partners; all (importer, exporter) pairs are matched cheapest-first
 * with a full deterministic tie-break. Pure: it reads the countries but never
 * mutates them, so every country is matched in the same pass.
 */
function clearGood(
  good: GoodId,
  countries: Country[],
  markets: Record<string, MarketSnapshot>,
  balance: TradeBalance,
): void {
  const offer = new Map<string, number>()
  const bid = new Map<string, number>()
  for (const country of countries) {
    const market = markets[country.id]
    if (market === undefined) continue
    const surplus = market.production[good] - market.demand[good]
    if (surplus > 0) offer.set(country.id, surplus)
    else if (surplus < 0) bid.set(country.id, -surplus)
  }
  if (offer.size === 0 || bid.size === 0) return

  const pairs: Pair[] = []
  for (const importer of countries) {
    if (!bid.has(importer.id)) continue
    const candidates: Pair[] = []
    for (const exporter of countries) {
      if (exporter.id === importer.id) continue
      if (!offer.has(exporter.id)) continue
      if (relationOf(importer, exporter.id) < RELATION_CUTOFF) continue
      candidates.push({ importer, exporter, landed: landedPrice(exporter, importer, good) })
    }
    candidates.sort(
      (a, b) => a.landed - b.landed || compareIds(a.exporter.id, b.exporter.id),
    )
    pairs.push(...candidates.slice(0, TOP_PARTNERS))
  }
  pairs.sort(
    (a, b) =>
      a.landed - b.landed ||
      compareIds(a.importer.id, b.importer.id) ||
      compareIds(a.exporter.id, b.exporter.id),
  )

  const bidRemaining = new Map(bid)
  const offerRemaining = new Map(offer)
  for (const pair of pairs) {
    const quantity = Math.min(
      bidRemaining.get(pair.importer.id) ?? 0,
      offerRemaining.get(pair.exporter.id) ?? 0,
    )
    if (quantity <= 1e-9) continue
    bidRemaining.set(pair.importer.id, (bidRemaining.get(pair.importer.id) ?? 0) - quantity)
    offerRemaining.set(pair.exporter.id, (offerRemaining.get(pair.exporter.id) ?? 0) - quantity)

    const unitPrice = pair.exporter.econ.prices[good]
    const basePrice = GOODS[good].basePrice
    balance.flows.push({
      good,
      from: pair.exporter.id,
      to: pair.importer.id,
      quantity,
      unitPrice,
      landedPrice: pair.landed,
      tariffPaid: 0, // T1b: gold settlement fills this.
      value: quantity * unitPrice,
    })
    balance.importQty[pair.importer.id]![good] += quantity
    balance.exportQty[pair.exporter.id]![good] += quantity
    balance.importValue[pair.importer.id] =
      (balance.importValue[pair.importer.id] ?? 0) + quantity * unitPrice
    balance.exportValue[pair.exporter.id] =
      (balance.exportValue[pair.exporter.id] ?? 0) + quantity * unitPrice
    balance.nx[pair.importer.id] = (balance.nx[pair.importer.id] ?? 0) - quantity * basePrice
    balance.nx[pair.exporter.id] = (balance.nx[pair.exporter.id] ?? 0) + quantity * basePrice
  }
}

/**
 * Global Top-6 bilateral quantity clearing for one month (plan §2.1 phases
 * A/B, §2.2). Deterministic and pure; the caller supplies the pre-clearing
 * domestic snapshots so no country can be settled before another.
 */
export function clearTrade(
  countries: Country[],
  markets: Record<string, MarketSnapshot>,
): TradeBalance {
  const balance: TradeBalance = {
    flows: [],
    exportQty: {},
    importQty: {},
    exportValue: {},
    importValue: {},
    nx: {},
  }
  for (const country of countries) {
    balance.exportQty[country.id] = zeroQuantities()
    balance.importQty[country.id] = zeroQuantities()
    balance.exportValue[country.id] = 0
    balance.importValue[country.id] = 0
    balance.nx[country.id] = 0
  }
  for (const good of TRADABLE_GOODS) clearGood(good, countries, markets, balance)
  return balance
}
