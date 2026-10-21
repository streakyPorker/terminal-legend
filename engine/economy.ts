import type {
  BuildingId,
  BuildingProfit,
  Country,
  GdpComponents,
  GoodId,
} from '../types'
import {
  BUILDING_IDS,
  BUILDING_RECIPES,
  CONSUMPTION_PROPENSITY,
  CONSUMER_GOODS,
  GOODS,
  GOOD_IDS,
  GOVERNMENT_DEMAND,
  INCOME_ELASTICITY,
  SUBSISTENCE,
  deriveLabor,
  effectiveCount,
  resourceMultiplier,
  type LaborStats,
} from './data'
import {
  LAND_VALUE_PER_UNIT,
  expenseParts,
  incomeParts,
  privateTaxBurden,
  type ExpenseParts,
  type IncomeParts,
  type TaxBaseQuantities,
} from './fiscal'
import { applyModifiers } from './modifiers'
import { effectiveResources } from './trade'
import { clamp, ensureConstructionFields, techMultiplier } from './internal'

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
  /** This month's four tax-base quantities (ADR 0023). */
  taxBaseQty: TaxBaseQuantities
  buildingProfits: Record<BuildingId, BuildingProfit>
  labor: LaborStats
}

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

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

// ---------------------------------------------------- utilization feedback
// ADR 0022 (plan 0008 B3): a building type's operating rate is driven by last
// month's profitability. Production multiplies each type's output by the
// *stored* rate, so the price → profit → capacity → price loop always carries a
// one-month lag and cannot close in the same month.

/**
 * Floor an unprofitable type's operating rate decays to. A type that loses
 * money still runs at half speed rather than stopping dead, so a price recovery
 * can revive it and the idle state has a fixed point.
 */
export const UTIL_IDLE_FLOOR = 0.5

/** First-order smoothing: the rate moves a quarter of the way to its target
 *  each month (ADR 0022). */
export const UTIL_SMOOTHING = 0.25

/**
 * Cap on the extra monthly decay applied to a deeply loss-making building count
 * on top of `DEPRECIATION_PER_MONTH`. Deterministic, no RNG (ADR 0022).
 */
export const SHRINK_MAX = 0.02

/**
 * Last month's stored operating rate for a building type (ADR 0022).
 * `computeProduction` reads this, so this month's output reflects last month's
 * profitability. A missing or corrupt value falls back to full utilisation.
 */
function storedUtilization(country: Country, id: BuildingId): number {
  const value = country.econ.buildingProfits?.[id]?.utilization
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1
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
  // Gated per-building output, summed by good (ADR 0021). BUILDING_RECIPES is
  // the only source of the coefficients; the multiplier seams it names are the
  // same `tech`/`infra`/`access`/`industrial` factors the code always applied.
  const raw = zeroGoods()
  for (const id of BUILDING_IDS) {
    const recipe = BUILDING_RECIPES[id]
    // Output is gated by last month's stored operating rate (ADR 0022): the
    // price → profit → capacity loop is one month behind, never same-month.
    const count = cap(b[id]) * storedUtilization(country, id)
    if (count <= 0) continue
    const modifier = recipe.outputModifier
    for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
      const gates = recipe.outputGates?.[good] ?? recipe.gates
      let value = count * coef
      if (gates?.tech) value *= tech
      if (gates?.infrastructure) value *= infra
      if (gates?.access) value *= access
      if (gates?.industrial) value *= industrial
      if (modifier !== undefined) value = applyModifiers(country, modifier, value)
      raw[good] += value
    }
  }
  // Opium is farm-grown (plan 0004 §1.1) and scaled by the country's own
  // output factor, which lets Britain stand in for British India.
  raw.opium *= country.opium.outputFactor
  // Artisans supply the bottom of the consumer market before factories do;
  // without them an agrarian country reads as permanently short of clothes.
  // National (per-artisan/pop) terms, not per-building recipes.
  raw.clothes += country.pops.artisans * 0.035
  raw.liquor += country.pops.artisans * 0.01
  raw.furniture += country.pops.artisans * 0.006
  raw.services += (country.pops.total / 1000) * 0.5 * access + country.pops.artisans * 0.01
  for (const id of GOOD_IDS) out[id] = output(id, raw[id])
  return out
}

export { computeProduction }

