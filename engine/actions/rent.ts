import type { Country, WorldState } from '../../types'
import type { ActionParams, ActionResult } from './types'

/**
 * PT-089: the player-only construction-capacity priority switch. When on, the
 * private market rents idle points before state projects draw on them; when
 * off, state projects keep first claim. AI countries never call this action
 * (the AI whitelist excludes it), so the flag stays a player lever.
 */
export function actionRent(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  if (country.id !== world.playerId) {
    return { ok: false, text: `${tag} 建造力出租优先级只能由玩家设定` }
  }
  const raw = params.enabled
  const enabled = raw === true || raw === 1 || raw === 'true' || raw === '1'
  country.econ.rentPriority = enabled
  return {
    ok: true,
    text: enabled
      ? `${tag} 开启「私人优先」：私人项目先按每点租金承租国有建造力，国有项目使用剩余`
      : `${tag} 关闭「私人优先」：国有项目优先使用建造力，私人项目只能租剩余点`,
  }
}
