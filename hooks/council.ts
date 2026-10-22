import type { EngineInterface } from 'claude-code'
import type { ControlAction, ControlPayload, CouncilAction, GameEvent, LogEntry, WorldState } from '../types'
import { makeRngForWorld } from '../engine/data'
import { decideForAi } from '../engine/ai'
import {
  advance,
  applyDecision,
  applyEventOption,
  clamp,
  clone,
  councilInterrupt,
  randomDecision,
  type AdvanceReport,
  type Decision,
} from '../engine/sim'
import { saveGame } from '../engine/save'
import { fiscalLedger } from '../engine/fiscal'
import { monthlyBriefing } from '../engine/secretary'
import { settleDueSituations } from '../engine/situations'
import { generateLiveEvents } from '../engine/liveEvents'
import { EVENTS_MAX } from '../engine/config/balance'
import { fmtDate, fmtNumber, fmtSigned } from '../view/format'
import {
  LIVE_EVENT_TIMEOUT_MS,
  SECRETARY_AGENT,
  SECRETARY_TIMEOUT_MS,
  activeWorld,
  clearDelegatedStop,
  getUi,
  getWorld,
  isDelegatedRun,
  isDelegatedStopRequested,
  openPane,
  patchUi,
  pendingOf,
  refreshStatus,
  requestDelegatedStop,
  secretaryAnswers,
  setDelegatedRun,
  setWorld,
} from './internal'

// ---------------------------------------------------------------- engine plumbing

// Time moves only when the player approves an advance or delegates a run.
let isAdvancing = false

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

/**
 * Live-event generator completer: one blocking `$.model.complete` returning the
 * raw JSON, or '' on failure/timeout so the turn falls back to no AI event.
 * Mirrors `arbiterCompleter`; mockable by mocking `$.model.complete` in tests.
 */
function liveEventCompleter(
  $: EngineInterface,
  world: WorldState,
): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    try {
      const result = await $.model.complete({
        model: world.ai.model || 'haiku',
        prompt,
        maxTokens: 1200,
        effort: 'low',
        timeoutMs: LIVE_EVENT_TIMEOUT_MS,
      })
      return result.isAnswered ? result.text : ''
    } catch {
      return ''
    }
  }
}

/**
 * The post-`advance` seam (ADR 0025 §1): the engine scans each major power from
 * its own perspective and drives one bounded model call per subject through
 * `generateLiveEvents`, which returns validated `GameEvent`s for
 * `world.events`. Returns [] on any failure so the caller never has to branch;
 * never throws.
 */
