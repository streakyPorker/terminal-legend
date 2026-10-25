/**
 * Military config: manpower, morale, leader ageing and war resolution
 * (plan 0009 §9 D1). Leaf module.
 */

/** Manpower flow: recruits per pop minus the standing-army draw, capped. */
export const MANPOWER_PER_POP = 0.0004
export const MANPOWER_ARMY_DRAW = 0.0006
export const MANPOWER_CAP_RATIO = 0.06
/** Conscription: max recruits per action, manpower per recruit, unrest and pop cost. */
export const CONSCRIPT_MAX = 20
export const CONSCRIPT_MANPOWER_COST = 2
export const CONSCRIPT_RADICALS_COST = 0.4
export const CONSCRIPT_POP_COST = 0.4
/** Army spending above this threshold feeds morale; below it, drains. */
export const MORALE_ARMY_THRESHOLD = 1
export const MORALE_GAIN = 0.15
export const MORALE_LOSS = -0.15
export const MORALE_MIN = 20
export const MORALE_MAX = 100

/**
 * PT-066: hulls a naval base can convert into a warship each month, scaled by
 * the share of its `ships` demand that was actually delivered.
 */
export const SHIPS_PER_NAVAL_BASE = 1

/**
 * Plan 0015 S4 / appendix B: the per-tier multiplier on the naval-base training
 * rate (index 0 = tier I, 1 = II ×1.25, 2 = III ×1.50). Seat-weighted by
 * `tierWeightedMultiplier`, so a base upgrade lifts commissioning without adding
 * a seat.
 */
export const SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER = [1, 1.25, 1.5]

/** Leader ageing. */
export const LEADER_AGE_PER_MONTH = 1 / 12
export const LEADER_DEATH_AGE = 82
export const LEADER_OLD_AGE = 70
export const LEADER_OLD_DEATH_CHANCE = 0.002
/** Standalone-8: how many memories a leader keeps. */
export const LEADER_MEMORY_MAX = 8

/** War resolution. */
export const WAR_STRENGTH_MORALE_DIVISOR = 60
export const WAR_STRENGTH_TECH_COEF = 0.03
export const WAR_SCORE_STEP = 12
export const WAR_SCORE_CLAMP = 12
export const WAR_SCORE_NOISE = 2
export const WAR_SCORE_LIMIT = 100
/** A monthly delta beyond this is reported as a decisive battlefield shift. */
export const WAR_SCORE_DECISIVE = 3
export const WAR_SCORE_WIN = 75
export const WAR_MONTHS_LIMIT = 60
/** Per-month war attrition on both sides. */
export const WAR_EXHAUSTION_PER_MONTH = 1.2
export const WAR_MORALE_LOSS_PER_MONTH = 0.4
export const WAR_RADICALS_PER_MONTH = 0.5
/** Peace settlement: exhaustion/morale/relation swings. */
export const WAR_END_EXHAUSTION_WIN = 15
export const WAR_END_EXHAUSTION_LOSE = 5
export const WAR_END_MORALE_WIN = 10
export const WAR_END_RELATION_PENALTY = 20
