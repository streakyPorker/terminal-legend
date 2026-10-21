import type {
  Country,
  GameDate,
  GameEvent,
  GoodId,
  LogEntry,
  TradeFlow,
  TradeRoute,
  WarIndemnity,
  WorldState,
} from '../types'
import { createWorld } from './data'
import { nationalDebt } from './fiscal'
import {
  RELATION_CUTOFF,
  ROUTE_GROW_UTILIZATION,
  ROUTE_MAX_LEVEL,
  ROUTE_MAX_PER_COUNTRY,
  ROUTE_SEED_PER_PAIR,
  ROUTE_UNIT_VOLUME,
  TRADABLE_GOODS,
  applyCapacity,
  applyPaymentCapacity,
  clearTrade,
  deriveResourceImports,
  effectiveSupply,
  embargoed,
  routeCapacityFactor,
  routeId,
  routeLandedPrice,
  settleTrade,
  type MarketSnapshot,
  type RouteService,
  type TradeBalance,
  type TradeSettlement,
} from './trade'
import { tickSituations } from './situations'
import {
  applyTradeRelations,
  atWar,
  driftRelations,
  expireEmbargoes,
  resolveWars,
  tradeBlocker,
} from './diplomacy'
import { tickEvents } from './events'
import { computeEconomy, computePrestige, inspectEconomy } from './economy'
import { simulateCountry } from './country'
import { applyDecision } from './actions'
import { advanceDate, appliedPart, clamp, sumParts, type Decision } from './internal'
import type { Rng } from './rng'

export type AdvanceReport = {
  start: GameDate
  end: GameDate
  log: LogEntry[]
  events: GameEvent[]
}

export function calibrateWorld(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    // Two passes: the first seeds wages/profits from GDP, the second lets
    // Stone-Geary demand read that income.
    const context = { atWar: false, tick: world.tick }
    let snap = computeEconomy(country, context)
    country.econ.wages = snap.wages
    country.econ.profits = snap.profits
    snap = computeEconomy(country, context)
    country.econ.gdp = snap.gdp
    country.econ.income = snap.income
    country.econ.lastIncomeOther = snap.revenue.other
    country.econ.expense = snap.expense
    country.econ.goods = snap.production
    country.econ.gdpComponents = snap.components
    country.econ.laborShare = snap.laborShare
    country.econ.wages = snap.wages
    country.econ.profits = snap.profits
    country.econ.taxBaseQty = snap.taxBaseQty
    country.econ.buildingProfits = snap.buildingProfits
    country.econ.laborDemand = snap.labor.demand
    country.econ.laborForce = snap.labor.force
    country.econ.laborUtilization = snap.labor.utilization
    country.econ.laborRawUtilization = snap.labor.raw
    const rawIncomeTotal = sumParts(snap.revenue)
    const rawExpenseTotal = sumParts(snap.outlay)
    country.econ.lastFundIncome = appliedPart(
      snap.revenue.sovereignIncome,
      rawIncomeTotal,
      snap.income,
    )
    country.econ.lastDebtInterest = appliedPart(
      snap.outlay.debtInterest,
      rawExpenseTotal,
      snap.expense,
    )
    country.econ.history = {
      gdp: [snap.gdp],
      treasury: [country.econ.treasury],
      sol: [country.pops.sol],
      legitimacy: [country.government.legitimacy],
      radicals: [country.pops.radicals],
      c: [snap.components.c],
      i: [snap.components.i],
      g: [snap.components.g],
      income: [snap.income],
      expense: [snap.expense],
      unemployment: [country.econ.unemployment],
      debt: [nationalDebt(country)],
      tariff: [country.econ.lastTariffRevenue],
    }
    country.diplo.prestige = computePrestige(country)
  }
}

