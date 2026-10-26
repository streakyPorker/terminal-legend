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
  BUILDING_OUTPUT,
  GOODS,
  INDUSTRIAL_BUILDING_IDS,
  buildableBuildingIds,
  maxUnlockedTier,
  recipeAt,
  resourceMultiplier,
} from './data'
import { nationalDebt } from './fiscal'
import { totalsFor } from './modifiers'
import {
  MAX_BUILDINGS_PER_SLOT,
  alreadyReserved,
  constructionMonthlyCost,
  constructionTotalCost,
} from './construction'
import { NON_UPGRADABLE_BUILDINGS } from './config/construction'
import type { EconomySnapshot } from './economy'
import { clamp } from './internal'
import {
  CAPITAL_COST_FLOOR,
  DEPRECIATION_PER_MONTH,
  INFRA_SCORE_BASE,
  INFRA_SCORE_LITERACY,
  INFRA_SCORE_OFFICE_BONUS,
  INFRA_SCORE_OFFICE_MIN,
  INFRA_SCORE_OFFICES,
  INFRA_SCORE_PORT,
  INFRA_SCORE_TRANSPORT,
  INVESTMENT_CONFIDENCE_MIN,
  INVESTMENT_DEBT_COEF,
  INVESTMENT_INDUSTRIAL_MAX,
  INVESTMENT_INDUSTRIAL_MIN,
  INVESTMENT_MONTHS_PER_YEAR,
  INVESTMENT_RATIO_MAX,
  INVESTMENT_RATIO_MIN,
  INVESTMENT_RENEWAL_SCORE,
  INVESTMENT_RESERVE_BASE,
  INVESTMENT_RESERVE_MULTIPLE,
  INVESTMENT_RETURN_BASE,
  MAX_PRIVATE_PROJECTS,
  PRIVATE_START_INTERVAL,
  SUPPLY_DEMAND_GUARD,
} from './config/economy'

export { DEPRECIATION_PER_MONTH, MAX_PRIVATE_PROJECTS, PRIVATE_START_INTERVAL }

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
    INVESTMENT_INDUSTRIAL_MIN,
    INVESTMENT_INDUSTRIAL_MAX,
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
    const ratio = clamp(demand[id] / Math.max(SUPPLY_DEMAND_GUARD, production[id]), INVESTMENT_RATIO_MIN, INVESTMENT_RATIO_MAX)
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
    case 'infrastructure':
      // Plan 0014: the merged provider keeps both renewal motives — the
      // transport level (railroads) and market access (ports).
      return (
        INFRA_SCORE_BASE +
        (1 - country.econ.transportInfrastructure / 100) * INFRA_SCORE_TRANSPORT +
        (1 - country.econ.marketAccess) * INFRA_SCORE_PORT
      )
    case 'universities':
      return INFRA_SCORE_BASE + (1 - country.pops.literacy) * INFRA_SCORE_LITERACY
    case 'offices': {
      const ceiling = country.bureaucracy.ceiling / 100
      return (
        INFRA_SCORE_BASE +
        (1 - clamp(ceiling, 0, 1)) * INFRA_SCORE_OFFICES +
        (b.offices < INFRA_SCORE_OFFICE_MIN ? INFRA_SCORE_OFFICE_BONUS : 0)
      )
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
  return (
    (1 + (INVESTMENT_RETURN_BASE + debtRatio * INVESTMENT_DEBT_COEF) / INVESTMENT_MONTHS_PER_YEAR) /
    Math.max(INVESTMENT_CONFIDENCE_MIN, confidence)
  )
}

/**
 * Per-seat gross value added (`Σ产出×价 − Σ投入×价`) of a building's recipe at
 * tier index `tierIndex` (0 = tier I), valued at the country's current prices.
 * This is the plan 0016 §S6 "预估毛利" signal: wages are excluded on purpose, so
 * the retrofit decision reads only the recipe/price improvement.
 */
export function tierValueAdded(country: Country, building: BuildingId, tierIndex: number): number {
  const recipe = recipeAt(building, tierIndex)
  const prices = country.econ.prices
  let added = 0
  for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
    added += coef * prices[good]
  }
  for (const [good, coef] of Object.entries(recipe.input) as [GoodId, number][]) {
    added -= coef * prices[good]
  }
  return added
}

/** Index (0-based; tier I = 0) of the highest tier a building actually occupies. */
export function topOccupiedTier(country: Country, building: BuildingId): number {
  const counts = country.econ.buildingTiers?.[building]
  if (counts === undefined) return 0
  for (let tier = counts.length - 1; tier >= 0; tier -= 1) {
    if ((counts[tier] ?? 0) > 0) return tier
  }
  return 0
}

