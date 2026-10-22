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
/** Cap on a participant's narrative text fed to the arbiter. */
export const SITUATION_NARRATIVE_MAX = 160

/**
 * Direct effects of the four opium-crisis result packs (plan 0004 §4.3). These
 * are the numbers the packs apply on top of their modifier packs, declared here
 * so the result magnitudes are tunable in one place (plan 0009 §9 D3).
 */
export const OPIUM_CRACKDOWN_LEGITIMACY = 6
export const OPIUM_CRACKDOWN_AUTHORITY = 8
export const OPIUM_CRACKDOWN_PRESTIGE = 8
export const OPIUM_CRACKDOWN_GBR_PRESTIGE = 5
export const OPIUM_CRACKDOWN_RELATION = -15
export const OPIUM_COMPROMISE_TARIFF_CUT = 8
export const OPIUM_COMPROMISE_LEGITIMACY = 4
export const OPIUM_COMPROMISE_RADICALS = 5
export const OPIUM_COMPROMISE_RELATION = 10
export const OPIUM_WAR_RELATION = -40
