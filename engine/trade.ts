import type {
  Country,
  Embargo,
  GoodId,
  ResourceId,
  TradeFlow,
  TradeRoute,
} from '../types'
import { GOODS, GOOD_IDS, REGION_COST, infrastructureCount } from './data'
import { RESOURCE_IMPORT_GOOD } from './endowment'
import { applyModifiers } from './modifiers'
import {
  ACCESS_FACTOR_BASE,
  ACCESS_FACTOR_COEF,
  IMPORT_CAPACITY_ACCESS,
  IMPORT_CAPACITY_BASE,
  IMPORT_CAPACITY_PORT,
  IMPORT_CAPACITY_RESTRUCTURE_FACTOR,
  IMPORT_CAPACITY_TRANSPORT,
  MAX_MONTHLY_DEFICIT_SHARE,
  RELATION_CUTOFF,
  RELATION_RISK_DIVISOR,
  ROUTE_CAPACITY_PORT_COEF,
  ROUTE_CAPACITY_TRANSPORT_DIVISOR,
  ROUTE_RESIDUAL_FRICTION,
  ROUTE_RESIDUAL_TOP_PARTNERS,
  ROUTE_SPOT_DISCOUNT,
  ROUTE_UNIT_VOLUME,
  SHIPS_PER_ROUTE_LEVEL,
  TOP_PARTNERS,
  TRADE_DEBT_GDP_CAP,
  TRANSPORT_FACTOR_BASE,
  TRANSPORT_FACTOR_DIVISOR,
} from './config/trade'

export { REGION_COST }
export { RESOURCE_IMPORT_GOOD, resourceImportBonus, effectiveResources } from './endowment'

/** The trade calibration constants live in `config/trade.ts`; they are
 *  re-exported here so the `./trade` import surface is unchanged. */
export {
  TOP_PARTNERS,
  RELATION_CUTOFF,
  ROUTE_UNIT_VOLUME,
  ROUTE_MAX_LEVEL,
  ROUTE_GROW_UTILIZATION,
  ROUTE_RESIDUAL_FRICTION,
  ROUTE_RESIDUAL_TOP_PARTNERS,
  ROUTE_SPOT_DISCOUNT,
  ROUTE_MAX_PER_COUNTRY,
  ROUTE_SEED_PER_PAIR,
  ROUTE_GRACE_MONTHS,
  MAX_MONTHLY_DEFICIT_SHARE,
} from './config/trade'

/**
 * Goods that never cross a border (plan §0). Services always; plan 0015 S4 /
 * ADR 0031 §6 adds electricity — 19th-century power cannot be cross-border
 * priced, so a country only ever gets the output bonus from its own plants.
 */
const NON_TRADABLE: GoodId[] = ['services', 'electricity']

/** Every good except the non-tradable pair, in the canonical GOOD_IDS order. */
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
 * Export duty actually charged: the explicitly split export rate when one is
 * set, otherwise the same single rate as imports (ADR 0009/0014).
 */
export const exportDutyRate = (country: Country): number =>
  country.econ.exportTariff ?? country.econ.tariff

/**
 * How much of a posted **import** duty actually lands on the importer's price.
 * `tariffBargaining` in [0, 0.9] is the share the foreign producer absorbs:
 * at 0 (the default) the posted rate passes through in full; at 0.9 only a
 * tenth of it moves the landed price. The importer's treasury still collects
 * the full posted duty — the difference is shifted back onto the exporter
 * (`bargainingAbsorbed`), which is the whole point of the leverage.
 *
 * Export duties need no equivalent: the engine never lowers the exporter's
 * domestic price for them, so the foreign consumer already bears them in full.
 */
export const tariffPassThrough = (country: Country): number =>
  1 - applyModifiers(country, 'tariffBargaining', 0)

/** The import duty rate that reaches the importer's price signal. */
export const effectiveImportDutyRate = (country: Country): number =>
  country.econ.tariff * tariffPassThrough(country)

/** Duty the exporter absorbs so the importer's price stays put (gold-conserving). */
export const bargainingAbsorbed = (
  importer: Country,
  importDuty: number,
): number => importDuty * applyModifiers(importer, 'tariffBargaining', 0)

