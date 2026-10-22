import type {
  BuildingId,
  Country,
  ConstructionProject,
  GoodId,
  LogEntry,
  WorldState,
} from '../types'
import {
  BUILDINGS,
  BUILDING_RECIPES,
  INVESTMENT_DEMAND,
  deriveBureaucracy,
  effectiveCount,
  infrastructureMultiplier,
  refreshInfrastructure,
} from './data'
import {
  CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL,
  debtPressure,
} from './fiscal'
import { applyModifiers } from './modifiers'
import { computeProduction } from './economy'
import { clamp, ensureConstructionFields, techMultiplier } from './internal'
import type { Rng } from './rng'

import {
  ADMIN_CAPACITY_MAX,
  BUILDING_COST_ADDEND,
  BUILDING_COST_MULTIPLIER,
  CANAL_MARKET_ACCESS,
  CAPACITY_COST,
  CONSTRUCTION_ACCESS_BASE,
  CONSTRUCTION_ACCESS_SLOPE,
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  CONSTRUCTION_SCHEDULE_MONTHS,
  MAX_BUILDINGS_PER_SLOT,
  OFFICE_ADMIN_CAPACITY,
  PORT_MARKET_ACCESS,
  PRIVATE_OWN_CAPACITY_SHARE,
  RAILROAD_MARKET_ACCESS,
  SCHOOL_LITERACY_GAIN,
  TELEGRAPH_MARKET_ACCESS,
  UNIVERSITY_ADMIN_CAPACITY,
  WORKLOAD_MULTIPLIER,
  WORKSHOP_CAPACITY_OUTPUT,
} from './config/construction'
import { RESTRUCTURE_DEBT_RATIO } from './config/fiscal'

/** Goods one workshop consumes per month to run at full capacity. */
export const WORKSHOP_INPUTS: Partial<Record<GoodId, number>> =
  BUILDING_RECIPES.workshops.input

/** The construction constants live in `config/construction.ts`; re-exported so
 *  the `./construction` / `./sim` import surface is unchanged. */
export {
  WORKSHOP_CAPACITY_OUTPUT,
  CAPACITY_COST,
  PRIVATE_OWN_CAPACITY_SHARE,
  CONSTRUCTION_RENT_PER_POINT,
  MAX_BUILDINGS_PER_SLOT,
  WORKLOAD_MULTIPLIER,
  CONSTRUCTION_COST_PER_POINT,
  BUILDING_COST_MULTIPLIER,
  BUILDING_COST_ADDEND,
}

export const capacityCost = (project: ConstructionProject): number =>
  (CAPACITY_COST[project.building] ?? 1) * project.count

/** Total points of work a project must complete. */
export const projectWorkload = (project: ConstructionProject): number =>
  capacityCost(project) * WORKLOAD_MULTIPLIER

export const maxSlotCapacity = (building: BuildingId): number =>
  MAX_BUILDINGS_PER_SLOT * (CAPACITY_COST[building] ?? 1)

/** Base gold per construction point and the per-building cost tuning live in
 *  `config/construction.ts`; both are re-exported above. */

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
  const access = CONSTRUCTION_ACCESS_BASE + applyModifiers(country, 'marketAccess', country.econ.marketAccess) * CONSTRUCTION_ACCESS_SLOPE
  // Plan 0011 F5: workshops ride the unified infrastructure multiplier like
  // every other building (the old `0.6 + transport / 160` curve retired).
  const infra = infrastructureMultiplier(
    applyModifiers(
      country,
      'transportInfrastructure',
      country.econ.transportInfrastructure,
    ),
  )
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
      turns: CONSTRUCTION_SCHEDULE_MONTHS,
      currentShare: need > 0 ? Math.min(1, take / need) : 1,
      remainingPoints: Math.max(0, remainingWorkload - take),
    }
  }

  for (let month = 1; month <= CONSTRUCTION_SCHEDULE_MONTHS && active.size > 0; month += 1) {
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

/** Adds built structures and their side effects. */
export function completeBuilding(country: Country, building: BuildingId, count: number): void {
  ensureConstructionFields(country)
  // Negative counts remove buildings (天命); never go below zero.
  country.econ.buildings[building] = Math.max(
    0,
    (country.econ.buildings[building] ?? 0) + count,
  )
  if (building === 'railroads') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * RAILROAD_MARKET_ACCESS, 0, 1)
  }
  if (building === 'ports') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * PORT_MARKET_ACCESS, 0, 1)
  }
  // Plan 0011 F4/F5. schools resolves the plan's §10 待定 ("建成时加识字率"): a
  // completed primary school raises literacy on the spot. canals/telegraphs keep
  // their market-access side effect, but their transport side effect retires:
  // infrastructure is now the unified supply/demand pool (railroads/ports/canals/
  // telegraphs supply it), refreshed below from the building counts. forts/
  // navalYards have no completion side effect beyond their small output.
  if (building === 'schools') {
    country.pops.literacy = clamp(country.pops.literacy + count * SCHOOL_LITERACY_GAIN, 0, 1)
  }
  if (building === 'canals') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * CANAL_MARKET_ACCESS, 0, 1)
  }
  if (building === 'telegraphs') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * TELEGRAPH_MARKET_ACCESS, 0, 1)
  }
  if (building === 'universities') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count * UNIVERSITY_ADMIN_CAPACITY,
      0,
      ADMIN_CAPACITY_MAX,
    )
  }
  if (building === 'offices') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count * OFFICE_ADMIN_CAPACITY,
      0,
      ADMIN_CAPACITY_MAX,
    )
  }
  country.bureaucracy = deriveBureaucracy(country, true)
  refreshInfrastructure(country)
}

/**
 * Brings legacy projects onto the current workload rules (ADR 0012/0013):
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
export function settleConstruction(
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
  const debtFloor = -country.econ.gdp * RESTRUCTURE_DEBT_RATIO
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
