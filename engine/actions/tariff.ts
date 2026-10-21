import type { Country } from '../../types'
import { TARIFF_RATE_MAX } from '../config/tax'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionTariff(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const rate = clamp(num(params.rate, country.econ.tariff), 0, TARIFF_RATE_MAX)
  country.econ.tariff = rate
  country.econ.taxes.tariff = rate
  // Without a separate export rate the old single-rate behaviour stands;
  // supplying `exportRate` splits the two directions (ADR 0014).
  const exportRate =
    params.exportRate === undefined
      ? rate
      : clamp(num(params.exportRate, rate), 0, TARIFF_RATE_MAX)
  country.econ.exportTariff = exportRate
  return {
    ok: true,
    text: `${tag} 将进口关税调整为 ${rate.toFixed(0)}%，出口关税 ${exportRate.toFixed(0)}%`,
  }
}
