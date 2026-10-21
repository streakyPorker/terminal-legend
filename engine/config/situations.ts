/**
 * Situation config: the opium-crisis trigger window/bars and the crackdown
 * embargo length (plan 0009 §9 D1, plan 0004 §4). Leaf module.
 */

/** Trigger window 1839.01–1842.12. */
export const OPIUM_WINDOW_START_YEAR = 1839
export const OPIUM_WINDOW_END_YEAR = 1842
/** Trigger bars: ≥ this many opium units/month, or ≥ this share of QING consumption. */
export const OPIUM_TRIGGER_IMPORT_UNITS = 2
export const OPIUM_TRIGGER_IMPORT_SHARE = 0.2
/** Relations above this do not trigger the crisis. */
export const OPIUM_TRIGGER_RELATION_MAX = -10
/** Months before an incomplete situation settles anyway. */
export const SITUATION_TIMEOUT_MONTHS = 3
/** Embargo length the crackdown pack imposes. */
export const OPIUM_CRISIS_EMBARGO_MONTHS = 24
