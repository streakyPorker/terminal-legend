import type { Country } from '../../types'
import { INVEST_AMOUNT_MAX, INVEST_CONFIDENCE_RANGE } from '../config/economy'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionInvest(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  // AI investment confidence, bounded to ±10 around the country's base
  // and ±3 per month (plan 0003 §4/§6).
  const base = country.politicalEconomy.investmentConfidence
  const delta = clamp(num(params.amount, 1), -INVEST_AMOUNT_MAX, INVEST_AMOUNT_MAX)
  const next = clamp(
    country.econ.investmentConfidence + delta,
    base - INVEST_CONFIDENCE_RANGE,
    base + INVEST_CONFIDENCE_RANGE,
  )
  country.econ.investmentConfidence = next
  return {
    ok: true,
    text: `${tag} 将投资信心调整为 ${next >= 0 ? '+' : ''}${next.toFixed(0)}`,
  }
}
