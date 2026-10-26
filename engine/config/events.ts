/**
 * Event config: the monthly random-event roll, AI option-picking odds, the
 * live-event parsing caps and the live-event salience thresholds
 * (plan 0009 §9 D1, plan 0010). Leaf module.
 */

/** Monthly chance of a random event, plus its radical-driven term. */
export const EVENT_BASE_CHANCE = 0.055
export const EVENT_RADICAL_CHANCE_DIVISOR = 1200
/** Max open events a player may accumulate before rolls stop. */
export const EVENT_PLAYER_OPEN_MAX = 3
/** AI option-picking odds for aggressive/reformist leaders. */
export const EVENT_AI_AGGRESSIVE_CHANCE = 0.65
export const EVENT_AI_REFORMIST_CHANCE = 0.65
/** A direct relation effect lands at this share on the target's side. */
export const EVENT_RELATION_BACK_FACTOR = 0.6

/** Live-event parse caps (plan 0010 §4). */
export const LIVE_MAX_EVENTS = 2
/**
 * Multi-subject generation caps (plan 0010 E5/§7): how many major powers may
 * contribute events in one turn, and the hard ceiling on `$.model.complete`
 * calls the generator may issue to bound cost/latency. One call per subject, so
 * the call cap is an independent guard against a mis-sized subject list.
 */
export const LIVE_MAX_SUBJECTS = 2
export const LIVE_MAX_MODEL_CALLS = 2
export const LIVE_MAX_OPTIONS = 4
export const LIVE_MAX_MODIFIERS = 8
export const LIVE_MODIFIER_VALUE_CAP = 500
export const LIVE_MODIFIER_MONTHS_MAX = 240
/** Live-event field-length caps (plan 0010 §4). */
export const LIVE_TITLE_MAX = 80
export const LIVE_TEXT_MAX = 600
export const LIVE_OPTION_LABEL_MAX = 60
export const LIVE_OPTION_RESULT_MAX = 300
export const LIVE_MODIFIER_LABEL_MAX = 40
export const LIVE_OPTION_ID_MAX = 24
export const LIVE_EFFECT_CAPS = {
  treasury: 300,
  radicals: 30,
  legitimacy: 30,
  prestige: 40,
  army: 20,
  popsPercent: 10,
  techPoints: 500,
  relationAmount: 50,
} as const

/** Live-event salience thresholds (plan 0010 §3/§10 待定). */
export const LIVE_MAX_TOPICS = 2
/**
 * PT-085: after a topic key (`economy:grain`, `livelihood:famine`, …) is used
 * for a live event, it is cooled for this many months so a persistent condition
 * does not spawn the same crisis event every turn. The condition itself still
 * shows up in the economic data; only the event seed is rested.
 */
export const LIVE_TOPIC_COOLDOWN_MONTHS = 6
export const LIVE_GRAIN_DEVIATION_MIN = 0.06
export const LIVE_GDP_CHANGE_MIN = 0.04
export const LIVE_UNEMPLOYMENT_MIN = 12
export const LIVE_RADICALS_MIN = 20
export const LIVE_LEGITIMACY_CENTER = 50
export const LIVE_LEGITIMACY_STRESS_MIN = 20
export const LIVE_DEBT_RATIO_MIN = 0.25
export const LIVE_INFAMY_SALIENCE_COEF = 0.5
export const LIVE_SOL_LOW = 50
export const LIVE_LITERACY_TARGET = 0.3
export const LIVE_FAMINE_SOL = 45
export const LIVE_FAMINE_GRAIN = 0.05
export const LIVE_WAR_SALIENCE = 80
export const LIVE_FAMINE_SALIENCE = 60
/** Ratio (0–1 deviation) → salience scale: a full deviation maps to this. */
export const LIVE_SALIENCE_SCALE = 100

/** Prompt-shaping caps (plan 0010 §3): how much state the topic seed carries. */
export const LIVE_PROMPT_RELATIONS_MAX = 5
export const LIVE_PROMPT_RECENT_LOG = 4

/**
 * The three narratorial perspectives the generation prompt guides the model
 * toward (plan 0010 E6): 史官 / 市井 / 列国舆论. Guidance only — the message
 * carries no new world fields and no structural output change.
 */
export const LIVE_NARRATIVE_PERSPECTIVES = ['史官', '市井', '列国舆论'] as const

/**
 * Calendar cadence of routine scenes (plan 0010 E7): a scene month is any
 * month index divisible by this value, so a year holds 12 / 6 = 2 scenes.
 * Routine scenes are flavour — every option is effect-free — so skipping one is
 * a no-op and never stalls the turn.
 */
export const LIVE_ROUTINE_INTERVAL_MONTHS = 6
