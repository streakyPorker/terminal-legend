import type {
  BuildingId,
  BuildingProfit,
  Country,
  GdpComponents,
  GoodId,
} from '../types'
import { ENGEL_INCOME_ELASTICITY, ENGEL_RATIO_MAX, ENGEL_RATIO_MIN } from './config/demand'
import {
  ARTISAN_OUTPUT,
  ARTISAN_SERVICE_OUTPUT,
  BUILDINGS,
  BUILDING_IDS,
  CONSUMPTION_PROPENSITY,
  CONSUMER_GOODS,
  consumerBasket,
  GOODS,
  GOOD_IDS,
  GOVERNMENT_DEMAND,
  isCostCentre,
  SUBSISTENCE,
  deriveLabor,
  effectiveCount,
  infrastructureCount,
  infrastructureMultiplier,
  infrastructureStats,
  infrastructureUpkeep,
  mixedRecipe,
  resourceMultiplier,
  techTier,
  type InfrastructureStats,
  type LaborStats,
} from './data'
import {
  LAND_VALUE_PER_UNIT,
  expenseParts,
  incomeParts,
  privateTaxBurden,
  taxBaseRevenues,
  type ExpenseParts,
  type IncomeParts,
  type TaxBaseQuantities,
} from './fiscal'
import { applyModifiers } from './modifiers'
import { TRADABLE_GOODS, effectiveResources } from './trade'
import { clamp, ensureConstructionFields, ensureGoodsFields, techMultiplier } from './internal'
import { curveOutput } from './scale'
import { PRODUCTION_GATE_CURVES } from './config/blocks/gates'
import {
  ARMS_PER_SHIP,
  ARMS_PER_SOLDIER,
  ARTISAN_SERVICE_ACCESS_SHARE,
  ARMY_DEMAND_PER_UNIT,
  FABRIC_DEMAND_PER_POP,
  GOV_ARMY_BASE_SHARE,
  GOV_ARMY_SPENDING_SHARE,
  GOV_BUREAUCRACY_PER_POP,
  GOV_EDUCATION_PER_POP,
  GOV_NAVY_BASE_SHARE,
  GOV_NAVY_SPENDING_SHARE,
  INDUSTRIAL_COAL_PER_POP,
  INDUSTRIAL_IRON_PER_POP,
  LABOR_SHARE_MAX,
  LABOR_SHARE_MIN,
  LABOR_SHARE_UNEMPLOYMENT_BASE,
  LABOR_SHARE_UNEMPLOYMENT_COEF,
  NAVY_DEMAND_PER_UNIT,
  OPIUM_DEMAND_BASE,
  OPIUM_DEMAND_INCOME_DIVISOR,
  POP_FACTOR_DIVISOR,
  POP_FACTOR_MIN,
  PRESTIGE_ARMY,
  PRESTIGE_GDP,
  PRESTIGE_NAVY,
  PRESTIGE_PORT,
  PRESTIGE_TECH,
  PRICE_CEILING_FACTOR,
  PRICE_DISCRETIONARY_FLOOR,
  PRICE_FLOOR_FACTOR,
  PRICE_LUXURY_FLOOR,
  PRICE_RATIO_MAX,
  PRICE_RATIO_MIN,
  PRICE_SMOOTHING,
  SAVINGS_RATE_CAP,
  SHRINK_MAX,
  STEEL_DEMAND_PER_POP,
  SUPPLY_DEMAND_GUARD,
  UTIL_IDLE_FLOOR,
  UTIL_SMOOTHING,
  WELFARE_TRANSFER_RATE,
  WOOD_DEMAND_PER_POP,
} from './config/economy'
import { PRESTIGE_MAX } from './config/balance'

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
  /** PT-073: final-consumption value per consumer good (per-good sales tax). */
  consumptionValueByGood: Partial<Record<GoodId, number>>
  /** PT-073: this month's consumption-tax take, paid out of private savings. */
  consumptionTaxTake: number
  buildingProfits: Record<BuildingId, BuildingProfit>
  labor: LaborStats
  /** Unified national infrastructure pool readings (plan 0011 F5). */
  infrastructure: InfrastructureStats
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
 * Utilization feedback (ADR 0022) now lives in `config/economy.ts`: the idle
 * floor, the first-order smoothing and the deep-loss decay cap. Re-exported so
 * the `./economy` and `./sim` import surface is unchanged.
 */
