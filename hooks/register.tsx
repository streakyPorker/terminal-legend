import type { EngineInterface, Register } from 'claude-code'
import type { LogEntry, PolicyProposal, TabId, UiState, WorldState } from '../types'
import { MODIFIER_STATS } from '../engine/modifiers'
import { BUILDINGS, COUNTRY_SEEDS, GOOD_IDS, WAR_GOAL_NAMES, initialUi, makeRngForWorld } from '../engine/data'
import { decideForAi, describeWorldForNarrator } from '../engine/ai'
import {
  advance,
  applyDecision,
  applyEventOption,
  applyPolicy,
  clamp,
  clone,
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  councilInterrupt,
  projectWorkload,
  newWorld,
  randomDecision,
  type AdvanceReport,
  type Decision,
} from '../engine/sim'
import { CURRENT_WORLD_VERSION, loadGame, saveGame } from '../engine/save'
import { forecastWorld, inspectWorld } from '../engine/inspect'
import { fiscalLedger } from '../engine/fiscal'
import { applyCheat, type CheatParams } from '../engine/cheat'
import { SECRETARY_PROMPT, monthlyBriefing } from '../engine/secretary'
import {
  SITUATION_STANCES,
  recordSituationProposal,
  settleDueSituations,
  situationStatus,
} from '../engine/situations'
import {
  countryTag,
  fmtDate,
  fmtDateLong,
  fmtGdp,
  fmtMoney,
  fmtNumber,
  fmtPop,
  fmtSigned,
  statusLine,
} from '../view/format'
import {
  Band,
  Panel,
  Report,
  helpText,
  type ControlAction,
  type CouncilAction,
  type UiKit,
} from '../view/panels'

const PANE = 'terminal-legend'
const WORLD = { plugin: 'terminal-legend', key: 'world' } as const
const UI = { plugin: 'terminal-legend', key: 'ui' } as const
const SECRETARY_AGENT = 'terminal-legend:secretary'
const SECRETARY_TIMEOUT_MS = 240_000
// Full toolset per ADR 0001: misuse is caught by the prompt and audited
// afterwards, not prevented by withholding tools.
const SECRETARY_TOOLS = [
  'mcp__terminal-legend__v3_status',
  'mcp__terminal-legend__v3_inspect',
  'mcp__terminal-legend__v3_forecast',
  'mcp__terminal-legend__v3_advance',
  'mcp__terminal-legend__v3_cheat',
  'mcp__terminal-legend__v3_action',
  'mcp__terminal-legend__v3_policy',
  'mcp__terminal-legend__v3_diplomacy',
  'mcp__terminal-legend__v3_situation',
  'mcp__terminal-legend__v3_event',
  'mcp__terminal-legend__v3_leader',
  'mcp__terminal-legend__v3_save',
] as const

/** agentId -> settle the answer its `turn.complete` will carry. */
const secretaryAnswers = new Map<string, (text: string) => void>()

// ---------------------------------------------------------------- state

