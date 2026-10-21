import type {
  BuildingId,
  Country,
  ConstructionProject,
  Embargo,
  EventOption,
  GameDate,
  GameEvent,
  GdpComponents,
  GoodId,
  LogEntry,
  LogKind,
  PolicyEffect,
  PolicyProposal,
  TradeRoute,
  TradeTension,
  War,
  WarGoal,
  WarIndemnity,
  WorldState,
} from '../types'
import type { LaborStats } from './data'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  CONSUMPTION_PROPENSITY,
  CONSUMER_GOODS,
  GOODS,
  GOOD_IDS,
  GOVERNMENT_DEMAND,
  INCOME_ELASTICITY,
  INVESTMENT_DEMAND,
  SPENDING,
  SUBSISTENCE,
  WAR_GOAL_NAMES,
  buildOf,
  createWorld,
  deriveBureaucracy,
  deriveLabor,
  deriveUnemployment,
  effectiveCount,
  makeRngForWorld,
  resourceMultiplier,
  spawnEvent,
  successorFor,
  techCost,
  techName,
} from './data'
import {
  CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL,
  debtPressure,
  expenseParts,
  incomeParts,
  nationalDebt,
  type ExpenseParts,
  type IncomeParts,
} from './fiscal'
import type { Rng } from './rng'
import {
  MODIFIER_STATS,
  MODIFIER_STAT_NAMES,
  addModifier,
  applyModifiers,
  tickModifiers,
  totalsFor,
} from './modifiers'
import { evaluateThresholds, logThresholds } from './thresholds'
import {
  applyCapacity,
  applyPaymentCapacity,
  clearTrade,
  deriveResourceImports,
  effectiveResources,
  effectiveSupply,
  embargoed,
  RELATION_CUTOFF,
  ROUTE_GROW_UTILIZATION,
  ROUTE_MAX_LEVEL,
  ROUTE_MAX_PER_COUNTRY,
  ROUTE_SEED_PER_PAIR,
  ROUTE_UNIT_VOLUME,
  routeCapacityFactor,
  routeId,
  routeLandedPrice,
  settleTrade,
  TRADABLE_GOODS,
  type MarketSnapshot,
  type RouteService,
  type TradeBalance,
  type TradeBlocker,
  type TradeSettlement,
} from './trade'
import { recordSituationProposal, tickSituations } from './situations'

export type Decision = {
  countryId: string
  action: string
  params: Record<string, string | number | boolean | undefined>
  narrative?: string
}

export type AdvanceReport = {
  start: GameDate
  end: GameDate
  log: LogEntry[]
  events: GameEvent[]
}

export type EconomySnapshot = {
  production: Record<GoodId, number>
  /** Supply actually available after trade: production + imports − exports. */
  supply: Record<GoodId, number>
  demand: Record<GoodId, number>
  /** Headline GDP after the `gdp` statistical modifier. */
  gdp: number
  /** Expenditure GDP before the `gdp` modifier; drives wages and profits. */
  realGdp: number
  income: number
  expense: number
  /** Raw revenue/outlay parts used to build this month's totals. */
  revenue: IncomeParts
  outlay: ExpenseParts
  components: GdpComponents
  laborShare: number
  wages: number
  profits: number
  labor: LaborStats
}

export const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

const sumParts = (parts: Record<string, number>): number =>
  Object.values(parts).reduce((sum, value) => sum + value, 0)

/** The applied share of a raw part after the `income`/`expense` modifier. */
const appliedPart = (raw: number, rawTotal: number, total: number): number =>
  rawTotal > 0 ? raw * (total / rawTotal) : 0

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

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const techMultiplier = (country: Country): number => 1 + country.tech.level * 0.07

/**
 * Resource multipliers for every good, for display and price formation. Reads
 * this month's effective endowments: last month's resource imports raise coal,
 * iron and timber toward the base (the `econ.resources` base itself stays put,
 * plan §2.6).
 */
export function resourceFactors(country: Country): Record<GoodId, number> {
  const out = zeroGoods()
  const effective = effectiveResources(country)
  for (const id of GOOD_IDS) out[id] = resourceMultiplier(effective, id)
  return out
}

/**
 * Additive v7 fields: a world loaded before the construction sector existed
 * has no `workshops` count or rent field. Fill them once in place so the
 * running game (not just a reloaded save) gets a working construction sector.
 */
