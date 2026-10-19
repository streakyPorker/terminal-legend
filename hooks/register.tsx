import type { EngineInterface, Register } from 'claude-code'
import type { TabId, UiState, WorldState } from '../types'
import { COUNTRY_SEEDS, initialUi, makeRngForWorld } from '../engine/data'
import { decideForAi, describeWorldForNarrator } from '../engine/ai'
import {
  advance,
  applyDecision,
  applyEventOption,
  clamp,
  clone,
  newWorld,
  randomDecision,
  type AdvanceReport,
  type Decision,
} from '../engine/sim'
import { loadGame, saveGame, setActive } from '../engine/save'
import { countryTag, fmtDate, fmtDateLong, fmtNumber, statusLine } from '../view/format'
import {
  Band,
  Panel,
  Report,
  helpText,
  type ControlAction,
  type UiKit,
} from '../view/panels'

const PANE = 'terminal-legend'
const WORLD = { plugin: 'terminal-legend', key: 'world' } as const
const UI = { plugin: 'terminal-legend', key: 'ui' } as const

// ---------------------------------------------------------------- state

async function getWorld($: EngineInterface): Promise<WorldState | undefined> {
  return (await $.state.get(WORLD)).value
}

async function setWorld($: EngineInterface, world: WorldState): Promise<void> {
  await $.state.set(WORLD, world)
}

async function getUi($: EngineInterface): Promise<UiState> {
  return (await $.state.get(UI)).value ?? initialUi()
}

async function setUi($: EngineInterface, ui: UiState): Promise<void> {
  await $.state.set(UI, ui)
}

async function patchUi($: EngineInterface, patch: Partial<UiState>): Promise<void> {
  await setUi($, { ...(await getUi($)), ...patch })
}

async function activeWorld(
  $: EngineInterface,
): Promise<{ world: WorldState; ui: UiState } | undefined> {
  const world = await getWorld($)
  const ui = await getUi($)
  if (world === undefined || !ui.isActive) return undefined
  return { world, ui }
}

// ---------------------------------------------------------------- text

function pendingOf(world: WorldState) {
  return world.events.filter(event => event.countryId === world.playerId && !event.isResolved)
}

function statusText(world: WorldState): string {
  const lines = [describeWorldForNarrator(world), '', '各国状态：']
  for (const country of Object.values(world.countries)) {
    const playerMark = country.isPlayer ? '★' : ' '
    lines.push(
      `${playerMark}[${country.flag}]${country.name}(${country.id}) 库${fmtNumber(country.econ.treasury)} GDP${fmtNumber(country.econ.gdp)} 合${Math.round(country.government.legitimacy)} 激${Math.round(country.pops.radicals)} 陆${fmtNumber(country.military.army)} 海${fmtNumber(country.military.navy)} 科${country.tech.level}`,
    )
  }
  const pending = pendingOf(world)
  if (pending.length > 0) {
    lines.push('', '待决事件：')
    for (const event of pending) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.text} 选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }
  const wars = world.wars
  if (wars.length > 0) {
    lines.push('', '战争：')
    for (const war of wars) {
      lines.push(
        `- ${war.name}：${war.attackers.join(',')} vs ${war.defenders.join(',')}，分数 ${Math.round(war.warScore)}，${war.lastEvent}`,
      )
    }
  }
  return lines.join('\n')
}

function summarize(report: AdvanceReport, months: number): string {
  const lines = [`推进 ${months} 个月：${fmtDate(report.start)} → ${fmtDate(report.end)}`]
  for (const entry of report.log.slice(-8)) {
    lines.push(`- ${fmtDate(entry.date)} ${entry.text}`)
  }
  if (report.events.length > 0) {
    lines.push('待决事件：')
    for (const event of report.events) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }
  return lines.join('\n')
}

