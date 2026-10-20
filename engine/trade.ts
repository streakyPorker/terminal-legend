import type { Country, Embargo, GoodId, ResourceId, Resources, TradeFlow } from '../types'
import { GOODS, GOOD_IDS, REGION_COST } from './data'

export { REGION_COST }

/** How many candidate exporters one importer may draw on per good (plan §2.2). */
export const TOP_PARTNERS = 6
/** Relations below this cut a partner out of the candidate list (plan §1.2). */
export const RELATION_CUTOFF = -50
/**
 * Share of GDP the private sector may borrow abroad in one month to fund the
 * import bill it cannot pay from export revenue or private capital (plan §10
 * mitigation, §11 calibration knob). Small so a trade deficit is contained
 * instead of being allowed to compound unbounded into external debt.
 */
export const MAX_MONTHLY_DEFICIT_SHARE = 0.03

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

/** True when one country's embargo list covers `targetId` for `good` (plan §3). */
export function embargoed(embargoes: Embargo[], targetId: string, good: GoodId): boolean {
  return embargoes.some(
    embargo =>
      embargo.target === targetId &&
      (embargo.goods === 'all' || embargo.goods.includes(good)),
  )
}

/**
 * Whether a candidate (importer, exporter, good) trade is blocked. Supplied by
 * the caller so clearing stays pure: embargoes and wars live in `WorldState`,
 * which `clearTrade` does not otherwise need.
 */
export type TradeBlocker = (importerId: string, exporterId: string, good: GoodId) => boolean

/**
 * Landed cost of one good delivered from `from` to `to` (plan §1.2): the
 * exporter's domestic price marked up by its export duty, then the importer's
 * import duty, region transport cost, market access, transport infrastructure
 * and relation risk. Both duties are part of the real price the importer pays.
 */
export function landedPrice(from: Country, to: Country, good: GoodId): number {
  const regionCost = REGION_COST[from.region][to.region]
  const accessFactor = 1.15 - to.econ.marketAccess * 0.25
  const transportFactor = 1.2 - to.econ.transportInfrastructure / 500
  const relationRisk = 1 + Math.max(0, -relationOf(to, from.id)) / 200
  return (
    from.econ.prices[good] *
    (1 + from.econ.tariff / 100) *
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
  flows: TradeFlow[],
  isBlocked?: TradeBlocker,
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
      // An embargo or a war severs the pair regardless of price (plan §3).
      if (isBlocked !== undefined && isBlocked(importer.id, exporter.id, good)) continue
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
    flows.push({
      good,
      from: pair.exporter.id,
      to: pair.importer.id,
      quantity,
      unitPrice,
      landedPrice: pair.landed,
      tariffPaid: 0,
      exportDuty: 0,
      value: quantity * unitPrice,
    })
  }
}

/** Country lookup by id, so per-flow tariff reads never scan the array. */
function byId(countries: Country[]): Record<string, Country> {
  const out: Record<string, Country> = {}
  for (const country of countries) out[country.id] = country
  return out
}

/**
 * Derives every aggregate from a final flow list (plan §2.5): the caller has
 * already applied clearing and any capacity scaling, so quantities, values,
 * tariffs and NX can never drift apart. Rewrites each flow's `value` and
 * `tariffPaid` so a scaled quantity stays self-consistent.
 */