async function generateTurnEvents(
  $: EngineInterface,
  world: WorldState,
): Promise<GameEvent[]> {
  return generateLiveEvents(world, liveEventCompleter($, world))
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

export async function advanceGame(
  $: EngineInterface,
  months: number,
  announce: boolean,
  openCouncil = true,
  // Delegated runs pass false: skipping generation there keeps a multi-month
  // run from stalling on one model call per month (ADR 0025 §7).
  allowLiveEvents = true,
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

    // Live events: engine picks salient topics, one blocking model call, strict
    // parse; accepted events join world.events so the council shows them and the
    // save records them (read never regenerates, ADR 0025 §5/§6).
    if (allowLiveEvents) {
      try {
        const generated = await generateTurnEvents($, world)
        if (generated.length > 0) {
          world.events.push(...generated)
          if (world.events.length > EVENTS_MAX) {
            world.events.splice(0, world.events.length - EVENTS_MAX)
          }
          for (const event of generated) {
            world.log.push({
              date: { ...world.date },
              kind: 'event',
              countryId: event.countryId,
              text: `[${world.countries[event.countryId]?.flag ?? ''}] 新事件：${event.title} — ${event.text}`,
            })
          }
          if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
        }
      } catch (error) {
        $.ui.log(`终末传奇：事件生成失败 ${String(error)}`, { to: 'debug' })
      }
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

export async function resolveEvent(
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
export async function startSecretary($: EngineInterface): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。输入 /v3 new 开始一局。'
  if (isDelegatedRun()) return '托管进行中，请等它结束再召见秘书。'
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
export async function auditOverreach(
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

/** Upper bound on slots a single build-panel order may queue (plan 0013). */
const MAX_SLOTS_PER_ORDER = 10

function orderParams(payload?: ControlPayload): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  if (payload?.projectId !== undefined) params.projectId = payload.projectId
  if (payload?.index !== undefined) params.index = payload.index
  if (payload?.position !== undefined) params.position = payload.position
  if (payload?.before !== undefined) params.before = payload.before
  return params
}

/** Applies one queue decision (cancel/reorder) from the build panel. */
async function panelDecision(
  $: EngineInterface,
  action: string,
  payload?: ControlPayload,
): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  if (isDelegatedRun()) return '托管进行中，请等它结束。'
  const world = clone(current.world)
  const result = applyDecision(
    world,
    { countryId: world.playerId, action, params: orderParams(payload) },
    makeRngForWorld(world),
  )
  if (!result.ok) return result.text
  await setWorld($, world)
  await saveGame($, world).catch(() => undefined)
  await refreshStatus($)
  await patchUi($, { notice: result.text })
  return result.text
}

/**
 * Queues `slots` (y) single entries of `perSlot` (x) buildings each — the `x*y`
 * order of plan 0013, equivalent to `y` successive `v3_action build` calls.
 * For `head` the slots keep their order by anchoring later ones after the first.
 */
async function panelBuild($: EngineInterface, payload?: ControlPayload): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  if (isDelegatedRun()) return '托管进行中，请等它结束。'
  const building = payload?.building
  if (building === undefined) return '请选择要建造的建筑。'
  const perSlot = clamp(Math.round(payload?.perSlot ?? 1), 1, 5)
  const slots = clamp(Math.round(payload?.slots ?? 1), 1, MAX_SLOTS_PER_ORDER)
  const world = clone(current.world)
  const rng = makeRngForWorld(world)
  let position: 'head' | 'tail' | 'before' | 'after' = payload?.position ?? 'tail'
  let before = payload?.before
  const texts: string[] = []
  for (let index = 0; index < slots; index += 1) {
    const known = new Set(world.econ.constructionQueue.map(project => project.id))
    const result = applyDecision(
      world,
      {
        countryId: world.playerId,
        action: 'build',
        params: { building, count: perSlot, position, ...(before === undefined ? {} : { before }) },
      },
      rng,
    )
    if (!result.ok) return [...texts, result.text].join('\n')
    texts.push(result.text)
    if (position === 'head') {
      const inserted = world.econ.constructionQueue.find(project => !known.has(project.id))
      if (inserted !== undefined) {
        position = 'after'
        before = inserted.id
      }
    }
  }
  await setWorld($, world)
  await saveGame($, world).catch(() => undefined)
  await refreshStatus($)
  const text = texts.join('\n')
  await patchUi($, { notice: text })
  return text
}

export async function controlGame(
  $: EngineInterface,
  action: ControlAction,
  payload?: ControlPayload,
): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'

  if (action === 'next') {
    if (isDelegatedRun()) return '托管进行中，请等它结束。'
    return advanceGame($, 1, true)
  }

  if (action === 'council') {
    await patchUi($, { tab: 'council' })
    await openPane($)
    return '已打开御前议事。'
  }

  if (action === 'build') return panelBuild($, payload)
  if (action === 'cancel') return panelDecision($, 'cancel', payload)
  if (action === 'reorder') return panelDecision($, 'reorder', payload)

  const world = clone(current.world)
  world.resumeOnStart = true
  await setWorld($, world)
  const path = await saveGame($, world).catch(() => '（保存失败）')
  $.ui.toast('已保存')
  return `已保存到 ${path}`
}

/** Requests the in-flight delegated run to stop after the current month (PT-039). */
export function stopDelegated($: EngineInterface): string {
  if (!isDelegatedRun()) return '当前没有正在进行的托管。'
  requestDelegatedStop()
  void patchUi($, { notice: '已请求停止托管，将在本月推进结束后停下…' }).catch(() => undefined)
  $.ui.toast('已请求停止托管')
  return '已请求停止托管，将在本月推进结束后停下。'
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

/**
 * Starts a managed run and returns at once. The monthly loop continues in
 * the background (command hooks have a short budget; a run may take minutes).
 */
export async function startDelegated($: EngineInterface, months: number): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  if (isDelegatedRun()) return '已有托管在进行中，请等它结束。'
  if (pendingOf(current.world).length > 0) return '先处理待决事件，再开始托管。'
  if (current.world.secretary.isRunning || secretaryAnswers.size > 0) {
    return '秘书正在拟旨，请等报告到达后再托管。'
  }
  const total = clamp(Number.isFinite(months) ? Math.round(months) : 1, 1, 12)
  overreachDuringRun = false
  clearDelegatedStop()
  setDelegatedRun(true)
  await patchUi($, {
    council: { ...current.ui.council, isOpen: false, isRunning: true },
    notice: `托管中：最多 ${total} 个月（/v3 stop 可随时停下）`,
  })
  void runDelegated($, total).catch(() => {
    setDelegatedRun(false)
  })
  return `托管已开始：最多 ${total} 个月；遇待决事件、战争或秘书越权会停下并提示，也可用 /v3 stop（或 v3_control stop）手动停止。`
}

async function runDelegated($: EngineInterface, total: number): Promise<void> {
  try {
    let advancedCount = 0
    let reason = ''
    for (let index = 0; index < total; index += 1) {
      if (isDelegatedStopRequested()) {
        reason = '手动停止'
        break
      }
      const before = await activeWorld($)
      if (before === undefined) break
      const snapshot = clone(before.world)
      const summary = await advanceGame($, 1, false, false, false)
      if (!summary.startsWith('推进 ')) {
        reason = summary
        break
      }
      advancedCount += 1
      const after = await activeWorld($)
      if (after === undefined) break
      reason = isDelegatedStopRequested() ? '手动停止' : interruptReason(snapshot, after.world)
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
    setDelegatedRun(false)
    clearDelegatedStop()
  }
}

export async function councilAction(
  $: EngineInterface,
  action: CouncilAction,
  value?: number,
): Promise<string> {
  const current = await activeWorld($)
  if (current === undefined) return '还没有进行中的游戏。'
  switch (action) {
    case 'approve': {
      if (isDelegatedRun()) return '托管进行中，请等它结束。'
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