async function getWorld($: EngineInterface): Promise<WorldState | undefined> {
  const world = (await $.state.get(WORLD)).value
  // A world left in plugin state by an older build is not migrated (ADR 0005);
  // it must not keep drawing a stale status line or crash the new engine.
  if (world !== undefined && world.version !== CURRENT_WORLD_VERSION) return undefined
  return world
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
      `${playerMark}[${country.flag}]${country.name}(${country.id}) 净资产${fmtMoney(country.econ.treasury)} GDP${fmtGdp(country.econ.gdp)} 合法性${Math.round(country.government.legitimacy)} 激进${Math.round(country.pops.radicals)} 陆军${fmtNumber(country.military.army)}万 海军${fmtNumber(country.military.navy)} 科技${country.tech.level}`,
    )
  }
  const player = world.countries[world.playerId]
  if (player !== undefined) {
    const load = constructionLoad(player)
    const schedule = constructionSchedule(player)
    const queue = player.econ.constructionQueue
    const stateQueue = queue.filter(
      project => (project.owner ?? 'state') !== 'private',
    )
    const privateQueue = queue.filter(
      project => (project.owner ?? 'state') === 'private',
    )
    const atWar = world.wars.some(
      war =>
        war.attackers.includes(player.id) || war.defenders.includes(player.id),
    )
    const ledger = fiscalLedger(player, { atWar, tick: world.tick })
    const taxShare =
      ledger.gdp > 0 ? ((ledger.income.taxes / ledger.gdp) * 100).toFixed(1) : '0.0'
    const stock =
      ledger.debt > 0
        ? `国债 ${fmtMoney(ledger.debt)}（月息 ${(ledger.debtRate * 100).toFixed(2)}%）`
        : `主权基金 ${fmtMoney(ledger.fund)}（月息 ${(ledger.fundRate * 100).toFixed(2)}%）`
    const pressure = ledger.debtPressure
    const debtPressureLine =
      pressure.ratio < 0.25
        ? `债务压力：无（债务/GDP ${(pressure.ratio * 100).toFixed(0)}%）`
        : `债务压力：${pressure.label}（债务/GDP ${(pressure.ratio * 100).toFixed(0)}%，收入 −${(pressure.incomePenalty * 100).toFixed(0)}%，建设速度 −${(pressure.constructionPenalty * 100).toFixed(0)}%，合法性目标 −${pressure.legitimacyPenalty.toFixed(1)}，月息 +${(pressure.interestSpread * 100).toFixed(2)}%）`
    const schedules = (world.indemnities ?? []).filter(
      schedule => schedule.from === player.id || schedule.to === player.id,
    )
    lines.push(
      '',
      `本国官僚：${Math.round(player.bureaucracy.score)}/${Math.round(player.bureaucracy.ceiling)}，行动预算 ${player.bureaucracy.actionBudget} 项/月，资金效率 ${Math.round(player.bureaucracy.fundEfficiency * 100)}%，延迟 ${Math.round(player.bureaucracy.delayChance * 100)}%，失真 ${Math.round(player.bureaucracy.infoDistortion * 100)}%`,
      `交通基础设施 ${Math.round(player.econ.transportInfrastructure)} · 行政能力 ${Math.round(player.econ.administrativeCapacity)} · 失业 ${player.econ.unemployment.toFixed(1)}%`,
      `GDP构成：消费 ${fmtNumber(player.econ.gdpComponents.c)} / 投资 ${fmtNumber(player.econ.gdpComponents.i)} / 政府 ${fmtNumber(player.econ.gdpComponents.g)}；工资 ${fmtNumber(player.econ.wages)}（劳动份额 ${Math.round(player.econ.laborShare * 100)}%）/ 利润 ${fmtNumber(player.econ.profits)}`,
      `国库净资产：${fmtMoney(player.econ.treasury)}（${stock}）`,
      debtPressureLine,
      `税率 ${player.econ.taxRate}% · 进口关税 ${player.econ.tariff}% · 出口关税 ${player.econ.exportTariff ?? player.econ.tariff}%`,
      `财政收入：税入 ${fmtNumber(ledger.income.taxes)} + 关税（进+出） ${fmtNumber(ledger.income.tariffs)} + 港口 ${fmtNumber(ledger.income.ports)} + 基金收益 ${fmtNumber(ledger.income.sovereignIncome)} + 赔款收入 ${fmtNumber(ledger.income.reparations)} + 其他（建造力出租） ${fmtNumber(ledger.income.other)} = ${fmtMoney(ledger.income.total)}/月（税入占 GDP ${taxShare}%）`,
      `财政支出：陆军 ${fmtNumber(ledger.expense.army)} + 海军 ${fmtNumber(ledger.expense.navy)} + 行政 ${fmtNumber(ledger.expense.administration)} + 教育 ${fmtNumber(ledger.expense.education)} + 福利 ${fmtNumber(ledger.expense.welfare)} + 债息 ${fmtNumber(ledger.expense.debtInterest)} + 市场损耗 ${fmtNumber(ledger.expense.marketLoss)} + 设施维护 ${fmtNumber(ledger.expense.upkeep)} + 赔款支出 ${fmtNumber(ledger.expense.reparations)} + 国有建设 ${fmtNumber(ledger.expense.construction)} + 建设补贴 ${fmtNumber(ledger.expense.constructionSubsidy)} = ${fmtMoney(ledger.expense.total)}/月`,
      `国库净额：收入 − 支出 = ${fmtSigned(ledger.net)} 金/月；私人部门贸易逆差 ${fmtMoney(ledger.tradeGap)}（由私人资本/私人外债 ${fmtMoney(ledger.privateDebt)} 承担，不影响国库）；净资产实际变动 ${fmtSigned(ledger.net)} 金/月；GDP 是产出，与国库收支不是同一本账`,
      `赔款日程：${
        schedules.length === 0
          ? '无'
          : schedules
              .map(schedule => {
                const paying = schedule.from === player.id
                const otherId = paying ? schedule.to : schedule.from
                const other = world.countries[otherId]?.name ?? otherId
                return `${paying ? '付给' : '收自'}${other} 每月 ${fmtNumber(schedule.monthlyAmount)} 金，剩余 ${schedule.monthsLeft} 月（余 ${fmtNumber(schedule.remaining)} 金）`
              })
              .join('；')
      }`,
      `私人资本 ${fmtNumber(Math.max(0, player.econ.privateCapital))} · 私人外债 ${fmtMoney(ledger.privateDebt)} · 投资信心 ${player.econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(player.econ.investmentConfidence)} · 闲置利润 ${fmtNumber(player.econ.idleProfits)} · 劳动原始利用率 ${(player.econ.laborRawUtilization * 100).toFixed(1)}%（需求 ${fmtPop(player.econ.laborDemand)} / 劳动力 ${fmtPop(player.econ.laborForce)}）`,
      `资源禀赋：农田 ${player.econ.resources.farmland} · 林地 ${player.econ.resources.timber} · 煤矿 ${player.econ.resources.coal} · 铁矿 ${player.econ.resources.iron}`,
      `建造能力 ${fmtNumber(load.capacity)} 点/月（队列剩余工程量 ${fmtNumber(load.requested)}，已分配 ${fmtNumber(load.allocated)}，闲置 ${fmtNumber(load.remaining)}；每点工程量造价 ${CONSTRUCTION_COST_PER_POINT} 金）`,
      `国有建造队列：${
        stateQueue.length === 0
          ? '空'
          : stateQueue
              .map(
                project =>
                  `${BUILDINGS[project.building].name}×${project.count}（工程量 ${fmtNumber(projectWorkload(project) * (1 - project.progress))}/${fmtNumber(projectWorkload(project))} 点，已完成 ${Math.round(project.progress * 100)}%，本月投入 ${fmtNumber(load.byProject[project.id] ?? 0)} 点，预计 ${schedule[project.id]?.turns ?? '—'} 回合，总造价 ${fmtNumber(constructionTotalCost(project))} 金）`,
              )
              .join('；')
      }`,
      `私人建造流转：自有 ${fmtNumber(load.privateOwn)} 点/月 + 国有流转 ${fmtNumber(load.privateRented + load.privateMarket)} 点/月（项目租用 ${fmtNumber(load.privateRented)}，市场 ${fmtNumber(load.privateMarket)}，租金 ${fmtMoney((load.privateRented + load.privateMarket) * CONSTRUCTION_RENT_PER_POINT)}）；${
        privateQueue.length === 0
          ? '无在建项目'
          : privateQueue
              .map(
                project =>
                  `${BUILDINGS[project.building].name}×${project.count}（工程量 ${fmtNumber(projectWorkload(project) * (1 - project.progress))}/${fmtNumber(projectWorkload(project))} 点，进度 ${Math.round(project.progress * 100)}%，自有 ${fmtNumber(load.privateByProject[project.id]?.own ?? 0)}，租用 ${fmtNumber(load.privateByProject[project.id]?.rented ?? 0)} 点/月）`,
              )
              .join('；')
      }`,
      `秘书委托：内政${world.secretary.delegation.internal ? '开' : '关'}，外交${world.secretary.delegation.diplomacy ? '开' : '关'}${world.secretary.lastReport === '' ? '' : `｜上次报告：${world.secretary.lastReport.slice(0, 200)}`}`,
      `国策修正：${player.modifiers.length === 0 ? '无' : player.modifiers.map(modifier => modifier.label).join('、')}`,
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
        `- ${war.name}（目标：${WAR_GOAL_NAMES[war.goal]}）：${war.attackers.join(',')} vs ${war.defenders.join(',')}，分数 ${Math.round(war.warScore)}，${war.lastEvent}`,
      )
    }
  }
  const situation = situationStatus(world)
  if (situation !== '') lines.push('', situation)
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
    '2. 玩家用自然语言下达命令时，先判断意图，再调用对应工具：v3_action（内政/建造/税收/征兵/法案）、v3_policy（提出政策并施加 buff/debuff）、v3_diplomacy（外交/宣战/停战）、v3_event（处理事件）、v3_advance（批准推进一月；months>1 视为托管）。',
    '3. 玩家与某国领袖交谈时，用该领袖的第一人称口吻回应，体现其人格、特质与议程；随后调用 v3_leader 记录这次交流（可带上 mood / relation 调整）。',
    '4. 时间按月推进：每月停在御前会议，只有玩家批准或托管后才推进；绝不要自行推进。',
    '5. 月度秘书是独立子代理（玩家用 /v3 secretary 召见）。你可以解读它的报告，但不要假装自己执行了它的计划。',
    '6. 回复使用中文，简洁但有画面感；重大转折可以引用编年史。',
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