function ensureConstructionFields(country: Country): void {
  const buildings = country.econ.buildings as Record<string, number>
  if (typeof buildings.workshops !== 'number') {
    buildings.workshops = Math.min(
      24,
      Math.max(1, Math.round((buildings.factories ?? 0) / 2)),
    )
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

function computeProduction(country: Country): Record<GoodId, number> {
  ensureConstructionFields(country)
  const tech = techMultiplier(country)
  const marketAccess = applyModifiers(country, 'marketAccess', country.econ.marketAccess)
  const access = 0.55 + marketAccess * 0.9
  const transport = applyModifiers(
    country,
    'transportInfrastructure',
    country.econ.transportInfrastructure,
  )
  const infra = 0.6 + transport / 160
  const b = country.econ.buildings
  const resources = resourceFactors(country)
  // Coal and iron are industrial inputs: a country poor in both runs its
  // factories less efficiently. This is what lets endowments reach GDP, not
  // just raw material output (round-1 playtest finding P1-4).
  const industrial = clamp((resources.coal + resources.iron) / 2, 0.7, 1.3)
  const out = zeroGoods()
  // Scale diminishing returns: capacity grows as count^0.98 (plan 0003 §0.1).
  const cap = (count: number): number => effectiveCount(count)
  // Every good reads through the generic `production` buff and its own
  // per-good buff, so policies can target either scale.
  const output = (id: GoodId, value: number): number =>
    applyModifiers(
      country,
      'production',
      applyModifiers(country, `${id}Output`, value * resources[id]),
    )
  const farm = (value: number): number => applyModifiers(country, 'farmOutput', value)
  const mine = (value: number): number => applyModifiers(country, 'mineOutput', value)
  const factory = (value: number): number => applyModifiers(country, 'factoryOutput', value)

  out.grain = output('grain', farm(cap(b.farms) * 0.30 * tech * infra * access))
  out.wood = output('wood', farm(cap(b.farms) * 0.04) + mine(cap(b.mines) * 0.04))
  out.coal = output('coal', mine(cap(b.mines) * 0.5 * tech))
  out.iron = output('iron', mine(cap(b.mines) * 0.42 * tech))
  out.fabric = output('fabric', factory(cap(b.factories) * 0.6 * tech * industrial))
  // Artisans supply the bottom of the consumer market before factories do;
  // without them an agrarian country reads as permanently short of clothes.
  out.clothes = output(
    'clothes',
    factory(cap(b.factories) * 0.38 * tech * industrial) + country.pops.artisans * 0.035,
  )
  out.liquor = output(
    'liquor',
    factory(cap(b.factories) * 0.2 * industrial) + country.pops.artisans * 0.01,
  )
  out.furniture = output(
    'furniture',
    factory(cap(b.factories) * 0.22 * tech * industrial) + country.pops.artisans * 0.006,
  )
  out.machinery = output('machinery', factory(cap(b.factories) * 0.18 * tech * industrial))
  out.arms = output(
    'arms',
    factory(cap(b.factories) * 0.07 * tech * industrial) + cap(b.barracks) * 0.05,
  )
  out.luxury = output('luxury', factory(cap(b.factories) * 0.035 * tech * industrial))
  out.services = output(
    'services',
    (country.pops.total / 1000) * 0.5 * access +
      country.pops.artisans * 0.01 +
      cap(b.offices) * 0.8 +
      cap(b.universities) * 0.2,
  )
  // Opium is farm-grown (plan 0004 §1.1) and scaled by the country's own
  // output factor, which lets Britain stand in for British India.
  out.opium = output(
    'opium',
    cap(b.farms) * 0.004 * tech * infra * access * country.opium.outputFactor,
  )
  return out
}

/** Construction points one workshop produces per month before input limits. */
export const WORKSHOP_CAPACITY_OUTPUT = 4

/** Goods one workshop consumes per month to run at full capacity. */
export const WORKSHOP_INPUTS: Partial<Record<GoodId, number>> = {
  wood: 1,
  grain: 0.6,
  iron: 0.3,
}

/** Construction points a project needs each month, per building in the slot. */
export const CAPACITY_COST: Record<BuildingId, number> = {
  farms: 0.5,
  mines: 1,
  factories: 2,
  railroads: 4,
  ports: 1.5,
  universities: 2,
  barracks: 1,
  offices: 1,
  workshops: 1.5,
}

/**
 * Private builders can do half a slot's monthly work with their own
 * organisation; the other half can rent idle state construction points, which
 * pays the treasury. State slots always have first claim on the points.
 */
export const PRIVATE_OWN_CAPACITY_SHARE = 0.5
/** Gold the state charges per rented construction point. */
export const CONSTRUCTION_RENT_PER_POINT = 0.3
/**
 * A slot may hold at most 5 buildings. There is no monthly point ceiling per
 * slot: the queue is the brake, and an entry may take every idle point up to
 * its remaining workload (ADR 0013).
 */
export const MAX_BUILDINGS_PER_SLOT = 5

/**
 * Total construction workload per unit of monthly point requirement. A slot
 * with one workshop (1.5 points of monthly need) carries 30 × 1.5 = 45 points
 * of workload. A slot is not limited to its own monthly need: it can draw any
 * idle state capacity, up to its remaining workload, so a small project
 * finishes faster when the workshops are otherwise idle. Duration is always
 * workload / points actually invested (ADR 0012/0013), never a stored month
 * count.
 */
export const WORKLOAD_MULTIPLIER = 30

export const capacityCost = (project: ConstructionProject): number =>
  (CAPACITY_COST[project.building] ?? 1) * project.count

/** Total points of work a project must complete. */
export const projectWorkload = (project: ConstructionProject): number =>
  capacityCost(project) * WORKLOAD_MULTIPLIER

export const maxSlotCapacity = (building: BuildingId): number =>
  MAX_BUILDINGS_PER_SLOT * (CAPACITY_COST[building] ?? 1)

/** Base gold paid per construction-workload point (ADR 0012). */
export const CONSTRUCTION_COST_PER_POINT = 0.2
/** Per-building gold tuning; v1 is 1 for every type. */
export const BUILDING_COST_MULTIPLIER: Record<BuildingId, number> = {
  farms: 1,
  mines: 1,
  factories: 1,
  railroads: 1,
  ports: 1,
  universities: 1,
  barracks: 1,
  offices: 1,
  workshops: 1,
}
/** Per-building fixed gold addend; v1 is 0 for every type. */
export const BUILDING_COST_ADDEND: Record<BuildingId, number> = {
  farms: 0,
  mines: 0,
  factories: 0,
  railroads: 0,
  ports: 0,
  universities: 0,
  barracks: 0,
  offices: 0,
  workshops: 0,
}

/**
 * Gold per workload point for a project: the fixed base times the building
 * multiplier, plus its addend spread over the workload (so the total stays
 * workload × per-point + addend).
 */
export function constructionGoldPerPoint(project: ConstructionProject): number {
  const workload = projectWorkload(project)
  return (
    CONSTRUCTION_COST_PER_POINT *
      (BUILDING_COST_MULTIPLIER[project.building] ?? 1) +
    (BUILDING_COST_ADDEND[project.building] ?? 0) / Math.max(1, workload)
  )
}

/** Total gold cost of the project: workload × per-point price. */
export const constructionTotalCost = (
  project: ConstructionProject,
): number => projectWorkload(project) * constructionGoldPerPoint(project)

/** Monthly gold bill when the slot receives its full monthly points. */
export const constructionMonthlyCost = (
  project: ConstructionProject,
): number => capacityCost(project) * constructionGoldPerPoint(project)

const importedQuantity = (country: Country, good: GoodId): number =>
  country.trade.imports
    .filter(flow => flow.good === good)
    .reduce((sum, flow) => sum + flow.quantity, 0)

/**
 * Construction points a country produces this month. Workshops are the source;
 * their output is capped by the availability of wood, grain and iron, so a
 * country that cannot supply the inputs builds slower (ADR 0010).
 */
export function constructionCapacity(country: Country): number {
  ensureConstructionFields(country)
  const workshops = country.econ.buildings.workshops ?? 0
  if (workshops <= 0) return 0
  const access = 0.55 + applyModifiers(country, 'marketAccess', country.econ.marketAccess) * 0.9
  const transport = applyModifiers(
    country,
    'transportInfrastructure',
    country.econ.transportInfrastructure,
  )
  const infra = 0.6 + transport / 160
  const gross =
    effectiveCount(workshops) *
      WORKSHOP_CAPACITY_OUTPUT *
      techMultiplier(country) *
      infra *
      access +
    Math.max(0, country.econ.spending.construction ?? 0) *
      CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL
  const production = computeProduction(country)
  let inputRatio = 1
  for (const [good, perWorkshop] of Object.entries(WORKSHOP_INPUTS) as [
    GoodId,
    number,
  ][]) {
    const need = workshops * perWorkshop
    if (need <= 0) continue
    const available = production[good] + importedQuantity(country, good)
    inputRatio = Math.min(inputRatio, available / need)
  }
  return Math.max(0, gross * clamp(inputRatio, 0, 1))
}

export type ConstructionSchedule = Record<
  string,
  {
    /** Months from now until completion (1 = the upcoming settlement). */
    turns: number
    /** Share of this month's need the slot receives right now. */
    currentShare: number
    /** Points still missing from this month's slot need. */
    remainingPoints: number
  }
>

/**
 * Projects the state queue forward with today's construction capacity and slot
 * ceilings, including the extra points from workshops that are still being
 * built. Gold is ignored (the state can deficit-finance); the estimate is a
 * planning aid, not a promise.
 */
export function constructionSchedule(country: Country): ConstructionSchedule {
  ensureConstructionFields(country)
  normalizeConstructionQueue(country)
  const state = country.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') !== 'private',
  )
  const result: ConstructionSchedule = {}
  if (state.length === 0) return result
  // Conservative: use today's capacity for every future month. Workshops still
  // under construction are not assumed to finish, so the estimate never
  // promises points that do not exist yet.
  const capacity = constructionCapacity(country)
  const progress = new Map(state.map(project => [project.id, project.progress]))
  const monthsLeft = new Map(state.map(project => [project.id, project.monthsLeft]))
  const active = new Set(state.map(project => project.id))

  let left = capacity
  for (const project of state) {
    const need = capacityCost(project)
    const workload = projectWorkload(project)
    const remainingWorkload = workload * Math.max(0, 1 - project.progress)
    const take = Math.min(left, remainingWorkload)
    left -= take
    result[project.id] = {
      turns: 60,
      currentShare: need > 0 ? Math.min(1, take / need) : 1,
      remainingPoints: Math.max(0, remainingWorkload - take),
    }
  }

  for (let month = 1; month <= 60 && active.size > 0; month += 1) {
    let monthCapacity = capacity
    for (const project of state) {
      if (!active.has(project.id)) continue
      const workload = projectWorkload(project)
      const remainingPoints =
        workload * Math.max(0, 1 - (progress.get(project.id) ?? 0))
      // A slot may draw any idle capacity, not just its own monthly need: the
      // queue is the only brake, so a one-building entry can finish at once
      // when the workshops have nothing else to do.
      const take = Math.min(monthCapacity, remainingPoints)
      monthCapacity -= take
      const share = workload > 0 ? take / workload : 1
      let projectProgress = (progress.get(project.id) ?? 0) + share
      let remainingMonths = monthsLeft.get(project.id) ?? 1
      while (projectProgress >= 1 - 1e-9 && remainingMonths > 0) {
        projectProgress -= 1
        remainingMonths -= 1
      }
      if (remainingMonths <= 0) {
        result[project.id]!.turns = month
        active.delete(project.id)
      } else {
        progress.set(project.id, projectProgress)
        monthsLeft.set(project.id, remainingMonths)
      }
    }
  }
  return result
}

export type ConstructionLoad = {
  /** Points produced this month. */
  capacity: number
  /** Points the whole queue would use if it ran at full speed. */
  requested: number
  /** Points actually allocated in queue order. */
  allocated: number
  /** capacity − allocated. */
  remaining: number
  /** Per-project allocation, in queue order. */
  byProject: Record<string, number>
  /** Private builders' own 50% capacity (not taken from the state). */
  privateOwn: number
  /** State points rented by private projects. */
  privateRented: number
  /** Idle state points rented to the private market after the project passes. */
  privateMarket: number
  /** Per private project: own share and rented state points. */
  privateByProject: Record<string, { own: number; rented: number }>
}

/**
 * Walks the *state* queue in order and allocates state construction points
 * until they run out. Private projects are funded by private capital and never
 * consume the state's workshops (ADR 0010), so they are excluded here.
 */
export function constructionLoad(country: Country): ConstructionLoad {
  ensureConstructionFields(country)
  normalizeConstructionQueue(country)
  const capacity = constructionCapacity(country)
  let remaining = capacity
  let requested = 0
  let allocated = 0
  const byProject: Record<string, number> = {}
  for (const project of country.econ.constructionQueue) {
    if ((project.owner ?? 'state') === 'private') continue
    const remainingPoints =
      projectWorkload(project) * Math.max(0, 1 - project.progress)
    // The queue's demand is the work left, not a monthly slot ceiling: each
    // entry can take everything the workshops can give until its work is done.
    requested += remainingPoints
    const take = Math.min(remaining, remainingPoints)
    remaining -= take
    allocated += take
    byProject[project.id] = take
  }
  // Projection of the private pass: own 50%, rent idle state points, pay gold
  // and rent from the same private pool, then rent the final idle points.
  let privateBudget = Math.max(0, country.econ.privateCapital)
  let privateOwn = 0
  let privateRented = 0
  const privateByProject: Record<string, { own: number; rented: number }> = {}
  for (const project of country.econ.constructionQueue) {
    if ((project.owner ?? 'state') !== 'private') continue
    const need = capacityCost(project)
    const workload = projectWorkload(project)
    const slotNeed = Math.min(
      need,
      maxSlotCapacity(project.building),
      workload * Math.max(0, 1 - project.progress),
    )
    const own = slotNeed * PRIVATE_OWN_CAPACITY_SHARE
    const affordableRent =
      CONSTRUCTION_RENT_PER_POINT > 0
        ? privateBudget / CONSTRUCTION_RENT_PER_POINT
        : Infinity
    const rented = Math.min(
      remaining,
      Math.max(0, slotNeed - own),
      affordableRent,
    )
    remaining -= rented
    privateBudget -= rented * CONSTRUCTION_RENT_PER_POINT
    const inputShare = need > 0 ? (own + rented) / need : 1
    privateBudget -= Math.min(privateBudget, project.monthlyCost * inputShare)
    privateOwn += own
    privateRented += rented
    privateByProject[project.id] = { own, rented }
  }
  const affordableMarket =
    CONSTRUCTION_RENT_PER_POINT > 0
      ? privateBudget / CONSTRUCTION_RENT_PER_POINT
      : 0
  const privateMarket = Math.min(remaining, Math.max(0, affordableMarket))
  remaining -= privateMarket
  return {
    capacity,
    requested,
    allocated,
    remaining,
    byProject,
    privateOwn,
    privateRented,
    privateMarket,
    privateByProject,
  }
}

type DemandBreakdown = {
  demand: Record<GoodId, number>
  /** Final-use quantities by block; GDP values them only up to supply. */
  consumer: Record<GoodId, number>
  investment: Record<GoodId, number>
  government: Record<GoodId, number>
}

/**
 * Share of profits saved for investment. The country profile sets the base,
 * investment confidence and the `privateInvestment` modifier move it
 * (plan 0003 §3/§4).
 */
export function effectiveSavingsRate(country: Country): number {
  const confidence = 1 + country.econ.investmentConfidence / 100
  return clamp(
    applyModifiers(
      country,
      'privateInvestment',
      country.politicalEconomy.savingsRate * confidence,
    ),
    0,
    0.9,
  )
}

function computeDemand(country: Country): DemandBreakdown {
  ensureConstructionFields(country)
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  const prices = country.econ.prices
  const b = country.econ.buildings
  const sp = country.econ.spending
  const demand = (id: GoodId, value: number): number =>
    applyModifiers(country, 'demand', applyModifiers(country, `${id}Demand`, value))
  const out = zeroGoods()
  const consumer = zeroGoods()

  // ---- consumer demand: Stone-Geary (plan 0003 §2.1) ----
  // The household budget is wages plus the unsaved share of profits, less
  // taxes, plus welfare transfers. Last month's bills are the best available
  // reading; the first month falls back to seed GDP.
  const wages =
    country.econ.wages > 0
      ? country.econ.wages
      : country.econ.gdp * country.politicalEconomy.laborShareBase
  const profits =
    country.econ.profits > 0
      ? country.econ.profits
      : country.econ.gdp * (1 - country.politicalEconomy.laborShareBase)
  const savingsRate = effectiveSavingsRate(country)
  const welfareTransfer = sp.welfare * popFactor * 0.03
  const taxEfficiency = 0.5 + country.government.legitimacy / 200
  const taxTake = (wages + profits) * (country.econ.taxRate / 100) * 0.4 * taxEfficiency
  const disposable = Math.max(0, wages + profits * (1 - savingsRate) - taxTake) + welfareTransfer
  const incomePerCapita = disposable / popFactor
  let subsistenceCost = 0
  for (const id of CONSUMER_GOODS) subsistenceCost += SUBSISTENCE[id] * prices[id]
  const supernumerary =
    Math.max(0, incomePerCapita - subsistenceCost) * CONSUMPTION_PROPENSITY
  for (const id of CONSUMER_GOODS) {
    const subsistence = popFactor * SUBSISTENCE[id]
    const discretionary =
      (popFactor * INCOME_ELASTICITY[id] * supernumerary) / Math.max(0.05, prices[id])
    // `consumption` scales discretionary spending, never the survival floor.
    consumer[id] = demand(
      id,
      subsistence + applyModifiers(country, 'consumption', discretionary),
    )
  }

  // Idle profits held back last month that were released as luxury spending.
  if (country.econ.idlePurchases > 0) {
    consumer.luxury += country.econ.idlePurchases / Math.max(0.1, prices.luxury)
  }

  // Opium is a separate demand block, not part of the Stone-Geary basket
  // (plan 0004 §1.1): it grows with supernumerary income and the country's
  // demand factor, and is not counted as a survival good.
  const opiumDemand = demand(
    'opium',
    popFactor * country.opium.demandFactor * (0.5 + supernumerary / 10),
  )

  for (const id of GOOD_IDS) out[id] = consumer[id]
  out.opium += opiumDemand
  const investment = zeroGoods()
  const government = zeroGoods()

  // ---- intermediate demand: industrial inputs, not part of GDP ----
  // Industrial towns buy food off the market; this puts agrarian and
  // industrial economies on opposite sides of the grain trade instead of
  // every country holding a permanent grain mountain.
  out.grain += demand('grain', b.factories * 1.0)
  // Workshops turn wood, grain and iron into construction points.
  for (const [good, perWorkshop] of Object.entries(WORKSHOP_INPUTS) as [
    GoodId,
    number,
  ][]) {
    if (perWorkshop > 0) out[good] += demand(good, b.workshops * perWorkshop)
  }
  out.coal += demand('coal', popFactor * 1.2 + b.factories * 0.35)
  out.iron += demand('iron', popFactor * 0.8 + b.factories * 0.4 + b.railroads * 0.5)
  out.fabric += demand('fabric', b.factories * 0.45 + popFactor * 0.5)
  out.wood += demand('wood', b.factories * 0.2 + b.railroads * 0.4 + popFactor * 0.3)
  out.machinery += demand('machinery', b.factories * 0.18)
  out.arms += demand('arms', country.military.army * 0.02 + country.military.navy * 0.01)

  // ---- investment demand from last month's actual construction spend ----
  // The settlement writes the goods quantities here, so a slot that finished
  // in one month still shows up in next month's I block. A project that
  // received no money contributes nothing (the phantom-investment guard).
  for (const [id, quantity] of Object.entries(
    country.econ.lastConstructionDemand ?? {},
  ) as [GoodId, number][]) {
    if (quantity <= 0) continue
    investment[id] += quantity
    out[id] += quantity
  }

  // ---- government demand from appropriations (plan 0003 §2.3) ----
  const militaryBase =
    country.military.army * 0.05 * (1 + country.military.quality) +
    country.military.navy * 0.04
  const governmentGold: Record<keyof typeof sp, number> = {
    army: sp.army * 0.5 + militaryBase * 0.7,
    navy: sp.navy * 0.5 + militaryBase * 0.3,
    bureaucracy: sp.bureaucracy * popFactor * 0.02,
    education: sp.education * popFactor * 0.03,
    // Welfare is a transfer to households (counted in C); construction is
    // investment (counted in I when actually paid). Counting either as
    // government purchases would double-count it.
    welfare: 0,
    construction: 0,
  }
  for (const [category, gold] of Object.entries(governmentGold) as [
    keyof typeof sp,
    number,
  ][]) {
    const shares = GOVERNMENT_DEMAND[category]
    for (const [id, share] of Object.entries(shares) as [GoodId, number][]) {
      const quantity = (gold * share) / Math.max(0.1, prices[id])
      government[id] += quantity
      out[id] += quantity
    }
  }

  // Every goods demand still reads through the generic per-good demand buffs
  // for the intermediate blocks above; consumer demand is already wrapped.
  return { demand: out, consumer, investment, government }
}

/** Production and demand for display, with no side effects. */
export function inspectEconomy(country: Country): {
  production: Record<GoodId, number>
  demand: Record<GoodId, number>
  resources: Record<GoodId, number>
} {
  return {
    production: computeProduction(country),
    demand: computeDemand(country).demand,
    resources: resourceFactors(country),
  }
}

export function computeEconomy(
  country: Country,
  override?: {
    supply?: Record<GoodId, number>
    nx?: number
    tariffRevenue?: number
    /** Fiscal-context flags for the interest rates (defaults: peace, tick 0). */
    atWar?: boolean
    tick?: number
  },
): EconomySnapshot {
  const production = computeProduction(country)
  const breakdown = computeDemand(country)
  const demand = breakdown.demand
  // Trade replaces domestic output with effective supply for pricing and the
  // C/I/G fill, so imported goods satisfy demand and exported ones leave it.
  const supply = override?.supply ?? production
  const nx = override?.nx ?? 0

  for (const id of GOOD_IDS) {
    const available = Math.max(0.01, supply[id])
    const ratio = demand[id] / available
    const target = GOODS[id].basePrice * clamp(Math.sqrt(ratio), 0.35, 3)
    const floor = GOODS[id].basePrice * 0.25
    const ceiling = GOODS[id].basePrice * 4
    country.econ.prices[id] = clamp(
      country.econ.prices[id] + (target - country.econ.prices[id]) * 0.3,
      floor,
      ceiling,
    )
  }

  // GDP is valued at base prices (real GDP). Each final-use block is filled in
  // proportion to its demand against effective supply, so unmet orders lower
  // GDP instead of inflating it. NX is added at base price and, like GDP, is
  // not scaled by the `gdp` statistical modifier.
  const components: GdpComponents = { c: 0, i: 0, g: 0, nx }
  for (const id of GOOD_IDS) {
    const fill = clamp(supply[id] / Math.max(0.01, demand[id]), 0, 1)
    const price = GOODS[id].basePrice
    components.c += breakdown.consumer[id] * price * fill
    components.i += breakdown.investment[id] * price * fill
    components.g += breakdown.government[id] * price * fill
  }
  const realGdp = components.c + components.i + components.g
  // The `gdp` modifier is a statistical adjustment: it scales the headline
  // and its displayed components, but wages/profits derive from realGdp so it
  // cannot compound through next month's consumer demand.
  const gdpFactor = realGdp > 0 ? applyModifiers(country, 'gdp', realGdp) / realGdp : 1
  components.c *= gdpFactor
  components.i *= gdpFactor
  components.g *= gdpFactor
  const gdp = realGdp * gdpFactor + nx

  // Revenue and expense are split by source/category in fiscal.ts so the HUD
  // can show a real cash account instead of a single net figure. Tariff
  // revenue is the gold actually collected on this month's import flows
  // (plan §2.4); construction is settled separately and folded in later.
  const context = { atWar: override?.atWar ?? false, tick: override?.tick ?? 0 }
  const revenue = incomeParts(
    country,
    gdp,
    override?.tariffRevenue ?? 0,
    context,
  )
  const income = applyModifiers(
    country,
    'income',
    revenue.taxes +
      revenue.tariffs +
      revenue.ports +
      revenue.sovereignIncome +
      revenue.reparations +
      revenue.other,
  )
  const outlay = expenseParts(country, gdp, context)
  const expense = applyModifiers(
    country,
    'expense',
    outlay.army +
      outlay.navy +
      outlay.administration +
      outlay.education +
      outlay.welfare +
      outlay.debtInterest +
      outlay.marketLoss +
      outlay.upkeep +
      outlay.reparations +
      outlay.constructionSubsidy,
  )

  const labor = deriveLabor(country)
  const rawShare =
    country.politicalEconomy.laborShareBase - (country.econ.unemployment - 5) * 0.01
  const laborShare = clamp(applyModifiers(country, 'laborShare', rawShare), 0.35, 0.7)
  const wages = realGdp * laborShare
  const profits = realGdp * (1 - laborShare)

  return {
    production,
    supply,
    demand,
    gdp,
    realGdp,
    income,
    expense,
    revenue,
    outlay,
    components,
    laborShare,
    wages,
    profits,
    labor,
  }
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

function computePrestige(country: Country): number {
  return clamp(
    applyModifiers(
      country,
      'prestige',
      country.econ.gdp * 0.05 +
        country.military.army * 0.18 +
        country.military.navy * 0.22 +
        country.tech.level * 4 +
        country.econ.buildings.ports * 0.2,
    ),
    0,
    240,
  )
}

function pushHistory(list: number[], value: number): void {
  list.push(Math.round(value * 100) / 100)
  if (list.length > 36) list.shift()
}

/** Adds built structures and their side effects. */
export function completeBuilding(country: Country, building: BuildingId, count: number): void {
  ensureConstructionFields(country)
  // Negative counts remove buildings (天命); never go below zero.
  country.econ.buildings[building] = Math.max(
    0,
    (country.econ.buildings[building] ?? 0) + count,
  )
  if (building === 'railroads') {
    country.econ.transportInfrastructure = clamp(
      country.econ.transportInfrastructure + count * 3,
      0,
      100,
    )
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * 0.02, 0, 1)
  }
  if (building === 'ports') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * 0.01, 0, 1)
  }
  if (building === 'universities') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count * 0.5,
      0,
      100,
    )
  }
  if (building === 'offices') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count,
      0,
      100,
    )
  }
  country.bureaucracy = deriveBureaucracy(country, true)
}