export { UTIL_IDLE_FLOOR, UTIL_SMOOTHING, SHRINK_MAX }

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
  ensureGoodsFields(country)
  const tech = techMultiplier(country)
  const marketAccess = applyModifiers(country, 'marketAccess', country.econ.marketAccess)
  const access = curveOutput(PRODUCTION_GATE_CURVES.access, marketAccess)
  // Plan 0011 F5: the per-recipe `infrastructure` gate retires in favour of ONE
  // unified multiplier for every building. It reads the stored level (written at
  // month end, so it lags one month like utilization, ADR 0022) and never
  // rewards a surplus (ratio ≥ 1 → 1).
  const infraLevel = applyModifiers(
    country,
    'transportInfrastructure',
    country.econ.transportInfrastructure,
  )
  const infra = infrastructureMultiplier(infraLevel)
  const b = country.econ.buildings
  const resources = resourceFactors(country)
  // Coal and iron are industrial inputs: a country poor in both runs its
  // factories less efficiently. This is what lets endowments reach GDP, not
  // just raw material output (round-1 playtest finding P1-4).
  const industrial = curveOutput(
    PRODUCTION_GATE_CURVES.industrial,
    (resources.coal + resources.iron) / 2,
  )
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
  // Gated per-building output, summed by good (ADR 0021). `mixedRecipe` is the
  // source of the (tier-weighted) coefficients; the multiplier seams it names
  // are the same `tech`/`infra`/`access`/`industrial` factors the code always
  // applied. Caliber (plan 0015 §S1 / 评审 M1): the seat count is
  // `effectiveCount(Σcount)`, capped ONCE for the whole building type — the tier
  // mix only scales the per-building coefficient via `mixedRecipe`, never the
  // cap per tier.
  const raw = zeroGoods()
  for (const id of BUILDING_IDS) {
    const recipe = mixedRecipe(country, id)
    // Output is gated by last month's stored operating rate (ADR 0022): the
    // price → profit → capacity loop is one month behind, never same-month.
    const count = cap(b[id]) * storedUtilization(country, id)
    if (count <= 0) continue
    const modifier = recipe.outputModifier
    for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
      const gates = recipe.outputGates?.[good] ?? recipe.gates
      let value = count * coef
      if (gates?.tech) value *= tech
      if (gates?.access) value *= access
      if (gates?.industrial) value *= industrial
      // The unified infrastructure debuff applies to every building's output.
      value *= infra
      if (modifier !== undefined) value = applyModifiers(country, modifier, value)
      raw[good] += value
    }
  }
  // Opium is farm-grown (plan 0004 §1.1) and scaled by the country's own
  // output factor, which lets Britain stand in for British India.
  raw.opium *= country.opium.outputFactor
  // Artisans supply the bottom of the consumer market before factories do;
  // without them an agrarian country reads as permanently short of clothes.
  // National (per-artisan/pop) terms, not per-building recipes; coefficients
  // live in data.ts (ARTISAN_OUTPUT) so B5 can calibrate them with the recipes.
  raw.clothes += country.pops.artisans * (ARTISAN_OUTPUT.clothes ?? 0)
  raw.liquor += country.pops.artisans * (ARTISAN_OUTPUT.liquor ?? 0)
  raw.furniture += country.pops.artisans * (ARTISAN_OUTPUT.furniture ?? 0)
  raw.services +=
    (country.pops.total / POP_FACTOR_DIVISOR) * ARTISAN_SERVICE_ACCESS_SHARE * access +
    country.pops.artisans * ARTISAN_SERVICE_OUTPUT
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
    SAVINGS_RATE_CAP,
  )
}