function narratorPrompt(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return ''
  const pending = pendingOf(world)
  const lines = [
    '## 终末传奇：进行中的大战略游戏',
    `你是这个 19 世纪世界的叙事者，同时也是各国领袖的扮演者。玩家扮演 ${countryTag(player)}。`,
    '硬性规则：',
    '1. 所有数值以工具返回为准；需要世界状态时调用 v3_status，绝不要编造数字。',
    '2. 玩家用自然语言下达命令时，先判断意图，再调用对应工具：v3_action（内政/建造/税收/征兵/法案）、v3_diplomacy（外交/宣战/停战）、v3_event（处理事件）、v3_advance（推进时间）。',
    '3. 玩家与某国领袖交谈时，用该领袖的第一人称口吻回应，体现其人格、特质与议程；随后调用 v3_leader 记录这次交流（可带上 mood / relation 调整）。',
    '4. 未经玩家明确要求，不要推进时间。',
    '5. 回复使用中文，简洁但有画面感；重大转折可以引用编年史。',
    '',
    describeWorldForNarrator(world),
  ]
  if (pending.length > 0) {
    lines.push('', '待决事件：')
    for (const event of pending) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.text} 选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- engine plumbing

let autoTimer: { cancel: () => void } | undefined
let isAdvancing = false
let isTurnRunning = false
let resumeAfterTurn = false

function stopAuto(): void {
  autoTimer?.cancel()
  autoTimer = undefined
}

function startAuto($: EngineInterface, seconds: number): void {
  stopAuto()
  const ms = Math.max(5, Math.floor(seconds)) * 1000
  autoTimer = $.clock.every(ms, () => {
    void tickOnce($).catch(() => undefined)
  })
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const world = await getWorld($)
  const ui = await getUi($)
  if (world === undefined || !ui.isActive) {
    $.ui.status(undefined)
    return
  }
  $.ui.status(statusLine(world))
}

async function openPane($: EngineInterface): Promise<void> {
  try {
    const opened = await $.ui.open({ id: PANE, title: '终末传奇' })
    await patchUi($, { isPaneOpen: opened.isPlaced })
    if (!opened.isPlaced) {
      $.ui.log('终末传奇：面板暂未展开（终端宽度不足），加宽终端或按 Ctrl+X Tab 查看。')
    }
  } catch (error) {
    $.ui.log(`终末传奇：打开面板失败 ${String(error)}`, { to: 'debug' })
  }
}

async function tickOnce($: EngineInterface): Promise<void> {
  if (isAdvancing || isTurnRunning) return
  const current = await activeWorld($)
  if (current === undefined) return
  if (!current.world.auto.isOn || current.world.auto.isPaused) return
  await advanceGame($, 1, false)
}

async function advanceGame(
  $: EngineInterface,
  months: number,
  announce: boolean,
): Promise<string> {
  if (isAdvancing) return '时间正在推进，请稍候。'
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。输入 /v3 new 开始一局。'
  const world = clone(current.world)
  isAdvancing = true
  await patchUi($, { isBusy: true }).catch(() => undefined)
  try {
    const rng = makeRngForWorld(world)
    let decisions: Decision[] = []
    let notes: string[] = []
    let aiError: string | undefined
    try {
      const report = await decideForAi($, world, rng)
      decisions = report.decisions
      notes = report.notes
      aiError = report.error
    } catch (error) {
      aiError = `AI 决策失败，改用确定性政策：${String(error)}`
      for (const country of Object.values(world.countries)) {
        if (country.isPlayer) continue
        const fallback = randomDecision(world, country, rng)
        if (fallback !== undefined) decisions.push(fallback)
      }
    }

    const report = advance(world, months, decisions, rng)
    if (notes.length > 0) {
      const date = { ...world.date }
      for (const note of notes) world.log.push({ date, kind: 'leader', text: note })
      if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
    }

    await setWorld($, world)
    await patchUi($, {
      isBusy: false,
      lastReport: summarize(report, months),
      notice: aiError ?? '',
    })
    await refreshStatus($)
    try {
      await saveGame($, world)
    } catch {
      // The game runs even when the project is read-only.
    }

    if (announce) {
      const interesting = report.log.filter(
        entry =>
          entry.kind === 'war' ||
          entry.kind === 'event' ||
          entry.kind === 'tech' ||
          entry.kind === 'leader' ||
          entry.kind === 'diplomacy',
      )
      const shown = (interesting.length > 0 ? interesting : report.log).slice(-5)
      for (const entry of shown) {
        $.ui.log(`${fmtDate(entry.date)} ${entry.text}`)
      }
    }
    const pending = pendingOf(world)
    if (pending.length > 0 && announce) {
      $.ui.toast(`新事件：${pending.map(event => event.title).join('、')}`)
    }
    return summarize(report, months)
  } finally {
    isAdvancing = false
    await patchUi($, { isBusy: false }).catch(() => undefined)
  }
}

async function resolveEvent(
  $: EngineInterface,
  eventId: string,
  optionId: string,
): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  const world = clone(current.world)
  const event = world.events.find(one => one.id === eventId)
  if (event === undefined) return `未知事件 ${eventId}`
  if (event.isResolved) return '该事件已经处理过了。'
  const text = applyEventOption(world, event, optionId, world.log)
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  await setWorld($, world)
  await saveGame($, world).catch(() => undefined)
  await refreshStatus($)
  $.ui.toast(text)
  return text
}