/**
 * Bring legacy projects onto the current workload rules (ADR 0012/0013):
 * cost priced per workload point, and at most five buildings per slot
 * (oversized slots are split).
 */
export function normalizeConstructionQueue(country: Country): void {
  const queue = country.econ.constructionQueue
  if (queue.length === 0) return
  const next: ConstructionProject[] = []
  let changed = false
  for (const project of queue) {
    const expectedMonthly = constructionMonthlyCost(project)
    if (
      project.monthsLeft !== 1 ||
      Math.abs(project.monthlyCost - expectedMonthly) > 1e-9
    ) {
      project.monthsLeft = 1
      project.monthlyCost = expectedMonthly
      changed = true
    }
    if (project.count > MAX_BUILDINGS_PER_SLOT) {
      let remaining = project.count
      let index = 0
      while (remaining > 0) {
        const count = Math.min(MAX_BUILDINGS_PER_SLOT, remaining)
        const part: ConstructionProject = {
          ...project,
          id: index === 0 ? project.id : `${project.id}-split${index}`,
          count,
          monthsLeft: 1,
          monthlyCost: 0,
          lastSpend: 0,
          lastCapacity: 0,
        }
        part.monthlyCost = constructionMonthlyCost(part)
        next.push(part)
        remaining -= count
        index += 1
      }
      changed = true
    } else {
      next.push(project)
    }
  }
  if (changed) country.econ.constructionQueue = next
}

/**
 * Spends the month's construction budget on queued projects. Money is
 * deducted as it is spent; whatever no project absorbs is administrative
 * waste (plan §7.3). Projects whose cash or budget runs out keep their
 * progress and wait for a better month.
 */
function settleConstruction(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
): number {
  ensureConstructionFields(country)
  normalizeConstructionQueue(country)
  const queue = country.econ.constructionQueue
  if (queue.length === 0) {
    country.econ.lastConstructionSpend = 0
    country.econ.lastStateConstructionSpend = 0
    country.econ.lastPrivateConstructionSpend = 0
    country.econ.lastConstructionRent = 0
    country.econ.lastConstructionDemand = {}
    return 0
  }
  let privateBudget = Math.max(0, country.econ.privateCapital)
  // State slots have first claim on the points; private slots use what is idle.
  let capacityLeft = constructionCapacity(country)
  // Deficit-financed construction: a small negative balance is normal debt,
  // not a stop sign. Only the 3× GDP restructuring floor removes the cash.
  const debtFloor = -country.econ.gdp * 3
  const kept = new Set<string>()
  let stateSpent = 0
  let privateSpent = 0
  let rentalIncome = 0
  const nextConstructionDemand: Partial<Record<GoodId, number>> = {}
  // A fully funded slot finishes in one month; `constructionSpeed` policies
  // and the debt-pressure penalty are the only modifiers on that pace.
  const constructionSpeed = applyModifiers(country, 'constructionSpeed', 1)

  const runProject = (
    project: ConstructionProject,
    capacityTake: number,
    inputShare: number,
    workShare: number,
    isPrivate: boolean,
  ): void => {
    const owner = isPrivate ? 'private' : 'state'
    const goldNeed = project.monthlyCost * inputShare
    const spend =
      capacityTake <= 0
        ? 0
        : isPrivate
          ? Math.min(privateBudget, goldNeed)
          : Math.min(goldNeed, Math.max(0, country.econ.treasury - debtFloor))
    project.lastSpend = spend
    project.lastCapacity = capacityTake
    if (spend > 0) {
      if (isPrivate) {
        privateBudget -= spend
        privateSpent += spend
      } else {
        stateSpent += spend
        country.econ.treasury -= spend
      }
      const funded =
        project.monthlyCost > 0 ? spend / project.monthlyCost : inputShare
      for (const [id, coefficient] of Object.entries(
        INVESTMENT_DEMAND[project.building],
      ) as [GoodId, number][]) {
        nextConstructionDemand[id] =
          (nextConstructionDemand[id] ?? 0) + coefficient * project.count * funded
      }
    }
    const goldShare = goldNeed > 0 ? spend / goldNeed : 1
    if (capacityTake > 0 && spend > 0) {
      const speed =
        constructionSpeed *
        (isPrivate ? 1 : 1 - debtPressure(country).constructionPenalty)
      const remainingWork =
        projectWorkload(project) * Math.max(0, 1 - project.progress)
      if (capacityTake >= remainingWork - 1e-9 && goldShare >= 1 - 1e-9) {
        // The slot received all the work it still needed. A speed penalty
        // multiplies progress, which would otherwise leave an asymptotic
        // "100% but still queued" tail for several months (PT-027).
        project.progress = 1
      } else {
        // Work is bounded by both the points invested and what the treasury or
        // private pool could actually pay for.
        const effective = workShare * Math.min(1, goldShare) * speed
        project.progress = Math.min(1, project.progress + effective)
      }
    }
    if (project.progress >= 1 - 1e-9) {
      completeBuilding(country, project.building, project.count)
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text:
          owner === 'private'
            ? `[${country.flag}] ${country.name}的私人资本建成 ${project.count} 座${BUILDINGS[project.building].name}`
            : `[${country.flag}] ${country.name}建成 ${project.count} 座${BUILDINGS[project.building].name}`,
      })
      return
    }
    kept.add(project.id)
  }

  // Pass 1: state slots, strictly in queue order, take points until exhausted.
  for (const project of queue) {
    if ((project.owner ?? 'state') === 'private') continue
    const need = capacityCost(project)
    const workload = projectWorkload(project)
    const remainingPoints = workload * Math.max(0, 1 - project.progress)
    const capacityTake = Math.min(capacityLeft, remainingPoints)
    capacityLeft -= capacityTake
    runProject(
      project,
      capacityTake,
      need > 0 ? capacityTake / need : 1,
      workload > 0 ? capacityTake / workload : 1,
      false,
    )
  }

  // Pass 2: private slots do half the work with their own organisation and may
  // rent idle state points for the rest; rent is private gold paid to the state.
  for (const project of queue) {
    if ((project.owner ?? 'state') !== 'private') continue
    const need = capacityCost(project)
    const workload = projectWorkload(project)
    const slotNeed = Math.min(
      need,
      maxSlotCapacity(project.building),
      workload * Math.max(0, 1 - project.progress),
    )
    const own = slotNeed * PRIVATE_OWN_CAPACITY_SHARE
    const affordableRent =
      CONSTRUCTION_RENT_PER_POINT > 0
        ? privateBudget / CONSTRUCTION_RENT_PER_POINT
        : Infinity
    const rented = Math.min(
      capacityLeft,
      Math.max(0, slotNeed - own),
      affordableRent,
    )
    capacityLeft -= rented
    const rent = rented * CONSTRUCTION_RENT_PER_POINT
    if (rent > 0) {
      privateBudget -= rent
      rentalIncome += rent
    }
    const capacityTake = own + rented
    runProject(
      project,
      capacityTake,
      need > 0 ? capacityTake / need : 1,
      workload > 0 ? capacityTake / workload : 1,
      true,
    )
  }

  // Any points still idle after the state and private project passes are
  // rented to the private sector as a construction service, paid from private
  // capital. This turns overbuilt capacity into treasury income instead of
  // leaving it unused.
  if (capacityLeft > 0 && CONSTRUCTION_RENT_PER_POINT > 0) {
    const affordableIdle = privateBudget / CONSTRUCTION_RENT_PER_POINT
    const idleRented = Math.min(capacityLeft, Math.max(0, affordableIdle))
    const idleRent = idleRented * CONSTRUCTION_RENT_PER_POINT
    if (idleRent > 0) {
      privateBudget -= idleRent
      rentalIncome += idleRent
    }
  }

  country.econ.constructionQueue = queue.filter(project => kept.has(project.id))
  country.econ.privateCapital = privateBudget
  country.econ.lastConstructionSpend = stateSpent + privateSpent
  country.econ.lastStateConstructionSpend = stateSpent
  country.econ.lastPrivateConstructionSpend = privateSpent
  country.econ.lastConstructionRent = rentalIncome
  country.econ.lastConstructionDemand = nextConstructionDemand
  // Unused appropriations are not spent at all: the appropriation is a monthly
  // cap, not a charge. This keeps the displayed budget equal to the treasury.
  return stateSpent
}

/**
 * Expected-return proxy for one building at current prices and demand. It
 * compares the current price basket with base prices and weights it by the
 * demand/supply pressure of the goods the building makes. The capital
 * threshold (4%/year + debt ratio × 2%) is expressed as a markup on 1
 * (plan 0003 §0.1/§4).
 */
export function investmentScore(
  country: Country,
  building: BuildingId,
  demand: Record<GoodId, number>,
  production: Record<GoodId, number>,
): number {
  const outputs = BUILDING_OUTPUT[building]
  const industrial = clamp(
    (resourceMultiplier(country.econ.resources, 'coal') +
      resourceMultiplier(country.econ.resources, 'iron')) /
      2,
    0.7,
    1.3,
  )
  let weightSum = 0
  let pressureSum = 0
  let potentialSum = 0
  for (const [id, quantity] of Object.entries(outputs) as [GoodId, number][]) {
    const resource = resourceMultiplier(country.econ.resources, id)
    const potential = building === 'factories' ? resource * industrial : resource
    const weight = quantity * GOODS[id].basePrice
    const ratio = clamp(demand[id] / Math.max(0.01, production[id]), 0.3, 2)
    weightSum += weight
    pressureSum += weight * ratio
    potentialSum += weight * potential
  }
  if (weightSum <= 0) return 0
  // Unmet demand is the primary signal; resource/industrial potential decides
  // whether this country is a good place to add the capacity.
  return (pressureSum / weightSum) * (potentialSum / weightSum)
}

/** Renewal score for buildings with no direct good output. */
function infrastructureScore(country: Country, building: BuildingId): number {
  const b = country.econ.buildings
  switch (building) {
    case 'railroads':
      return 0.55 + (1 - country.econ.transportInfrastructure / 100) * 0.5
    case 'ports':
      return 0.55 + (1 - country.econ.marketAccess) * 0.5
    case 'universities':
      return 0.55 + (1 - country.pops.literacy) * 0.3
    case 'offices': {
      const ceiling = country.bureaucracy.ceiling / 100
      return 0.55 + (1 - clamp(ceiling, 0, 1)) * 0.3 + (b.offices < 4 ? 0.1 : 0)
    }
    default:
      return 0
  }
}

function capitalThreshold(country: Country): number {
  const debtRatio = nationalDebt(country) / Math.max(1, country.econ.gdp)
  // 4%/year + debt ratio × 2%/year, expressed as a monthly markup. Confidence
  // policies lower the hurdle rate, so `privateInvestment` boosts both savings
  // and the range of projects that clear it.
  const confidence = 1 + totalsFor(country, 'privateInvestment').percent / 100
  return (1 + (0.04 + debtRatio * 0.02) / 12) / Math.max(0.5, confidence)
}

/** Monthly depreciation of the building stock; replacement investment keeps
 *  the private-investment loop alive after the initial industrialisation. */
const DEPRECIATION_PER_MONTH = 0.0015

/**
 * Private builders start at most one project every other month, with at most
 * three in flight. Without the brake the queue filled with ten mine projects
 * within a year and the private sector felt like a second state (PT-029).
 */
export const MAX_PRIVATE_PROJECTS = 3
export const PRIVATE_START_INTERVAL = 2

/**
 * Allocates this month's private savings to at most one new private project.
 * Private projects are visible in the queue but cannot be cancelled
 * (plan 0003 §4). Returns the savings that stayed idle.
 */