function computeDemand(country: Country): DemandBreakdown {
  ensureConstructionFields(country)
  const popFactor = Math.max(POP_FACTOR_MIN, country.pops.total / POP_FACTOR_DIVISOR)
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
  const welfareTransfer = sp.welfare * popFactor * WELFARE_TRANSFER_RATE
  // The private tax burden is the land + profit + consumption take computed
  // from the four real bases (ADR 0023), not a GDP share. Using last month's
  // stored base quantities keeps the loop one month behind, like wages/profits.
  const taxTake = privateTaxBurden(country)
  const disposable = Math.max(0, wages + profits * (1 - savingsRate) - taxTake) + welfareTransfer
  const incomePerCapita = disposable / popFactor
  // Plan 0015 §S4 / ADR 0031 §6: the consumer basket grows with node-level
  // `demandShift` effects (chemicals after `industry-5`). With no shift active
  // it is exactly the calibrated `CONSUMER_GOODS` basket.
  const basket = consumerBasket(country)
  let subsistenceCost = 0
  for (const id of basket.goods) subsistenceCost += SUBSISTENCE[id] * prices[id]
  const supernumerary =
    Math.max(0, incomePerCapita - subsistenceCost) * CONSUMPTION_PROPENSITY
  // PT-098: Engel curve. The discretionary weights are tilted by how far income
  // sits above the subsistence line — staples lose weight, superior goods gain
  // it — then renormalised so the household's total discretionary outlay is
  // unchanged (only the mix moves).
  const incomeRatio = clamp(
    incomePerCapita / Math.max(subsistenceCost, 1e-6),
    ENGEL_RATIO_MIN,
    ENGEL_RATIO_MAX,
  )
  const weight: Partial<Record<GoodId, number>> = {}
  let baseWeight = 0
  let tiltedWeight = 0
  for (const id of basket.goods) {
    const base = basket.elasticity[id]
    // Income elasticity of the weight: staples grow slower than income, superior
    // goods faster. Always > 0, so quantities never shrink as income rises.
    const tilted = base * Math.pow(incomeRatio, ENGEL_INCOME_ELASTICITY[id] ?? 1)
    weight[id] = tilted
    baseWeight += base
    tiltedWeight += tilted
  }
  const engelNorm = tiltedWeight > 0 ? baseWeight / tiltedWeight : 1
  for (const id of basket.goods) {
    const subsistence = popFactor * SUBSISTENCE[id]
    const discretionary =
      (popFactor * (weight[id] ?? 0) * engelNorm * supernumerary) /
      Math.max(PRICE_DISCRETIONARY_FLOOR, prices[id])
    // `consumption` scales discretionary spending, never the survival floor.
    consumer[id] = demand(
      id,
      subsistence + applyModifiers(country, 'consumption', discretionary),
    )
  }

  // Idle profits held back last month that were released as luxury spending.
  if (country.econ.idlePurchases > 0) {
    consumer.luxury += country.econ.idlePurchases / Math.max(PRICE_LUXURY_FLOOR, prices.luxury)
  }

  // Opium is a separate demand block, not part of the Stone-Geary basket
  // (plan 0004 §1.1): it grows with supernumerary income and the country's
  // demand factor, and is not counted as a survival good.
  const opiumDemand = demand(
    'opium',
    popFactor *
      country.opium.demandFactor *
      (OPIUM_DEMAND_BASE + supernumerary / OPIUM_DEMAND_INCOME_DIVISOR),
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
    const recipe = mixedRecipe(country, id)
    // Caliber (plan 0015 §S1 / 评审 M1): intermediate input reads the RAW seat
    // count `buildings[id]` — no `effectiveCount` cap — and only the
    // per-building coefficient is tier-weighted through `mixedRecipe`.
    // Plan 0016 §S1: a NON_TRADABLE input (electricity) is instead charged
    // `effectiveCount(count) × storedUtilization(country, id)` — idle/over-built
    // electrified seats draw proportionally less, and no electricity input
    // exists before IV/V, so the all-I/II/III oracle is byte-identical. Tradable
    // inputs (coal/steel/…) keep the RAW count exactly as before.
    const idleAdjusted = effectiveCount(count) * storedUtilization(country, id)
    for (const [good, perBuilding] of Object.entries(recipe.input) as [
      GoodId,
      number,
    ][]) {
      const charged = TRADABLE_GOODS.includes(good) ? count : idleAdjusted
      intermediate[good] += charged * perBuilding
    }
  }
  // Industrial towns buy food off the market; this puts agrarian and
  // industrial economies on opposite sides of the grain trade instead of
  // every country holding a permanent grain mountain.
  intermediate.coal += popFactor * INDUSTRIAL_COAL_PER_POP
  intermediate.iron += popFactor * INDUSTRIAL_IRON_PER_POP
  // Plan 0011 F5: the infrastructure network is itself an intermediate consumer
  // — throughput materials scale with supply, administration with the level, and
  // offices/universities/schools already supply the services it burns.
  const infraUpkeep = infrastructureUpkeep(country)
  for (const [good, quantity] of Object.entries(infraUpkeep) as [GoodId, number][]) {
    if (quantity !== 0) intermediate[good] += quantity
  }
  // Heavy industry buys worked STEEL, not raw ore (plan 0011 F1). Scaling it by
  // population keeps the steel market two-sided: populous, factory-light
  // economies (QING, RUS) bid, factory-dense ones (GBR, FRA, PRU) offer. The
  // ore is consumed only by the factories that smelt it, so `iron` is the
  // single input of the ore→steel chain.
  intermediate.steel += popFactor * STEEL_DEMAND_PER_POP
  intermediate.fabric += popFactor * FABRIC_DEMAND_PER_POP
  intermediate.wood += popFactor * WOOD_DEMAND_PER_POP
  for (const good of GOOD_IDS) {
    if (intermediate[good] !== 0) out[good] += demand(good, intermediate[good])
  }
  out.arms += demand(
    'arms',
    country.military.army * ARMS_PER_SOLDIER + country.military.navy * ARMS_PER_SHIP,
  )

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
    country.military.army * ARMY_DEMAND_PER_UNIT * (1 + country.military.quality) +
    country.military.navy * NAVY_DEMAND_PER_UNIT
  const governmentGold: Record<keyof typeof sp, number> = {
    army: sp.army * GOV_ARMY_SPENDING_SHARE + militaryBase * GOV_ARMY_BASE_SHARE,
    navy: sp.navy * GOV_NAVY_SPENDING_SHARE + militaryBase * GOV_NAVY_BASE_SHARE,
    bureaucracy: sp.bureaucracy * popFactor * GOV_BUREAUCRACY_PER_POP,
    education: sp.education * popFactor * GOV_EDUCATION_PER_POP,
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
      const quantity = (gold * share) / Math.max(PRICE_LUXURY_FLOOR, prices[id])
      government[id] += quantity
      out[id] += quantity
    }
  }

  // PT-097: standing per-good demand levers (the GM's `v3_cheat demand`).
  // The absolute part is *per popFactor* — it scales with population exactly
  // like the subsistence floor — and the percentage part scales that good's
  // whole demand. Both are applied once, after every block has landed.
  const demandBase = country.econ.demandBase
  const demandFlat = country.econ.demandFlat
  const demandPct = country.econ.demandPct
  if (demandBase !== undefined || demandFlat !== undefined || demandPct !== undefined) {
    for (const id of GOOD_IDS) {
      // `(model + popFactor × x + a) × (1 + pct)` — the per-head coefficient,
      // the population-independent constant, then the percentage on the sum.
      const perPop = demandBase?.[id] ?? 0
      if (perPop !== 0) out[id] += popFactor * perPop
      const flat = demandFlat?.[id] ?? 0
      if (flat !== 0) out[id] += flat
      const pct = demandPct?.[id] ?? 0
      if (pct !== 0) out[id] *= 1 + pct / 100
    }
  }

  // Every goods demand still reads through the generic per-good demand buffs
  // for the intermediate blocks above; consumer demand is already wrapped.
  // The consumption tax base values only the final consumer basket, never the
  // intermediate demand above (ADR 0023 de-duplication rule).
  let consumptionValue = 0
  for (const id of basket.goods) consumptionValue += consumer[id] * prices[id]
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
    const available = Math.max(SUPPLY_DEMAND_GUARD, supply[id])
    const ratio = demand[id] / available
    const target =
      GOODS[id].basePrice * clamp(Math.sqrt(ratio), PRICE_RATIO_MIN, PRICE_RATIO_MAX)
    const floor = GOODS[id].basePrice * PRICE_FLOOR_FACTOR
    const ceiling = GOODS[id].basePrice * PRICE_CEILING_FACTOR
    country.econ.prices[id] = clamp(
      country.econ.prices[id] + (target - country.econ.prices[id]) * PRICE_SMOOTHING,
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
    const fill = clamp(supply[id] / Math.max(SUPPLY_DEMAND_GUARD, demand[id]), 0, 1)
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
  // Transfers paid are contractual too (PT-065): keep them out of the
  // `expense` modifier, symmetric with the income side.
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
      outlay.constructionSubsidy,
  ) + outlay.reparations

  const labor = deriveLabor(country)
  const rawShare =
    country.politicalEconomy.laborShareBase -
    (country.econ.unemployment - LABOR_SHARE_UNEMPLOYMENT_BASE) * LABOR_SHARE_UNEMPLOYMENT_COEF
  const laborShare = clamp(
    applyModifiers(country, 'laborShare', rawShare),
    LABOR_SHARE_MIN,
    LABOR_SHARE_MAX,
  )
  const wages = realGdp * laborShare
  const profits = realGdp * (1 - laborShare)

  // Per-building-type operating profit (ADR 0021 B2, driven from B3). It uses
  // this month's recipe output/input valued at this month's prices and splits
  // each type's value added into wages and profit (PT-093).
  // `utilization` is written as *next* month's operating rate (ADR 0022): a
  // profitable type recovers toward 1, a losing one decays toward
  // UTIL_IDLE_FLOOR. `computeProduction` reads this stored value next month, so
  // the feedback stays one month behind.
  const prices = country.econ.prices
  const buildings = country.econ.buildings
  const rows = BUILDING_IDS.map((id) => {
    const recipe = mixedRecipe(country, id)
    const count = buildings[id]
    // Caliber (plan 0015 §S1 / 评审 M1): the revenue/input row values the
    // per-class count at `effectiveCount(Σcount)` — the same capped-once count
    // the production loop uses — so only the tier-weighted coefficient moves
    // with the mix, never the cap.
    const effCount = effectiveCount(count)
    let revenue = 0
    let inputCost = 0
    for (const [good, coef] of Object.entries(recipe.output) as [GoodId, number][]) {
      revenue += coef * prices[good] * effCount
    }
    for (const [good, coef] of Object.entries(recipe.input) as [GoodId, number][]) {
      inputCost += coef * prices[good] * effCount
    }
    return { id, count, revenue, inputCost }
  })
  // PT-093: split each type's own value added into wages and profit, instead of
  // spreading the whole national wage bill over the building stock. The national
  // bill (`labour share × GDP`) is larger than the value the buildings add — GDP
  // also carries investment and government spending — so charging it in full
  // left every type showing an operating loss and idling toward the floor.
  // The national profit pool is then handed out by value-added share, so
  // `Σ buildingProfits.profit` equals that pool and every commercially viable
  // type carries a positive margin.
  const valueAddedOf = (row: { revenue: number; inputCost: number }): number =>
    Math.max(0, row.revenue - row.inputCost)
  let valueAddedTotal = 0
  for (const row of rows) valueAddedTotal += valueAddedOf(row)
  const buildingProfits = {} as Record<BuildingId, BuildingProfit>
  for (const row of rows) {
    const valueAdded = row.revenue - row.inputCost
    const costCentre = isCostCentre(row.id)
    let profit: number
    if (costCentre || !(valueAddedTotal > 0)) {
      // Cost centres sell nothing; their input bill is the loss they book, and
      // it must not idle them (PT-052). A crashed economy with no positive
      // value added anywhere falls back to the raw residual.
      profit = valueAdded
    } else {
      profit = Math.min(valueAdded, (profits * valueAddedOf(row)) / valueAddedTotal)
    }
    const typeWages = valueAdded - profit
    const profitPerBuilding = profit / Math.max(1, row.count)
    // Cost centres have no sellable output, so their accounting loss must not
    // idle them: a building site is either working at full capacity or not at
    // all (PT-052).
    const target = isCostCentre(row.id) || profitPerBuilding > 0 ? 1 : UTIL_IDLE_FLOOR
    const prevUtil = storedUtilization(country, row.id)
    buildingProfits[row.id] = {
      revenue: row.revenue,
      inputCost: row.inputCost,
      wages: typeWages,
      profit,
      utilization: clamp(prevUtil + (target - prevUtil) * UTIL_SMOOTHING, 0, 1),
      profitPerBuilding,
    }
  }

  // The four tax bases (ADR 0023): land endowment, the national profit pool,
  // final consumer spending and the border duty. GDP is deliberately absent — it
  // is a derived output, never a tax base.
  // PT-093: the profit base is the pool the owners actually receive, which is
  // what an income tax on company profits is meant to reach, not the sum of
  // positive per-building operating rows (that double-counted loss-making types
  // and ignored profits booked outside the building accounts).
  const profitBase = profits
  // PT-073: the per-good final-consumption basket, so each consumer good can be
  // taxed at its own rate and the ledger can show the breakdown.
  const consumptionValueByGood: Partial<Record<GoodId, number>> = {}
  for (const id of CONSUMER_GOODS) {
    consumptionValueByGood[id] = breakdown.consumer[id] * country.econ.prices[id]
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
    consumptionValueByGood,
  )
  // PT-073: the consumption take is booked against private savings, not the
  // household basket, so the tax moves prices rather than quantities.
  const consumptionTaxTake = taxBaseRevenues(
    country,
    override?.tariffRevenue ?? 0,
    context,
    taxBaseQty,
    consumptionValueByGood,
  ).consumption
  // PT-065: scheduled transfers (loan installments, reparations) are
  // contractual payments, not domestic revenue — an `income` modifier such as
  // 「理财有方 +40%」 must not inflate them, or a 3.23/month loan books as 4.4.
  const income = applyModifiers(
    country,
    'income',
    revenue.taxes + revenue.ports + revenue.sovereignIncome + revenue.other,
  ) + revenue.reparations

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
    consumptionValueByGood,
    consumptionTaxTake,
    buildingProfits,
    labor,
    infrastructure: infrastructureStats(country),
  }
}

function computePrestige(country: Country): number {
  return clamp(
    applyModifiers(
      country,
      'prestige',
      country.econ.gdp * PRESTIGE_GDP +
        country.military.army * PRESTIGE_ARMY +
        country.military.navy * PRESTIGE_NAVY +
        techTier(country.tech) * PRESTIGE_TECH +
        infrastructureCount(country) * PRESTIGE_PORT,
    ),
    0,
    PRESTIGE_MAX,
  )
}

export { computePrestige }