// Time moves only when the player approves an advance or delegates a run.
let isAdvancing = false

async function refreshStatus($: EngineInterface): Promise<void> {
  const world = await getWorld($)
  const ui = await getUi($)
  if (world === undefined || !ui.isActive) {
    $.ui.status(undefined)
    return
  }
  const council = ui.council?.isOpen === true ? ' · 待议' : ' · 已批'
  $.ui.status(`${statusLine(world)}${council}`)
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

/**
 * The crisis arbiter's completer: one cheap `$.model.complete` returning the
 * chosen result id, or '' on failure so the engine falls back deterministically
 * (plan §4.4). Mirrors engine/ai.ts's model call style.
 */
function arbiterCompleter(
  $: EngineInterface,
  world: WorldState,
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    try {
      const result = await $.model.complete({
        model: world.ai.model || 'haiku',
        prompt,
        maxTokens: 32,
        effort: 'low',
        timeoutMs: 15000,
      })
      return result.isAnswered ? result.text : ''
    } catch {
      return ''
    }
  }
}

async function advanceGame(
  $: EngineInterface,
  months: number,
  announce: boolean,
  openCouncil = true,
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
    // Settlement needs the async arbiter, so it runs here, right after the tick
    // that aged the situation (plan §4.4); the engine tick only opens/counts.
    const situationLog: LogEntry[] = []
    await settleDueSituations(world, arbiterCompleter($, world), rng, situationLog)
    if (situationLog.length > 0) {
      world.log.push(...situationLog)
      if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
    }
    if (notes.length > 0) {
      const date = { ...world.date }
      for (const note of notes) world.log.push({ date, kind: 'leader', text: note })
      if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
    }

    let summary = summarize(report, months)
    const beforePlayer = current.world.countries[world.playerId]
    const afterPlayer = world.countries[world.playerId]
    if (beforePlayer !== undefined && afterPlayer !== undefined) {
      const delta = (now: number, before: number): string =>
        `${fmtNumber(now)}（${fmtSigned(now - before)}）`
      const atWar = world.wars.some(
        war =>
          war.attackers.includes(afterPlayer.id) ||
          war.defenders.includes(afterPlayer.id),
      )
      const ledger = fiscalLedger(afterPlayer, { atWar, tick: world.tick })
      const stock =
        ledger.debt > 0
          ? `国债 ${fmtNumber(ledger.debt)}`
          : `基金 ${fmtNumber(ledger.fund)}`
      summary += `\n本月：GDP ${delta(afterPlayer.econ.gdp, beforePlayer.econ.gdp)}｜国库净资产 ${delta(afterPlayer.econ.treasury, beforePlayer.econ.treasury)}｜收入 ${fmtNumber(ledger.income.total)} 支出 ${fmtNumber(ledger.expense.total)} 净 ${fmtSigned(ledger.net)}｜失业 ${afterPlayer.econ.unemployment.toFixed(1)}%｜${stock}｜激进 ${Math.round(afterPlayer.pops.radicals)}`
      summary += `\n私人资本 ${fmtNumber(afterPlayer.econ.privateCapital)} · 投资信心 ${afterPlayer.econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(afterPlayer.econ.investmentConfidence)} · 资源 农${afterPlayer.econ.resources.farmland}/林${afterPlayer.econ.resources.timber}/煤${afterPlayer.econ.resources.coal}/铁${afterPlayer.econ.resources.iron}`
    }
    await setWorld($, world)
    await patchUi($, {
      isBusy: false,
      lastReport: summary,
      notice: aiError ?? '',
      council: {
        isOpen: openCouncil,
        report: summary,
        secretaryReport: '',
        isRunning: false,
      },
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
    return summary
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

/**
 * Spawns the secretary subagent and waits for its final answer, bounded by
 * the 240-second timeout. An empty answer means it did not report in time.
 */
async function askSecretary(
  $: EngineInterface,
  world: WorldState,
): Promise<{ text: string; isTimeout: boolean }> {
  const spawned = await $.agent.spawn({
    subagentType: SECRETARY_AGENT,
    prompt: monthlyBriefing(world),
    description: '月度秘书',
  })
  const agentId = spawned.agentId
  if (agentId === undefined) {
    return { text: '秘书未能受命', isTimeout: false }
  }
  const answer = await new Promise<string>(resolve => {
    let timer: { cancel: () => void } | undefined
    timer = $.clock.after(SECRETARY_TIMEOUT_MS, () => {
      secretaryAnswers.delete(agentId)
      resolve('')
    })
    secretaryAnswers.set(agentId, text => {
      timer?.cancel()
      resolve(text)
    })
  })
  return { text: answer, isTimeout: answer === '' }
}

/**
 * Starts a secretary turn without blocking the caller: the command and UI
 * hooks have a short budget, while the subagent may take up to 240 seconds.
 * The report lands later through finishSecretary.
 */
async function startSecretary($: EngineInterface): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。输入 /v3 new 开始一局。'
  if (isDelegatedRun) return '托管进行中，请等它结束再召见秘书。'
  if (current.world.secretary.isRunning || secretaryAnswers.size > 0) {
    return '秘书正在拟旨，请稍候。'
  }
  const world = clone(current.world)
  world.secretary.isRunning = true
  world.secretary.consecutiveOverreach = 0
  await setWorld($, world)
  await patchUi($, {
    notice: '秘书正在拟旨…',
    council: { ...current.ui.council, isRunning: true },
  })
  void finishSecretary($, world).catch(() => undefined)
  return '秘书已受命，正在拟旨；报告到达后会提示。'
}

/** Waits for the subagent's answer, then stores it and tells the player. */
async function finishSecretary(
  $: EngineInterface,
  briefingWorld: WorldState,
): Promise<void> {
  try {
    const answer = await askSecretary($, briefingWorld)
    // The subagent's tool calls wrote their own world; reload rather than
    // overwriting them with the pre-run copy. If the game was ended while the
    // secretary ran, drop the report instead of resurrecting the world.
    const latestWorld = await getWorld($)
    if (latestWorld === undefined) return
    const next = clone(latestWorld)
    const report = answer.isTimeout ? '秘书未按时呈报' : answer.text
    next.secretary.isRunning = false
    next.secretary.lastRunTick = next.tick
    next.secretary.lastReport = report
    if (!answer.isTimeout && report !== '') {
      next.log.push({
        date: { ...next.date },
        kind: 'politics',
        text: `[秘书] ${report.replace(/\s+/g, ' ').slice(0, 160)}`,
      })
      if (next.log.length > 400) next.log.splice(0, next.log.length - 400)
    }
    await setWorld($, next)
    await saveGame($, next).catch(() => undefined)
    await refreshStatus($)
    const ui = await getUi($)
    await patchUi($, {
      notice: answer.isTimeout ? '秘书未按时呈报' : '秘书已呈报，请审阅',
      council: { ...ui.council, secretaryReport: report, isRunning: false },
    })
    $.ui.toast(answer.isTimeout ? '秘书未按时呈报' : '秘书已呈报')
  } catch (error) {
    const latest = await activeWorld($)
    if (latest !== undefined) {
      const next = clone(latest.world)
      next.secretary.isRunning = false
      await setWorld($, next).catch(() => undefined)
    }
    const ui = await getUi($)
    await patchUi($, {
      notice: '秘书出错',
      council: { ...ui.council, isRunning: false },
    }).catch(() => undefined)
    $.ui.toast(`秘书出错：${String(error)}`)
  }
}

/**
 * Records a secretary overreach (advance, cheat, war, peace) in the chronicle
 * and tells the player. Per ADR 0001 the call itself still runs.
 */
async function auditOverreach(
  $: EngineInterface,
  action: string,
): Promise<boolean> {
  overreachDuringRun = true
  const current = await activeWorld($)
  if (current === undefined) return false
  const world = clone(current.world)
  const count = (world.secretary.consecutiveOverreach ?? 0) + 1
  world.secretary.consecutiveOverreach = count
  world.log.push({
    date: { ...world.date },
    kind: 'politics',
    text: `[秘书越权] ${action}（连续第 ${count} 次）`,
  })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  await setWorld($, world)
  await saveGame($, world).catch(() => undefined)
  const blocked = count > 3
  $.ui.toast(blocked ? `秘书连续越权，${action}已被拒绝` : `秘书越权：${action}`)
  await patchUi($, {
    notice: blocked ? `秘书连续越权，${action}已被拒绝` : `秘书越权：${action}`,
  })
  return blocked
}

async function controlGame($: EngineInterface, action: ControlAction): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  const world = clone(current.world)

  if (action === 'next') {
    if (isDelegatedRun) return '托管进行中，请等它结束。'
    return advanceGame($, 1, true)
  }

  if (action === 'council') {
    await patchUi($, { tab: 'council' })
    await openPane($)
    return '已打开御前议事。'
  }

  world.resumeOnStart = true
  await setWorld($, world)
  const path = await saveGame($, world).catch(() => '（保存失败）')
  $.ui.toast('已保存')
  return `已保存到 ${path}`
}

// Set by auditOverreach when the secretary oversteps during a managed run.
let overreachDuringRun = false

/**
 * Why a managed run should stop after the month that just passed, or '' to
 * keep going. Plan §4.5; the historical-agenda check waits for agenda data.
 */
function interruptReason(before: WorldState, after: WorldState): string {
  const reason = councilInterrupt(before, after)
  if (reason !== '') return reason
  if (overreachDuringRun) return '秘书越权'
  return ''
}

let isDelegatedRun = false

/**
 * Starts a managed run and returns at once. The monthly loop continues in
 * the background (command hooks have a short budget; a run may take minutes).
 */
async function startDelegated($: EngineInterface, months: number): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  if (isDelegatedRun) return '已有托管在进行中，请等它结束。'
  if (pendingOf(current.world).length > 0) return '先处理待决事件，再开始托管。'
  if (current.world.secretary.isRunning || secretaryAnswers.size > 0) {
    return '秘书正在拟旨，请等报告到达后再托管。'
  }
  const total = clamp(Number.isFinite(months) ? Math.round(months) : 1, 1, 12)
  overreachDuringRun = false
  isDelegatedRun = true
  await patchUi($, {
    council: { ...current.ui.council, isOpen: false, isRunning: true },
    notice: `托管中：最多 ${total} 个月`,
  })
  void runDelegated($, total).catch(() => {
    isDelegatedRun = false
  })
  return `托管已开始：最多 ${total} 个月；遇待决事件、战争或秘书越权会停下并提示。`
}

