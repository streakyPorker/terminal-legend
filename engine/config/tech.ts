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

/**
 * Per-era node cost (plan 0005 §1.5, retuned in K4). The tree's costs are a
 * single dial so the whole pace can be calibrated from one place; every node's
 * `cost` derives from its era via `techNodeCost`. K4 tuned this so a 120-month
 * baseline advances roughly one node every 2–4 years (docs/adr/0030-tech-tree.md).
 */
export const TECH_ERA_COSTS: readonly [number, number, number, number] = [160, 360, 720, 1280]

/** The configured cost of a node's era, clamped to the modelled 1–4 range. */
export function techNodeCost(era: number): number {
  const clamped = Math.min(TECH_MAX_ERA, Math.max(1, Math.round(era)))
  return TECH_ERA_COSTS[clamped - 1] ?? TECH_ERA_COSTS[0] ?? 0
}

/**
 * AI research selection (plan 0005 §2.5, K3). Non-player countries pick the
 * next node deterministically: each ready node scores by its branch weight —
 * the general line is prioritised so the common era line is completed first,
 * then traits and the national situation tilt industry / administration /
 * military. Ties break by node id ascending, so the same seed + state always
 * yields the same choice. No RNG is involved.
 */
export const TECH_AI_GENERAL_PRIORITY = 5
export const TECH_AI_BRANCH_BASE = 1

/** Leader traits (substring match) that bias the AI toward a branch. */
export const TECH_AI_TRAIT_INDUSTRY: readonly string[] = ['工业', '贸易', '工商', '实业']
export const TECH_AI_TRAIT_ADMIN: readonly string[] = [
  '改革',
  '务实',
  '维新',
  '秩序',
  '维稳',
  '内斗',
]
export const TECH_AI_TRAIT_MILITARY: readonly string[] = [
  '军事',
  '扩张',
  '海权',
  '陆军',
  '专制',
  '民粹',
  '殖民',
  '防御',
]
export const TECH_AI_TRAIT_WEIGHT = 1

/** Situation weights: scarce industry → industry; instability → admin; war → military. */
export const TECH_AI_FACTORY_FLOOR = 12
export const TECH_AI_INDUSTRY_SCARCE = 1.5
export const TECH_AI_RADICALS_HIGH = 25
export const TECH_AI_LEGITIMACY_LOW = 45
export const TECH_AI_ADMIN_UNSTABLE = 1.5
export const TECH_AI_WAR_MILITARY = 2
/** An army under this size (ten-thousands) reads as weak. */
export const TECH_AI_WEAK_ARMY_FLOOR = 20
export const TECH_AI_WEAK_ARMY_MILITARY = 1
