/**
 * Society config: population growth, urbanisation, standard of living,
 * literacy, unemployment, radicals/loyalists, legitimacy and authority
 * (plan 0009 §9 D1). Leaf module.
 */

/** Population growth rate: base minus unrest-scaling penalties. */
export const GROWTH_BASE = 0.0012
export const GROWTH_SOL_BASE = 40
export const GROWTH_SOL_DIVISOR = 20000
export const GROWTH_RADICALS_DIVISOR = 50000
export const GROWTH_EXHAUSTION_DIVISOR = 100000

/** Urbanisation: peasants drawn into industry each month. */
export const URBAN_PEASANT_PULL = 0.0008
export const URBAN_INDUSTRY_PULL = 0.015
export const URBAN_TECH_PULL = 0.05
export const ARTISAN_SHIFT_PEASANT = 0.0006
export const ARTISAN_SHIFT_INDUSTRY = 0.003

/** Standard of living (sol) formula and its clamp. */
export const SOL_BASE = 20
export const SOL_GDP_PER_CAPITA = 250
export const SOL_TECH = 1.2
export const SOL_RADICALS = 0.08
export const SOL_WELFARE = 2
export const SOL_MIN = 5
export const SOL_MAX = 95

/** Literacy gain from education spending and universities. */
export const LITERACY_EDUCATION = 0.0008
export const LITERACY_UNIVERSITY = 0.0002

/** Labour-utilisation penalty added to the unemployment target. */
export const UNEMPLOYMENT_LABOR_PENALTY = 2
export const UNEMPLOYMENT_MIN = 0
export const UNEMPLOYMENT_MAX = 30
/** Unemployment stock smoothing and the monthly move cap. */
export const UNEMPLOYMENT_SMOOTHING = 0.25
export const UNEMPLOYMENT_MAX_STEP = 1.5

/** Radical pressure contributions. */
export const RADICAL_TAX_BASE = 5
export const RADICAL_TAX_COEF = 0.08
export const RADICAL_TARIFF_BASE = 10
export const RADICAL_TARIFF_COEF = 0.03
export const RADICAL_SOL_BASE = 40
export const RADICAL_SOL_COEF = 0.03
export const RADICAL_EXHAUSTION_COEF = 0.06
export const RADICAL_UNEMPLOYMENT_COEF = 0.03
export const RADICAL_SCARCITY_COEF = 0.12
/** Relief that offsets radical pressure. */
export const RELIEF_BASE = 0.3
export const RELIEF_LEGITIMACY = 0.35
export const RELIEF_WELFARE = 0.2
export const RELIEF_EDUCATION = 0.08
export const RELIEF_LOYALISTS = 0.015
/** Loyalist flow. */
export const LOYALIST_LEGITIMACY_COEF = 0.01
export const LOYALIST_RADICAL_COEF = 0.3

/** Legitimacy target formula and its monthly pull toward the target. */
export const LEGITIMACY_BASE = 50
export const LEGITIMACY_RADICALS_COEF = 0.5
export const LEGITIMACY_TREASURY_BONUS = 4
export const LEGITIMACY_TREASURY_PENALTY = -6
export const LEGITIMACY_EXHAUSTION_COEF = 0.2
export const LEGITIMACY_WELFARE_COEF = 2
export const LEGITIMACY_PULL = 0.08
export const LEGITIMACY_SUCCESSION_PENALTY = 5

/**
 * Government type → legitimacy target bonus (the "government-type table").
 * An unknown type scores 0.
 */
export const GOVERNMENT_LEGITIMACY_BONUS: Record<string, number> = {
  专制君主制: -4,
  君主立宪制: 8,
  共和制: 10,
  民主制: 12,
  寡头制: -2,
}

/** Authority flow: recovery per legitimacy point, and the low-legitimacy lurch. */
export const AUTHORITY_LEGITIMACY_COEF = 0.03
export const AUTHORITY_LOW_THRESHOLD = 30
export const AUTHORITY_LOW_PENALTY = 1.5

/** Market scarcity feeding unrest. */
export const SCARCITY_ESSENTIAL_WEIGHT = 1.6
export const SCARCITY_OTHER_WEIGHT = 0.5
export const SCARCITY_MAX = 8

/** Radicals at/above which the state collapses and tears up its policies. */
export const COLLAPSE_RADICALS = 92
/** Odds a fiscal emergency is reported in the chronicle. */
export const FISCAL_ALERT_DEBT_RATIO = 0.5
export const FISCAL_ALERT_CHANCE = 0.03