/** Overwrites a country's trade record with this month's clearing result. */
function recordTrade(
  country: Country,
  balance: TradeBalance,
  capacity: number,
  settlement: TradeSettlement,
  resourceImports: Country['econ']['resourceImports'],
): void {
  const trade = country.trade
  trade.exports = balance.flows.filter(flow => flow.from === country.id)
  trade.imports = balance.flows.filter(flow => flow.to === country.id)
  trade.exportValue = balance.exportValue[country.id] ?? 0
  trade.importValue = balance.importValue[country.id] ?? 0
  trade.tariffRevenue = settlement.tariffRevenue
  trade.nx = balance.nx[country.id] ?? 0
  trade.capacity = capacity
  country.econ.lastImportBill = settlement.importBill
  country.econ.lastExportRevenue = settlement.exportRevenue
  country.econ.lastTariffRevenue = settlement.tariffRevenue
  country.econ.lastTradeBalance = settlement.tradeBalance
  country.econ.resourceImports = resourceImports
  trade.history.exportValue.push(trade.exportValue)
  trade.history.importValue.push(trade.importValue)
  trade.history.nx.push(trade.nx)
  trade.history.tariffRevenue.push(trade.tariffRevenue)
  for (const series of Object.values(trade.history)) {
    if (series.length > 36) series.shift()
  }
}

/**
 * Books this month's installment reparations onto both sides before the
 * country simulation runs. The payer's expense and the receiver's income are
 * equal, so the transfer conserves gold without touching either treasury
 * directly here.
 */
function prepareIndemnities(world: WorldState): void {
  if (!Array.isArray(world.indemnities)) world.indemnities = []
  for (const country of Object.values(world.countries)) {
    country.econ.reparationsPaid = 0
    country.econ.reparationsReceived = 0
  }
  const active: WarIndemnity[] = []
  for (const schedule of world.indemnities) {
    if (world.tick < schedule.startsAtTick) {
      active.push(schedule)
      continue
    }
    const payer = world.countries[schedule.from]
    const receiver = world.countries[schedule.to]
    if (
      payer === undefined ||
      receiver === undefined ||
      schedule.remaining <= 0
    ) {
      continue
    }
    const amount = Math.min(schedule.monthlyAmount, schedule.remaining)
    payer.econ.reparationsPaid += amount
    receiver.econ.reparationsReceived += amount
    schedule.remaining = Math.max(0, schedule.remaining - amount)
    schedule.monthsLeft -= 1
    if (schedule.remaining > 0.01 && schedule.monthsLeft > 0) {
      active.push(schedule)
    }
  }
  world.indemnities = active
}

/**
 * Grows, decays or removes each standing route after settlement (ADR 0020),
 * then opens at most one fresh route per country. Growth uses the quantity the
 * route *matched* (before the soft/payment cuts) so a solvency squeeze does not
 * kill structurally sound routes; `lastQty` instead records what was actually
 * delivered. Deterministic: routes are visited in array order, every candidate
 * sort carries an explicit id tie-break, and there is no RNG.
 */
export function growRoutes(
  world: WorldState,
  services: Map<string, RouteService>,
  markets: Record<string, MarketSnapshot>,
): void {
  const kept: TradeRoute[] = []
  for (const route of world.tradeRoutes) {
    const from = world.countries[route.from]
    const to = world.countries[route.to]
    if (from === undefined || to === undefined) continue
    const blocked =
      atWar(world, route.from, route.to) ||
      embargoed(from.embargoes, route.to, route.good) ||
      embargoed(to.embargoes, route.from, route.good) ||
      (to.diplo.relations[route.from] ?? 0) < RELATION_CUTOFF
    const service = services.get(route.id)
    const matched = service?.matched ?? 0
    const capacity =
      service?.capacity ?? route.level * ROUTE_UNIT_VOLUME * routeCapacityFactor(from, to)
    const margin = to.econ.prices[route.good] - routeLandedPrice(from, to, route.good)
    const healthy =
      !blocked && margin > 0 && capacity > 0 && matched / capacity >= ROUTE_GROW_UTILIZATION
    const level = healthy ? Math.min(ROUTE_MAX_LEVEL, route.level + 1) : route.level - 1
    if (level <= 0) continue
    kept.push({ ...route, level, lastQty: service?.flow.quantity ?? 0, lastMargin: margin })
  }
  world.tradeRoutes = kept
  autoOpenRoutes(world, markets)
}

