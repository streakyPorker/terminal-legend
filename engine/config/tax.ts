/**
 * Tax config: the four-base tax machinery (ADR 0023) plus the tariff floor and
 * the construction-subsidy dials (plan 0009 §9 D1). Leaf module.
 */

/** Land-value-per-unit: farmland endowment × this gives the land base in gold. */
export const LAND_VALUE_PER_UNIT = 4
/** Construction subsidy: points and gold per spending level (ADR 0015). */
export const CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL = 1.5
export const CONSTRUCTION_SUBSIDY_COST_PER_LEVEL = 0.45
/** Free trade lowers tariffs but never below this floor (ADR 0009). */
export const FREE_TRADE_TARIFF_FLOOR = 5
/** Tariff rate cap. */
export const TARIFF_RATE_MAX = 60

/** `taxEfficiency` modifier base. */
export const TAX_EFFICIENCY_BASE = 0.5
export const TAX_EFFICIENCY_LEGITIMACY_DIVISOR = 200
/** Collection efficiency floor + bureaucracy/legitimacy terms (ADR 0023). */
export const COLLECTION_BASE = 0.35
export const COLLECTION_BUREAUCRACY_DIVISOR = 200
export const COLLECTION_LEGITIMACY_DIVISOR = 400
export const COLLECTION_MIN = 0.3
export const COLLECTION_MAX = 1.1
/** Beyond this rate a single base erodes (evasion, flight, informal work). */
export const COMPLIANCE_THRESHOLD = 25
export const COMPLIANCE_COEF = 0.015
export const COMPLIANCE_MIN = 0.45
export const COMPLIANCE_MAX = 1
/** Port dues per port building per month. */
export const PORT_INCOME_PER_BUILDING = 0.02
