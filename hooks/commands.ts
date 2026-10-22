import type { CommandRunInput, EngineInterface } from 'claude-code'
import type { TabId } from '../types'
import { COUNTRY_SEEDS, initialUi, makeRngForWorld } from '../engine/data'
import { applyCheat, type CheatParams } from '../engine/cheat'
import { applyDecision, clamp, clone, newWorld } from '../engine/sim'
import { loadGame, saveGame } from '../engine/save'
import { countryTag, fmtDateLong } from '../view/format'
import { helpText } from '../view/panels'
import {
  activeWorld,
  isDelegatedRun,
  openPane,
  patchUi,
  pendingOf,
  refreshStatus,
  setUi,
  setWorld,
} from './internal'
import { advanceGame, resolveEvent, startDelegated, startSecretary, stopDelegated } from './council'
import { statusHint, statusText } from './prompt'

// ---------------------------------------------------------------- commands

export async function runV3Command(
  $: EngineInterface,
  e: CommandRunInput,
  aiModel: string,
): Promise<{ text: string }> {
  const parts = e.args.trim().split(/\s+/).filter(part => part !== '')
  const sub = (parts[0] ?? 'status').toLowerCase()

  const current = await activeWorld($)

  try {
    switch (sub) {
      case 'new': {
        if (isDelegatedRun()) return { text: '托管进行中，请等它结束再开新局。' }
        const requested = (parts[1] ?? 'QING').toUpperCase()
        const seedRow = COUNTRY_SEEDS.find(row => row.id === requested)
        if (seedRow === undefined) {
          return {
            text: `未知国家 ${requested}。可用：${COUNTRY_SEEDS.map(row => `${row.id}=${row.name}`).join('，')}`,
          }
        }
        const world = newWorld(Date.now(), requested)
        world.createdAt = Date.now()
        world.ai.model = aiModel
        world.resumeOnStart = true
        await setWorld($, world)
        await setUi($, {
          ...initialUi(),
          isActive: true,
          tab: 'council',
          council: {
            isOpen: true,
            report: `新局开始：${fmtDateLong(world.date)}。御前会议等你批准推进第一个月。`,
            secretaryReport: '',
            isRunning: false,
          },
        })
        await refreshStatus($)
        await openPane($)
        await saveGame($, world).catch(() => undefined)
        const player = world.countries[requested]
        return {
          text: `新游戏开始：${fmtDateLong(world.date)}，你扮演 ${player !== undefined ? countryTag(player) : requested}。御前会议已开始；用 /v3 next 批准推进一月，或 /v3 run N 托管。`,
        }
      }

      case 'next':
      case 'advance':
      case 'approve': {
        if (isDelegatedRun()) return { text: '托管进行中，请等它结束。' }
        return { text: await advanceGame($, 1, true) }
      }

      case 'run': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        const months = clamp(Math.floor(Number(parts[1] ?? current.world.secretary.delegation.months)), 1, 12)
        return { text: await startDelegated($, months) }
      }

      case 'stop': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        return { text: stopDelegated($) }
      }

      case 'council': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        await patchUi($, { tab: 'council' })
        await openPane($)
        return { text: '已切换到御前议事。' }
      }

      case 'secretary': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        return { text: await startSecretary($) }
      }

      case 'delegate': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        const domain = (parts[1] ?? '').toLowerCase()
        const toggle = (parts[2] ?? '').toLowerCase()
        if (
          (domain !== 'internal' && domain !== 'diplomacy') ||
          (toggle !== 'on' && toggle !== 'off')
        ) {
          return {
            text: '用法：/v3 delegate internal on|off，或 /v3 delegate diplomacy on|off。',
          }
        }
        const world = clone(current.world)
        if (domain === 'internal') world.secretary.delegation.internal = toggle === 'on'
        else world.secretary.delegation.diplomacy = toggle === 'on'
        await setWorld($, world)
        await saveGame($, world).catch(() => undefined)
        await refreshStatus($)
        return {
          text: `${domain === 'internal' ? '内政' : '外交'}委托已${toggle === 'on' ? '开启' : '关闭'}。`,
        }
      }

      case 'cheat': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        const lower = (parts[1] ?? '').toLowerCase()
        // The tool schema spells two actions in camelCase; accept either.
        const action =
          lower === 'techpoints'
            ? 'techPoints'
            : lower === 'warscore'
              ? 'warScore'
              : lower === 'finishprojects'
                ? 'finishProjects'
                : lower
        const params: CheatParams = { action }
        if (action === 'treasury' || action === 'techPoints') {
          params.amount = Number(parts[2] ?? 0)
        } else if (action === 'building') {
          params.building = parts[2] ?? ''
          params.count = Number(parts[3] ?? 1)
        } else if (action === 'relations' || action === 'warScore') {
          params.country = (parts[2] ?? '').toUpperCase()
          params.amount = Number(parts[3] ?? 10)
        } else if (action === 'date') {
          params.year = Number(parts[2] ?? current.world.date.year)
          params.month = Number(parts[3] ?? current.world.date.month)
        } else if (action === 'finishProjects') {
          // No parameters: completes every state project in the queue.
        } else if (action === 'event') {
          if (parts[2] !== undefined) params.kind = parts[2]
        } else if (action === 'leader') {
          params.name = parts.slice(2).join(' ')
        } else if (action === 'modifier') {
          params.stat = parts[2] ?? ''
          params.value = Number(parts[3] ?? 0)
          params.stack = parts[4] ?? 'flat'
          if (parts[5] !== undefined) params.months = Number(parts[5])
        } else {
          return {
            text: '用法：/v3 cheat treasury|techPoints <数值>｜building <建筑> <数量>｜finishProjects｜relations <国家> <数值>｜warScore <国家> <数值>｜date <年> <月>｜event [类型]｜leader <姓名>',
          }
        }
        const world = clone(current.world)
        const result = applyCheat(world, params)
        if (!result.ok) return { text: result.text }
        await setWorld($, world)
        await saveGame($, world).catch(() => undefined)
        await refreshStatus($)
        await patchUi($, { notice: result.text })
        return { text: result.text }
      }

      case 'ironman': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        const toggle = (parts[1] ?? '').toLowerCase()
        if (toggle !== 'on' && toggle !== 'off') {
          return { text: '用法：/v3 ironman on|off（仅开局第一个月可切换）。' }
        }
        if (current.world.tick !== 0) {
          return { text: '铁人模式只能在开局第一个月切换。' }
        }
        const world = clone(current.world)
        world.ironman = toggle === 'on'
        await setWorld($, world)
        await saveGame($, world).catch(() => undefined)
        await refreshStatus($)
        return {
          text:
            toggle === 'on'
              ? '铁人模式已开启：天命禁用，只保留自动存档。'
              : '铁人模式已关闭。',
        }
      }

      case 'panel': {
        if (current === undefined) return { text: '还没有进行中的游戏。先 /v3 new。' }
        await openPane($)
        return { text: '已打开终末传奇面板。' }
      }

      case 'status': {
        if (current === undefined) {
          // Clear any status line left behind by a previous session.
          $.ui.status(undefined)
          return { text: statusHint() }
        }
        // Re-render the line so a stale unit/format from an older session
        // is replaced the next time the player asks for status.
        await refreshStatus($)
        return { text: statusText(current.world) }
      }

      case 'events': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        const pending = pendingOf(current.world)
        if (pending.length === 0) return { text: '没有待处理事件。用 /v3 next 推进时间。' }
        return {
          text: pending
            .map(
              event =>
                `[${event.id}] ${event.title}：${event.text}\n选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
            )
            .join('\n\n'),
        }
      }

      case 'resolve': {
        const eventId = parts[1]
        const optionId = parts[2]
        if (eventId === undefined || optionId === undefined) {
          return { text: '用法：/v3 resolve <事件ID> <选项ID>。先 /v3 events 查看。' }
        }
        const text = await resolveEvent($, eventId, optionId)
        return { text }
      }

      case 'play': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        if (isDelegatedRun()) return { text: '托管进行中，请等它结束再切换国家。' }
        const target = (parts[1] ?? '').toUpperCase()
        const country = current.world.countries[target]
        if (country === undefined) {
          return { text: `未知国家 ${target}。可用：${Object.keys(current.world.countries).join('，')}` }
        }
        const world = clone(current.world)
        const result = applyDecision(
          world,
          { countryId: world.playerId, action: 'play', params: { country: target } },
          makeRngForWorld(world),
        )
        if (!result.ok) return { text: result.text }
        await setWorld($, world)
        await saveGame($, world).catch(() => undefined)
        await refreshStatus($)
        return { text: result.text }
      }

      case 'save': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        if (current.world.ironman && parts[1] !== undefined) {
          return { text: '铁人模式只保留自动存档，不能命名存档。' }
        }
        const world = clone(current.world)
        world.resumeOnStart = true
        await setWorld($, world)
        const path = await saveGame($, world, parts[1])
        return { text: `已保存到 ${path}` }
      }

      case 'load': {
        if (isDelegatedRun()) return { text: '托管进行中，请等它结束再读取存档。' }
        if (current !== undefined && current.world.ironman) {
          return { text: '铁人模式不能读取其他存档。' }
        }
        const loaded = await loadGame($, parts[1])
        if (loaded === undefined) return { text: '没有找到存档。' }
        loaded.resumeOnStart = true
        await setWorld($, loaded)
        await setUi($, {
          ...initialUi(),
          isActive: true,
          tab: 'council',
          council: {
            isOpen: true,
            report: `已载入 ${fmtDateLong(loaded.date)} 的存档。御前会议等你批准。`,
            secretaryReport: loaded.secretary.lastReport,
            isRunning: false,
          },
        })
        await refreshStatus($)
        await openPane($)
        return { text: `已载入 ${fmtDateLong(loaded.date)} 的存档，你扮演 ${loaded.countries[loaded.playerId]?.name ?? loaded.playerId}。` }
      }

      case 'end': {
        if (current !== undefined) {
          const world = clone(current.world)
          world.resumeOnStart = false
          await setWorld($, world)
          await saveGame($, world).catch(() => undefined)
        }
        await patchUi($, { isActive: false, isPaneOpen: false })
        $.ui.status(undefined)
        $.ui.toast('本局已结束，存档保留')
        return { text: '本局已结束。存档保留，/v3 load 可继续，/v3 new 可开新局。' }
      }

      case 'rank':
      case 'rankings': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        await patchUi($, { tab: 'rankings' })
        await openPane($)
        return { text: '已切换到列强排名。' }
      }

      case 'market':
      case 'economy':
      case 'pops':
      case 'diplomacy':
      case 'military':
      case 'tech':
      case 'log':
      case 'overview': {
        if (current === undefined) return { text: '还没有进行中的游戏。' }
        await patchUi($, { tab: sub as TabId })
        await openPane($)
        return { text: `已切换到「${sub}」面板。` }
      }

      case 'help':
      default:
        return { text: helpText() }
    }
  } catch (error) {
    return { text: `终末传奇出错：${String(error)}` }
  }
}