/** Opens at most one route per country for a complementary pair (ADR 0020). */
function autoOpenRoutes(world: WorldState, markets: Record<string, MarketSnapshot>): void {
  const ids = Object.keys(world.countries).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const count = new Map<string, number>()
  const has = new Set<string>()
  for (const route of world.tradeRoutes) {
    count.set(route.from, (count.get(route.from) ?? 0) + 1)
    count.set(route.to, (count.get(route.to) ?? 0) + 1)
    has.add(route.id)
  }
  type Candidate = { importer: string; exporter: string; good: GoodId; margin: number }
  const candidates: Candidate[] = []
  for (const importerId of ids) {
    const importer = world.countries[importerId]
    const market = markets[importerId]
    if (importer === undefined || market === undefined) continue
    for (const good of TRADABLE_GOODS) {
      if (market.demand[good] - market.production[good] <= 0) continue
      for (const exporterId of ids) {
        if (exporterId === importerId) continue
        const exporter = world.countries[exporterId]
        const exporterMarket = markets[exporterId]
        if (exporter === undefined || exporterMarket === undefined) continue
        if (exporterMarket.production[good] - exporterMarket.demand[good] <= 0) continue
        if (has.has(routeId(good, exporterId, importerId))) continue
        if (atWar(world, exporterId, importerId)) continue
        if (embargoed(importer.embargoes, exporterId, good)) continue
        if (embargoed(exporter.embargoes, importerId, good)) continue
        if ((importer.diplo.relations[exporterId] ?? 0) < RELATION_CUTOFF) continue
        const margin = importer.econ.prices[good] - routeLandedPrice(exporter, importer, good)
        candidates.push({ importer: importerId, exporter: exporterId, good, margin })
      }
    }
  }
  candidates.sort(
    (a, b) =>
      b.margin - a.margin ||
      (a.good < b.good ? -1 : a.good > b.good ? 1 : 0) ||
      (a.importer < b.importer ? -1 : a.importer > b.importer ? 1 : 0) ||
      (a.exporter < b.exporter ? -1 : a.exporter > b.exporter ? 1 : 0),
  )
  const opened = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.margin <= 0) continue
    if (opened.has(candidate.importer)) continue
    if ((count.get(candidate.importer) ?? 0) >= ROUTE_MAX_PER_COUNTRY) continue
    if ((count.get(candidate.exporter) ?? 0) >= ROUTE_MAX_PER_COUNTRY) continue
    const id = routeId(candidate.good, candidate.exporter, candidate.importer)
    if (has.has(id)) continue
    world.tradeRoutes.push({
      id,
      good: candidate.good,
      from: candidate.exporter,
      to: candidate.importer,
      level: 1,
      owner: world.tick % 2 === 0 ? 'private' : 'state',
      openedAt: { ...world.date },
      lastQty: 0,
      lastMargin: candidate.margin,
    })
    has.add(id)
    opened.add(candidate.importer)
    count.set(candidate.importer, (count.get(candidate.importer) ?? 0) + 1)
    count.set(candidate.exporter, (count.get(candidate.exporter) ?? 0) + 1)
  }
}

/**
 * Seeds the initial route network at world creation (ADR 0020): one clearing on
 * the calibrated markets, then a level-1 route for the top flows into each
 * (importer, good). Deterministic; the residual market still handles any flow
 * not seeded, so the 1836 economy is unchanged in kind.
 */
export function bootstrapRoutes(world: WorldState): void {
  const countries = Object.values(world.countries)
  const markets: Record<string, MarketSnapshot> = {}
  for (const country of countries) markets[country.id] = inspectEconomy(country)
  const balance = clearTrade(countries, markets)
  const groups = new Map<string, TradeFlow[]>()
  for (const flow of balance.flows) {
    const key = `${flow.good}|${flow.to}`
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [flow])
    else list.push(flow)
  }
  const routes: TradeRoute[] = []
  for (const list of groups.values()) {
    list.sort((a, b) => b.value - a.value || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    for (const flow of list.slice(0, ROUTE_SEED_PER_PAIR)) {
      routes.push({
        id: routeId(flow.good, flow.from, flow.to),
        good: flow.good,
        from: flow.from,
        to: flow.to,
        level: 1,
        owner: 'private',
        openedAt: { ...world.date },
        lastQty: 0,
        lastMargin: 0,
      })
    }
  }
  routes.sort(
    (a, b) =>
      (a.good < b.good ? -1 : a.good > b.good ? 1 : 0) ||
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  )
  world.tradeRoutes = routes
}

