import type { WorldState } from '../../types'
import { applyEventOption } from '../events'
import type { ActionParams, ActionResult } from './types'

export function actionEvent(world: WorldState, params: ActionParams): ActionResult {
  const eventId = String(params.eventId ?? '')
  const optionId = String(params.optionId ?? '')
  const event = world.events.find(one => one.id === eventId)
  if (event === undefined) return { ok: false, text: `未知事件 ${eventId}` }
  const result = applyEventOption(world, event, optionId)
  return { ok: true, text: result }
}