async function runDelegated($: EngineInterface, total: number): Promise<void> {
  try {
    let advancedCount = 0
    let reason = ''
    for (let index = 0; index < total; index += 1) {
      const before = await activeWorld($)
      if (before === undefined) break
      const snapshot = clone(before.world)
      const summary = await advanceGame($, 1, false, false)
      if (!summary.startsWith('推进 ')) {
        reason = summary
        break
      }
      advancedCount += 1
      const after = await activeWorld($)
      if (after === undefined) break
      reason = interruptReason(snapshot, after.world)
      if (reason !== '') break
    }

    const latest = await activeWorld($)
    if (latest === undefined) return
    const lastReport = latest.ui.council.report
    const header =
      reason === ''
        ? `托管完成：推进 ${advancedCount} 个月`
        : `托管中断：推进 ${advancedCount} 个月后，因「${reason}」停下`
    const report = `${header}\n${lastReport}`
    await patchUi($, {
      council: {
        isOpen: true,
        report,
        secretaryReport: latest.ui.council.secretaryReport,
        isRunning: false,
      },
      notice: header,
    })
    await refreshStatus($)
    $.ui.toast(header)
  } finally {
    isDelegatedRun = false
  }
}

async function councilAction(
  $: EngineInterface,
  action: CouncilAction,
  value?: number,
): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  switch (action) {
    case 'approve': {
      if (isDelegatedRun) return '托管进行中，请等它结束。'
      await patchUi($, {
        council: { ...current.ui.council, isOpen: false },
      })
      return advanceGame($, 1, true)
    }
    case 'run':
      return startDelegated($, value ?? current.world.secretary.delegation.months)
    case 'recompose':
      return startSecretary($)
    case 'delegate-internal': {
      const world = clone(current.world)
      world.secretary.delegation.internal = !world.secretary.delegation.internal
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      $.ui.toast(`内政委托已${world.secretary.delegation.internal ? '开启' : '关闭'}`)
      return 'ok'
    }
    case 'delegate-diplomacy': {
      const world = clone(current.world)
      world.secretary.delegation.diplomacy = !world.secretary.delegation.diplomacy
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      $.ui.toast(`外交委托已${world.secretary.delegation.diplomacy ? '开启' : '关闭'}`)
      return 'ok'
    }
    case 'months': {
      const world = clone(current.world)
      world.secretary.delegation.months = clamp(Math.round(value ?? 1), 1, 12)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      return 'ok'
    }
    default:
      return 'ok'
  }
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
    name: 'v3_inspect',
    description:
      '终末传奇：只读明细查询。section 取 economy（GDP 分解/物价/缺口）、market（商品市场供需与对外贸易/伙伴）、fiscal（收支/债务/税率）、labor（失业分解/工资）、trade（分商品进出口/伙伴）、construction（建造力/队列/租金）、military（军力/战争）、history（近 12 个月序列）。遇到“为什么变了”先用它，不要读存档或源码。',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: [
            'economy',
            'market',
            'fiscal',
            'labor',
            'trade',
            'construction',
            'military',
            'history',
          ],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'v3_forecast',
    description:
      '终末传奇：预估下月现金流（收入、支出、净额、结算后国库、建造力分配与租金）。它是计划值，遇贸易/事件会偏移。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'v3_advance',
    description:
      '终末传奇：批准并推进一个月（打开下一次御前会议）。months>1 启动后台托管并立即返回，遇待决事件、新的战争/战争结束、秘书越权即中断。会先让各国 AI 领袖做决策，再确定性模拟经济、人口、科技、外交与战争。仅玩家可调用；秘书调用会被审计。',
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
    name: 'v3_cheat',
    description:
      '终末传奇（天命）：修改玩家国家的金钱、科技点、建筑、关系、战争分数、日期，或触发事件、更换领袖、施加修正、立即完成国有建造队列。铁人模式下拒绝。action 取值：treasury（amount）、techPoints（amount）、building（building/count）、finishProjects（完成全部国有在建项目）、relations（country/amount）、warScore（country/amount）、date（year/month）、event（kind 可选）、leader（name/title/persona）、modifier（stat/stack/value/months/label）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'treasury',
            'techPoints',
            'building',
            'finishProjects',
            'relations',
            'warScore',
            'date',
            'event',
            'leader',
            'modifier',
          ],
        },
        amount: { type: 'number' },
        building: {
          type: 'string',
          enum: [
            'farms',
            'mines',
            'factories',
            'railroads',
            'ports',
            'universities',
            'barracks',
            'offices',
            'workshops',
          ],
        },
        count: { type: 'integer', minimum: -20, maximum: 20 },
        country: { type: 'string' },
        year: { type: 'integer', minimum: 1800, maximum: 2200 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        kind: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string' },
        persona: { type: 'string' },
        stat: { type: 'string', description: 'modifier 时必填，例如 production / income / radicals。' },
        stack: { type: 'string', enum: ['flat', 'percent', 'multiply'] },
        value: { type: 'number' },
        months: { type: 'integer', minimum: 0, maximum: 240 },
        label: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_action',
    description:
      '终末传奇：对玩家国家执行一项内政行动。action 取值：build（建造，需 building/count）、cancel（取消国有项目，需 projectId）、tax（税率，需 rate）、tariff（关税：rate 为进口税率，可选 exportRate 单独设出口税率；省略则进出口同率）、spending（支出，需 category/amount）、research（研究方向，需 tech）、conscript（征兵，需 amount）、law（法案，需 name）、route（贸易路线：op 取 open/raise/lower/close，需 good 与 partner）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'build',
            'cancel',
            'tax',
            'tariff',
            'spending',
            'research',
            'conscript',
            'law',
            'route',
          ],
        },
        projectId: { type: 'string', description: 'cancel 时必填，建造队列中的项目 id。' },
        building: {
          type: 'string',
          enum: [
            'farms',
            'mines',
            'factories',
            'railroads',
            'ports',
            'universities',
            'barracks',
            'offices',
            'workshops',
          ],
          description: 'build 时必填。',
        },
        count: { type: 'integer', minimum: 1, maximum: 5 },
        rate: { type: 'number', minimum: 0, maximum: 60, description: '进口关税税率（tariff 时）。' },
        exportRate: {
          type: 'number',
          minimum: 0,
          maximum: 60,
          description: '出口关税税率（可选；省略则与进口同率）。',
        },
        category: {
          type: 'string',
          enum: ['army', 'navy', 'bureaucracy', 'education', 'welfare', 'construction'],
        },
        amount: { type: 'number', minimum: 0, maximum: 50 },
        tech: { type: 'string' },
        op: {
          type: 'string',
          enum: ['open', 'raise', 'lower', 'close'],
          description: 'route 时必填：开通 / 提升 / 降低 / 关闭航线。',
        },
        good: { type: 'string', enum: [...GOOD_IDS], description: 'route 时必填，可贸易商品。' },
        partner: { type: 'string', description: 'route 时必填，伙伴国家 id（如 GBR）。' },
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
    name: 'v3_policy',
    description:
      '终末传奇：提交一项政策提议。政策由若干效果条目组成，每条把某个数值入口加上 buff/debuff；引擎校验单位与数值后按叠算规则结算，并消耗权威（默认 5，最多 40）。效果条目字段：stat（修正对象）、stack（flat/percent/multiply，默认 flat）、value、months（可选，持续月数）、label（可选）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '政策名称，例如「重商主义」。' },
        description: { type: 'string' },
        authorityCost: { type: 'integer', minimum: 0, maximum: 40 },
        effects: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              stat: { type: 'string', enum: MODIFIER_STATS },
              stack: { type: 'string', enum: ['flat', 'percent', 'multiply'] },
              value: { type: 'number' },
              months: { type: 'integer', minimum: 1, maximum: 240 },
              label: { type: 'string' },
            },
            required: ['stat', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'effects'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_diplomacy',
    description:
      '终末传奇：执行外交行动。move 取值：improve（改善关系）、insult（交恶）、alliance（结盟）、rival（设为对手）、gift（赠礼）、war（宣战）、peace（停战；本方获胜时可用 indemnityTotal/indemnityMonths 声明赔款总额与最长分期月数）、embargo（禁运，可选定商品与月数）、unembargo（解除禁运）、tension（就敏感商品施加贸易张力）。target 是国家代码，例如 GBR、RUS、QING。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '目标国家代码，如 GBR。' },
        move: {
          type: 'string',
          enum: [
            'improve',
            'insult',
            'alliance',
            'rival',
            'gift',
            'war',
            'peace',
            'embargo',
            'unembargo',
            'tension',
          ],
        },
        amount: {
          type: 'number',
          minimum: -10,
          maximum: 30,
          description: 'improve/gift 的幅度；tension 时也可用作关系张力（-10..10）。',
        },
        good: {
          type: 'string',
          enum: [...GOOD_IDS],
          description: 'embargo/unembargo/tension 的商品；tension 仅限 opium/arms/grain。',
        },
        months: {
          type: 'number',
          minimum: 1,
          maximum: 60,
          description: 'embargo 的持续月数，缺省为永久。',
        },
        relationDelta: {
          type: 'number',
          minimum: -10,
          maximum: 10,
          description: 'tension 的关系张力（-10..10）。',
        },
        reason: { type: 'string', description: '宣战/禁运/张力的理由，可选。' },
        goal: {
          type: 'string',
          enum: ['reparations', 'openMarket', 'sphere', 'humiliation'],
          description: 'war 的战争目标，决定停战时的和约条款；缺省 reparations。',
        },
        indemnityTotal: {
          type: 'number',
          minimum: 0,
          maximum: 100000,
          description:
            'peace 且本方获胜时的赔款总额（金）；缺省为败方 GDP 的 10%，上限为败方 GDP 的 2 倍。败方自行决定一次付清多少、余款分几期。',
        },
        indemnityMonths: {
          type: 'number',
          minimum: 1,
          maximum: 240,
          description: 'peace 时允许的最长分期月数；缺省 60（5 年）。',
        },
      },
      required: ['target', 'move'],
      additionalProperties: false,
    },
  },
  {
    name: 'v3_situation',
    description:
      '终末传奇：就当前开启的局势（如鸦片危机）提交立场。action=submit 需要 stance（crackdown 禁烟 / compromise 妥协 / war 开战 / aid 求援 / neutral 观望）与 narrative（一句叙事）；action=abstain 表示弃权观望。提案只作仲裁上下文，不直接落账。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['submit', 'abstain'] },
        stance: { type: 'string', enum: [...SITUATION_STANCES] },
        narrative: { type: 'string', description: '一句提案叙事，submit 时必填。' },
      },
      required: ['action'],
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

  // ------------------------------------------------------------ session

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'v3',
      description: '终末传奇：维多利亚式大战略模拟（新游戏 / 推进 / 面板 / 事件 / 存档）',
      argumentHint: '[new|next|run|council|secretary|delegate|panel|status|events|save|load|play|end|help]',
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
  on('agent.offer', { agent: SECRETARY_AGENT }, () => ({ isOffered: false }))

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

  on('command.run', { command: 'v3' }, async ($, e) => {
    const parts = e.args.trim().split(/\s+/).filter(part => part !== '')
    const sub = (parts[0] ?? 'status').toLowerCase()

    const current = await activeWorld($)

    try {
      switch (sub) {
        case 'new': {
          if (isDelegatedRun) return { text: '托管进行中，请等它结束再开新局。' }
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
          if (isDelegatedRun) return { text: '托管进行中，请等它结束。' }
          return { text: await advanceGame($, 1, true) }
        }

        case 'run': {
          if (current === undefined) return { text: '还没有进行中的游戏。' }
          const months = clamp(Math.floor(Number(parts[1] ?? current.world.secretary.delegation.months)), 1, 12)
          return { text: await startDelegated($, months) }
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
          if (isDelegatedRun) return { text: '托管进行中，请等它结束再切换国家。' }
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
          if (isDelegatedRun) return { text: '托管进行中，请等它结束再读取存档。' }
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

  on('tool.call', { tool: 'mcp__terminal-legend__v3_inspect' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const section =
        typeof args.section === 'string' ? args.section : 'economy'
      return toolOk(inspectWorld(current.world, section))
    } catch (error) {
      return toolFail(`明细查询失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_forecast' }, async $ => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      return toolOk(forecastWorld(current.world))
    } catch (error) {
      return toolFail(`预估失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_advance' }, async ($, e) => {
    try {
      if (e.agentId !== undefined && (await auditOverreach($, '推进时间'))) {
        return toolFail('秘书连续越权，推进时间的请求已被拒绝。')
      }
      const args = e as unknown as Args
      const months = clamp(Math.floor(Number(args.months ?? 1)), 1, 24)
      if (isDelegatedRun) return toolFail('托管进行中，请等它结束。')
      if (months <= 1) return toolOk(await advanceGame($, 1, true))
      return toolOk(await startDelegated($, months))
    } catch (error) {
      return toolFail(`推进失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_cheat' }, async ($, e) => {
    try {
      if (e.agentId !== undefined && (await auditOverreach($, '使用天命'))) {
        return toolFail('秘书连续越权，天命的请求已被拒绝。')
      }
      // Read after the audit: the audit writes the incremented counter.
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const params: CheatParams = { action: String(args.action ?? '') }
      for (const key of [
        'building',
        'count',
        'country',
        'amount',
        'year',
        'month',
        'kind',
        'name',
        'title',
        'persona',
        'stat',
        'stack',
        'value',
        'months',
        'label',
        'id',
      ]) {
        const value = args[key]
        if (typeof value === 'string' || typeof value === 'number') params[key] = value
      }
      const world = clone(current.world)
      const result = applyCheat(world, params)
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      await patchUi($, { notice: result.text })
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`天命失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_action' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const world = clone(current.world)
      const params: Record<string, string | number | boolean | undefined> = {}
      for (const key of [
        'building',
        'count',
        'rate',
        'exportRate',
        'category',
        'amount',
        'tech',
        'name',
        'projectId',
        'op',
        'good',
        'partner',
      ]) {
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

  on('tool.call', { tool: 'mcp__terminal-legend__v3_policy' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const args = e as unknown as Args
      const rawEffects = (args as { effects?: unknown }).effects
      const proposal: PolicyProposal = {
        name: String(args.name ?? ''),
        description: typeof args.description === 'string' ? args.description : undefined,
        authorityCost:
          typeof args.authorityCost === 'number' ? args.authorityCost : undefined,
        effects: Array.isArray(rawEffects)
          ? (rawEffects as PolicyProposal['effects'])
          : [],
      }
      const world = clone(current.world)
      const result = applyPolicy(world, world.playerId, proposal)
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      await patchUi($, { notice: result.text })
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`政策失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_diplomacy' }, async ($, e) => {
    try {
      const args = e as unknown as Args
      const move = String(args.move ?? '')
      if (e.agentId !== undefined && (move === 'war' || move === 'peace')) {
        const blocked = await auditOverreach($, move === 'war' ? '宣战' : '停战')
        if (blocked) return toolFail('秘书连续越权，宣战/停战的请求已被拒绝。')
      }
      // Read after the audit: the audit writes the incremented counter.
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const world = clone(current.world)
      const params: Record<string, string | number | boolean | undefined> = {
        target: String(args.target ?? '').toUpperCase(),
        move,
      }
      if (typeof args.amount === 'number') params.amount = args.amount
      if (typeof args.good === 'string') params.good = args.good
      if (typeof args.months === 'number') params.months = args.months
      if (typeof args.relationDelta === 'number') params.relationDelta = args.relationDelta
      if (typeof args.reason === 'string') params.reason = args.reason
      if (typeof args.goal === 'string') params.goal = args.goal
      if (typeof args.indemnityTotal === 'number') {
        params.indemnityTotal = args.indemnityTotal
      }
      if (typeof args.indemnityMonths === 'number') {
        params.indemnityMonths = args.indemnityMonths
      }
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

  on('tool.call', { tool: 'mcp__terminal-legend__v3_situation' }, async ($, e) => {
    try {
      const current = await activeWorld($)
      if (current === undefined) return toolFail('还没有进行中的游戏。')
      const world = clone(current.world)
      // The secretary may propose only under diplomacy authorisation (plan §4.2);
      // war and peace stay the player's, which the diplomacy handler audits.
      if (e.agentId !== undefined && !world.secretary.delegation.diplomacy) {
        return toolFail('外交未授权，秘书不能提交局势提案。')
      }
      const args = e as unknown as Args
      const action = String(args.action ?? 'submit')
      const stance = action === 'abstain' ? 'neutral' : String(args.stance ?? '')
      const narrative = action === 'abstain' ? '弃权观望' : String(args.narrative ?? '')
      const result = recordSituationProposal(world, world.playerId, stance, narrative)
      if (!result.ok) return toolFail(result.text)
      await setWorld($, world)
      await saveGame($, world).catch(() => undefined)
      await refreshStatus($)
      await patchUi($, { notice: result.text })
      return toolOk(result.text)
    } catch (error) {
      return toolFail(`局势提案失败：${String(error)}`)
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
      if (current.world.ironman && name !== undefined) {
        return toolFail('铁人模式只保留自动存档，不能命名存档。')
      }
      const path = await saveGame($, current.world, name)
      return toolOk(`已保存到 ${path}`)
    } catch (error) {
      return toolFail(`保存失败：${String(error)}`)
    }
  })

  on('tool.call', { tool: 'mcp__terminal-legend__v3_play' }, async ($, e) => {
    try {
      if (isDelegatedRun) return toolFail('托管进行中，请等它结束再切换国家。')
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
        council={current.ui.council}
        onCouncil={(action, value) => {
          void councilAction($, action, value)
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
        council={current.ui.council}
        onCouncil={(action, value) => {
          void councilAction($, action, value)
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
