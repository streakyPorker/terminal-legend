import type { Country } from '../../types'
import { techName } from '../data'
import type { ActionParams, ActionResult } from './types'

export function actionResearch(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const name = String(params.tech ?? techName(country.tech.level + 1))
  country.tech.researching = name
  return { ok: true, text: `${tag} 将研究方向定为「${name}」` }
}
