import type { ModifierStack, ModifierStat, WorldState } from '../types'
import { buildOf, makeRngForWorld, spawnEvent } from './data'
import { MODIFIER_STATS, MODIFIER_STAT_NAMES, addModifier } from './modifiers'
import { clamp, completeBuilding } from './sim'

export type CheatParams = Record<string, string | number | undefined>

const finite = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The 天命 tools: deliberate, player-only edits to the world. Ironman refuses
 * every one of them. Returns the line written to the chronicle.
 */
export function applyCheat(
  world: WorldState,
  params: CheatParams,
): { ok: boolean; text: string } {
  if (world.ironman) return { ok: false, text: '铁人模式下无法使用天命。' }
  const player = world.countries[world.playerId]
  if (player === undefined) return { ok: false, text: '还没有进行中的游戏。' }
  const tag = `[${player.flag}] ${player.name}`
  const action = String(params.action ?? '')

  let text = ''
  switch (action) {
    case 'treasury': {
      const amount = finite(params.amount)
      player.econ.treasury = Math.max(0, player.econ.treasury + amount)
      text = `国库${amount >= 0 ? '增加' : '减少'} ${Math.abs(amount).toFixed(1)} 金，现为 ${player.econ.treasury.toFixed(1)} 金`
      break
    }
    case 'techPoints': {
      const amount = finite(params.amount)
      player.tech.points = Math.max(0, player.tech.points + amount)
      text = `科技点${amount >= 0 ? '增加' : '减少'} ${Math.abs(amount).toFixed(1)}，现为 ${player.tech.points.toFixed(1)}`
      break
    }
    case 'building': {
      const id = buildOf(String(params.building ?? ''))
      if (id === undefined) return { ok: false, text: `未知建筑 ${String(params.building ?? '')}` }
      const count = clamp(Math.round(finite(params.count ?? params.amount, 1)), -20, 20)
      if (count === 0) return { ok: false, text: '数量不能为 0。' }
      // completeBuilding applies (or reverses) the side effects and re-derives
      // bureaucracy, so removing a railroad also removes its infrastructure.
      completeBuilding(player, id, count)
      text = `${player.name}的${id}数量${count > 0 ? '增加' : '减少'} ${Math.abs(count)}，现为 ${player.econ.buildings[id]}`
      break
    }
    case 'relations': {
      const targetId = String(params.country ?? params.target ?? '').toUpperCase()
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
      const amount = clamp(finite(params.amount, 10), -100, 100)
      player.diplo.relations[target.id] = clamp(
        (player.diplo.relations[target.id] ?? 0) + amount,
        -100,
        100,
      )
      target.diplo.relations[player.id] = clamp(
        (target.diplo.relations[player.id] ?? 0) + amount * 0.6,
        -100,
        100,
      )
      text = `与${target.name}的关系${amount >= 0 ? '改善' : '恶化'} ${Math.abs(amount)}`
      break
    }
    case 'warScore': {
      const targetId = String(params.country ?? params.target ?? '').toUpperCase()
      const war = world.wars.find(
        one =>
          (one.attackers.includes(player.id) && one.defenders.includes(targetId)) ||
          (one.defenders.includes(player.id) && one.attackers.includes(targetId)),
      )
      if (war === undefined) return { ok: false, text: `与${targetId}并未交战。` }
      const amount = finite(params.amount, 10)
      war.warScore = clamp(war.warScore + amount, -100, 100)
      text = `${war.name}的战争分数变为 ${war.warScore.toFixed(0)}`
      break
    }
    case 'date': {
      const year = Math.round(finite(params.year, world.date.year))
      const month = clamp(Math.round(finite(params.month, world.date.month)), 1, 12)
      world.date = { year, month }
      text = `日期设为 ${year} 年 ${month} 月`
      break
    }
    case 'event': {
      const kind = typeof params.kind === 'string' ? params.kind : undefined
      const event = spawnEvent(world, player, makeRngForWorld(world), kind)
      if (event === undefined) return { ok: false, text: '没有可触发的事件。' }
      world.events.push(event)
      if (world.events.length > 80) world.events.splice(0, world.events.length - 80)
      text = `触发事件「${event.title}」`
      break
    }
    case 'modifier': {
      const stat = String(params.stat ?? '') as ModifierStat
      if (!MODIFIER_STATS.includes(stat)) {
        return {
          ok: false,
          text: `未知修正对象 ${stat}。可用：${MODIFIER_STATS.join(', ')}`,
        }
      }
      const stack = String(params.stack ?? 'flat') as ModifierStack
      if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
        return { ok: false, text: 'stack 必须是 flat / percent / multiply。' }
      }
      const value = finite(params.value ?? params.amount)
      const months = finite(params.months)
      const id =
        typeof params.id === 'string' && params.id !== ''
          ? params.id
          : `${player.id}:cheat:${stat}:${player.modifiers.length}`
      addModifier(player, {
        id,
        label:
          typeof params.label === 'string' && params.label !== ''
            ? params.label
            : `天命·${MODIFIER_STAT_NAMES[stat]}`,
        stat,
        stack,
        value,
        monthsLeft: months > 0 ? months : undefined,
        source: 'cheat',
      })
      text = `施加修正 ${MODIFIER_STAT_NAMES[stat]} ${value}${stack === 'flat' ? '' : '%'}（${months > 0 ? `${months} 月` : '长期'}）`
      break
    }
    case 'leader': {
      const name = String(params.name ?? params.leader ?? '').trim()
      if (name === '') return { ok: false, text: '需要领袖姓名。' }
      player.leader.name = name.slice(0, 40)
      if (typeof params.title === 'string' && params.title !== '') {
        player.leader.title = params.title.slice(0, 20)
      }
      if (typeof params.persona === 'string' && params.persona !== '') {
        player.leader.persona = params.persona.slice(0, 200)
      }
      text = `领袖换成${player.leader.title}${player.leader.name}`
      break
    }
    default:
      return {
        ok: false,
        text: '未知天命：treasury / techPoints / building / relations / warScore / date / event / leader / modifier',
      }
  }

  world.log.push({ date: { ...world.date }, kind: 'system', text: `[天命] ${tag} ${text}` })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text: `${tag} ${text}` }
}
