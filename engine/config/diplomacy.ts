import type { GoodId } from '../../types'

/**
 * Diplomacy config: relation drift, infamy drag, trade-warmth/hostility, the
 * diplomacy-action magnitudes and the war-goal settlement constants
 * (plan 0009 §9 D1). Leaf module (imports only the `GoodId` type).
 */

/** Goods whose trade sours relations. */
export const SENSITIVE_GOODS: GoodId[] = ['opium', 'arms', 'grain']
/** Monthly warmth a full trade share earns ("最多 +2"). */
export const TRADE_WARMTH_MAX = 2
/** Monthly relation drag per unit of sensitive-import share. */
export const SENSITIVE_DRAG = 20
/** Clamp on the per-pair-per-month trade relation delta (±). */
export const TRADE_RELATION_ENVELOPE = 10
/** Floor for the automatic trade effects, below the hard trade cut. */
export const TRADE_RELATION_FLOOR = -45
/** Months of trade-tension history kept. */
export const TRADE_TENSION_RETENTION_MONTHS = 24
/** Longest embargo an action may set. */
export const EMBARGO_MONTHS_MAX = 60

/** Relation drift: monthly pull toward the resting target, and infamy drag. */
export const RELATION_DRIFT = 0.012
export const RELATION_ALLIANCE_TARGET = 55
export const RELATION_RIVAL_TARGET = -35
export const INFAMY_DRAG = 0.1

/** `improve` move. */
export const DIPLOMACY_IMPROVE_DEFAULT = 8
export const DIPLOMACY_IMPROVE_MAX = 30
export const DIPLOMACY_IMPROVE_BACK_FACTOR = 0.6
/** `insult` move. */
export const DIPLOMACY_INSULT = 15
export const DIPLOMACY_INSULT_BACK = 12
/** `alliance` requires at least this relation. */
export const DIPLOMACY_ALLIANCE_MIN_RELATION = 30
/** `rival` move relation cut. */
export const DIPLOMACY_RIVAL_RELATION = 30
/** `gift` move. */
export const DIPLOMACY_GIFT_DEFAULT = 3
export const DIPLOMACY_GIFT_MAX = 20
export const DIPLOMACY_GIFT_FACTOR = 2
export const DIPLOMACY_GIFT_BACK_FACTOR = 1.6
/** `war` move relation cut and infamy gain; `peace` score threshold. */
export const DIPLOMACY_WAR_RELATION = 50
export const DIPLOMACY_WAR_INFAMY = 10
export const DIPLOMACY_PEACE_SCORE = 10
/** `embargo`/`unembargo` relation effects. */
export const DIPLOMACY_EMBARGO_RELATION = 15
export const DIPLOMACY_EMBARGO_BACK = 12
export const DIPLOMACY_UNEMBARGO_RELATION = 5

/** War-goal settlement (plan §5). */
export const REPARATIONS_DEFAULT_GDP_SHARE = 0.1
export const REPARATIONS_MAX_GDP = 2
export const REPARATIONS_DEFAULT_MONTHS = 60
export const REPARATIONS_MAX_MONTHS = 240
export const REPARATIONS_MIN_MONTHS = 1
export const REPARATIONS_LOSER_LEGITIMACY = 5
export const REPARATIONS_CAPACITY_INCOME_SHARE = 0.15
export const REPARATIONS_CAPACITY_MIN = 0.5
export const REPARATIONS_MIN_REMAINING = 0.01
export const REPARATIONS_WINNER_PRESTIGE = 10
export const REPARATIONS_LOSER_PRESTIGE = 10
/** Legitimacy the loser sheds in the *defeat* column (goal owner lost). */
export const REPARATIONS_DEFEAT_LEGITIMACY = 3
/** `openMarket` goal. */
export const OPEN_MARKET_TARIFF_CUT = 10
export const OPEN_MARKET_LOSER_LEGITIMACY = 4
export const OPEN_MARKET_LOSER_RELATION = 10
export const OPEN_MARKET_LOSER_PRESTIGE = 5
/** `sphere` goal. */
export const SPHERE_LOSER_PRESTIGE = 8
export const SPHERE_LOSER_LEGITIMACY = 2
export const SPHERE_RELATION_PENALTY = 10
/** `humiliation` goal. */
export const HUMILIATION_PRESTIGE = 15
export const HUMILIATION_LOSER_PRESTIGE = 8
export const HUMILIATION_LOSER_LEGITIMACY = 8
/** Legitimacy the loser sheds in the *defeat* column (goal owner lost). */
export const HUMILIATION_DEFEAT_LEGITIMACY = 3
