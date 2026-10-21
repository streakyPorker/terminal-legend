import type {
  BuildingId,
  Country,
  ConstructionProject,
  GoodId,
  LogEntry,
  WorldState,
} from '../types'
import { BUILDINGS, BUILDING_OUTPUT, GOODS, INDUSTRIAL_BUILDING_IDS, resourceMultiplier } from './data'
import { nationalDebt } from './fiscal'
import { totalsFor } from './modifiers'
import {
  MAX_BUILDINGS_PER_SLOT,
  constructionMonthlyCost,
  constructionTotalCost,
} from './construction'
import type { EconomySnapshot } from './economy'
import { clamp } from './internal'

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
    const potential =
      (INDUSTRIAL_BUILDING_IDS as BuildingId[]).includes(building)
        ? resource * industrial
        : resource
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
export const DEPRECIATION_PER_MONTH = 0.0015

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
export function investPrivateCapital(
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
  // Capital cost of one building: turns an absolute monthly profit into a
  // return on capital, the deterministic tie-break between equally-attractive
  // candidates (ADR 0022).
  const capitalCost = (building: BuildingId): number =>
    Math.max(0.01, constructionTotalCost(draftProject(building, 1)))
  const scores = (Object.keys(BUILDINGS) as BuildingId[]).map(building => {
    const hasOutput = Object.keys(BUILDING_OUTPUT[building]).length > 0
    const profitable = snap.buildingProfits[building].profitPerBuilding > 0
    return {
      building,
      hasOutput,
      profitable,
      returnOnCapital: profitable
        ? snap.buildingProfits[building].profitPerBuilding / capitalCost(building)
        : 0,
      // Legacy shortage/dispatch signal: which output is short relative to its
      // price basket. It allocates investment among *profitable* types.
      score: hasOutput
        ? investmentScore(country, building, snap.demand, snap.production)
        : infrastructureScore(country, building),
      stock: country.econ.buildings[building],
    }
  })
  // The profitability gate is binding: an unprofitable type is never built
  // (ADR 0022). Among profitable types the shortage signal picks the target,
  // with return on capital and the building id as deterministic tie-breaks.
  let best: (typeof scores)[number] | undefined
  for (const row of scores) {
    if (!row.hasOutput || !row.profitable) continue
    if (
      best === undefined ||
      row.score > best.score ||
      (row.score === best.score &&
        (row.returnOnCapital > best.returnOnCapital ||
          (row.returnOnCapital === best.returnOnCapital && row.building < best.building)))
    ) {
      best = row
    }
  }
  // Renewal goes to the type losing the most stock to depreciation, so farms,
  // universities and offices are not permanently ignored in favour of the
  // single highest-scoring factory. Unprofitable capacity is not renewed; it
  // idles and shrinks instead (ADR 0022).
  const renewalCandidates = scores.filter(
    row => row.stock > 0 && row.score > 0.55 && row.profitable,
  )
  const renewal =
    renewalCandidates.length > 0
      ? renewalCandidates[world.tick % renewalCandidates.length]
      : undefined

  // Slots finish in a month now, so private builders can commit most of the
  // idle pool: keep only what active projects already need.
  const headroom = Math.max(0, country.econ.privateCapital - activePrivateCost)
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
