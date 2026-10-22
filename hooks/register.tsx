import type { Register } from 'claude-code'
import type { WorldState } from '../types'
import { initialUi } from '../engine/data'
import { clone } from '../engine/sim'
import { loadGame, saveGame } from '../engine/save'
import { SECRETARY_PROMPT } from '../engine/secretary'
import { fmtDateLong } from '../view/format'
import {
  activeWorld,
  getUi,
  getWorld,
  patchUi,
  refreshStatus,
  secretaryAnswers,
  setUi,
  setWorld,
} from './internal'
import {
  SECRETARY_TOOLS,
  TOOL_SPECS,
  handleV3Action,
  handleV3Advance,
  handleV3Cheat,
  handleV3Control,
  handleV3Diplomacy,
  handleV3Event,
  handleV3Forecast,
  handleV3Inspect,
  handleV3Leader,
  handleV3Manual,
  handleV3Play,
  handleV3Policy,
  handleV3Save,
  handleV3Situation,
  handleV3Status,
} from './tools'
import { renderAbovePrompt, renderCommandOutput, renderPane } from './render'
import { narratorPrompt } from './prompt'
import { runV3Command } from './commands'

// ---------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const aiModel = String(options.aiModel ?? 'haiku')

  // ------------------------------------------------------------ session

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'v3',
      description: '终末传奇：维多利亚式大战略模拟（新游戏 / 推进 / 面板 / 事件 / 存档）',
      argumentHint: '[new|next|run|stop|council|secretary|delegate|panel|status|events|save|load|play|end|help]',
    })
    for (const spec of TOOL_SPECS) {
      await $.tool.register({ ...spec, isDeferred: false })
    }
    // The monthly secretary: a cheap subagent with the full game toolset,
    // constrained by its prompt and audited after the fact.
    await $.agent.register({
      name: 'secretary',
      description: '终末传奇月度秘书：起草并执行御前会议计划。',
      prompt: SECRETARY_PROMPT,
      tools: [...SECRETARY_TOOLS],
      model: 'haiku',
      omitClaudeMd: true,
    })

    const world = await getWorld($)
    const ui = await getUi($)
    if (world !== undefined && ui.isActive) {
      if (world.secretary.isRunning) {
        const resumed = clone(world)
        resumed.secretary.isRunning = false
        await setWorld($, resumed)
      }
      await patchUi($, { council: { ...ui.council, isOpen: true, isRunning: false } })
      await refreshStatus($)
    } else if (world === undefined) {
      let loaded: WorldState | undefined
      try {
        loaded = await loadGame($)
      } catch {
        loaded = undefined
      }
      if (loaded !== undefined && loaded.resumeOnStart) {
        await setWorld($, loaded)
        await setUi($, {
          ...initialUi(),
          isActive: true,
          tab: 'council',
          council: { isOpen: true, report: '', secretaryReport: '', isRunning: false },
        })
        await refreshStatus($)
        $.ui.log(`终末传奇：已载入 ${fmtDateLong(loaded.date)} 的存档，御前会议已开始`)
      } else {
        $.ui.status(undefined)
      }
    } else {
      // A world survives in plugin state after /v3 end (so /v3 load can
      // resume it), but an inactive game must not leave its status line
      // lingering under the prompt in the next session. A stale world from an
      // older version is treated the same way.
      $.ui.status(undefined)
      if (ui.isActive) {
        await patchUi($, { isActive: false, isPaneOpen: false })
      }
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const world = await getWorld($)
    if (world !== undefined) {
      await saveGame($, world).catch(() => undefined)
    }
    // Do not carry a status line into the next session.
    $.ui.status(undefined)
    return next(e)
  })

  // ------------------------------------------------------------ turn lifecycle

  // The secretary is spawned only by this plugin; the model never sees it.
  // (Matcher literals are spelled inline so `claude plugin validate` resolves
  // them; the shared spelling lives in ./internal: SECRETARY_AGENT.)
  on('agent.offer', { agent: 'terminal-legend:secretary' }, () => ({ isOffered: false }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const settle = secretaryAnswers.get(e.agentId)
      if (settle !== undefined) {
        secretaryAnswers.delete(e.agentId)
        settle(e.answer)
      }
    }
    return next(e)
  })

  // ------------------------------------------------------------ system prompt

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const current = await activeWorld($)
    if (current === undefined) return composed
    return {
      sections: [
        ...composed.sections,
        {
          id: 'terminal-legend:world',
          scope: 'session' as const,
          text: narratorPrompt(current.world),
        },
      ],
    }
  })

  // ------------------------------------------------------------ commands

  on('command.run', { command: 'v3' }, ($, e) => runV3Command($, e, aiModel))

  // ------------------------------------------------------------ tools

  on('tool.call', { tool: 'mcp__terminal-legend__v3_status' }, handleV3Status)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_inspect' }, handleV3Inspect)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_manual' }, handleV3Manual)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_forecast' }, handleV3Forecast)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_advance' }, handleV3Advance)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_cheat' }, handleV3Cheat)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_action' }, handleV3Action)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_policy' }, handleV3Policy)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_diplomacy' }, handleV3Diplomacy)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_situation' }, handleV3Situation)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_event' }, handleV3Event)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_leader' }, handleV3Leader)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_save' }, handleV3Save)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_control' }, handleV3Control)
  on('tool.call', { tool: 'mcp__terminal-legend__v3_play' }, handleV3Play)

  // ------------------------------------------------------------ drawing

  on('ui.render', { component: 'Pane', requestId: 'terminal-legend' }, renderPane)

  on('ui.render', { component: 'AbovePrompt' }, renderAbovePrompt)

  on('ui.render', { component: 'CommandOutput', props: { command: 'v3' } }, renderCommandOutput)
}
