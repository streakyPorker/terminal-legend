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
  INFRA_BUILDING_IDS,
  INVESTMENT_DEMAND,
  applyBuildingDelta,
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
  CAPACITY_COST,
  CONSTRUCTION_ACCESS_BASE,
  CONSTRUCTION_ACCESS_SLOPE,
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  CONSTRUCTION_SCHEDULE_MONTHS,
  INFRA_MARKET_ACCESS,
  MAX_BUILDINGS_PER_SLOT,
  OFFICE_ADMIN_CAPACITY,
  PRIVATE_OWN_CAPACITY_SHARE,
  SCHOOL_LITERACY_GAIN,
  UNIVERSITY_ADMIN_CAPACITY,
  UPGRADE_WORKLOAD_SHARE,
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

/** Plan 0015 §S2: an absent `kind` (every pre-S2 project and every new build)
 *  is treated as `'build'`. */
export const projectKind = (project: ConstructionProject): 'build' | 'upgrade' =>
  project.kind === 'upgrade' ? 'upgrade' : 'build'

/**
 * Plan 0015 §S2 / ADR 0031 §5: seats at `fromTier` already claimed by OTHER
 * pending upgrade projects of the same building, so repeat orders cannot
 * over-reserve. `fromTier` is the 0-based `buildingTiers` index stored on the
 * project (tier I = 0), matching `recipeAt` / `applyBuildingDelta`.
 */
export function alreadyReserved(
  country: Country,
  id: BuildingId,
  fromTier: number,
): number {
  let reserved = 0
  for (const project of country.econ.constructionQueue) {
    if (projectKind(project) !== 'upgrade') continue
    if (project.building !== id) continue
    if ((project.fromTier ?? 0) !== fromTier) continue
    reserved += project.count
  }
  return reserved
}

/** Total points of work a project must complete. An upgrade retrofits existing
 *  seats, so it needs only `UPGRADE_WORKLOAD_SHARE` of the same-tier new-build
 *  workload; the per-point price is unchanged, so the saving is time and total
 *  points, never a discount (plan 0015 §S2 / ADR 0031 §5). */
