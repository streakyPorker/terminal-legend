import type { WorldState } from '../../types'

/**
 * Why a managed run should stop after the month that just passed, or '' to
 * keep going (plan §4.5). The secretary-overreach check lives in the hooks
 * layer, where the audit flag is.
 */
export function councilInterrupt(before: WorldState, after: WorldState): string {
  const pendingOf = (world: WorldState): number =>
    world.events.filter(event => event.countryId === world.playerId && !event.isResolved).length
  // Any unresolved player event stops a run, whether it was already open or
  // arrived this month (plan §4.5).
  if (pendingOf(after) > 0) return '有待决事件'

  const atWar = (world: WorldState, id: string): boolean =>
    world.wars.some(
      war =>
        war.id === id &&
        (war.attackers.includes(world.playerId) || war.defenders.includes(world.playerId)),
    )
  const newWar = after.wars.some(war => !before.wars.some(one => one.id === war.id) && atWar(after, war.id))
  if (newWar) return '新的战争'
  const warEnded = before.wars.some(war => atWar(before, war.id) && !after.wars.some(one => one.id === war.id))
  if (warEnded) return '战争结束'
  return ''
}
