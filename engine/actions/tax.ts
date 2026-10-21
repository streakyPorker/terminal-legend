import type { Country, TaxBaseId } from '../../types'
import { TAX_BASE_IDS, TAX_BASE_NAMES } from '../fiscal'
import { TARIFF_RATE_MAX } from '../config/tax'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

/** The four-base tax menu, shown when `v3_action tax` omits `base` (ADR 0023). */
export function taxMenuText(country: Country): string {
  return TAX_BASE_IDS.map(base => {
    const rate = base === 'tariff' ? country.econ.tariff : country.econ.taxes[base]
    return `${TAX_BASE_NAMES[base]}(${base}) ${rate.toFixed(0)}%`
  }).join(' / ')
}

export function actionTax(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const base = String(params.base ?? '') as TaxBaseId
  if (!TAX_BASE_IDS.includes(base)) {
    return {
      ok: false,
      text: `${tag} 需要税基 base（land/profit/consumption/tariff）。当前：${taxMenuText(country)}`,
    }
  }
  const rate = clamp(num(params.rate, country.econ.taxes[base]), 0, TARIFF_RATE_MAX)
  if (base === 'tariff') {
    country.econ.tariff = rate
    country.econ.taxes.tariff = rate
  } else {
    country.econ.taxes[base] = rate
  }
  return { ok: true, text: `${tag} 将${TAX_BASE_NAMES[base]}税率调整为 ${rate.toFixed(0)}%` }
}