async function controlGame($: EngineInterface, action: ControlAction): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  const world = clone(current.world)

  if (action === 'next') {
    return advanceGame($, 1, true)
  }

  if (action === 'save') {
    world.auto.resumeOnStart = true
    await setWorld($, world)
    const path = await saveGame($, world).catch(() => '（保存失败）')
    $.ui.toast('已保存')
    return `已保存到 ${path}`
  }

  if (action === 'pause') {
    world.auto.isOn = true
    world.auto.isPaused = true
    stopAuto()
  } else if (action === 'resume') {
    world.auto.isOn = true
    world.auto.isPaused = false
    startAuto($, world.auto.intervalSeconds)
  } else {
    world.auto.isOn = !world.auto.isOn
    world.auto.isPaused = false
    if (world.auto.isOn) startAuto($, world.auto.intervalSeconds)
    else stopAuto()
  }

  await setWorld($, world)
  await saveGame($, world).catch(() => undefined)
  await refreshStatus($)
  await patchUi($, {
    notice: world.auto.isOn
      ? world.auto.isPaused
        ? '自动推进已暂停'
        : `自动推进中：每 ${world.auto.intervalSeconds} 秒一个月`
      : '已切换为手动推进',
  })
  return 'ok'
}

// ---------------------------------------------------------------- tool specs

const TOOL_SPECS: {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}[] = [
  {
    name: 'v3_status',
    description:
      '终末传奇：读取当前世界状态（玩家国家、财政、人口、军力、科技、各国对比、待决事件、战争）。在回答任何需要具体数字的问题前先调用它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'v3_advance',
    description:
      '终末传奇：推进游戏时间。默认 1 个月，最多 24 个月。会先让各国 AI 领袖做决策，再确定性模拟经济、人口、科技、外交与战争，并返回编年史与待决事件。',
    inputSchema: {
      type: 'object',
      properties: {
        months: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: '推进的月数，默认 1。',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_action',
    description:
      '终末传奇：对玩家国家执行一项内政行动。action 取值：build（建造，需 building/count）、tax（税率，需 rate）、tariff（关税，需 rate）、spending（支出，需 category/amount）、research（研究方向，需 tech）、conscript（征兵，需 amount）、law（法案，需 name）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build', 'tax', 'tariff', 'spending', 'research', 'conscript', 'law'],
        },
        building: {
          type: 'string',
          enum: ['farms', 'mines', 'factories', 'railroads', 'ports', 'universities', 'barracks'],
          description: 'build 时必填。',
        },
        count: { type: 'integer', minimum: 1, maximum: 20 },
        rate: { type: 'number', minimum: 0, maximum: 60 },
        category: {
          type: 'string',
          enum: ['army', 'navy', 'bureaucracy', 'education', 'welfare', 'construction'],
        },
        amount: { type: 'number', minimum: 0, maximum: 50 },
        tech: { type: 'string' },
        name: {
          type: 'string',
          enum: [
            '教育改革',
            '福利改革',
            '自由贸易',
            '保护关税',
            '征兵制',
            '宗教宽容',
          ],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_diplomacy',
    description:
      '终末传奇：执行外交行动。move 取值：improve（改善关系）、insult（交恶）、alliance（结盟）、rival（设为对手）、gift（赠礼）、war（宣战）、peace（停战）。target 是国家代码，例如 GBR、RUS、QING。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标国家代码，如 GBR。' },
        move: {
          type: 'string',
          enum: ['improve', 'insult', 'alliance', 'rival', 'gift', 'war', 'peace'],
        },
        amount: { type: 'number', minimum: 1, maximum: 30 },
        reason: { type: 'string', description: '宣战理由，可选。' },
      },
      required: ['target', 'move'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_event',
    description:
      '终末传奇：处理待决事件。省略 eventId 时列出所有待决事件及其选项；给出 eventId 与 optionId 时执行该选项并返回结果。',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        optionId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_leader',
    description:
      '终末传奇：记录玩家与某国领袖的一次交流，并调整该领袖的情绪与两国关系；同时暂停该国 12 个回合的后台 AI 决策，交给叙事者扮演。country 为国家代码。',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string' },
        message: { type: 'string', description: '玩家对这位领袖说的话或达成的约定。' },
        mood: { type: 'number', minimum: -30, maximum: 30, description: '情绪变化量。' },
        relation: {
          type: 'number',
          minimum: -30,
          maximum: 30,
          description: '两国关系变化量。',
        },
      },
      required: ['country', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_save',
    description: '终末传奇：保存当前游戏。可选 name 指定存档名。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_play',
    description: '终末传奇：切换玩家扮演的国家。country 为国家代码，例如 FRA。',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string' } },
      required: ['country'],
      additionalProperties: false,
    },
  },
]