function investPrivateCapital(
  world: WorldState,
  country: Country,
  snap: EconomySnapshot,
  savingsThisMonth: number,
  log: LogEntry[],
): void {
  const ownProjects = country.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
  const activePrivateCost = ownProjects.reduce(
    (sum, project) => sum + project.monthlyCost,
    0,
  )
  const threshold = capitalThreshold(country)
  const scores = (Object.keys(BUILDINGS) as BuildingId[]).map(building => ({
    building,
    hasOutput: Object.keys(BUILDING_OUTPUT[building]).length > 0,
    score:
      Object.keys(BUILDING_OUTPUT[building]).length > 0
        ? investmentScore(country, building, snap.demand, snap.production)
        : infrastructureScore(country, building),
    stock: country.econ.buildings[building],
  }))
  let best: { building: BuildingId; score: number } | undefined
  for (const row of scores) {
    if (!row.hasOutput) continue
    if (best === undefined || row.score > best.score) {
      best = { building: row.building, score: row.score }
    }
  }
  // Renewal goes to the type losing the most stock to depreciation, so farms,
  // universities and offices are not permanently ignored in favour of the
  // single highest-scoring factory.
  const renewalCandidates = scores.filter(row => row.stock > 0 && row.score > 0.55)
  const renewal =
    renewalCandidates.length > 0
      ? renewalCandidates[world.tick % renewalCandidates.length]
      : undefined

  // Slots finish in a month now, so private builders can commit most of the
  // idle pool: keep only what active projects already need.
  const headroom = Math.max(0, country.econ.privateCapital - activePrivateCost)
  const draftProject = (
    building: BuildingId,
    count: number,
  ): ConstructionProject => ({
    id: 'draft',
    building,
    count,
    owner: 'private',
    monthsLeft: 1,
    monthlyCost: 0,
    lastSpend: 0,
    progress: 0,
    startedAt: { ...world.date },
  })
  const canStart = ((): { affordable: number } | undefined => {
    if (best === undefined) return undefined
    const perMonth = constructionMonthlyCost(draftProject(best.building, 1))
    if (perMonth <= 0) return undefined
    return { affordable: Math.floor(headroom / perMonth) }
  })()
  let started = false
  const sinceStart = world.tick - (country.econ.lastPrivateStartTick ?? -999)
  if (
    best !== undefined &&
    canStart !== undefined &&
    best.score > threshold &&
    ownProjects.length < MAX_PRIVATE_PROJECTS &&
    sinceStart >= PRIVATE_START_INTERVAL &&
    canStart.affordable >= 1
  ) {
    const count = clamp(canStart.affordable, 1, MAX_BUILDINGS_PER_SLOT)
    const monthlyCost = constructionMonthlyCost(draftProject(best.building, count))
    if (monthlyCost <= country.econ.privateCapital) {
      country.econ.constructionQueue.push({
        id: `proj-${world.tick}-${country.id}-priv-${country.econ.constructionQueue.length}`,
        building: best.building,
        count,
        owner: 'private',
        monthsLeft: 1,
        monthlyCost,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      })
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}的私人资本投建 ${count} 座${BUILDINGS[best.building].name}`,
      })
      country.econ.lastPrivateStartTick = world.tick
      started = true
    }
  }

  // Replacement investment: when no expansion clears the capital threshold,
  // a healthy existing stock (score > 0.7) still needs one-for-one renewal.
  // This keeps private construction and I from freezing for years after the
  // initial industrialisation (round-2 P1-1).
  if (
    !started &&
    ownProjects.length < MAX_PRIVATE_PROJECTS &&
    sinceStart >= PRIVATE_START_INTERVAL &&
    renewal !== undefined
  ) {
    const monthlyCost = constructionMonthlyCost(
      draftProject(renewal.building, 1),
    )
    if (monthlyCost <= headroom && monthlyCost <= country.econ.privateCapital) {
      country.econ.constructionQueue.push({
        id: `proj-${world.tick}-${country.id}-renew-${country.econ.constructionQueue.length}`,
        building: renewal.building,
        count: 1,
        owner: 'private',
        monthsLeft: 1,
        monthlyCost,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      })
      // Renewal is routine maintenance; it stays visible in the queue but is
      // not worth a chronicle line every few months for every country.
      country.econ.lastPrivateStartTick = world.tick
      started = true
    }
  }

  // Working capital reserved for active private projects; anything above it
  // is idle. The retained share stays in the pool, the rest is released as
  // luxury purchases next month (plan 0003 §4).
  const totalPrivateCost = country.econ.constructionQueue
    .filter(project => (project.owner ?? 'state') === 'private')
    .reduce((sum, project) => sum + project.monthlyCost, 0)
  const reserve = Math.max(10, totalPrivateCost * 3)
  const idle = Math.max(0, country.econ.privateCapital - reserve)
  const released = idle * (1 - country.politicalEconomy.idleRetained)
  if (released > 0) {
    country.econ.privateCapital = Math.max(0, country.econ.privateCapital - released)
    country.econ.idlePurchases += released
  }
  country.econ.idleProfits = idle
}

function simulateCountry(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
  incoming?: {
    supply: Record<GoodId, number>
    nx: number
    settlement: TradeSettlement
  },
): void {
  const oldPops = Math.max(1, country.pops.total)
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  const snap = computeEconomy(country, {
    ...(incoming === undefined
      ? {}
      : {
          supply: incoming.supply,
          nx: incoming.nx,
          tariffRevenue: incoming.settlement.tariffRevenue,
        }),
    atWar,
    tick: world.tick,
  })
  // The demand computed above consumed last month's released idle capital.
  country.econ.idlePurchases = 0

  // Market scarcity feeds unrest; effective supply already includes this
  // month's trade, so imports relieve the shortage.
  let scarcity = 0
  for (const id of GOOD_IDS) {
    const demand = snap.demand[id]
    if (demand <= 0) continue
    const shortage = Math.max(0, demand - snap.supply[id])
    scarcity += (shortage / demand) * (id === 'grain' || id === 'clothes' ? 1.6 : 0.5)
  }
  scarcity = clamp(scarcity, 0, 8)

  country.econ.gdp = snap.gdp
  country.econ.gdpComponents = snap.components
  country.econ.income = snap.income
  country.econ.lastIncomeOther = snap.revenue.other
  country.econ.expense = snap.expense
  country.econ.goods = snap.production
  country.econ.laborShare = snap.laborShare
  country.econ.wages = snap.wages
  country.econ.profits = snap.profits
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

  const balance = snap.income - snap.expense
  country.econ.treasury += balance
  // The treasury is signed net assets: a negative balance is national debt
  // and pays interest next month. There is no separate debt stock and no
  // principal-repayment step to reconcile.
  if (country.econ.treasury < -country.econ.gdp * 3) {
    const before = -country.econ.treasury
    country.econ.treasury = -country.econ.gdp * 1.5
    // Halve import capacity and cap new external debt for the next 12 months
    // (plan §2.4).
    country.econ.restructuredUntilTick = Math.max(
      country.econ.restructuredUntilTick,
      world.tick + 12,
    )
    country.pops.radicals = clamp(country.pops.radicals + 8, 0, 100)
    country.government.legitimacy = clamp(country.government.legitimacy - 8, 0, 100)
    country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}债务违约并重组：国债从 ${before.toFixed(0)} 降至 ${(-country.econ.treasury).toFixed(0)}`,
    })
  }

  // Gold settlement (plan §2.4): the private sector's external net accrues to
  // or is drawn from private capital. An unfinanced import bill becomes
  // *private* external debt (negative private capital), never state debt: the
  // treasury only collects tariffs and never pays the private import bill
  // (ADR 0008). A private debt stock is repaid first by later export surpluses.
  country.econ.lastTradeDebt = 0
  if (incoming !== undefined) {
    const settlement = incoming.settlement
    if (settlement.externalNet >= 0) {
      country.econ.privateCapital += settlement.externalNet
    } else {
      // The private sector bears what it can draw plus the private external
      // debt it takes on; `dropped` stays forgiven beyond the restructuring cap.
      country.econ.privateCapital -=
        settlement.drawnFromCapital + settlement.debtIncrease
    }
    country.econ.lastTradeDebt = settlement.debtIncrease
    if (settlement.dropped > 0) {
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}私人外债超过重组上限，${settlement.dropped.toFixed(1)} 金未能融资`,
      })
    }
  }

  // Income distribution: profits fund private savings, and this month's
  // savings may start one private project (plan 0003 §3/§4).
  const savings = snap.profits * effectiveSavingsRate(country)
  country.econ.privateCapital += savings
  investPrivateCapital(world, country, snap, savings, log)

  // The construction queue pays from the appropriation; only the money that
  // actually reached a project counts as government spending.
  const stateConstructionSpent = settleConstruction(world, country, rng, log)
  country.econ.expense = snap.expense + stateConstructionSpent

  // Capital wears out slowly. Without this the private investment loop stops
  // permanently once the capital stock satisfies demand (round-2 P1-1).
  for (const id of BUILDING_IDS) {
    country.econ.buildings[id] = Math.max(
      0,
      country.econ.buildings[id] * (1 - DEPRECIATION_PER_MONTH),
    )
  }
  // Rails, ports, offices and universities wear out too; their infrastructure
  // bonuses must not outlive the buildings that produced them.
  country.econ.transportInfrastructure *= 1 - DEPRECIATION_PER_MONTH
  country.econ.marketAccess *= 1 - DEPRECIATION_PER_MONTH
  country.econ.administrativeCapacity *= 1 - DEPRECIATION_PER_MONTH

  // Pops: growth, urbanisation, standard of living.
  const growthRate = applyModifiers(
    country,
    'growth',
    0.0012 +
      (country.pops.sol - 40) / 20000 -
      country.pops.radicals / 50000 -
      country.military.exhaustion / 100000,
  )
  country.pops.growth = growthRate
  const newTotal = Math.max(1, oldPops * (1 + growthRate))
  const scale = newTotal / oldPops
  country.pops.total = newTotal
  country.pops.peasants *= scale
  country.pops.workers *= scale
  country.pops.artisans *= scale
  country.pops.clergy *= scale
  country.pops.aristocrats *= scale
  country.pops.capitalists *= scale

  const urbanPull = Math.min(
    country.pops.peasants * 0.0008,
    country.econ.buildings.factories * 0.015 * (1 + country.tech.level * 0.05),
  )
  country.pops.peasants -= urbanPull
  country.pops.workers += urbanPull

  const artisanShift = Math.min(
    country.pops.artisans * 0.0006,
    country.econ.buildings.factories * 0.003,
  )
  country.pops.artisans -= artisanShift
  country.pops.workers += artisanShift

  country.pops.sol = clamp(
    applyModifiers(
      country,
      'sol',
      20 +
        (snap.realGdp / Math.max(1, country.pops.total)) * 250 +
        country.tech.level * 1.2 -
        country.pops.radicals * 0.08 +
        country.econ.spending.welfare * 2,
    ),
    5,
    95,
  )

  const literacyGain =
    (country.econ.spending.education * 0.0008 +
      country.econ.buildings.universities * 0.0002) *
    (1 - country.pops.literacy)
  country.pops.literacy = clamp(
    country.pops.literacy + applyModifiers(country, 'literacy', literacyGain),
    0,
    1,
  )

  // Industry absorbs labour; literacy and unrest move the rate the other way.
  // Low labour utilisation (a vast idle peasantry) adds a modest penalty;
  // full utilisation removes it (plan 0003 §0.1).
  const laborPenalty = (1 - snap.labor.utilization) * 2
  const unemploymentTarget = clamp(
    applyModifiers(country, 'unemployment', deriveUnemployment(country) + laborPenalty),
    0,
    30,
  )
  // Smooth the stock and cap the monthly move so the factory-absorption
  // threshold cannot swing unemployment from 6% to 29% in a year.
  const unemploymentStep = clamp(
    (unemploymentTarget - country.econ.unemployment) * 0.25,
    -1.5,
    1.5,
  )
  country.econ.unemployment = clamp(
    country.econ.unemployment + unemploymentStep,
    0,
    30,
  )

  const radicalPressure =
    Math.max(0, country.econ.taxRate - 10) * 0.08 +
    Math.max(0, country.econ.tariff - 10) * 0.03 +
    Math.max(0, 40 - country.pops.sol) * 0.03 +
    country.military.exhaustion * 0.06 +
    country.econ.unemployment * 0.03 +
    scarcity * 0.12
  const relief =
    0.3 +
    (country.government.legitimacy / 100) * 0.35 +
    country.econ.spending.welfare * 0.2 +
    country.econ.spending.education * 0.08 +
    country.pops.loyalists * 0.015
  // Radicals and loyalists are stocks updated by a monthly flow; modifiers
  // scale the flow, not the stock, so a percent buff cannot compound monthly.
  country.pops.radicals = clamp(
    country.pops.radicals + applyModifiers(country, 'radicals', radicalPressure - relief),
    0,
    100,
  )
  country.pops.loyalists = clamp(
    country.pops.loyalists +
      applyModifiers(
        country,
        'loyalists',
        country.government.legitimacy * 0.01 - radicalPressure * 0.3,
      ),
    0,
    100,
  )

  const govBonus =
    country.government.type === '专制君主制'
      ? -4
      : country.government.type === '君主立宪制'
        ? 8
        : country.government.type === '共和制'
          ? 10
          : country.government.type === '民主制'
            ? 12
            : country.government.type === '寡头制'
              ? -2
              : 0
  const legitimacyTarget = clamp(
    applyModifiers(
      country,
      'legitimacy',
      50 +
        govBonus -
        country.pops.radicals * 0.5 +
        (country.econ.treasury > 0 ? 4 : -6) -
        debtPressure(country).legitimacyPenalty -
        country.military.exhaustion * 0.2 +
        country.econ.spending.welfare * 2,
    ),
    0,
    100,
  )
  country.government.legitimacy +=
    (legitimacyTarget - country.government.legitimacy) * 0.08

  // Authority recovers in proportion to legitimacy; a discredited regime
  // loses it (round-2 P1-6). Standing policies also drain authority; if the
  // regime cannot pay the upkeep, the policy programme starts to lapse.
  let policyUpkeep = country.modifiers.reduce(
    (sum, modifier) => sum + (modifier.upkeep ?? 0),
    0,
  )
  if (policyUpkeep > 0 && country.government.authority < policyUpkeep) {
    const lapsed = country.modifiers.find(modifier => (modifier.upkeep ?? 0) > 0)
    if (lapsed !== undefined) {
      country.modifiers = country.modifiers.filter(
        modifier => modifier.source !== lapsed.source,
      )
      log.push({
        date: { ...world.date },
        kind: 'politics',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}权威枯竭：「${lapsed.label}」等政策中止`,
      })
      policyUpkeep = country.modifiers.reduce(
        (sum, modifier) => sum + (modifier.upkeep ?? 0),
        0,
      )
    }
  }
  const authorityFlow =
    country.government.legitimacy * 0.03 -
    (country.government.legitimacy < 30 ? 1.5 : 0) -
    policyUpkeep
  country.government.authority = clamp(
    country.government.authority + applyModifiers(country, 'authority', authorityFlow),
    0,
    100,
  )

  // Bureaucratic effectiveness and the four constraints it feeds.
  country.bureaucracy = deriveBureaucracy(country, true)

  // Technology.
  // A base research rate keeps a state without universities from standing
  // still for decades (PT-007); universities, literacy, education spending and
  // the tech level itself multiply on top of it.
  const researchBase =
    2 +
    country.pops.literacy * 3 +
    country.bureaucracy.score * 0.06
  country.tech.pointsPerMonth =
    researchBase +
    country.econ.buildings.universities *
      0.9 *
      (0.4 + country.pops.literacy) *
      (1 + country.econ.spending.education * 0.03) *
      (1 + country.tech.level * 0.02)
  country.tech.points += applyModifiers(
    country,
    'techPoints',
    country.tech.pointsPerMonth,
  )
  const nextCost = techCost(country.tech.level + 1)
  if (country.tech.level < 10 && country.tech.points >= nextCost) {
    country.tech.points -= nextCost
    country.tech.level += 1
    const unlocked = techName(country.tech.level)
    country.tech.unlocked.push(unlocked)
    country.tech.researching = techName(country.tech.level + 1)
    log.push({
      date: { ...world.date },
      kind: 'tech',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}解锁了「${unlocked}」`,
    })
  }

  // Military.
  country.military.manpower = clamp(
    country.military.manpower +
      applyModifiers(
        country,
        'manpower',
        country.pops.total * 0.0004 - country.military.army * 0.0006,
      ),
    0,
    country.pops.total * 0.06,
  )
  // Morale is a stock fed by a monthly flow; scale the flow.
  country.military.morale = clamp(
    country.military.morale +
      applyModifiers(country, 'morale', country.econ.spending.army > 1 ? 0.15 : -0.15),
    20,
    100,
  )

  country.diplo.prestige = computePrestige(country)

  // Leaders age; an old one eventually gives way to the next generation.
  country.leader.age += 1 / 12
  if (
    country.leader.age >= 82 ||
    (country.leader.age >= 70 && rng.chance(0.002))
  ) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng)
    country.government.legitimacy = clamp(country.government.legitimacy - 5, 0, 100)
    log.push({
      date: { ...world.date },
      kind: 'leader',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：${oldName}逝世，${country.leader.title}${country.leader.name}继位`,
    })
  }

  // Timed buffs and debuffs age one month.
  for (const label of tickModifiers(country)) {
    log.push({
      date: { ...world.date },
      kind: 'politics',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：「${label}」到期`,
    })
  }

  // State thresholds grant or lift buffs after the month's numbers settle.
  logThresholds(world, country, evaluateThresholds(country), log)

  // State collapse tears up the policy programme; permanent buffs do not
  // survive a revolution.
  if (country.pops.radicals >= 92) {
    const before = country.modifiers.filter(modifier => modifier.source.startsWith('policy:'))
    if (before.length > 0) {
      country.modifiers = country.modifiers.filter(
        modifier => !modifier.source.startsWith('policy:'),
      )
      log.push({
        date: { ...world.date },
        kind: 'politics',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}国家崩解：${before.length} 项政策被废除`,
      })
    }
  }

  pushHistory(country.econ.history.gdp, snap.gdp)
  pushHistory(country.econ.history.treasury, country.econ.treasury)
  pushHistory(country.econ.history.sol, country.pops.sol)
  pushHistory(country.econ.history.legitimacy, country.government.legitimacy)
  pushHistory(country.econ.history.radicals, country.pops.radicals)
  pushHistory(country.econ.history.c, snap.components.c)
  pushHistory(country.econ.history.i, snap.components.i)
  pushHistory(country.econ.history.g, snap.components.g)
  pushHistory(country.econ.history.income, country.econ.income)
  pushHistory(country.econ.history.expense, country.econ.expense)
  pushHistory(country.econ.history.unemployment, country.econ.unemployment)
  pushHistory(country.econ.history.debt, nationalDebt(country))
  pushHistory(country.econ.history.tariff, country.econ.lastTariffRevenue)

  const debt = nationalDebt(country)
  if (
    country.econ.treasury <= 0 &&
    snap.income - country.econ.expense < 0 &&
    debt > country.econ.gdp * 0.5 &&
    rng.chance(0.03)
  ) {
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}财政告急，国债升至 ${debt.toFixed(1)}`,
    })
  }
}

/**
 * Goods whose trade sours relations (plan §2.7/§6): importing any of these
 * from a partner adds a monthly tension. Tuned against the 60-month baseline.
 */
export const SENSITIVE_GOODS: GoodId[] = ['opium', 'arms', 'grain']
/**
 * §11 calibration knob: the automatic *warmth* a full trade share earns (plan
 * §2.7 "最多 +2"). Scaled by `(1 - sensitiveShare)` so the sensitive slice of
 * trade earns no warmth — otherwise a monopoly partner's warmth swamps the drag.
 */
export const TRADE_WARMTH_MAX = 2
/**
 * §11 calibration knob: monthly relation *drag* per unit of sensitive-import
 * share (plan §2.7). The flat −0.5 draft was calibrated away (see §11.2): a
 * monopoly partner's import share is almost entirely sensitive, so a flat
 * penalty could never outrun the share-scaled warmth and the crisis bar
 * (§4.1, 中英关系 ≤ −10) was unreachable. This scales with how much of the
 * bilateral trade is actually sensitive, so opium dependency sinks relations.
 * It intentionally exceeds the ±10 monthly envelope: a fully sensitive
 * partner always moves at the cap, while a marginal sensitive slice can still
 * outrun the warmth term.
 */
export const SENSITIVE_DRAG = 15
/** Per ordered pair per month: auto + sensitive + agent tension is clamped here (plan §2.7). */
export const TRADE_RELATION_ENVELOPE = 10
/**
 * §11 calibration knob: floor for the *automatic* trade effects. Trade friction
 * alone must not reach the hard trade cut at `RELATION_CUTOFF` (−50, plan §1.2) —
 * severance is a diplomatic act (tension, embargo, war). Without it a monopoly
 * opium partner's drag crossed −50, closed the route, mean-reversion reopened it
 * trading only opium (sensitiveShare → 1) and shoved it back under: a limit cycle
 * that killed the opium flow through 1840–42.
 */
export const TRADE_RELATION_FLOOR = -45
/** Months of trade-tension history kept for the diplomacy UI (plan §2.7). */
export const TRADE_TENSION_RETENTION_MONTHS = 24
/** Longest embargo an action may set; absent means permanent (plan §3). */
export const EMBARGO_MONTHS_MAX = 60

export function atWar(world: WorldState, a: string, b: string): boolean {
  return world.wars.some(
    war =>
      (war.attackers.includes(a) && war.defenders.includes(b)) ||
      (war.defenders.includes(a) && war.attackers.includes(b)),
  )
}

/**
 * Creates a War with the shared shape both the `diplomacy` war move and the
 * crisis war packs use (plan §4.3/§5). Returns undefined when the pair is
 * already at war; the caller owns any relation/infamy changes, because those
 * differ between the diplomacy move (−50) and a result pack (−40).
 */
export function declareWar(
  world: WorldState,
  attackerId: string,
  targetId: string,
  goal: WarGoal,
  reason: string,
): War | undefined {
  const attacker = world.countries[attackerId]
  const target = world.countries[targetId]
  if (attacker === undefined || target === undefined) return undefined
  if (atWar(world, attackerId, targetId)) return undefined
  const defenders = [targetId, ...target.diplo.alliances.filter(id => id !== attackerId)]
  const war: War = {
    id: `war-${world.tick}-${attackerId}-${targetId}`,
    name: `${attacker.name}—${target.name}战争`,
    attackers: [attackerId],
    defenders,
    started: { ...world.date },
    months: 0,
    warScore: 0,
    battles: 0,
    reason,
    lastEvent: '战争爆发',
    goal,
    goalOwner: attackerId,
  }
  world.wars.push(war)
  return war
}

/**
 * A blocked (importer, exporter, good) pair never trades (plan §3): a war
 * severs it in either direction, and an embargo severs it in either direction
 * because the embargoing country cuts the corresponding trade outright.
 */
function tradeBlocker(world: WorldState): TradeBlocker {
  return (importerId, exporterId, good) => {
    if (atWar(world, importerId, exporterId)) return true
    const importer = world.countries[importerId]
    const exporter = world.countries[exporterId]
    if (importer !== undefined && embargoed(importer.embargoes, exporterId, good)) return true
    if (exporter !== undefined && embargoed(exporter.embargoes, importerId, good)) return true
    return false
  }
}

/** Ages embargoes by one month; those reaching zero are lifted and logged. */
function expireEmbargoes(world: WorldState, log: LogEntry[]): void {
  for (const country of Object.values(world.countries)) {
    const remaining: Embargo[] = []
    for (const embargo of country.embargoes) {
      if (embargo.months === undefined) {
        remaining.push(embargo)
        continue
      }
      const months = embargo.months - 1
      if (months <= 0) {
        const target = world.countries[embargo.target]
        log.push({
          date: { ...world.date },
          kind: 'diplomacy',
          countryId: country.id,
          text: `[${country.flag}] ${country.name} 对 ${target?.name ?? embargo.target} 的禁运到期`,
        })
        continue
      }
      remaining.push({ ...embargo, months })
    }
    country.embargoes = remaining
  }
}

/** This month's bilateral trade with one partner, at unit prices (plan §2.7). */
function bilateralTradeValue(country: Country, partnerId: string): number {
  let value = 0
  for (const flow of country.trade.exports) if (flow.to === partnerId) value += flow.value
  for (const flow of country.trade.imports) if (flow.from === partnerId) value += flow.value
  return value
}

function sameDate(a: GameDate, b: GameDate): boolean {
  return a.year === b.year && a.month === b.month
}

/**
 * The sensitive slice of `country`'s imports from one partner, as a share of
 * `country`'s *total* import gold value (plan §2.7). 0 when nothing is imported
 * at all. This is the weight on the drag — and the part of trade warmed by 1×.
 */
function sensitiveImportShare(country: Country, partnerId: string): number {
  const totalImports = country.trade.importValue
  if (totalImports <= 0) return 0
  let sensitive = 0
  for (const flow of country.trade.imports) {
    if (flow.from === partnerId && SENSITIVE_GOODS.includes(flow.good)) sensitive += flow.value
  }
  return sensitive / totalImports
}

/**
 * Monthly trade-driven relation effects (plan §2.7), a deterministic step
 * beside `driftRelations`. For each ordered pair:
 *
 *   delta = TRADE_WARMTH_MAX × (1 − sensitiveShare) × partnerShare
 *         − SENSITIVE_DRAG × sensitiveShare
 *         + Σ(agent tradeTension deltas recorded last month for this pair)
 *
 * A partner's trade share warms relations, but the sensitive slice earns no
 * warmth and instead drags them down proportional to its share of imports — so
 * a monsoon-trade partner (GBR for QING) sinks while a non-sensitive partner
 * still warms. The sum is clamped to the ±10 envelope, then the relation is
 * clamped to [-100, 100]; when no agent tension is involved the automatic part
 * additionally floors at `TRADE_RELATION_FLOOR` so trade alone cannot sever the
 * pair. Routine auto drift is *not* logged (it would flood the
 * 400-entry chronicle); agent tensions are logged where they are submitted and
 * embargo changes where they happen.
 */
export function applyTradeRelations(world: WorldState, log: LogEntry[]): void {
  const ids = Object.keys(world.countries).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  // Agent tensions are recorded at the pre-tick date and settled on the next
  // tick, so each is applied exactly once as the month rolls forward.
  const pending = world.tradeTensions.filter(tension =>
    sameDate(advanceDate(tension.date), world.date),
  )
  for (const fromId of ids) {
    const country = world.countries[fromId]
    if (country === undefined) continue
    const total = country.trade.exportValue + country.trade.importValue
    for (const partnerId of ids) {
      if (partnerId === fromId) continue
      let auto = 0
      if (total > 0) {
        const partnerShare = bilateralTradeValue(country, partnerId) / total
        const sensitiveShare = sensitiveImportShare(country, partnerId)
        auto += TRADE_WARMTH_MAX * (1 - sensitiveShare) * partnerShare
        auto -= SENSITIVE_DRAG * sensitiveShare
      }
      let agentDelta = 0
      for (const tension of pending) {
        if (tension.from === fromId && tension.partner === partnerId) {
          agentDelta += tension.relationDelta
        }
      }
      const delta = auto + agentDelta
      if (delta === 0) continue
      const bounded = clamp(delta, -TRADE_RELATION_ENVELOPE, TRADE_RELATION_ENVELOPE)
      const current = country.diplo.relations[partnerId] ?? 0
      let next = current + bounded
      // The floor binds the automatic effects only; an explicit agent tension may
      // still drive the pair all the way to -100 (plan §2.7).
      if (agentDelta === 0) next = Math.max(next, TRADE_RELATION_FLOOR)
      country.diplo.relations[partnerId] = clamp(next, -100, 100)
    }
  }
  world.tradeTensions = world.tradeTensions.filter(
    tension => dateDistance(world.date, tension.date) < TRADE_TENSION_RETENTION_MONTHS,
  )
}

function driftRelations(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    for (const other of Object.values(world.countries)) {
      if (other.id === country.id) continue
      const current = country.diplo.relations[other.id] ?? 0
      // Infamy drags every relationship's resting point down.
      const infamyDrag = country.diplo.infamy * 0.1
      const target =
        (country.diplo.alliances.includes(other.id)
          ? 55
          : country.diplo.rivals.includes(other.id)
            ? -35
            : 0) - infamyDrag
      country.diplo.relations[other.id] = current + (target - current) * 0.012
    }
  }
}

export function strength(world: WorldState, ids: string[]): number {
  let total = 0
  for (const id of ids) {
    const country = world.countries[id]
    if (country === undefined) continue
    total += applyModifiers(
      country,
      'armyStrength',
      country.military.army *
        country.military.quality *
        (country.military.morale / 60) *
        (1 + country.tech.level * 0.03),
    )
  }
  return total
}

/**
 * The victor's reparation terms: total gold and the maximum installment term.
 * The loser decides how much of the total it pays immediately and how the
 * remainder is spread over the term (see the `reparations` goal branch).
 */
export type ReparationTerms = {
  /** Defaults to 10% of the loser's GDP. */
  total?: number
  /** Maximum installment term in months; defaults to 60 (five years). */
  maxMonths?: number
}

/**
 * Peace terms for one war (plan 0004 §5). The goal owner's side winning applies
 * the victory column, its side losing the defeat column; effects land on every
 * country of a side, mirroring the belligerent loop in `endWar`.
 */
function applyWarGoal(
  world: WorldState,
  war: War,
  goalOwnerWon: boolean,
  winnerIds: string[],
  loserIds: string[],
  terms?: ReparationTerms,
): void {
  const goalSide = goalOwnerWon ? winnerIds : loserIds
  const otherSide = goalOwnerWon ? loserIds : winnerIds

  if (!goalOwnerWon) {
    for (const id of goalSide) {
      const country = world.countries[id]
      if (country === undefined) continue
      switch (war.goal) {
        case 'reparations':
          country.diplo.prestige = clamp(country.diplo.prestige - 10, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
        case 'openMarket':
          for (const otherId of otherSide) {
            country.diplo.relations[otherId] = clamp(
              (country.diplo.relations[otherId] ?? 0) - 10,
              -100,
              100,
            )
          }
          country.diplo.prestige = clamp(country.diplo.prestige - 5, 0, 240)
          break
        case 'sphere':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 2, 0, 100)
          break
        case 'humiliation':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
      }
    }
    return
  }

  switch (war.goal) {
    case 'reparations': {
      const recipient = world.countries[war.goalOwner]
      if (!Array.isArray(world.indemnities)) world.indemnities = []
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        const rawTotal = terms?.total
        const total = clamp(
          Number.isFinite(rawTotal) ? (rawTotal as number) : loser.econ.gdp * 0.1,
          0,
          loser.econ.gdp * 2,
        )
        const rawMonths = terms?.maxMonths
        const maxMonths = clamp(
          Number.isFinite(rawMonths) ? Math.round(rawMonths as number) : 60,
          1,
          240,
        )
        // The loser pays what it can without going into debt, then spreads the
        // rest over at most `maxMonths`. The victor only set the total and the
        // term; this split is the loser's own plan.
        const lump = clamp(loser.econ.treasury, 0, total)
        loser.econ.treasury -= lump
        loser.government.legitimacy = clamp(loser.government.legitimacy - 5, 0, 100)
        if (recipient !== undefined && lump > 0) recipient.econ.treasury += lump

        const remaining = total - lump
        if (remaining > 0.01) {
          const capacity = Math.max(0.5, loser.econ.income * 0.15)
          const months = Math.min(
            maxMonths,
            Math.max(1, Math.ceil(remaining / capacity)),
          )
          world.indemnities.push({
            id: `indemnity-${war.id}-${id}`,
            from: id,
            to: war.goalOwner,
            monthlyAmount: remaining / months,
            monthsLeft: months,
            remaining,
            startsAtTick: world.tick + 1,
            startedAt: { ...world.date },
          })
        }
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 10, 0, 240)
      }
      break
    }
    case 'openMarket': {
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.econ.tariff = clamp(loser.econ.tariff - 10, 0, 60)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 4, 0, 100)
        addModifier(loser, {
          id: `war:${war.id}:openMarket:access`,
          label: '门户开放',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.15,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        addModifier(winner, {
          id: `war:${war.id}:openMarket:income`,
          label: '通商特权',
          stat: 'income',
          stack: 'percent',
          value: 5,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      break
    }
    case 'sphere': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          if (!winner.diplo.sphere.includes(loserId)) winner.diplo.sphere.push(loserId)
        }
        addModifier(winner, {
          id: `war:${war.id}:sphere:access`,
          label: '势力范围',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.05,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      // Both sides fall an extra 10 beyond the belligerent relation decline.
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          winner.diplo.relations[loserId] = clamp(
            (winner.diplo.relations[loserId] ?? 0) - 10,
            -100,
            100,
          )
          const loser = world.countries[loserId]
          if (loser === undefined) continue
          loser.diplo.relations[id] = clamp(
            (loser.diplo.relations[id] ?? 0) - 10,
            -100,
            100,
          )
        }
      }
      break
    }
    case 'humiliation': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 15, 0, 240)
      }
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.diplo.prestige = clamp(loser.diplo.prestige - 15, 0, 240)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 8, 0, 100)
      }
      break
    }
  }
}

function endWar(
  world: WorldState,
  war: War,
  winner: 'attackers' | 'defenders' | 'white',
  log: LogEntry[],
  terms?: ReparationTerms,
): void {
  const attackerIds = war.attackers
  const defenderIds = war.defenders
  const winnerIds = winner === 'attackers' ? attackerIds : winner === 'defenders' ? defenderIds : []
  const loserIds = winner === 'attackers' ? defenderIds : winner === 'defenders' ? attackerIds : []

  // Exhaustion recovery, morale and leader memory stay goal-independent; only
  // the generic prestige/radical effects are replaced (plan §5).
  for (const id of winnerIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    country.military.exhaustion = clamp(country.military.exhaustion - 15, 0, 100)
    country.military.morale = clamp(country.military.morale + 10, 20, 100)
    country.leader.memory.push(`${war.name}以胜利告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }
  for (const id of loserIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    country.military.exhaustion = clamp(country.military.exhaustion + 5, 0, 100)
    country.leader.memory.push(`${war.name}以失败告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }

  // A white peace or the 60-month timeout settles no goal (plan §5).
  if (winner !== 'white') {
    applyWarGoal(
      world,
      war,
      winnerIds.includes(war.goalOwner),
      winnerIds,
      loserIds,
      terms,
    )
  }

  for (const id of [...attackerIds, ...defenderIds]) {
    const country = world.countries[id]
    if (country === undefined) continue
    for (const otherId of [...attackerIds, ...defenderIds]) {
      if (otherId === id) continue
      const current = country.diplo.relations[otherId] ?? 0
      country.diplo.relations[otherId] = clamp(current - 20, -100, 100)
    }
  }

  world.wars = world.wars.filter(one => one.id !== war.id)
  log.push({
    date: { ...world.date },
    kind: 'war',
    text:
      winner === 'white'
        ? `《${war.name}》以白和告终`
        : `《${war.name}》结束：${winner === 'attackers' ? '进攻方' : '防守方'}获胜`,
  })
}

function resolveWars(world: WorldState, rng: Rng, log: LogEntry[]): void {
  for (const war of [...world.wars]) {
    war.months += 1
    war.battles += 1
    const attack = strength(world, war.attackers) / Math.max(1, war.attackers.length)
    const defend = strength(world, war.defenders) / Math.max(1, war.defenders.length)
    const delta = clamp(((attack - defend) / Math.max(1, attack + defend)) * 12, -12, 12)
    war.warScore = clamp(war.warScore + delta + rng.range(-2, 2), -100, 100)
    war.lastEvent =
      delta > 3
        ? '进攻方在战场上占了上风'
        : delta < -3
          ? '防守方稳住了阵线'
          : '双方在战线上僵持'

    for (const id of [...war.attackers, ...war.defenders]) {
      const country = world.countries[id]
      if (country === undefined) continue
      country.military.exhaustion = clamp(country.military.exhaustion + 1.2, 0, 100)
      country.military.morale = clamp(country.military.morale - 0.4, 20, 100)
      country.pops.radicals = clamp(country.pops.radicals + 0.5, 0, 100)
    }

    if (war.warScore >= 75) {
      endWar(world, war, 'attackers', log)
    } else if (war.warScore <= -75) {
      endWar(world, war, 'defenders', log)
    } else if (war.months >= 60) {
      endWar(world, war, 'white', log)
    }
  }
}

function aiEventChoice(country: Country, options: EventOption[], rng: Rng): EventOption {
  const aggressive = country.leader.traits.some(trait =>
    ['扩张', '军事', '专制', '民粹', '海权'].includes(trait),
  )
  const reformist = country.leader.traits.some(trait =>
    ['改革', '贸易', '务实', '维新'].includes(trait),
  )
  if (aggressive && rng.chance(0.65)) return options[0] as EventOption
  if (reformist && options.length > 1 && rng.chance(0.65)) return options[1] as EventOption
  return rng.pick(options)
}

export function applyEventOption(
  world: WorldState,
  event: GameEvent,
  optionId: string,
  log?: LogEntry[],
  rng?: Rng,
): string {
  if (event.isResolved) return '该事件已经处理过了。'
  const option = event.options.find(one => one.id === optionId)
  if (option === undefined) return `没有找到选项 ${optionId}。`
  const country = world.countries[event.countryId]
  if (country === undefined) return '事件所属国家不存在。'

  const effects = option.effects
  if (effects.treasury !== undefined) {
    // A negative result stays on the books as national debt; there is no
    // separate debt stock to transfer it into.
    country.econ.treasury += effects.treasury
  }
  if (effects.radicals !== undefined) {
    country.pops.radicals = clamp(country.pops.radicals + effects.radicals, 0, 100)
  }
  if (effects.legitimacy !== undefined) {
    country.government.legitimacy = clamp(
      country.government.legitimacy + effects.legitimacy,
      0,
      100,
    )
  }
  if (effects.prestige !== undefined) {
    country.diplo.prestige = clamp(country.diplo.prestige + effects.prestige, 0, 240)
  }
  if (effects.army !== undefined) {
    country.military.army = Math.max(0, country.military.army + effects.army)
  }
  if (effects.popsPercent !== undefined) {
    country.pops.total = Math.max(1, country.pops.total * (1 + effects.popsPercent / 100))
  }
  if (effects.techPoints !== undefined) {
    country.tech.points += effects.techPoints
  }
  if (effects.relationTarget !== undefined && effects.relationAmount !== undefined) {
    const target = world.countries[effects.relationTarget]
    if (target !== undefined) {
      const current = country.diplo.relations[target.id] ?? 0
      country.diplo.relations[target.id] = clamp(current + effects.relationAmount, -100, 100)
      const back = target.diplo.relations[country.id] ?? 0
      target.diplo.relations[country.id] = clamp(back + effects.relationAmount * 0.6, -100, 100)
    }
  }
  if (effects.modifiers !== undefined) {
    effects.modifiers.forEach((one, index) => {
      addModifier(country, {
        id: `event:${event.id}:${index}`,
        label: one.label ?? event.title,
        stat: one.stat,
        stack: one.stack ?? 'flat',
        value: one.value,
        monthsLeft: one.months,
        source: `event:${event.id}`,
      })
    })
  }
  if (effects.succeed === true) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng ?? makeRngForWorld(world))
    if (log !== undefined) {
      log.push({
        date: { ...world.date },
        kind: 'leader',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}：${oldName}退位，${country.leader.title}${country.leader.name}继位`,
      })
    }
  }

  event.isResolved = true
  event.resolvedOption = option.id
  country.leader.memory.push(`「${event.title}」：${option.label}`)
  if (country.leader.memory.length > 8) country.leader.memory.shift()

  const line: LogEntry = {
    date: { ...world.date },
    kind: 'event',
    countryId: country.id,
    text: `[${country.flag}] ${event.title}：${option.result}`,
  }
  if (log !== undefined) log.push(line)

  return `${event.title}：${option.result}`
}