function deriveBalance(countries: Country[], flows: TradeFlow[]): TradeBalance {
  const index = byId(countries)
  const balance: TradeBalance = {
    flows,
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
  for (const flow of flows) {
    const value = flow.quantity * flow.unitPrice
    const base = GOODS[flow.good].basePrice
    // Export duty is charged on the exporter's domestic value; import duty is
    // then charged on the border value that already includes the export duty.
    const exportTariff = index[flow.from]?.econ.tariff ?? 0
    const importTariff = index[flow.to]?.econ.tariff ?? 0
    const borderValue = value * (1 + exportTariff / 100)
    flow.value = value
    flow.exportDuty = value * (exportTariff / 100)
    flow.tariffPaid = borderValue * (importTariff / 100)
    const imported = balance.importQty[flow.to]
    const exported = balance.exportQty[flow.from]
    if (imported !== undefined) imported[flow.good] += flow.quantity
    if (exported !== undefined) exported[flow.good] += flow.quantity
    balance.importValue[flow.to] = (balance.importValue[flow.to] ?? 0) + value
    balance.exportValue[flow.from] = (balance.exportValue[flow.from] ?? 0) + value
    balance.nx[flow.to] = (balance.nx[flow.to] ?? 0) - flow.quantity * base
    balance.nx[flow.from] = (balance.nx[flow.from] ?? 0) + flow.quantity * base
  }
  return balance
}

/**
 * Global Top-6 bilateral quantity clearing for one month (plan §2.1 phases
 * A/B, §2.2). Deterministic and pure; the caller supplies the pre-clearing
 * domestic snapshots so no country can be settled before another.
 */
export function clearTrade(
  countries: Country[],
  markets: Record<string, MarketSnapshot>,
  isBlocked?: TradeBlocker,
): TradeBalance {
  const flows: TradeFlow[] = []
  for (const good of TRADABLE_GOODS) clearGood(good, countries, markets, flows, isBlocked)
  return deriveBalance(countries, flows)
}

/**
 * Soft import capacity in gold for one country this month (plan §2.3). A
 * country restructured within the last 12 months has its capacity halved.
 */
export function importCapacity(country: Country, tick: number): number {
  const base =
    50 +
    country.econ.buildings.ports * 8 +
    country.econ.marketAccess * 200 +
    country.econ.transportInfrastructure * 1
  return tick <= country.econ.restructuredUntilTick ? base * 0.5 : base
}

/**
 * Applies the soft capacity cap to the cleared flows (plan §2.3/§2.4). When an
 * importer's total pre-tariff gold import bill exceeds its capacity, every one
 * of its flows is scaled by the same factor; because an exporter shares the
 * very same flow object, its export shrinks identically and global conservation
 * (Σ importBill === Σ exportRevenue) survives. Aggregates, tariffs and NX are
 * re-derived from the scaled flow list. Returns each country's capacity.
 */
export function applyCapacity(
  countries: Country[],
  balance: TradeBalance,
  tick: number,
): Record<string, number> {
  const capacities: Record<string, number> = {}
  const byImporter = new Map<string, TradeFlow[]>()
  for (const flow of balance.flows) {
    const list = byImporter.get(flow.to)
    if (list === undefined) byImporter.set(flow.to, [flow])
    else list.push(flow)
  }
  for (const country of countries) {
    const capacity = importCapacity(country, tick)
    capacities[country.id] = capacity
    const flows = byImporter.get(country.id)
    if (flows === undefined) continue
    let bill = 0
    for (const flow of flows) {
      // The real private payment is the domestic value plus both duties.
      bill += flow.value + flow.exportDuty + flow.tariffPaid
    }
    if (bill > capacity && bill > 0) {
      const factor = capacity / bill
      for (const flow of flows) flow.quantity *= factor
    }
  }
  Object.assign(balance, deriveBalance(countries, balance.flows))
  return capacities
}

/**
 * Gold an importer can actually pay this month (plan §10): its export revenue,
 * plus its realisable private capital, plus a small GDP-share of new external
 * debt. This is the hard counterpart to §2.3's soft capacity — soft capacity
 * models ports and transport, payment capacity models solvency.
 */
export function paymentCapacity(country: Country, exportRevenue: number): number {
  return (
    exportRevenue +
    Math.max(0, country.econ.privateCapital) +
    country.econ.gdp * MAX_MONTHLY_DEFICIT_SHARE
  )
}

/**
 * Applies the payment-capacity cut after the soft capacity (plan §10). When an
 * importer's pre-tariff gold bill exceeds `paymentCapacity`, every one of its
 * flows is scaled by the same factor; the exporter shares the flow object, so
 * its export shrinks identically and global conservation survives. Each
 * country's export revenue is read from the same pre-cut list, so the pass is
 * order-independent; unmet demand is simply left unmet (no iteration). Returns
 * each country's payment capacity.
 */
export function applyPaymentCapacity(
  countries: Country[],
  balance: TradeBalance,
): Record<string, number> {
  const capacities: Record<string, number> = {}
  const byImporter = new Map<string, TradeFlow[]>()
  for (const flow of balance.flows) {
    const list = byImporter.get(flow.to)
    if (list === undefined) byImporter.set(flow.to, [flow])
    else list.push(flow)
  }
  // Freeze every exporter's revenue from the pre-cut list: a later partner
  // scaling its imports must not change what this country could have paid.
  const exportRevenue = new Map<string, number>()
  for (const flow of balance.flows) {
    exportRevenue.set(
      flow.from,
      (exportRevenue.get(flow.from) ?? 0) + flow.quantity * flow.unitPrice,
    )
  }
  for (const country of countries) {
    capacities[country.id] = paymentCapacity(country, exportRevenue.get(country.id) ?? 0)
  }
  for (const country of countries) {
    const flows = byImporter.get(country.id)
    if (flows === undefined) continue
    const capacity = capacities[country.id] ?? 0
    let bill = 0
    for (const flow of flows) {
      // The real private payment is the domestic value plus both duties.
      bill += flow.value + flow.exportDuty + flow.tariffPaid
    }
    if (bill > capacity && bill > 0) {
      const factor = capacity / bill
      for (const flow of flows) flow.quantity *= factor
    }
  }
  Object.assign(balance, deriveBalance(countries, balance.flows))
  return capacities
}

/** Per-country gold settlement derived from the final flow list (plan §2.4). */
export type TradeSettlement = {
  /** Border value the importer pays: domestic value + the exporter's duty. */
  importBill: number
  /** Domestic value the exporter's private sector receives. */
  exportRevenue: number
  /** Import duty collected by the importing state. */
  importDuty: number
  /** Export duty collected by the exporting state. */
  exportDuty: number
  /** Total tariff income: importDuty + exportDuty. */
  tariffRevenue: number
  /** exportRevenue − importBill; the reported trade balance. */
  tradeBalance: number
  /** The private sector's external net: exportRevenue − importBill − importDuty. */
  externalNet: number
  drawnFromCapital: number
  /** Increase in *private* external debt (never state debt; ADR 0008). */
  debtIncrease: number
  /** Post-default excess beyond the gdp×0.2 new-debt cap, forgiven. */
  dropped: number
}

/**
 * Settles one country's gold from the final flows (plan §2.4). The importer's
 * private sector pays the border value (domestic value + the exporter's export
 * duty) plus the importer's own import duty; the exporter's private sector
 * receives the domestic value and its state receives the export duty. Transport
 * friction inside `landedPrice` never appears here. A shortfall draws on
 * `privateCapital` first, then becomes *private* external debt (negative private
 * capital), capped at `gdp×0.2` inside the post-default window. It never touches
 * the state treasury (ADR 0008). Pure: the caller applies the returned amounts.
 */
export function settleTrade(
  country: Country,
  flows: TradeFlow[],
  tick: number,
): TradeSettlement {
  let importBill = 0
  let exportRevenue = 0
  let importDuty = 0
  let exportDuty = 0
  for (const flow of flows) {
    const value = flow.quantity * flow.unitPrice
    if (flow.to === country.id) {
      const borderValue = value + flow.exportDuty
      importBill += borderValue
      importDuty += borderValue * (country.econ.tariff / 100)
    }
    if (flow.from === country.id) {
      exportRevenue += value
      exportDuty += value * (country.econ.tariff / 100)
    }
  }
  const tariffRevenue = importDuty + exportDuty
  const tradeBalance = exportRevenue - importBill
  const externalNet = exportRevenue - importBill - importDuty
  let drawnFromCapital = 0
  let debtIncrease = 0
  let dropped = 0
  if (externalNet < 0) {
    const need = -externalNet
    drawnFromCapital = Math.min(Math.max(0, country.econ.privateCapital), need)
    let remainder = need - drawnFromCapital
    if (tick <= country.econ.restructuredUntilTick) {
      const cap = country.econ.gdp * 0.2
      if (remainder > cap) {
        dropped = remainder - cap
        remainder = cap
      }
    }
    debtIncrease = remainder
  }
  return {
    importBill,
    exportRevenue,
    importDuty,
    exportDuty,
    tariffRevenue,
    tradeBalance,
    externalNet,
    drawnFromCapital,
    debtIncrease,
    dropped,
  }
}

/** Which resource each imported good feeds; farmland has no imported good. */
export const RESOURCE_IMPORT_GOOD: Record<ResourceId, GoodId | undefined> = {
  farmland: undefined,
  timber: 'wood',
  coal: 'coal',
  iron: 'iron',
}

/** Imported amount per resource this month, from the final flow list (plan §2.6). */
export function deriveResourceImports(
  flows: TradeFlow[],
  countryId: string,
): Record<ResourceId, number> {
  const out: Record<ResourceId, number> = { farmland: 0, timber: 0, coal: 0, iron: 0 }
  for (const [resource, good] of Object.entries(RESOURCE_IMPORT_GOOD) as [
    ResourceId,
    GoodId | undefined,
  ][]) {
    if (good === undefined) continue
    for (const flow of flows) {
      if (flow.to === countryId && flow.good === good) out[resource] += flow.quantity
    }
  }
  return out
}

/**
 * Effective endowment bonus from imports (plan §2.6): the import share of
 * available supply, scaled and capped at +15 points. Derived only — it never
 * writes back into `econ.resources`.
 */
export function resourceImportBonus(imports: number, domesticProduction: number): number {
  const share = imports / Math.max(1, domesticProduction + imports)
  return Math.min(15, Math.max(0, share * 20))
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