export function advance(
  world: WorldState,
  months: number,
  decisions: Decision[],
  rng: Rng,
): AdvanceReport {
  const start = { ...world.date }
  const log: LogEntry[] = []
  const pending: GameEvent[] = []

  // One decision per AI country, plus the player's own actions.
  for (const decision of decisions.slice(0, 12)) {
    const result = applyDecision(world, decision, rng)
    if (result.ok) {
      log.push({
        date: { ...world.date },
        // Diplomacy moves (including embargo/unembargo/tension) and crisis
        // proposals read as diplomacy in the chronicle; else politics (plan §6).
        kind:
          decision.action === 'diplomacy' || decision.action === 'situation'
            ? 'diplomacy'
            : 'politics',
        countryId: decision.countryId,
        text: result.text,
      })
    }
  }

  const total = clamp(Math.floor(months), 1, 120)
  for (let index = 0; index < total; index += 1) {
    world.date = advanceDate(world.date)
    world.tick += 1
    // Reparations are booked before any country simulates, so both sides see
    // the same installment in this month's income/expense.
    prepareIndemnities(world)
    // Embargoes age at the start of the month, before clearing, so an embargo
    // that expires this month no longer blocks it (plan §3).
    expireEmbargoes(world, log)
    const countries = Object.values(world.countries)
    // Phase A: snapshot every country's domestic production and demand before
    // any of them is settled, so import/export decisions are order-independent.
    const markets: Record<string, MarketSnapshot> = {}
    for (const country of countries) markets[country.id] = inspectEconomy(country)
    // Phase B: clear each tradable good globally, then cap imports by soft
    // capacity (plan §2.3) before anything is derived from the flows. Standing
    // routes reserve their supply first (ADR 0020); the routeServices map keeps
    // each route's shared flow so growth/decay can read it after the cuts.
    const routeServices = new Map<string, RouteService>()
    const balance = clearTrade(
      countries,
      markets,
      tradeBlocker(world),
      world.tradeRoutes,
      routeServices,
    )
    const capacities = applyCapacity(countries, balance, world.tick)
    // Payment capacity (plan §10) is a second, independent limiter: a country
    // cannot fund imports past its export revenue, private capital and a small
    // GDP-share of new debt. Applied after the soft capacity as one
    // deterministic pass, so a country may be capped by either.
    applyPaymentCapacity(countries, balance)
    // Phases C/D: recompute each country from its effective supply and book NX.
    for (const country of countries) {
      const market = markets[country.id] as MarketSnapshot
      const settlement = settleTrade(country, balance.flows, world.tick)
      const supply = effectiveSupply(
        market.production,
        balance.importQty[country.id] as Record<GoodId, number>,
        balance.exportQty[country.id] as Record<GoodId, number>,
      )
      simulateCountry(world, country, rng, log, {
        supply,
        nx: balance.nx[country.id] ?? 0,
        settlement,
      })
      recordTrade(
        country,
        balance,
        capacities[country.id] ?? 0,
        settlement,
        deriveResourceImports(balance.flows, country.id),
      )
    }
    // Routes grow, decay or open once per month, after every country has been
    // settled, so their margin reads the freshly updated domestic prices.
    growRoutes(world, routeServices, markets)
    driftRelations(world)
    applyTradeRelations(world, log)
    resolveWars(world, rng, log)
    // Age and (maybe) open the opium crisis (plan §4.1). Settlement is deferred
    // to the host, which owns the async arbiter (§4.4).
    tickSituations(world, log)
    pending.push(...tickEvents(world, rng, log))
  }

  world.log.push(...log)
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  world.events.push(...pending)
  if (world.events.length > 80) world.events.splice(0, world.events.length - 80)

  return { start, end: { ...world.date }, log, events: pending }
}

export function newWorld(seed: number, playerId: string): WorldState {
  const world = createWorld(seed, playerId)
  calibrateWorld(world)
  bootstrapRoutes(world)
  return world
}