type Args = Record<string, unknown>

// A plugin tool's result may be a string, an array, or undefined — not an
// object. The model reads the string as the tool's output.
const toolOk = (text: string) => ({ result: text })

// `{ deny }` is the tool.call refusal: the model receives the text as an
// errored result.
const toolFail = (text: string) => ({ deny: text })

// ---------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const aiModel = String(options.aiModel ?? 'haiku')
  const defaultSeconds = Math.max(5, Math.floor(Number(options.autoTickSeconds ?? 60)))
  const autoStart = options.autoStart !== false

  // ------------------------------------------------------------ session

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'v3',
      description: '终末传奇：维多利亚式大战略模拟（新游戏 / 推进 / 面板 / 事件 / 存档）',
      argumentHint: '[new|next|auto|pause|resume|panel|status|events|save|load|play|end|help]',
    })
    for (const spec of TOOL_SPECS) {
      await $.tool.register({ ...spec, isDeferred: false })
    }

    const world = await getWorld($)
    const ui = await getUi($)
    if (world !== undefined && ui.isActive) {
      await setActive($, true)
      await refreshStatus($)
      if (world.auto.isOn && !world.auto.isPaused) {
        startAuto($, world.auto.intervalSeconds)
      }
    } else if (world === undefined) {
      let loaded: WorldState | undefined
      try {
        loaded = await loadGame($)
      } catch {
        loaded = undefined
      }
      if (loaded !== undefined && loaded.auto.resumeOnStart) {
        await setWorld($, loaded)
        await setUi($, { ...initialUi(), isActive: true })
        await setActive($, true)
        await refreshStatus($)
        if (loaded.auto.isOn && !loaded.auto.isPaused) {
          startAuto($, loaded.auto.intervalSeconds)
        }
        $.ui.log(`终末传奇：已载入 ${fmtDateLong(loaded.date)} 的存档`)
      } else {
        await setActive($, false)
        $.ui.status(undefined)
      }
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopAuto()
    const world = await getWorld($)
    if (world !== undefined) {
      await saveGame($, world).catch(() => undefined)
    }
    await setActive($, false)
    return next(e)
  })

  // ------------------------------------------------------------ turn lifecycle

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) isTurnRunning = false
    if (resumeAfterTurn) {
      resumeAfterTurn = false
      const current = await activeWorld($)
      if (current !== undefined && current.world.auto.isOn) {
        const world = clone(current.world)
        world.auto.isPaused = false
        await setWorld($, world)
        await refreshStatus($)
        startAuto($, world.auto.intervalSeconds)
        await patchUi($, { notice: '玩家操作结束，自动推进继续' })
      }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'plugin') return next(e)
    const current = await activeWorld($)
    if (
      current !== undefined &&
      current.world.auto.isOn &&
      !current.world.auto.isPaused
    ) {
      const world = clone(current.world)
      world.auto.isPaused = true
      resumeAfterTurn = true
      stopAuto()
      await setWorld($, world)
      await refreshStatus($)
      await patchUi($, { notice: '玩家行动中，自动推进已暂停' })
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

  on('command.run', { command: 'v3' }, async ($, e) => {
    const parts = e.args.trim().split(/\s+/).filter(part => part !== '')
    const sub = (parts[0] ?? 'status').toLowerCase()

    const current = await activeWorld($)

    try {
      switch (sub) {
        case 'new': {
          const requested = (parts[1] ?? 'QING').toUpperCase()
          const seedRow = COUNTRY_SEEDS.find(row => row.id === requested)
          if (seedRow === undefined) {
            return {
              text: `未知国家 ${requested}。可用：${COUNTRY_SEEDS.map(row => `${row.id}=${row.name}`).join('，')}`,
            }
          }
          const world = newWorld(Date.now(), requested)
          world.createdAt = Date.now()
          world.auto.aiModel = aiModel
          world.auto.intervalSeconds = defaultSeconds
          world.auto.isOn = autoStart
          world.auto.isPaused = false
          world.auto.resumeOnStart = true
          await setWorld($, world)
          await setUi($, { ...initialUi(), isActive: true })
          await setActive($, true)
          await refreshStatus($)
          if (autoStart) startAuto($, world.auto.intervalSeconds)
          await openPane($)
          await saveGame($, world).catch(() => undefined)
          const player = world.countries[requested]
          return {
            text: `新游戏开始：${fmtDateLong(world.date)}，你扮演 ${player !== undefined ? countryTag(player) : requested}。自动推进每 ${world.auto.intervalSeconds} 秒一个月；你一发消息就会暂停。`,
          }
        }

        case 'next':
        case 'advance': {
          const months = clamp(Math.floor(Number(parts[1] ?? 1)), 1, 24)
          const summary = await advanceGame($, months, true)
          return { text: summary }
        }

        case 'auto': {
          if (current === undefined) return { text: '还没有进行中的游戏。先 /v3 new。' }
          const world = clone(current.world)
          const seconds = parts[1] !== undefined ? Math.max(5, Math.floor(Number(parts[1]))) : world.auto.intervalSeconds || defaultSeconds
          world.auto.isOn = true
          world.auto.isPaused = false
          world.auto.intervalSeconds = seconds
          await setWorld($, world)
          startAuto($, seconds)
          await saveGame($, world).catch(() => undefined)
          await refreshStatus($)
          return { text: `自动推进已开启：每 ${seconds} 秒一个月。` }
        }

        case 'pause': {
          if (current === undefined) return { text: '还没有进行中的游戏。' }
          const world = clone(current.world)
          world.auto.isOn = true
          world.auto.isPaused = true
          stopAuto()
          await setWorld($, world)
          await saveGame($, world).catch(() => undefined)
          await refreshStatus($)
          return { text: '自动推进已暂停。' }
        }

        case 'resume': {
          if (current === undefined) return { text: '还没有进行中的游戏。' }
          const world = clone(current.world)
          world.auto.isOn = true
          world.auto.isPaused = false
          await setWorld($, world)
          startAuto($, world.auto.intervalSeconds)
          await refreshStatus($)
          return { text: `自动推进继续：每 ${world.auto.intervalSeconds} 秒一个月。` }
        }

        case 'stop': {
          if (current === undefined) return { text: '还没有进行中的游戏。' }
          const world = clone(current.world)
          world.auto.isOn = false
          world.auto.isPaused = false
          stopAuto()
          await setWorld($, world)
          await saveGame($, world).catch(() => undefined)
          await refreshStatus($)
          return { text: '已切换为手动推进。' }
        }

        case 'panel': {
          if (current === undefined) return { text: '还没有进行中的游戏。先 /v3 new。' }
          await openPane($)
          return { text: '已打开终末传奇面板。' }
        }

        case 'status': {
          if (current === undefined) return { text: statusHint() }
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
          const world = clone(current.world)
          world.auto.resumeOnStart = true
          await setWorld($, world)
          const path = await saveGame($, world, parts[1])
          return { text: `已保存到 ${path}` }
        }

        case 'load': {
          const loaded = await loadGame($, parts[1])
          if (loaded === undefined) return { text: '没有找到存档。' }
          loaded.auto.resumeOnStart = true
          await setWorld($, loaded)
          await setUi($, { ...initialUi(), isActive: true })
          await setActive($, true)
          await refreshStatus($)
          if (loaded.auto.isOn && !loaded.auto.isPaused) {
            startAuto($, loaded.auto.intervalSeconds)
          } else {
            stopAuto()
          }
          await openPane($)
          return { text: `已载入 ${fmtDateLong(loaded.date)} 的存档，你扮演 ${loaded.countries[loaded.playerId]?.name ?? loaded.playerId}。` }
        }

        case 'end': {
          if (current !== undefined) {
            const world = clone(current.world)
            world.auto.isOn = false
            world.auto.isPaused = true
            world.auto.resumeOnStart = false
            await setWorld($, world)
            await saveGame($, world).catch(() => undefined)
          }
          stopAuto()
          resumeAfterTurn = false
          await patchUi($, { isActive: false, isPaneOpen: false })
          await setActive($, false)
          $.ui.status(undefined)
          $.ui.toast('本局已结束，claude-hud 已恢复')
          return { text: '本局已结束。存档保留，/v3 load 可继续，/v3 new 可开新局。' }
        }

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
  })

  // ------------------------------------------------------------ tools

  on('tool.call', { tool: 'mcp__terminal-legend__v3_status' }, async $ => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。请让玩家先运行 /v3 new。')
      return toolOk(statusText(current.world))
    } catch (error) {
      return toolFail(`读取状态失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_advance' }, async ($, e) => {
    try {
      const args = e as unknown as Args
      const months = clamp(Math.floor(Number(args.months ?? 1)), 1, 24)
      const summary = await advanceGame($, months, true)
      return toolOk(summary)
    } catch (error) {
      return toolFail(`推进失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_action' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const world = clone(current.world)
      const params: Record<string, string | number | boolean | undefined> = {}
      for (const key of ['building', 'count', 'rate', 'category', 'amount', 'tech', 'name']) {
        const value = args[key]
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          params[key] = value
        }
      }
      const result = applyDecision(
        world,
        {
          countryId: world.playerId,
          action: String(args.action ?? ''),
          params,
        },
        makeRngForWorld(world),
      )
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      await patchUi($, { notice: result.text })
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`行动失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_diplomacy' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const world = clone(current.world)
      const params: Record<string, string | number | boolean | undefined> = {
        target: String(args.target ?? '').toUpperCase(),
        move: String(args.move ?? ''),
      }
      if (typeof args.amount === 'number') params.amount = args.amount
      if (typeof args.reason === 'string') params.reason = args.reason
      const result = applyDecision(
        world,
        { countryId: world.playerId, action: 'diplomacy', params },
        makeRngForWorld(world),
      )
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      await patchUi($, { notice: result.text })
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`外交行动失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_event' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const eventId = typeof args.eventId === 'string' ? args.eventId : ''
      if (eventId === '') {
        const pending = pendingOf(current.world)
        if (pending.length === 0) return toolOk('没有待处理事件。')
        return toolOk(
          pending
            .map(
              event =>
                `[${event.id}] ${event.title}：${event.text}\n选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
            )
            .join('\n\n'),
        )
      }
      const optionId = typeof args.optionId === 'string' ? args.optionId : ''
      if (optionId === '') return toolFail('需要 optionId 才能处理事件。')
      const text = await resolveEvent($, eventId, optionId)
      return toolOk(text)
    } catch (error) {
      return toolFail(`事件处理失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_leader' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const world = clone(current.world)
      const countryId = String(args.country ?? '').toUpperCase()
      const country = world.countries[countryId]
      if (country === undefined) return toolFail(`未知国家 ${countryId}`)
      const message = String(args.message ?? '').slice(0, 400)
      const player = world.countries[world.playerId]
      const speaker = player === undefined ? '玩家' : countryTag(player)
      country.leader.memory.push(`${speaker}：${message}`)
      if (country.leader.memory.length > 8) country.leader.memory.shift()
      if (typeof args.mood === 'number') {
        country.leader.mood = clamp(country.leader.mood + args.mood, -100, 100)
      }
      if (typeof args.relation === 'number' && player !== undefined) {
        const forward = country.diplo.relations[player.id] ?? 0
        country.diplo.relations[player.id] = clamp(forward + args.relation, -100, 100)
        const back = player.diplo.relations[country.id] ?? 0
        player.diplo.relations[country.id] = clamp(back + args.relation * 0.8, -100, 100)
      }
      world.ai.suspended[countryId] = world.tick + 12
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      const sheet = [
        `${country.flag}${country.name} · ${country.leader.title}${country.leader.name}`,
        `人格：${country.leader.persona}`,
        `特质：${country.leader.traits.join('、')}`,
        `议程：${country.leader.agenda}`,
        `情绪：${Math.round(country.leader.mood)}`,
        `记忆：${country.leader.memory.slice(-4).join('；')}`,
      ]
      return toolOk(sheet.join('\n'))
    } catch (error) {
      return toolFail(`领袖交流失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_save' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const name = typeof args.name === 'string' ? args.name : undefined
      const path = await saveGame($, current.world, name)
      return toolOk(`已保存到 ${path}`)
    } catch (error) {
      return toolFail(`保存失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_play' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const target = String(args.country ?? '').toUpperCase()
      const world = clone(current.world)
      const result = applyDecision(
        world,
        { countryId: world.playerId, action: 'play', params: { country: target } },
        makeRngForWorld(world),
      )
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`切换国家失败：${String(error)}`)
    }
  })

  // ------------------------------------------------------------ drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await activeWorld($)
    const kit = $.ui.resolve(e) as unknown as UiKit
    if (current === undefined) {
      const { Box, Text } = kit
      return (
        <Box flexDirection="column">
          <Text bold>终末传奇</Text>
          <Text dimColor>还没有进行中的游戏。输入 /v3 new 开始，/v3 load 读取存档。</Text>
        </Box>
      )
    }
    return (
      <Panel
        ui={kit}
        world={current.world}
        width={e.props.bodyColumns}
        tab={current.ui.tab}
        notice={current.ui.isBusy ? '处理中…' : current.ui.notice}
        onTab={tab => {
          void patchUi($, { tab })
        }}
        onControl={control => {
          void controlGame($, control)
        }}
        onEvent={(eventId, optionId) => {
          void resolveEvent($, eventId, optionId)
        }}
      />
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await activeWorld($)
    if (current === undefined) return next(e)
    const kit = $.ui.resolve(e) as unknown as UiKit
    return (
      <Band
        ui={kit}
        world={current.world}
        width={e.props.bodyColumns}
        maxRows={e.props.maxRows}
        onControl={control => {
          void controlGame($, control)
        }}
      />
    )
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'v3' } }, async ($, e) => {
    const current = await activeWorld($)
    const kit = $.ui.resolve(e) as unknown as UiKit
    if (current === undefined) {
      const { Text } = kit
      return <Text dimColor>{e.props.text}</Text>
    }
    return (
      <Report
        ui={kit}
        world={current.world}
        width={e.viewport?.columns ?? 100}
        args={e.props.args}
        text={e.props.text}
        onEvent={(eventId, optionId) => {
          void resolveEvent($, eventId, optionId)
        }}
      />
    )
  })
}

function statusHint(): string {
  return '终末传奇：还没有进行中的游戏。\n/v3 new [国家] 开一局（默认 QING 大清）\n/v3 load 读取存档\n/v3 help 查看全部命令'
}