/**
 * Landed cost of one good delivered from `from` to `to` (plan §1.2): the
 * exporter's domestic price marked up by its export duty, then the importer's
 * import duty, region transport cost, market access, transport infrastructure
 * and relation risk. Both duties are part of the real price the importer pays.
 */
export function landedPrice(from: Country, to: Country, good: GoodId): number {
  const regionCost = REGION_COST[from.region][to.region]
  const accessFactor = ACCESS_FACTOR_BASE - to.econ.marketAccess * ACCESS_FACTOR_COEF
  const transportFactor = TRANSPORT_FACTOR_BASE - to.econ.transportInfrastructure / TRANSPORT_FACTOR_DIVISOR
  const relationRisk = 1 + Math.max(0, -relationOf(to, from.id)) / RELATION_RISK_DIVISOR
  return (
    from.econ.prices[good] *
    (1 + exportDutyRate(from) / 100) *
    (1 + effectiveImportDutyRate(to) / 100) *
    regionCost *
    accessFactor *
    transportFactor *
    relationRisk
  )
}

/**
 * Landed cost on an established route (ADR 0020): identical to `landedPrice`
 * but without the relation-risk premium and with the route discount. A route is
 * a standing relationship, so it carries no spot friction; this price only
 * feeds the growth margin and display, never a gold account.
 */
export function routeLandedPrice(from: Country, to: Country, good: GoodId): number {
  const regionCost = REGION_COST[from.region][to.region]
  const accessFactor = ACCESS_FACTOR_BASE - to.econ.marketAccess * ACCESS_FACTOR_COEF
  const transportFactor = TRANSPORT_FACTOR_BASE - to.econ.transportInfrastructure / TRANSPORT_FACTOR_DIVISOR
  return (
    from.econ.prices[good] *
    (1 + exportDutyRate(from) / 100) *
    (1 + effectiveImportDutyRate(to) / 100) *
    regionCost *
    accessFactor *
    transportFactor *
    ROUTE_SPOT_DISCOUNT
  )
}

/** Port and transport multiplier on a route's monthly capacity (ADR 0020). */
export function routeCapacityFactor(from: Country, to: Country): number {
  return (
    1 +
    (from.econ.transportInfrastructure + to.econ.transportInfrastructure) /
      ROUTE_CAPACITY_TRANSPORT_DIVISOR +
    infrastructureCount(to) * ROUTE_CAPACITY_PORT_COEF
  )
}

/** Deterministic route id: unique per (good, exporter, importer). */
export const routeId = (good: GoodId, from: string, to: string): string =>
  `route-${good}-${from}-${to}`

