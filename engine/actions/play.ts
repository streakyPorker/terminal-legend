import type { WorldState } from '../../types'
import type { ActionParams, ActionResult } from './types'

export function actionPlay(world: WorldState, params: ActionParams): ActionResult {
  const targetId = String(params.country ?? '')
  const target = world.countries[targetId]
  if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
  const oldPlayer = world.countries[world.playerId]
  if (oldPlayer !== undefined) oldPlayer.isPlayer = false
  target.isPlayer = true
  world.playerId = target.id
  return { ok: true, text: `你现在扮演${target.name}` }
}
