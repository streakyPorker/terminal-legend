/**
 * PT-098: demand-model shaping — the Engel curve.
 *
 * The Stone-Geary basket gives every consumer good a fixed income elasticity,
 * so a richer country buys the same *mix* as a poor one, only more of it. That
 * kept grain demand glued to the subsistence line while services and luxury
 * stayed scarce.
 *
 * Each good now carries an **income elasticity of its discretionary weight**: as
 * income rises above the subsistence line, staples' weight grows slowly and
 * superior goods' weight grows fast. The weights are renormalised, so the shift
 * is in the *mix*, while the household budget still sets the total. Every
 * exponent stays above zero, so no good's quantity ever shrinks as a country
 * gets richer — only its share does.
 *
 * The ratio is `incomePerCapita / subsistenceCost`, not a gold figure, so it
 * means the same thing in 1836 Qing and in a rich industrial economy later.
 */

import type { GoodId } from '../../types'

/**
 * Income elasticity of each good's discretionary weight. 1 = grows in step with
 * income above subsistence; below 1 = staple (share falls); above 1 = superior
 * good (share rises).
 */
export const ENGEL_INCOME_ELASTICITY: Partial<Record<GoodId, number>> = {
  grain: 0.6,
  clothes: 1.05,
  furniture: 1,
  liquor: 0.95,
  services: 1.1,
  luxury: 1.35,
  chemicals: 1.05,
}

/** The subsistence ratio is clamped into this band before the weights move. */
export const ENGEL_RATIO_MIN = 0.5
export const ENGEL_RATIO_MAX = 6