/**
 * Plan 0016 §S6: the deterministic retrofit a country would order for `building`
 * — moving up to `maxCount` of its top-tier seats to the next tier — or
 * undefined when none clears the gate. The gate, in order: the target tier is
 * unlocked (`maxUnlockedTier`), source seats remain after other pending upgrades
 * have reserved theirs, and the target tier's per-seat gross value added is
 * positive AND strictly above the source tier's (the projected margin improves).
 * No RNG anywhere: the same state always yields the same candidate.
 */
export function upgradeCandidate(
  country: Country,
  building: BuildingId,
  maxCount: number,
): { fromTier: number; toTier: number; count: number } | undefined {
  if (NON_UPGRADABLE_BUILDINGS.includes(building)) return undefined
  const fromTier = topOccupiedTier(country, building)
  const toTier = fromTier + 1
  // `maxUnlockedTier` is 1-based (tier II = 2), so a 0-based `toTier` index
  // needs the ceiling to reach `toTier + 1`.
  if (maxUnlockedTier(country, building) < toTier + 1) return undefined
  const seats =
    (country.econ.buildingTiers[building]?.[fromTier] ?? 0) -
    alreadyReserved(country, building, fromTier)
  if (seats <= 0) return undefined
  const target = tierValueAdded(country, building, toTier)
  if (target <= 0 || target <= tierValueAdded(country, building, fromTier)) return undefined
  const count = Math.floor(Math.min(seats, maxCount))
  if (!(count >= 1)) return undefined
  return { fromTier, toTier, count }
}

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
  const draftUpgrade = (
    building: BuildingId,
    fromTier: number,
    toTier: number,
    count: number,
  ): ConstructionProject => ({
    ...draftProject(building, count),
    kind: 'upgrade',
    fromTier,
    toTier,
  })
  // Capital cost of one building: turns an absolute monthly profit into a
  // return on capital, the deterministic tie-break between equally-attractive
  // candidates (ADR 0022).
  const capitalCost = (building: BuildingId): number =>
    Math.max(CAPITAL_COST_FLOOR, constructionTotalCost(draftProject(building, 1)))
  const scores = buildableBuildingIds(country).map(building => {
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
    row => row.stock > 0 && row.score > INVESTMENT_RENEWAL_SCORE && row.profitable,
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
    // Plan 0016 §S6: when the chosen type's next tier is unlocked and the
    // retrofit raises per-seat gross margin, the private investor retrofits
    // existing seats (`kind: 'upgrade'`) instead of adding new tier-I capacity.
    // The retrofit shares the new-build balance and the one-project-per-interval
    // cap, and `upgradeCandidate` reserves source seats, so repeat orders cannot
    // oversubscribe (deterministic — no RNG).
    //
    // Scoped to NON-PLAYER countries: the plan's goal is that the empires the
    // player does not run electrify on their own (ADR 0032 §后果风险). The
    // player's own seats are upgraded through the ordinary `v3_action upgrade`
    // order, so the player country keeps the pre-S6 private-investment baseline.
    const retrofit = country.isPlayer
      ? undefined
      : upgradeCandidate(country, best.building, canStart.affordable)
    if (retrofit !== undefined) {
      const draft = draftUpgrade(best.building, retrofit.fromTier, retrofit.toTier, retrofit.count)
      const monthlyCost = constructionMonthlyCost(draft)
      if (monthlyCost <= country.econ.privateCapital) {
        country.econ.constructionQueue.push({
          ...draft,
          id: `proj-${world.tick}-${country.id}-upg-${country.econ.constructionQueue.length}`,
          monthlyCost,
        })
        log.push({
          date: { ...world.date },
          kind: 'economy',
          countryId: country.id,
          text: `[${country.flag}] ${country.name}的私人资本将 ${retrofit.count} 座${BUILDINGS[best.building].name}从 ${retrofit.fromTier + 1} 级升级到 ${retrofit.toTier + 1} 级`,
        })
        country.econ.lastPrivateStartTick = world.tick
        started = true
      }
    } else {
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
  const reserve = Math.max(INVESTMENT_RESERVE_BASE, totalPrivateCost * INVESTMENT_RESERVE_MULTIPLE)
  const idle = Math.max(0, country.econ.privateCapital - reserve)
  const released = idle * (1 - country.politicalEconomy.idleRetained)
  if (released > 0) {
    country.econ.privateCapital = Math.max(0, country.econ.privateCapital - released)
    country.econ.idlePurchases += released
  }
  country.econ.idleProfits = idle
}