export const projectWorkload = (project: ConstructionProject): number =>
  capacityCost(project) *
  WORKLOAD_MULTIPLIER *
  (projectKind(project) === 'upgrade' ? UPGRADE_WORKLOAD_SHARE : 1)

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
export function completeBuilding(
  country: Country,
  building: BuildingId,
  count: number,
  tier = 0,
): void {
  ensureConstructionFields(country)
  // Negative counts remove buildings (天命); never go below zero. A 天命 or a
  // legacy project lands at tier I (index 0); a tier-II new build passes its
  // target index so the delta lands in the right bucket — the mutator keeps
  // `Σ buildingTiers[id] === buildings[id]` true either way.
  applyBuildingDelta(country, building, tier, count)
  // Plan 0014 / ADR 0029: the merged infrastructure building keeps the providers'
  // market-access completion side effect; iterate `INFRA_BUILDING_IDS` and read
  // the per-building coefficient table so a future re-split stays data-only.
  for (const id of INFRA_BUILDING_IDS) {
    const access = INFRA_MARKET_ACCESS[id]
    if (access === undefined) continue
    if (building === id) {
      country.econ.marketAccess = clamp(country.econ.marketAccess + count * access, 0, 1)
    }
  }
  // Plan 0011 F4/F5. schools resolves the plan's §10 待定 ("建成时加识字率"): a
  // completed primary school raises literacy on the spot. Infrastructure supply
  // is derived from the building counts and refreshed below; universities and
  // offices raise administrative capacity.
  if (building === 'schools') {
    country.pops.literacy = clamp(country.pops.literacy + count * SCHOOL_LITERACY_GAIN, 0, 1)
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
 * Plan 0015 §S2 / ADR 0031 §5: completes an upgrade project by MOVING `count`
 * seats from `fromTier` to `toTier` (0-based indices). Unlike
 * {@link completeBuilding} it is a retrofit — it adds no new seats, fires no
 * completion side effects (market access / literacy / administrative capacity)
 * and does NOT refresh infrastructure. Seat availability is re-validated here:
 * if the source tier shrank since the order, only the seats that remain move and
 * a remainder project is returned for the caller to write back onto the queue
 * (undefined when fully done).
 */
export function completeUpgrade(
  country: Country,
  project: ConstructionProject,
): ConstructionProject | undefined {
  ensureConstructionFields(country)
  const from = project.fromTier ?? 0
  const to = project.toTier ?? from + 1
  const available = Math.max(0, country.econ.buildingTiers[project.building]?.[from] ?? 0)
  const moved = Math.min(project.count, available)
  if (moved > 0) {
    applyBuildingDelta(country, project.building, from, -moved)
    applyBuildingDelta(country, project.building, to, moved)
  }
  if (moved >= project.count) return undefined
  const remainder: ConstructionProject = {
    ...project,
    id: `${project.id}-rem`,
    count: project.count - moved,
    monthsLeft: 1,
    lastSpend: 0,
    lastCapacity: 0,
    progress: 0,
  }
  remainder.monthlyCost = constructionMonthlyCost(remainder)
  return remainder
}

/**
 * Brings legacy projects onto the current workload rules (ADR 0012/0013):
 * cost priced per workload point, and at most five buildings per slot
 * (oversized slots are split). Upgrade projects are never split — they claim
 * an arbitrary number of seats that already exist (plan 0015 §S2).
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
    if (projectKind(project) === 'build' && project.count > MAX_BUILDINGS_PER_SLOT) {
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
  // Upgrade projects that had to complete partially; written back after both
  // passes so the same-month loop never re-processes them (plan 0015 §S2).
  const remainders: ConstructionProject[] = []
  // A fully funded slot finishes in one month; `constructionSpeed` policies
  // and the debt-pressure penalty are the only modifiers on that pace.
  const constructionSpeed = applyModifiers(country, 'constructionSpeed', 1)

  const runProject = (
    project: ConstructionProject,
    capacityTake: number,
    inputShare: number,
    workShare: number,
    isPrivate: boolean,
    // PT-070 safety net: the treasury covers a broke private pool's shortfall.
    subsidy = 0,
  ): void => {
    const owner = isPrivate ? 'private' : 'state'
    const goldNeed = project.monthlyCost * inputShare
    const spend =
      capacityTake <= 0
        ? 0
        : isPrivate
          ? Math.min(privateBudget + subsidy, goldNeed)
          : Math.min(goldNeed, Math.max(0, country.econ.treasury - debtFloor))
    project.lastSpend = spend
    project.lastCapacity = capacityTake
    if (spend > 0) {
      if (isPrivate) {
        const fromPrivate = Math.min(privateBudget, spend)
        privateBudget -= fromPrivate
        privateSpent += fromPrivate
        const fromState = spend - fromPrivate
        if (fromState > 0) {
          stateSpent += fromState
          country.econ.treasury -= fromState
        }
      } else {
        stateSpent += spend
        country.econ.treasury -= spend
      }
      const funded =
        project.monthlyCost > 0 ? spend / project.monthlyCost : inputShare
      // ADR 0031 §5 / plan 0015 §S2: an upgrade draws NO materials — its only
      // costs are capacity and gold. So the intermediate-good investment demand
      // is new builds only; the upgrade's gold still lands in `stateSpent`
      // above (the construction-spend channel counted as GDP investment I).
      if (projectKind(project) !== 'upgrade') {
        for (const [id, coefficient] of Object.entries(
          INVESTMENT_DEMAND[project.building],
        ) as [GoodId, number][]) {
          nextConstructionDemand[id] =
            (nextConstructionDemand[id] ?? 0) + coefficient * project.count * funded
        }
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
      if (projectKind(project) === 'upgrade') {
        const from = (project.fromTier ?? 0) + 1
        const to = (project.toTier ?? (project.fromTier ?? 0) + 1) + 1
        const remainder = completeUpgrade(country, project)
        const done = project.count - (remainder?.count ?? 0)
        log.push({
          date: { ...world.date },
          kind: 'economy',
          countryId: country.id,
          text:
            remainder === undefined
              ? `[${country.flag}] ${country.name}将 ${done} 座${BUILDINGS[project.building].name}从 ${from} 级升级到 ${to} 级`
              : `[${country.flag}] ${country.name}将 ${done} 座${BUILDINGS[project.building].name}从 ${from} 级升级到 ${to} 级，${remainder.count} 座因存量不足顺延`,
        })
        // A partially-completed upgrade whose source tier shrank goes back onto
        // the queue with its remaining seat count (plan 0015 §S2).
        if (remainder !== undefined) remainders.push(remainder)
        return
      }
      completeBuilding(country, project.building, project.count, project.toTier ?? 0)
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
    const inputShare = need > 0 ? capacityTake / need : 1
    // Safety net only: a private pool that cannot pay gets the treasury behind
    // it, so idle capacity never rots (PT-070).
    const subsidy =
      privateBudget + 1e-9 < project.monthlyCost * inputShare
        ? Math.min(
            project.monthlyCost * inputShare - privateBudget,
            Math.max(0, country.econ.treasury - debtFloor),
          )
        : 0
    runProject(
      project,
      capacityTake,
      inputShare,
      workload > 0 ? capacityTake / workload : 1,
      true,
      subsidy,
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

  for (const remainder of remainders) {
    queue.push(remainder)
    kept.add(remainder.id)
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
