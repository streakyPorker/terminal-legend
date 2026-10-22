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

/**
 * Cross-branch overflow (plan 0005 §2.3, K2). A `15–25%` slice of the current
 * research flow is added as *extra* progress to the other branches' current-era
 * nodes; the main node keeps its full flow. The rate rises with literacy,
 * university count and education spending, then clamps to `[MIN, MAX]`:
 *
 *   spillRate = clamp(
 *     BASE + literacy × LITERACY_COEF
 *          + min(universities / UNIVERSITY_DIVISOR, UNIVERSITY_MAX)
 *          + education × EDUCATION_COEF,
 *     MIN, MAX)
 */
export const TECH_SPILL_BASE = 0.15
export const TECH_SPILL_LITERACY_COEF = 0.1
export const TECH_SPILL_UNIVERSITY_DIVISOR = 20
export const TECH_SPILL_UNIVERSITY_MAX = 0.1
export const TECH_SPILL_EDUCATION_COEF = 0.01
export const TECH_SPILL_MIN = 0.15
export const TECH_SPILL_MAX = 0.25

/**
 * International diffusion (plan 0005 §2.4, K2): a research-*speed* bonus for a
 * lagging country, derived from the tech gap to its most advanced partner, the
 * trade share with that partner, relations and an alliance. Capped at
 * `TECH_DIFFUSION_MAX`; a war or embargo with the partner zeroes it. It never
 * grants free points or unlocks — it only scales the monthly research flow.
 *
 *   techScore(c) = era × SCORE_ERA_COEF + unlocked.length
 *   bonus = clamp(
 *     gap × GAP_COEF + tradeShare × TRADE_COEF
 *       + relation / RELATION_DIVISOR + (alliance ? ALLIANCE : 0),
 *     0, MAX)
 */
export const TECH_SCORE_ERA_COEF = 10
export const TECH_DIFFUSION_GAP_COEF = 0.02
export const TECH_DIFFUSION_TRADE_COEF = 0.2
export const TECH_DIFFUSION_RELATION_DIVISOR = 1000
export const TECH_DIFFUSION_ALLIANCE = 0.1
export const TECH_DIFFUSION_MAX = 0.5