function tickEvents(world: WorldState, rng: Rng, log: LogEntry[]): GameEvent[] {
  const pending: GameEvent[] = []
  for (const country of Object.values(world.countries)) {
    const chance = 0.055 + country.pops.radicals / 1200
    if (!rng.chance(chance)) continue
    if (country.isPlayer) {
      const open = world.events.filter(
        event => event.countryId === country.id && !event.isResolved,
      )
      if (open.length >= 3) continue
    }
    const event = spawnEvent(world, country, rng)
    if (event === undefined) continue
    if (country.isPlayer) {
      pending.push(event)
      log.push({
        date: { ...world.date },
        kind: 'event',
        countryId: country.id,
        text: `[${country.flag}] 新事件：${event.title} — ${event.text}`,
      })
    } else {
      const option = aiEventChoice(country, event.options, rng)
      applyEventOption(world, event, option.id, log)
    }
  }
  return pending
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

function relationLine(country: Country, other: Country): string {
  const value = Math.round(country.diplo.relations[other.id] ?? 0)
  return `[${other.flag}]${other.name} ${value >= 0 ? '+' : ''}${value}`
}

/**
 * Free trade lowers the tariff but never below this floor: a state still needs
 * a customs administration, and a 0% default makes the whole tax look absent
 * (playtest feedback, ADR 0009). The rate applies to both imports and exports.
 */
export const FREE_TRADE_TARIFF_FLOOR = 5

/** Political capital each law consumes (plan §7.6). */
const LAW_AUTHORITY_COST: Record<string, number> = {
  教育改革: 8,
  福利改革: 10,
  自由贸易: 12,
  保护关税: 10,
  征兵制: 15,
  宗教宽容: 5,
}

export function applyDecision(
  world: WorldState,
  decision: Decision,
  rng: Rng,
): { ok: boolean; text: string } {
  const country = world.countries[decision.countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${decision.countryId}` }
  const params = decision.params
  const tag = `[${country.flag}] ${country.name}`

  switch (decision.action) {
    case 'build': {
      const id = String(params.building ?? '')
      const building = buildOf(id)
      if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
      const count = clamp(Math.floor(num(params.count, 1)), 1, MAX_BUILDINGS_PER_SLOT)
      // Orders per month are unlimited: every slot holds at most five buildings.
      // Gold is paid per workload point; duration falls out of the points.
      const draft: ConstructionProject = {
        id: `proj-${world.tick}-${country.id}-${country.econ.constructionQueue.length}`,
        building,
        count,
        owner: 'state',
        monthsLeft: 1,
        monthlyCost: 0,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      }
      draft.monthlyCost = constructionMonthlyCost(draft)
      country.econ.constructionQueue.push(draft)
      return {
        ok: true,
        text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列（工程量 ${projectWorkload(draft).toFixed(1)} 点；按队列顺序取用闲置建造力，一次最多投入剩余工程量；总造价 ${constructionTotalCost(draft).toFixed(1)} 金，每点 ${constructionGoldPerPoint(draft).toFixed(2)} 金）`,
      }
    }
    case 'tax': {
      const rate = clamp(num(params.rate, country.econ.taxRate), 0, 60)
      country.econ.taxRate = rate
      return { ok: true, text: `${tag} 将税率调整为 ${rate.toFixed(0)}%` }
    }
    case 'tariff': {
      const rate = clamp(num(params.rate, country.econ.tariff), 0, 60)
      country.econ.tariff = rate
      // Without a separate export rate the old single-rate behaviour stands;
      // supplying `exportRate` splits the two directions (ADR 0014).
      const exportRate =
        params.exportRate === undefined
          ? rate
          : clamp(num(params.exportRate, rate), 0, 60)
      country.econ.exportTariff = exportRate
      return {
        ok: true,
        text: `${tag} 将进口关税调整为 ${rate.toFixed(0)}%，出口关税 ${exportRate.toFixed(0)}%`,
      }
    }
    case 'spending': {
      const category = String(params.category ?? '') as keyof Country['econ']['spending']
      if (!(category in country.econ.spending)) {
        return { ok: false, text: `${tag} 未知支出类别 ${category}` }
      }
      const amount = clamp(num(params.amount, country.econ.spending[category]), 0, 50)
      country.econ.spending[category] = amount
      return {
        ok: true,
        text: `${tag} 将${SPENDING[category].name}支出调整为 ${amount.toFixed(1)}`,
      }
    }
    case 'research': {
      const name = String(params.tech ?? techName(country.tech.level + 1))
      country.tech.researching = name
      return { ok: true, text: `${tag} 将研究方向定为「${name}」` }
    }
    case 'invest': {
      // AI investment confidence, bounded to ±10 around the country's base
      // and ±3 per month (plan 0003 §4/§6).
      const base = country.politicalEconomy.investmentConfidence
      const delta = clamp(num(params.amount, 1), -3, 3)
      const next = clamp(country.econ.investmentConfidence + delta, base - 10, base + 10)
      country.econ.investmentConfidence = next
      return {
        ok: true,
        text: `${tag} 将投资信心调整为 ${next >= 0 ? '+' : ''}${next.toFixed(0)}`,
      }
    }
    case 'conscript': {
      const wanted = clamp(num(params.amount, 1), 1, 20)
      const possible = Math.min(wanted, country.military.manpower / 2)
      if (possible <= 0.1) return { ok: false, text: `${tag} 没有可用的人力` }
      country.military.army += possible
      country.military.manpower -= possible * 2
      country.pops.radicals = clamp(country.pops.radicals + possible * 0.4, 0, 100)
      country.pops.total = Math.max(1, country.pops.total - possible * 0.4)
      return { ok: true, text: `${tag} 征召了 ${possible.toFixed(1)} 万兵力` }
    }
    case 'cancel': {
      const projectId = String(params.projectId ?? params.id ?? '')
      const index = country.econ.constructionQueue.findIndex(
        project => project.id === projectId,
      )
      if (index < 0) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
      const project = country.econ.constructionQueue[index]
      if (project === undefined) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
      if ((project.owner ?? 'state') === 'private') {
        return { ok: false, text: `${tag} 私人项目不可取消（${BUILDINGS[project.building].name}）` }
      }
      country.econ.constructionQueue.splice(index, 1)
      return {
        ok: true,
        text: `${tag} 取消了 ${BUILDINGS[project.building].name}×${project.count} 的国有建造项目`,
      }
    }
    case 'law': {
      const name = String(params.name ?? params.law ?? '')
      if (name === '') return { ok: false, text: `${tag} 未知法案` }
      const legal: Record<string, () => string> = {
        教育改革: () => {
          country.pops.literacy = clamp(country.pops.literacy + 0.04, 0, 1)
          country.econ.spending.education += 0.5
          addModifier(country, {
            id: 'law:教育改革',
            label: '教育改革',
            stat: 'literacy',
            stack: 'percent',
            value: 10,
            source: 'law:教育改革',
          })
          return `${tag} 推行教育改革，识字率上升`
        },
        福利改革: () => {
          country.pops.radicals = clamp(country.pops.radicals - 6, 0, 100)
          country.econ.spending.welfare += 0.5
          addModifier(country, {
            id: 'law:福利改革',
            label: '福利改革',
            stat: 'radicals',
            stack: 'flat',
            value: -2,
            source: 'law:福利改革',
          })
          return `${tag} 推行福利改革，民怨稍减`
        },
        自由贸易: () => {
          const exportRate = country.econ.exportTariff ?? country.econ.tariff
          country.econ.tariff = clamp(
            country.econ.tariff - 8,
            FREE_TRADE_TARIFF_FLOOR,
            60,
          )
          country.econ.exportTariff = clamp(
            exportRate - 8,
            FREE_TRADE_TARIFF_FLOOR,
            60,
          )
          country.econ.marketAccess = clamp(country.econ.marketAccess + 0.08, 0, 1)
          addModifier(country, {
            id: 'law:自由贸易:income',
            label: '自由贸易',
            stat: 'income',
            stack: 'percent',
            value: 8,
            source: 'law:自由贸易',
          })
          return `${tag} 推行自由贸易，进口关税 ${country.econ.tariff.toFixed(0)}%、出口关税 ${country.econ.exportTariff.toFixed(0)}%（下限 ${FREE_TRADE_TARIFF_FLOOR}%），市场接入提高`
        },
        保护关税: () => {
          const exportRate = country.econ.exportTariff ?? country.econ.tariff
          country.econ.tariff = clamp(country.econ.tariff + 8, 0, 60)
          country.econ.exportTariff = clamp(exportRate + 8, 0, 60)
          country.econ.marketAccess = clamp(country.econ.marketAccess - 0.04, 0, 1)
          addModifier(country, {
            id: 'law:保护关税:factory',
            label: '保护关税',
            stat: 'factoryOutput',
            stack: 'percent',
            value: 12,
            source: 'law:保护关税',
          })
          return `${tag} 推行保护关税，国库与工厂受益`
        },
        征兵制: () => {
          country.military.manpower = clamp(country.military.manpower + 10, 0, country.pops.total * 0.06)
          country.pops.radicals = clamp(country.pops.radicals + 3, 0, 100)
          addModifier(country, {
            id: 'law:征兵制',
            label: '征兵制',
            stat: 'armyStrength',
            stack: 'percent',
            value: 10,
            source: 'law:征兵制',
          })
          return `${tag} 推行征兵制，人力池扩大`
        },
        宗教宽容: () => {
          country.pops.radicals = clamp(country.pops.radicals - 4, 0, 100)
          country.government.legitimacy = clamp(country.government.legitimacy + 2, 0, 100)
          addModifier(country, {
            id: 'law:宗教宽容',
            label: '宗教宽容',
            stat: 'legitimacy',
            stack: 'flat',
            value: 2,
            source: 'law:宗教宽容',
          })
          return `${tag} 推行宗教宽容，社会稳定`
        },
      }
      const apply = legal[name]
      if (apply === undefined) return { ok: false, text: `${tag} 未知法案 ${name}` }
      const cost = LAW_AUTHORITY_COST[name] ?? 8
      if (country.government.authority < cost) {
        return {
          ok: false,
          text: `${tag} 权威不足，无法通过${name}（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
        }
      }
      country.government.authority = clamp(country.government.authority - cost, 0, 100)
      return { ok: true, text: apply() }
    }
    case 'diplomacy': {
      const targetId = String(params.target ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `${tag} 未知目标 ${targetId}` }
      const move = String(params.move ?? params.action ?? '')
      const current = country.diplo.relations[target.id] ?? 0
      switch (move) {
        case 'improve': {
          const amount = clamp(num(params.amount, 8), 1, 30)
          country.diplo.relations[target.id] = clamp(current + amount, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 0.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 改善了与${target.name}的关系（${relationLine(country, target)}）` }
        }
        case 'insult': {
          country.diplo.relations[target.id] = clamp(current - 15, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 12,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 与${target.name}交恶` }
        }
        case 'alliance': {
          if (country.diplo.rivals.includes(target.id) || current < 30) {
            return { ok: false, text: `${tag} 与${target.name}的关系不足以结盟` }
          }
          if (!country.diplo.alliances.includes(target.id)) country.diplo.alliances.push(target.id)
          if (!target.diplo.alliances.includes(country.id)) target.diplo.alliances.push(country.id)
          return { ok: true, text: `${tag} 与${target.name}缔结同盟` }
        }
        case 'rival': {
          if (!country.diplo.rivals.includes(target.id)) country.diplo.rivals.push(target.id)
          country.diplo.relations[target.id] = clamp(current - 30, -100, 100)
          return { ok: true, text: `${tag} 将${target.name}列为竞争对手` }
        }
        case 'gift': {
          const amount = clamp(num(params.amount, 3), 1, 20)
          if (country.econ.treasury < amount) return { ok: false, text: `${tag} 国库不足以赠礼` }
          country.econ.treasury -= amount
          country.diplo.relations[target.id] = clamp(current + amount * 2, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 1.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 向${target.name}赠送了价值 ${amount.toFixed(1)} 的礼物` }
        }
        case 'war': {
          const war = declareWar(
            world,
            country.id,
            target.id,
            asWarGoal(params.goal),
            String(params.reason ?? '边境争端'),
          )
          if (war === undefined) return { ok: false, text: `${tag} 与${target.name}已经在战争中` }
          country.diplo.relations[target.id] = clamp(current - 50, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 50,
            -100,
            100,
          )
          country.diplo.infamy = clamp(country.diplo.infamy + 10, 0, 100)
          return { ok: true, text: `${tag} 向${target.name}宣战（${war.defenders.length} 国应战）` }
        }
        case 'peace': {
          const war = world.wars.find(
            one =>
              (one.attackers.includes(country.id) && one.defenders.includes(target.id)) ||
              (one.defenders.includes(country.id) && one.attackers.includes(target.id)),
          )
          if (war === undefined) return { ok: false, text: `${tag} 与${target.name}并未交战` }
          // The victor's terms: total gold and the maximum installment term.
          // Omitted values fall back to 10% of GDP and 60 months.
          const terms: ReparationTerms = {
            total:
              typeof params.indemnityTotal === 'number'
                ? params.indemnityTotal
                : undefined,
            maxMonths:
              typeof params.indemnityMonths === 'number'
                ? params.indemnityMonths
                : undefined,
          }
          endWar(
            world,
            war,
            war.warScore > 10
              ? war.attackers.includes(country.id)
                ? 'attackers'
                : 'defenders'
              : war.warScore < -10
                ? war.attackers.includes(country.id)
                  ? 'defenders'
                  : 'attackers'
                : 'white',
            [],
            terms,
          )
          return { ok: true, text: `${tag} 与${target.name}停战` }
        }
        case 'embargo': {
          if (target.id === country.id) return { ok: false, text: `${tag} 不能对自己禁运` }
          const goodParam = params.good === undefined ? undefined : String(params.good)
          const good = goodParam === undefined ? undefined : asGood(goodParam)
          if (goodParam !== undefined && good === undefined) {
            return { ok: false, text: `${tag} 未知商品 ${goodParam}` }
          }
          const goods: GoodId[] | 'all' = good === undefined ? 'all' : [good]
          const months =
            params.months === undefined
              ? undefined
              : clamp(Math.floor(num(params.months, 1)), 1, EMBARGO_MONTHS_MAX)
          const reason = params.reason === undefined ? undefined : String(params.reason)
          const key = goods === 'all' ? 'all' : goods.join(',')
          const existing = country.embargoes.find(one =>
            one.target === target.id &&
            (one.goods === 'all' ? 'all' : one.goods.join(',')) === key,
          )
          if (existing !== undefined) {
            existing.since = { ...world.date }
            existing.months = months
            existing.reason = reason
          } else {
            country.embargoes.push({
              target: target.id,
              goods,
              since: { ...world.date },
              months,
              reason,
            })
          }
          // The file's `insult` convention: the sender cools more than the target.
          country.diplo.relations[target.id] = clamp(current - 15, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 12,
            -100,
            100,
          )
          const scope =
            goods === 'all' ? '全面' : `对${goods.map(one => GOODS[one].name).join('、')}`
          return {
            ok: true,
            text: `${tag} 对${target.name}实施${scope}禁运${months === undefined ? '（永久）' : `（${months} 个月）`}（${relationLine(country, target)}）`,
          }
        }
        case 'unembargo': {
          if (target.id === country.id) return { ok: false, text: `${tag} 不能对自己解除禁运` }
          const goodParam = params.good === undefined ? undefined : String(params.good)
          const good = goodParam === undefined ? undefined : asGood(goodParam)
          if (goodParam !== undefined && good === undefined) {
            return { ok: false, text: `${tag} 未知商品 ${goodParam}` }
          }
          const before = country.embargoes.length
          country.embargoes = country.embargoes.filter(one => {
            if (one.target !== target.id) return true
            if (good === undefined) return false
            return !(one.goods === 'all' || one.goods.includes(good))
          })
          const lifted = before - country.embargoes.length
          // Gift-style symmetry: both sides warm by the same amount (plan §3).
          country.diplo.relations[target.id] = clamp(current + 5, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + 5,
            -100,
            100,
          )
          return {
            ok: true,
            text:
              lifted > 0
                ? `${tag} 解除对${target.name}的禁运（${lifted} 项），关系回暖（${relationLine(country, target)}）`
                : `${tag} 与${target.name}本无禁运，关系回暖（${relationLine(country, target)}）`,
          }
        }
        case 'tension': {
          const good = asGood(String(params.good ?? ''))
          if (good === undefined || !SENSITIVE_GOODS.includes(good)) {
            return {
              ok: false,
              text: `${tag} 贸易张力只允许敏感商品：${SENSITIVE_GOODS.join('、')}`,
            }
          }
          const delta = num(params.relationDelta, num(params.amount, 0))
          if (!Number.isFinite(delta) || Math.abs(delta) > TRADE_RELATION_ENVELOPE) {
            return {
              ok: false,
              text: `${tag} 贸易张力变化必须在 ±${TRADE_RELATION_ENVELOPE} 之内`,
            }
          }
          // Record the intent only; the monthly §2.7 step applies it next month.
          world.tradeTensions.push({
            date: { ...world.date },
            from: country.id,
            partner: target.id,
            good,
            relationDelta: delta,
            reason: String(params.reason ?? '贸易摩擦'),
          })
          return {
            ok: true,
            text: `${tag} 就${GOODS[good].name}贸易向${target.name}施加张力 ${delta >= 0 ? '+' : ''}${delta}（下月生效）`,
          }
        }
        default:
          return { ok: false, text: `${tag} 未知外交动作 ${move}` }
      }
    }
    case 'route': {
      const op = String(params.op ?? 'open')
      const goodParam = String(params.good ?? '')
      const good = asGood(goodParam)
      if (good === undefined || !TRADABLE_GOODS.includes(good)) {
        return { ok: false, text: `${tag} 未知或不可贸易商品 ${goodParam}` }
      }
      const partnerId = String(params.partner ?? '')
      const partner = world.countries[partnerId]
      if (partner === undefined) return { ok: false, text: `${tag} 未知伙伴 ${partnerId}` }
      if (partnerId === country.id) return { ok: false, text: `${tag} 不能与本国开通贸易路线` }
      if (atWar(world, country.id, partnerId)) {
        return { ok: false, text: `${tag} 与${partner.name}处于战争状态，无法通商` }
      }
      if (
        embargoed(country.embargoes, partnerId, good) ||
        embargoed(partner.embargoes, country.id, good)
      ) {
        return { ok: false, text: `${tag} 与${partner.name}就该商品存在禁运` }
      }
      // Direction: the endpoint with the larger net surplus exports. A tie goes
      // to the lexicographically smaller id so the pair is symmetric.
      const own = inspectEconomy(country)
      const other = inspectEconomy(partner)
      const ownSurplus = own.production[good] - own.demand[good]
      const partnerSurplus = other.production[good] - other.demand[good]
      const playerExports =
        ownSurplus > partnerSurplus ||
        (ownSurplus === partnerSurplus && country.id < partnerId)
      const fromId = playerExports ? country.id : partnerId
      const toId = playerExports ? partnerId : country.id
      const id = routeId(good, fromId, toId)
      const index = world.tradeRoutes.findIndex(route => route.id === id)
      const existing = index < 0 ? undefined : world.tradeRoutes[index]
      const label = `${GOODS[good].name} ${fromId}→${toId}`
      if (op === 'open') {
        if (existing !== undefined) {
          return { ok: false, text: `${tag} 与${partner.name}的${label}航线已存在（等级 ${existing.level}）` }
        }
        world.tradeRoutes.push({
          id,
          good,
          from: fromId,
          to: toId,
          level: 1,
          owner: 'state',
          openedAt: { ...world.date },
          lastQty: 0,
          lastMargin: 0,
        })
        return { ok: true, text: `${tag} 开通${label}航线（等级 1，国有）` }
      }
      if (existing === undefined) {
        return { ok: false, text: `${tag} 未找到与${partner.name}的${label}航线` }
      }
      if (op === 'raise') {
        existing.level = Math.min(ROUTE_MAX_LEVEL, existing.level + 1)
        return { ok: true, text: `${tag} 将${label}航线提升到等级 ${existing.level}` }
      }
      if (op === 'lower') {
        existing.level -= 1
        if (existing.level <= 0) world.tradeRoutes.splice(index, 1)
        return {
          ok: true,
          text:
            existing.level <= 0
              ? `${tag} 关闭了${label}航线`
              : `${tag} 将${label}航线降低到等级 ${existing.level}`,
        }
      }
      if (op === 'close') {
        world.tradeRoutes.splice(index, 1)
        return { ok: true, text: `${tag} 关闭了${label}航线` }
      }
      return { ok: false, text: `${tag} 未知航线操作 ${op}` }
    }
    case 'situation': {
      // A crisis proposal (plan §4.2): context for the arbitration only.
      const stance = String(params.stance ?? '')
      const narrative = String(params.narrative ?? decision.narrative ?? '')
      return recordSituationProposal(world, country.id, stance, narrative)
    }
    case 'event': {
      const eventId = String(params.eventId ?? '')
      const optionId = String(params.optionId ?? '')
      const event = world.events.find(one => one.id === eventId)
      if (event === undefined) return { ok: false, text: `未知事件 ${eventId}` }
      const result = applyEventOption(world, event, optionId)
      return { ok: true, text: result }
    }
    case 'play': {
      const targetId = String(params.country ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
      const oldPlayer = world.countries[world.playerId]
      if (oldPlayer !== undefined) oldPlayer.isPlayer = false
      target.isPlayer = true
      world.playerId = target.id
      return { ok: true, text: `你现在扮演${target.name}` }
    }
    default:
      return { ok: false, text: `未知行动 ${decision.action}` }
  }
}

