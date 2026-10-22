/**
 * Tech config: the monthly research-rate formula (plan 0009 §9 D1). The tech
 * multiplier curve itself lives in `config/blocks/tech.ts` (C5); this file only
 * holds the research flow dials.
 */

/** Base research points per month before literacy/bureaucracy. */
export const RESEARCH_BASE = 2
export const RESEARCH_LITERACY_COEF = 3
export const RESEARCH_BUREAUCRACY_COEF = 0.06
/** University research term. */
export const RESEARCH_UNIVERSITY_PER_BUILDING = 0.9
export const RESEARCH_UNIVERSITY_LITERACY_BASE = 0.4
export const RESEARCH_EDUCATION_COEF = 0.03
export const RESEARCH_TECH_LEVEL_COEF = 0.02

/**
 * The `techTier` continuous proxy for the old linear level (plan 0005 §3):
 * `TECH_TIER_BASE + era × TECH_TIER_ERA_COEF + unlocked.length × TECH_TIER_UNLOCKED_COEF`.
 * It feeds the unchanged `1 + tier × 0.07` tech-gated multiplier, so existing
 * formulas keep a continuous input as the tree replaces `tech.level`.
 */
export const TECH_TIER_BASE = 1
export const TECH_TIER_ERA_COEF = 1.5
export const TECH_TIER_UNLOCKED_COEF = 0.05
/** Highest era tier; the general line stops here (plan 0005 §1.1). */
export const TECH_MAX_ERA = 4
