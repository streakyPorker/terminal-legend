import type { Country } from '../../types'
import { SPENDING } from '../data'
import { SPENDING_MAX } from '../config/fiscal'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionSpending(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const category = String(params.category ?? '') as keyof Country['econ']['spending']
  if (!(category in country.econ.spending)) {
    return { ok: false, text: `${tag} 未知支出类别 ${category}` }
  }
  const amount = clamp(num(params.amount, country.econ.spending[category]), 0, SPENDING_MAX)
  country.econ.spending[category] = amount
  return {
    ok: true,
    text: `${tag} 将${SPENDING[category].name}支出调整为 ${amount.toFixed(1)}`,
  }
}