type DemandBreakdown = {
  demand: Record<GoodId, number>
  /** Final-use quantities by block; GDP values them only up to supply. */
  consumer: Record<GoodId, number>
  investment: Record<GoodId, number>
  government: Record<GoodId, number>
  /** Final consumer-goods spending at current prices, the consumption tax base. */
  consumptionValue: number
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
  // The private tax burden is the land + profit + consumption take computed
  // from the four real bases (ADR 0023), not a GDP share. Using last month's
  // stored base quantities keeps the loop one month behind, like wages/profits.
  const taxTake = privateTaxBurden(country)
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
  // Each building consumes its recipe.input (Σ count × coefficient). The
  // per-popFactor household industrial terms and the military arms term stay
  // national, outside the recipes.
  const intermediate = zeroGoods()
  for (const id of BUILDING_IDS) {
    const count = b[id]
    if (count <= 0) continue
    for (const [good, perBuilding] of Object.entries(BUILDING_RECIPES[id].input) as [
      GoodId,
      number,
    ][]) {
      intermediate[good] += count * perBuilding
    }
  }
  // Industrial towns buy food off the market; this puts agrarian and
  // industrial economies on opposite sides of the grain trade instead of
  // every country holding a permanent grain mountain.
  intermediate.coal += popFactor * 1.2
  intermediate.iron += popFactor * 0.8
  intermediate.fabric += popFactor * 0.5
  intermediate.wood += popFactor * 0.3
  for (const good of GOOD_IDS) {
    if (intermediate[good] !== 0) out[good] += demand(good, intermediate[good])
  }
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
  // The consumption tax base values only the final consumer basket, never the
  // intermediate demand above (ADR 0023 de-duplication rule).
  let consumptionValue = 0
  for (const id of CONSUMER_GOODS) consumptionValue += consumer[id] * prices[id]
  return { demand: out, consumer, investment, government, consumptionValue }
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

/**
 * The consumption tax base for this month (ADR 0023): the final consumer
 * basket valued at current prices. Intermediate and investment demand are
 * deliberately excluded.
 */
export function finalConsumptionBase(country: Country): number {
  return computeDemand(country).consumptionValue
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

  // Fiscal context for the interest rates and the tax-collection reading.
  const context = { atWar: override?.atWar ?? false, tick: override?.tick ?? 0 }
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

  // Per-building-type operating profit (ADR 0021 B2, driven from B3). It uses
  // this month's recipe output/input valued at this month's prices and
  // allocates the national wage bill by labor × count. `utilization` is written
  // as *next* month's operating rate (ADR 0022): a profitable type recovers
  // toward 1, a losing one decays toward UTIL_IDLE_FLOOR. `computeProduction`
  // reads this stored value next month, so the feedback stays one month behind.
  const prices = country.econ.prices
  const buildings = country.econ.buildings
  let laborWeightTotal = 0
  for (const id of BUILDING_IDS) laborWeightTotal += BUILDING_RECIPES[id].labor * buildings[id]
  const buildingProfits = {} as Record<BuildingId, BuildingProfit>
  for (const id of BUILDING_IDS) {
    const recipe = BUILDING_RECIPES[id]
    const count = buildings[id]
    const effCount = effectiveCount(count)
    let revenue = 0
    let inputCost = 0
    for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
      revenue += coef * prices[good] * effCount
    }
    for (const [good, coef] of Object.entries(recipe.input) as [GoodId, number][]) {
      inputCost += coef * prices[good] * effCount
    }
    const wageWeight =
      laborWeightTotal > 0 ? (recipe.labor * count) / laborWeightTotal : 0
    const typeWages = wages * wageWeight
    const profit = revenue - inputCost - typeWages
    const profitPerBuilding = profit / Math.max(1, count)
    const target = profitPerBuilding > 0 ? 1 : UTIL_IDLE_FLOOR
    const prevUtil = storedUtilization(country, id)
    buildingProfits[id] = {
      revenue,
      inputCost,
      wages: typeWages,
      profit,
      utilization: clamp(prevUtil + (target - prevUtil) * UTIL_SMOOTHING, 0, 1),
      profitPerBuilding,
    }
  }

  // The four tax bases (ADR 0023): land endowment, per-building profit (only
  // positive contributions), final consumer spending and the border duty. GDP
  // is deliberately absent — it is a derived output, never a tax base.
  let profitBase = 0
  for (const id of BUILDING_IDS) {
    profitBase += Math.max(0, buildingProfits[id].profit)
  }
  const taxBaseQty: TaxBaseQuantities = {
    land: country.econ.resources.farmland * LAND_VALUE_PER_UNIT,
    profit: profitBase,
    consumption: breakdown.consumptionValue,
    tariff: (country.econ.lastImportBill ?? 0) + (country.econ.lastExportRevenue ?? 0),
  }
  const revenue = incomeParts(
    country,
    override?.tariffRevenue ?? 0,
    context,
    taxBaseQty,
  )
  const income = applyModifiers(
    country,
    'income',
    revenue.taxes +
      revenue.ports +
      revenue.sovereignIncome +
      revenue.reparations +
      revenue.other,
  )

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
    taxBaseQty,
    buildingProfits,
    labor,
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

export { computePrestige }
