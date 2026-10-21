/**
 * Economy config: production, price formation, Stone-Geary demand, GDP
 * valuation and the utilization/profit feedback coefficients (plan 0009 §9 D1,
 * ADR 0024 §1). Leaf module.
 *
 * Only tunable numbers live here; every value is a 1:1 move of the inline
 * literal it replaces, so behaviour is bit-for-bit identical.
 */

/** Price formation: the price moves a fraction of the way to its target/month. */
export const PRICE_SMOOTHING = 0.3
/** demand/supply ratio is clamped here before the sqrt target price. */
export const PRICE_RATIO_MIN = 0.35
export const PRICE_RATIO_MAX = 3
/** Hard price floor/ceiling as multiples of the good's base price. */
export const PRICE_FLOOR_FACTOR = 0.25
export const PRICE_CEILING_FACTOR = 4
/** Divisor guard so a zero/negative supply or demand never divides by zero. */
export const SUPPLY_DEMAND_GUARD = 0.01
/** Price floors used when valuing discretionary/luxury spending. */
export const PRICE_DISCRETIONARY_FLOOR = 0.05
export const PRICE_LUXURY_FLOOR = 0.1

/** Utilization feedback (ADR 0022): an idle type runs at this floor. */
export const UTIL_IDLE_FLOOR = 0.5
/** First-order smoothing: the operating rate moves this share toward target. */
export const UTIL_SMOOTHING = 0.25
/** Cap on the extra monthly decay a deeply loss-making count suffers. */
export const SHRINK_MAX = 0.02

/** Demand normalisation: population per "pop factor" unit, and its floor. */
export const POP_FACTOR_DIVISOR = 1000
export const POP_FACTOR_MIN = 0.1
/** Share of profits saved for investment is capped here. */
export const SAVINGS_RATE_CAP = 0.9
/** Welfare transfers to households, per pop factor and spending level. */
export const WELFARE_TRANSFER_RATE = 0.03
/** Services supplied per pop through market access (the artisan-service term). */
export const ARTISAN_SERVICE_ACCESS_SHARE = 0.5
/** Opium demand: base plus a share of supernumerary income. */
export const OPIUM_DEMAND_BASE = 0.5
export const OPIUM_DEMAND_INCOME_DIVISOR = 10
/** Household industrial demand per pop factor. */
export const INDUSTRIAL_COAL_PER_POP = 1.2
export const INDUSTRIAL_IRON_PER_POP = 0.6
export const STEEL_DEMAND_PER_POP = 0.2
export const FABRIC_DEMAND_PER_POP = 0.5
export const WOOD_DEMAND_PER_POP = 0.3
/** Army/navy arms demand. */
export const ARMS_PER_SOLDIER = 0.02
export const ARMS_PER_SHIP = 0.01
/** Military base demand: army scales with quality, navy does not. */
export const ARMY_DEMAND_PER_UNIT = 0.05
export const NAVY_DEMAND_PER_UNIT = 0.04
/** Government gold that turns into goods demand, by branch. */
export const GOV_ARMY_SPENDING_SHARE = 0.5
export const GOV_ARMY_BASE_SHARE = 0.7
export const GOV_NAVY_SPENDING_SHARE = 0.5
export const GOV_NAVY_BASE_SHARE = 0.3
export const GOV_BUREAUCRACY_PER_POP = 0.02
export const GOV_EDUCATION_PER_POP = 0.03

/** Labour share: each unemployment point above the base moves it this much. */
export const LABOR_SHARE_UNEMPLOYMENT_BASE = 5
export const LABOR_SHARE_UNEMPLOYMENT_COEF = 0.01
export const LABOR_SHARE_MIN = 0.35
export const LABOR_SHARE_MAX = 0.7
/** Prestige formula weights. */
export const PRESTIGE_GDP = 0.05
export const PRESTIGE_ARMY = 0.18
export const PRESTIGE_NAVY = 0.22
export const PRESTIGE_TECH = 4
export const PRESTIGE_PORT = 0.2

/** Private investment: capital threshold, scoring and project pacing. */
/** Hurdle rate = base + debtRatio × coef, per year, expressed monthly. */
export const INVESTMENT_RETURN_BASE = 0.04
export const INVESTMENT_DEBT_COEF = 0.02
export const INVESTMENT_MONTHS_PER_YEAR = 12
export const INVESTMENT_CONFIDENCE_MIN = 0.5
/** Investment-score potential/ratio clamps. */
export const INVESTMENT_INDUSTRIAL_MIN = 0.7
export const INVESTMENT_INDUSTRIAL_MAX = 1.3
export const INVESTMENT_RATIO_MIN = 0.3
export const INVESTMENT_RATIO_MAX = 2
/** Infrastructure renewal-score terms (floor + distance-to-target weights). */
export const INFRA_SCORE_BASE = 0.55
export const INFRA_SCORE_TRANSPORT = 0.5
export const INFRA_SCORE_PORT = 0.5
export const INFRA_SCORE_LITERACY = 0.3
export const INFRA_SCORE_OFFICES = 0.3
export const INFRA_SCORE_OFFICE_BONUS = 0.1
export const INFRA_SCORE_OFFICE_MIN = 4
/** Only types at/above this score are renewal candidates. */
export const INVESTMENT_RENEWAL_SCORE = 0.7
/** Working-capital reserve: max(base, monthlyCost × multiple). */
export const INVESTMENT_RESERVE_BASE = 10
export const INVESTMENT_RESERVE_MULTIPLE = 3
/** Floor on a building's capital cost, so return-on-capital never divides by 0. */
export const CAPITAL_COST_FLOOR = 0.01
/** Monthly depreciation of the building stock. */
export const DEPRECIATION_PER_MONTH = 0.0015
/** Private builders: at most this many projects in flight, one per interval. */
export const MAX_PRIVATE_PROJECTS = 3
export const PRIVATE_START_INTERVAL = 2
/** Investment-confidence action: max monthly delta and the band around the base. */
export const INVEST_AMOUNT_MAX = 3
export const INVEST_CONFIDENCE_RANGE = 10