/**
 * Validates and applies a policy proposal from the model or the secretary.
 * Magnitudes are free (ADR 0002); the engine checks shapes, costs authority,
 * and turns each effect entry into a modifier (ADR 0003/0004).
 */
/**
 * How a flat policy value translates into "one percent of effect" for
 * authority pricing. Percent/multiply values already are percentages; flat
 * values need a stat-specific scale (e.g. literacy is a 0..1 fraction, so a
 * flat +0.5 is +50 points, not +0.5).
 */
const POLICY_FLAT_SCALE: Partial<Record<PolicyEffect['stat'], number>> = {
  literacy: 100,
  marketAccess: 100,
  laborShare: 100,
  privateInvestment: 100,
  consumption: 100,
  growth: 1000,
  taxEfficiency: 100,
  gdp: 2,
  income: 2,
  expense: 2,
  techPoints: 2,
  production: 2,
  demand: 2,
  farmOutput: 2,
  mineOutput: 2,
  factoryOutput: 2,
}

const flatScale = (stat: PolicyEffect['stat']): number => {
  if (stat.endsWith('Output') || stat.endsWith('Demand')) return 2
  // The default treats one flat point of a 0..100 stock/flow stat as a
  // substantial effect (10 "percent-equivalent" points).
  return POLICY_FLAT_SCALE[stat] ?? 10
}

