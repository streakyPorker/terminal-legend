/**
 * Fiscal config: interest rates, the per-capita expense coefficients, the
 * construction subsidy (points/gold), the restructuring rule and the fiscal
 * alert (plan 0009 §9 D1). Leaf module.
 */

/** Debt rate: base, and the weak-mandate / low-prestige / unrest terms. */
export const DEBT_RATE_BASE = 0.004
export const DEBT_WEAK_MANDATE_BASE = 50
export const DEBT_WEAK_MANDATE_COEF = 0.004
export const DEBT_LOW_PRESTIGE_BASE = 20
export const DEBT_LOW_PRESTIGE_COEF = 0.004
export const DEBT_UNREST_BASE = 50
export const DEBT_UNREST_SPREAD = 0.002
export const DEBT_RESTRUCTURE_SPREAD = 0.004
export const DEBT_WAR_SPREAD = 0.002
export const DEBT_RATE_MIN = 0.002
export const DEBT_RATE_MAX = 0.02
/** Sovereign fund rate: base, plus legitimacy/prestige/access terms. */
export const FUND_RATE_BASE = 0.0015
export const FUND_LEGITIMACY_COEF = 0.002
export const FUND_PRESTIGE_COEF = 0.002
export const FUND_ACCESS_COEF = 0.001
export const FUND_WAR_SPREAD = 0.0005
export const FUND_RATE_MIN = 0.0002
export const FUND_RATE_MAX = 0.006
/** Expense coefficients. */
export const ARMY_EXPENSE_PER_UNIT = 0.05
export const ARMY_SPENDING_SHARE = 0.5
export const NAVY_EXPENSE_PER_UNIT = 0.04
export const NAVY_SPENDING_SHARE = 0.5
export const ADMIN_EXPENSE_PER_POP = 0.12
export const ADMIN_BUREAUCRACY_PER_POP = 0.02
export const EDUCATION_EXPENSE_PER_POP = 0.03
/**
 * PT-101: welfare costs `level × popFactor × sol × this`. A richer population
 * costs more to keep at the same welfare level, so the same policy knob buys
 * less in a rich country than in a poor one.
 */
export const WELFARE_EXPENSE_PER_POP_SOL = 0.0008
export const MARKET_LOSS_COEF = 0.02
/**
 * PT-102: market loss is a *leakage* — goods and silver lost in transit, graft,
 * and the friction of a state that cannot police its own markets. It therefore
 * scales with bureaucracy: at BUREAUCRACY_REFERENCE the coefficient is 1, a
 * weaker administration leaks more and a stronger one leaks less.
 */
export const MARKET_LOSS_BUREAUCRACY_REFERENCE = 50
export const MARKET_LOSS_BUREAUCRACY_SPAN = 100
export const MARKET_LOSS_BUREAUCRACY_MIN = 0.5
export const MARKET_LOSS_BUREAUCRACY_MAX = 1.6
export const UPKEEP_PER_BUILDING = 0.01
/** Cap on a spending appropriation (per category). */
export const SPENDING_MAX = 50

/** Net-assets restructuring: at −ratio×GDP, reset to −reset×GDP for N months. */
export const RESTRUCTURE_DEBT_RATIO = 3
export const RESTRUCTURE_RESET_RATIO = 1.5
export const RESTRUCTURE_MONTHS = 12
export const RESTRUCTURE_RADICALS = 8
export const RESTRUCTURE_LEGITIMACY = 8
export const RESTRUCTURE_PRESTIGE = 8
