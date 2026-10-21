import type { Country } from '../../types'
import {
  CONSCRIPT_MANPOWER_COST,
  CONSCRIPT_MAX,
  CONSCRIPT_POP_COST,
  CONSCRIPT_RADICALS_COST,
} from '../config/military'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionConscript(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const wanted = clamp(num(params.amount, 1), 1, CONSCRIPT_MAX)
  const possible = Math.min(wanted, country.military.manpower / CONSCRIPT_MANPOWER_COST)
  if (possible <= 0.1) return { ok: false, text: `${tag} 没有可用的人力` }
  country.military.army += possible
  country.military.manpower -= possible * CONSCRIPT_MANPOWER_COST
  country.pops.radicals = clamp(country.pops.radicals + possible * CONSCRIPT_RADICALS_COST, 0, 100)
  country.pops.total = Math.max(1, country.pops.total - possible * CONSCRIPT_POP_COST)
  return { ok: true, text: `${tag} 征召了 ${possible.toFixed(1)} 万兵力` }
}
