import type { Country, GoodId, TaxBaseId } from '../../types'
import { CONSUMER_GOODS, GOODS } from '../data'
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
  // PT-073: `good` gives one consumer good its own consumption-tax rate; the
  // unified `consumption` rate stays the fallback for every good without an
  // override. An explicit 0 is a valid exemption.
  if (base === 'consumption' && params.good !== undefined) {
    const goodParam = String(params.good)
    const good = CONSUMER_GOODS.includes(goodParam as GoodId)
      ? (goodParam as GoodId)
      : undefined
    if (good === undefined) {
      return {
        ok: false,
        text: `${tag} 消费税只能按消费品设定（${CONSUMER_GOODS.map(id => GOODS[id].name).join('、')}），未知商品 ${goodParam}`,
      }
    }
    country.econ.consumptionTaxByGood = {
      ...(country.econ.consumptionTaxByGood ?? {}),
      [good]: rate,
    }
    return {
      ok: true,
      text: `${tag} 将${GOODS[good].name}消费税定为 ${rate.toFixed(0)}%（其余消费品仍按统一税率 ${country.econ.taxes.consumption.toFixed(0)}%）`,
    }
  }
  if (base === 'tariff') {
    country.econ.tariff = rate
    country.econ.taxes.tariff = rate
  } else {
    country.econ.taxes[base] = rate
  }
  return { ok: true, text: `${tag} 将${TAX_BASE_NAMES[base]}税率调整为 ${rate.toFixed(0)}%` }
}
