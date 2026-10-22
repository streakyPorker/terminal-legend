/**
 * Cross-cutting balance constants: the value bounds and shared envelopes that
 * many domains clamp against. Leaf module (imports nothing), so any engine
 * module can read it without a module-init cycle.
 *
 * Extracted from inline literals in plan 0009 §9 D1; the values are unchanged.
 */

/** Legitimacy is a 0..100 stock. */
export const LEGITIMACY_MAX = 100
/** Radicals are a 0..100 stock. */
export const RADICALS_MAX = 100
/** Loyalists are a 0..100 stock. */
export const LOYALISTS_MAX = 100
/** Prestige is clamped to 0..240. */
export const PRESTIGE_MAX = 240
/** Bilateral relations run −100..100. */
export const RELATION_MIN = -100
export const RELATION_MAX = 100
/** Months of a series kept for the UI sparklines (GDP, treasury, …). */
export const HISTORY_MONTHS = 36
/** Run/ledger ceilings. */
export const MAX_MONTHS_PER_RUN = 120
export const MAX_DECISIONS_PER_MONTH = 12
export const LOG_MAX_ENTRIES = 400
export const EVENTS_MAX = 80
/**
 * Per-country retained modifier ceiling. Raised 64 → 128 for the tech tree
 * (plan 0005 §4), so early permanent tech modifiers are not silently evicted by
 * later policies, events and wars.
 */
export const MODIFIER_CAP = 128