/** A route as matched this month: its flow, its capacity and its served qty. */
export type RouteService = {
  route: TradeRoute
  /** The shared flow object; the soft/payment cuts scale it in place. */
  flow: TradeFlow
  /** Capacity this month, before any cut. */
  capacity: number
  /** Quantity the route pass assigned, before the cuts (its structural load). */
  matched: number
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
 * surplus, bids each importer's need; every importer sees at most
 * `topPartners` cheapest partners; all (importer, exporter) pairs are matched
 * cheapest-first with a full deterministic tie-break. Pure: it reads the
 * countries but never mutates them, so every country is matched in the same
 * pass. The offer/bid maps are consumed in place so a route pass can reserve
 * supply first and the residual (spot) market sees only what is left.
 */
function clearGood(
  good: GoodId,
  countries: Country[],
  offer: Map<string, number>,
  bid: Map<string, number>,
  flows: TradeFlow[],
  isBlocked?: TradeBlocker,
  friction = 1,
  topPartners = TOP_PARTNERS,
): void {
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
      candidates.push({
        importer,
        exporter,
        landed: landedPrice(exporter, importer, good) * friction,
      })
    }
    candidates.sort(
      (a, b) => a.landed - b.landed || compareIds(a.exporter.id, b.exporter.id),
    )
    pairs.push(...candidates.slice(0, topPartners))
  }
  pairs.sort(
    (a, b) =>
      a.landed - b.landed ||
      compareIds(a.importer.id, b.importer.id) ||
      compareIds(a.exporter.id, b.exporter.id),
  )

  for (const pair of pairs) {
    const quantity = Math.min(
      bid.get(pair.importer.id) ?? 0,
      offer.get(pair.exporter.id) ?? 0,
    )
    if (quantity <= 1e-9) continue
    bid.set(pair.importer.id, (bid.get(pair.importer.id) ?? 0) - quantity)
    offer.set(pair.exporter.id, (offer.get(pair.exporter.id) ?? 0) - quantity)

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

/**
 * Reserves supply for every standing route before the spot market runs (ADR
 * 0020). Routes are walked in a deterministic (good, from, to) order; a route
 * severed by war/embargo or a relation below the cutoff is skipped, so its
 * supply stays available to the residual pass. Each route pushes one shared
 * flow object, the same one both endpoints read, which is what keeps the gold
 * identities exact. Offer/bid are decremented in place.
 */
function routePass(
  index: Record<string, Country>,
  routes: TradeRoute[],
  offer: Record<GoodId, Map<string, number>>,
  bid: Record<GoodId, Map<string, number>>,
  flows: TradeFlow[],
  isBlocked: TradeBlocker | undefined,
  services: Map<string, RouteService> | undefined,
): void {
  const ordered = [...routes].sort(
    (a, b) =>
      compareIds(a.good, b.good) || compareIds(a.from, b.from) || compareIds(a.to, b.to),
  )
  // PT-067: the exporter carries the cargo, so its hulls gate every route it
  // serves. Short hulls scale all of that country's routes down by the same
  // ratio — never a per-route arbitrary cut.
  const requiredLevels: Record<string, number> = {}
  for (const route of routes) {
    requiredLevels[route.from] = (requiredLevels[route.from] ?? 0) + route.level
  }
  const fleetFactor = (id: string): number => {
    const country = index[id]
    if (country === undefined) return 1
    const required = (requiredLevels[id] ?? 0) * SHIPS_PER_ROUTE_LEVEL
    if (required <= 0) return 1
    const hulls =
      (country.military.navy ?? 0) + (country.econ.merchantHulls ?? 0)
    return Math.min(1, hulls / required)
  }
  for (const route of ordered) {
    if (!TRADABLE_GOODS.includes(route.good)) continue
    if (route.from === route.to) continue
    const from = index[route.from]
    const to = index[route.to]
    if (from === undefined || to === undefined) continue
    if (relationOf(to, from.id) < RELATION_CUTOFF) continue
    if (isBlocked !== undefined && isBlocked(route.to, route.from, route.good)) continue
    const goodOffer = offer[route.good]
    const goodBid = bid[route.good]
    if (goodOffer === undefined || goodBid === undefined) continue
    const offerRemaining = goodOffer.get(route.from) ?? 0
    const bidRemaining = goodBid.get(route.to) ?? 0
    const capacity =
      route.level *
      ROUTE_UNIT_VOLUME *
      routeCapacityFactor(from, to) *
      fleetFactor(route.from)
    const quantity = Math.min(offerRemaining, bidRemaining, capacity)
    if (quantity <= 1e-9) continue
    goodOffer.set(route.from, offerRemaining - quantity)
    goodBid.set(route.to, bidRemaining - quantity)
    const unitPrice = from.econ.prices[route.good]
    const flow: TradeFlow = {
      good: route.good,
      from: route.from,
      to: route.to,
      quantity,
      unitPrice,
      landedPrice: routeLandedPrice(from, to, route.good),
      tariffPaid: 0,
      exportDuty: 0,
      value: quantity * unitPrice,
    }
    flows.push(flow)
    services?.set(route.id, { route, flow, capacity, matched: quantity })
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
    const exporter = index[flow.from]
    const importer = index[flow.to]
    const exportTariff = exporter === undefined ? 0 : exportDutyRate(exporter)
    const importTariff = importer === undefined ? 0 : importer.econ.tariff
    const borderValue = value * (1 + exportTariff / 100)
    flow.value = value
    flow.exportDuty = value * (exportTariff / 100)
    flow.tariffPaid = borderValue * (importTariff / 100)
    // Bargaining power does not cut the duty the importer collects; it pushes
    // that slice onto the exporter, so the importer's price barely moves while
    // its treasury keeps the full posted duty (gold-conserving transfer).
    flow.absorbed =
      importer === undefined ? 0 : bargainingAbsorbed(importer, flow.tariffPaid)
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
 * One month's global clearing (plan §2.1 phases A/B, §2.2). When `routes` are
 * supplied, the standing routes reserve their supply/bid first (ADR 0020) and
 * the residual clears as spot with friction and a narrower candidate list; when
 * omitted the function is the original pure spot clearing (unit tests call it
 * this way). Deterministic and pure; the caller supplies the pre-clearing
 * domestic snapshots so no country can be settled before another.
 */
export function clearTrade(
  countries: Country[],
  markets: Record<string, MarketSnapshot>,
  isBlocked?: TradeBlocker,
  routes?: TradeRoute[],
  services?: Map<string, RouteService>,
): TradeBalance {
  const flows: TradeFlow[] = []
  const offer = {} as Record<GoodId, Map<string, number>>
  const bid = {} as Record<GoodId, Map<string, number>>
  for (const good of TRADABLE_GOODS) {
    const goodOffer = new Map<string, number>()
    const goodBid = new Map<string, number>()
    for (const country of countries) {
      const market = markets[country.id]
      if (market === undefined) continue
      const surplus = market.production[good] - market.demand[good]
      if (surplus > 0) goodOffer.set(country.id, surplus)
      else if (surplus < 0) goodBid.set(country.id, -surplus)
    }
    offer[good] = goodOffer
    bid[good] = goodBid
  }
  const routed = routes !== undefined && routes.length > 0
  if (routed) {
    routePass(byId(countries), routes, offer, bid, flows, isBlocked, services)
  }
  const friction = routed ? ROUTE_RESIDUAL_FRICTION : 1
  const topPartners = routed ? ROUTE_RESIDUAL_TOP_PARTNERS : TOP_PARTNERS
  for (const good of TRADABLE_GOODS) {
    clearGood(good, countries, offer[good], bid[good], flows, isBlocked, friction, topPartners)
  }
  return deriveBalance(countries, flows)
}

/**
 * Soft import capacity in gold for one country this month (plan §2.3). A
 * country restructured within the last 12 months has its capacity halved.
 */
export function importCapacity(country: Country, tick: number): number {
  const base =
    IMPORT_CAPACITY_BASE +
    infrastructureCount(country) * IMPORT_CAPACITY_PORT +
    country.econ.marketAccess * IMPORT_CAPACITY_ACCESS +
    country.econ.transportInfrastructure * IMPORT_CAPACITY_TRANSPORT
  return tick <= country.econ.restructuredUntilTick
    ? base * IMPORT_CAPACITY_RESTRUCTURE_FACTOR
    : base
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
      // The real private payment is the domestic value plus both duties,
      // minus whatever the exporter absorbed under the importer's leverage.
      bill += flow.value + flow.exportDuty + flow.tariffPaid - (flow.absorbed ?? 0)
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
      // The real private payment is the domestic value plus both duties,
      // minus whatever the exporter absorbed under the importer's leverage.
      bill += flow.value + flow.exportDuty + flow.tariffPaid - (flow.absorbed ?? 0)
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
    const absorbed = flow.absorbed ?? 0
    if (flow.to === country.id) {
      const borderValue = value + flow.exportDuty
      // The exporter's absorbed slice lowers what the importer's private
      // sector pays, but the state still collects the full posted duty.
      importBill += borderValue - absorbed
      importDuty += borderValue * (country.econ.tariff / 100)
    }
    if (flow.from === country.id) {
      exportRevenue += value - absorbed
      exportDuty += value * (exportDutyRate(country) / 100)
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
      const cap = country.econ.gdp * TRADE_DEBT_GDP_CAP
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