export function applyPolicy(
  world: WorldState,
  countryId: string,
  proposal: PolicyProposal,
): { ok: boolean; text: string } {
  const country = world.countries[countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${countryId}` }
  const name = String(proposal.name ?? '').trim().slice(0, 40)
  if (name === '') return { ok: false, text: '政策需要一个名称。' }
  const effects = Array.isArray(proposal.effects) ? proposal.effects.slice(0, 12) : []
  if (effects.length === 0) return { ok: false, text: '政策至少需要一个效果条目。' }

  const parsed: PolicyEffect[] = []
  for (const effect of effects) {
    if (!MODIFIER_STATS.includes(effect.stat)) {
      return { ok: false, text: `未知修正对象 ${String(effect.stat)}` }
    }
    const value = Number(effect.value)
    if (!Number.isFinite(value)) return { ok: false, text: '效果数值必须是有限数字。' }
    if (Math.abs(value) > 200) {
      return { ok: false, text: '单个效果数值不能超过 200（防止无界政策）' }
    }
    const cappedStat =
      effect.stat === 'gdp' ||
      effect.stat === 'consumption' ||
      effect.stat === 'demand' ||
      effect.stat === 'production' ||
      effect.stat.endsWith('Output') ||
      effect.stat.endsWith('Demand')
    if (cappedStat && (effect.stack ?? 'flat') !== 'flat' && Math.abs(value) > 100) {
      return {
        ok: false,
        text: `「${MODIFIER_STAT_NAMES[effect.stat]}」类修正单条不得超过 100%`,
      }
    }
    const stack = effect.stack ?? 'flat'
    if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
      return { ok: false, text: '效果单位必须是 flat / percent / multiply。' }
    }
    const months =
      effect.months === undefined
        ? undefined
        : Math.min(240, Math.max(1, Math.round(Number(effect.months))))
    if (months !== undefined && !Number.isFinite(months)) {
      return { ok: false, text: '持续月数必须是数字。' }
    }
    parsed.push({
      stat: effect.stat,
      stack,
      value,
      months,
      label: effect.label,
    })
  }

  // Authority cost scales with the effect's magnitude and duration. This keeps
  // a permanent +50% GDP policy from costing the same 5 points as a +2% one
  // (round-2 playtest P0-3).
  const weight = parsed.reduce((sum, effect) => {
    // A permanent effect is priced as 48 months; flat values are converted to
    // percentage-equivalent units by stat scale.
    const months = effect.months ?? 48
    const magnitude =
      effect.stack === 'flat'
        ? Math.abs(effect.value) * flatScale(effect.stat)
        : Math.abs(effect.value)
    return sum + magnitude * (months / 12)
  }, 0)
  const required = clamp(Math.round(weight * 0.2), 1, 40)
  const requested = clamp(Math.round(num(proposal.authorityCost, 5)), 1, 40)
  const cost = Math.max(required, requested)
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `权威不足，无法推行「${name}」（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)

  parsed.forEach((effect, index) => {
    // A permanent policy replaces an earlier permanent policy on the same
    // stat/stack instead of stacking with it; timed policies keep their own
    // slots and expire normally.
    const id =
      effect.months === undefined
        ? `policy:${effect.stat}:${effect.stack ?? 'flat'}`
        : `policy:${name}:${index}`
    addModifier(country, {
      id,
      label: effect.label ?? name,
      stat: effect.stat,
      stack: effect.stack ?? 'flat',
      value: effect.value,
      monthsLeft: effect.months,
      upkeep: cost / 48 / parsed.length,
      source: `policy:${name}`,
    })
  })

  const summary = parsed
    .map(
      effect =>
        `${MODIFIER_STAT_NAMES[effect.stat]} ${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}${effect.months === undefined ? '' : `（${effect.months} 月）`}`,
    )
    .join('；')
  const text = `[${country.flag}] ${country.name} 推行政策「${name}」：${summary}（权威 -${cost}）`
  world.log.push({
    date: { ...world.date },
    kind: 'politics',
    countryId: country.id,
    text,
  })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text }
}

