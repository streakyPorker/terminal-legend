import type { WorldState } from '../../types'
import type { Decision } from '../internal'
import type { Rng } from '../rng'
import { actionBuild, actionCancel, actionReorder, actionUpgrade } from './build'
import { actionTax } from './tax'
import { actionTariff } from './tariff'
import { actionSpending } from './spending'
import { actionResearch } from './research'
import { actionInvest } from './invest'
import { actionConscript } from './conscript'
import { actionLaw } from './law'
import { actionDiplomacy } from './diplomacy'
import { actionRoute } from './route'
import { actionSituation } from './situation'
import { actionEvent } from './event'
import { actionPlay } from './play'
import type { ActionResult } from './types'

/**
 * The single action dispatcher. Each case delegates to the per-action module
 * that owns its concern; the early `country === undefined` guard and the
 * unknown-action fallback stay here so the entry behaviour is unchanged.
 */
export function applyDecision(
  world: WorldState,
  decision: Decision,
  rng: Rng,
): ActionResult {
  const country = world.countries[decision.countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${decision.countryId}` }
  const params = decision.params
  switch (decision.action) {
    case 'build':
      return actionBuild(world, country, params)
    case 'upgrade':
      return actionUpgrade(world, country, params)
    case 'tax':
      return actionTax(country, params)
    case 'tariff':
      return actionTariff(country, params)
    case 'spending':
      return actionSpending(country, params)
    case 'research':
      return actionResearch(country, params)
    case 'invest':
      return actionInvest(country, params)
    case 'conscript':
      return actionConscript(country, params)
    case 'cancel':
      return actionCancel(country, params)
    case 'reorder':
      return actionReorder(country, params)
    case 'law':
      return actionLaw(country, params)
    case 'diplomacy':
      return actionDiplomacy(world, country, params)
    case 'route':
      return actionRoute(world, country, params)
    case 'situation':
      return actionSituation(world, country, params, decision.narrative)
    case 'event':
      return actionEvent(world, params)
    case 'play':
      return actionPlay(world, params)
    default:
      return { ok: false, text: `未知行动 ${decision.action}` }
  }
}