export function randomDecision(world: WorldState, country: Country, rng: Rng): Decision | undefined {
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  // Crisis fallback (plan §6): a participant in an open situation states a
  // persona-driven stance when the model gave none; proposals carry no effects.
  const situation = world.situations.find(one => !one.resolved)
  if (
    situation !== undefined &&
    situation.countries.includes(country.id) &&
    !situation.proposals.some(one => one.countryId === country.id)
  ) {
    const aggressive = country.leader.traits.some(trait =>
      ['扩张', '军事', '专制', '民粹', '海权'].includes(trait),
    )
    const reformist = country.leader.traits.some(trait =>
      ['改革', '贸易', '务实', '维新'].includes(trait),
    )
    const stance = aggressive
      ? country.id === 'QING'
        ? 'crackdown'
        : 'war'
      : reformist
        ? 'compromise'
        : 'neutral'
    return {
      countryId: country.id,
      action: 'situation',
      params: { stance, narrative: `${country.name}就鸦片危机表明立场` },
    }
  }
  // Debt service is a hard constraint; the deterministic fallback raises
  // taxes before a debt spiral becomes permanent.
  if (
    nationalDebt(country) > country.econ.gdp &&
    country.econ.taxRate < 45 &&
    rng.chance(0.5)
  ) {
    return {
      countryId: country.id,
      action: 'tax',
      params: { rate: Math.min(45, country.econ.taxRate + 2) },
      narrative: `${country.name}为偿债提高税率`,
    }
  }
  if (
    country.econ.income < country.econ.expense &&
    country.econ.treasury < 5 &&
    country.econ.spending.army > 1 &&
    rng.chance(0.3)
  ) {
    return {
      countryId: country.id,
      action: 'spending',
      params: { category: 'army', amount: country.econ.spending.army - 1 },
      narrative: `${country.name}压缩军费以平衡预算`,
    }
  }
  // Confidence drifts with the fiscal mood when the model is unavailable.
  if (rng.chance(0.15)) {
    const mood = country.econ.income - country.econ.expense > 0 ? 1 : -1
    return {
      countryId: country.id,
      action: 'invest',
      params: { amount: mood },
      narrative: `${country.name}调整投资信心`,
    }
  }
  if (
    !atWar &&
    country.econ.treasury > 8 &&
    country.econ.constructionQueue.length < 6 &&
    rng.chance(0.45)
  ) {
    const options = [
      'factories',
      'farms',
      'mines',
      'railroads',
      'universities',
      'workshops',
    ] as const
    const building = rng.pick(options)
    return {
      countryId: country.id,
      action: 'build',
      params: { building, count: 1 },
      narrative: `${country.name}扩建${building}`,
    }
  }
  if (country.pops.radicals > 30 && country.econ.treasury > 4 && rng.chance(0.4)) {
    return {
      countryId: country.id,
      action: 'law',
      params: { name: '福利改革' },
      narrative: `${country.name}以福利安抚民怨`,
    }
  }
  const others = Object.values(world.countries).filter(one => one.id !== country.id)
  const infamous = others.filter(
    one => one.diplo.infamy > 25 && !country.diplo.rivals.includes(one.id),
  )
  if (!atWar && infamous.length > 0 && rng.chance(0.08)) {
    const target = rng.pick(infamous)
    return {
      countryId: country.id,
      action: 'diplomacy',
      params: { target: target.id, move: 'rival' },
      narrative: `${country.name}对声名狼藉的${target.name}提高警惕`,
    }
  }
  if (!atWar && rng.chance(0.12)) {
    const target = rng.pick(others)
    const current = country.diplo.relations[target.id] ?? 0
    if (current > -60 && rng.chance(0.4)) {
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'improve' },
        narrative: `${country.name}向${target.name}示好`,
      }
    }
  }
  if (
    !atWar &&
    rng.chance(0.03) &&
    country.leader.traits.some(trait => ['扩张', '军事', '海权', '民粹'].includes(trait))
  ) {
    const targets = Object.values(world.countries).filter(
      one => one.id !== country.id && (country.diplo.relations[one.id] ?? 0) < -20,
    )
    if (targets.length > 0) {
      const target = rng.pick(targets)
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'war', reason: '宿怨与野心', goal: 'reparations' },
        narrative: `${country.name}对${target.name}发出最后通牒`,
      }
    }
  }
  return undefined
}

/**
 * Why a managed run should stop after the month that just passed, or '' to
 * keep going (plan §4.5). The secretary-overreach check lives in the hooks
 * layer, where the audit flag is.
 */
export function councilInterrupt(before: WorldState, after: WorldState): string {
  const pendingOf = (world: WorldState): number =>
    world.events.filter(event => event.countryId === world.playerId && !event.isResolved).length
  // Any unresolved player event stops a run, whether it was already open or
  // arrived this month (plan §4.5).
  if (pendingOf(after) > 0) return '有待决事件'

  const atWar = (world: WorldState, id: string): boolean =>
    world.wars.some(
      war =>
        war.id === id &&
        (war.attackers.includes(world.playerId) || war.defenders.includes(world.playerId)),
    )
  const newWar = after.wars.some(war => !before.wars.some(one => one.id === war.id) && atWar(after, war.id))
  if (newWar) return '新的战争'
  const warEnded = before.wars.some(war => atWar(before, war.id) && !after.wars.some(one => one.id === war.id))
  if (warEnded) return '战争结束'
  return ''
}

export function newWorld(seed: number, playerId: string): WorldState {
  const world = createWorld(seed, playerId)
  calibrateWorld(world)
  bootstrapRoutes(world)
  return world
}
