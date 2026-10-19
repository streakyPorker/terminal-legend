import type { EngineInterface } from 'claude-code'
import type { Country, GameDate, WorldState } from '../types'
import { GOODS, GOOD_IDS, techName } from './data'

import type { Rng } from './rng'
import { randomDecision, type Decision } from './sim'

export type AiReport = {
  decisions: Decision[]
  notes: string[]
  error?: string
}

const SYSTEM = `你是 19 世纪大战略游戏的世界决策引擎。你为每个 AI 国家选择本月行动。
规则：
- 只输出一个 JSON 数组，不要输出解释、Markdown 或代码围栏。
- 每个元素形如 {"country":"GBR","action":"build","params":{"building":"factories","count":1},"narrative":"一句符合该领袖性格的行动描述"}
- 每个国家最多 1 条；只为他国（非玩家国）决策。
- action 只能是：build, tax, tariff, spending, research, conscript, law, diplomacy。
- build 的 building 只能是：farms, mines, factories, railroads, ports, universities, barracks。
- diplomacy 需要 params.target（国家代码）与 params.move（improve, insult, alliance, rival, gift, war, peace）。
- law 的 name 只能是：教育改革, 福利改革, 自由贸易, 保护关税, 征兵制, 宗教宽容。
- 行动要服从领袖的人格、当前财政与国内稳定；不要凭空创造数值。`

const fmtDate = (date: GameDate): string => `${date.year}年${date.month}月`

const n1 = (value: number): string => value.toFixed(1)

function topRelations(country: Country, world: WorldState): string {
  const rows = Object.values(world.countries)
    .filter(other => other.id !== country.id)
    .map(other => ({
      id: other.id,
      name: other.name,
      value: Math.round(country.diplo.relations[other.id] ?? 0),
    }))
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  return rows
    .slice(0, 5)
    .map(row => `${row.id}${row.value >= 0 ? '+' : ''}${row.value}`)
    .join(' ')
}

function countryLine(country: Country, world: WorldState): string {
  const surplus = country.econ.income - country.econ.expense
  const war = world.wars.some(
    one => one.attackers.includes(country.id) || one.defenders.includes(country.id),
  )
  return [
    `${country.id}=${country.name}`,
    `领袖:${country.leader.name}(${country.leader.traits.join(',')})`,
    `议程:${country.leader.agenda}`,
    `情绪:${Math.round(country.leader.mood)}`,
    `国库:${n1(country.econ.treasury)}`,
    `GDP:${n1(country.econ.gdp)}`,
    `合法性:${Math.round(country.government.legitimacy)}`,
    `激进:${Math.round(country.pops.radicals)}`,
    `生活:${Math.round(country.pops.sol)}`,
    `陆军:${n1(country.military.army)}`,
    `海军:${n1(country.military.navy)}`,
    `科技:${country.tech.level}`,
    `月盈余:${surplus >= 0 ? '+' : ''}${n1(surplus)}`,
    war ? '战争:是' : '战争:否',
    `关系:${topRelations(country, world)}`,
    country.leader.memory.length > 0
      ? `近事:${country.leader.memory.slice(-2).join('；')}`
      : '近事:无',
  ].join(' | ')
}

export function buildAiPrompt(world: WorldState): string {
  const player = world.countries[world.playerId]
  const lines: string[] = []
  lines.push(`日期：${fmtDate(world.date)}`)
  lines.push(`玩家：${player?.name ?? world.playerId}（${world.playerId}）`)
  lines.push('')
  lines.push('国家状态：')
  for (const country of Object.values(world.countries)) {
    if (country.isPlayer) continue
    if ((world.ai.suspended[country.id] ?? 0) > world.tick) continue
    lines.push(countryLine(country, world))
  }
  lines.push('')
  const recent = world.log.slice(-10)
  if (recent.length > 0) {
    lines.push('近期大事：')
    for (const entry of recent) lines.push(`- ${fmtDate(entry.date)} ${entry.text}`)
    lines.push('')
  }
  const wars = world.wars
  if (wars.length > 0) {
    lines.push('进行中的战争：')
    for (const war of wars) {
      lines.push(
        `- ${war.name}：${war.attackers.join(',')} vs ${war.defenders.join(',')}，战争分数 ${Math.round(war.warScore)}`,
      )
    }
    lines.push('')
  }
  lines.push('请输出本月各国行动的 JSON 数组。')
  return lines.join('\n')
}

type RawDecision = {
  country?: unknown
  action?: unknown
  params?: unknown
  narrative?: unknown
}

function coerceParams(raw: unknown): Record<string, string | number | boolean | undefined> {
  if (raw === null || typeof raw !== 'object') return {}
  const out: Record<string, string | number | boolean | undefined> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === undefined
    ) {
      out[key] = value
    }
  }
  return out
}

const ACTIONS = new Set([
  'build',
  'tax',
  'tariff',
  'spending',
  'research',
  'conscript',
  'law',
  'diplomacy',
])

function parseDecisions(
  text: string,
  world: WorldState,
): { decisions: Decision[]; error?: string } {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return { decisions: [], error: '模型没有返回 JSON 数组' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { decisions: [], error: 'JSON 解析失败' }
  }
  if (!Array.isArray(parsed)) return { decisions: [], error: '返回的不是数组' }

  const decisions: Decision[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as RawDecision
    const countryId = String(raw.country ?? '')
    const action = String(raw.action ?? '')
    const country = world.countries[countryId]
    if (country === undefined || country.isPlayer) continue
    if ((world.ai.suspended[countryId] ?? 0) > world.tick) continue
    if (!ACTIONS.has(action)) continue
    if (seen.has(countryId)) continue
    seen.add(countryId)

    const params = coerceParams(raw.params)
    if (action === 'diplomacy') {
      const target = String(params.target ?? '')
      if (world.countries[target] === undefined || target === countryId) continue
    }
    const narrative =
      typeof raw.narrative === 'string' && raw.narrative.trim() !== ''
        ? raw.narrative.trim().slice(0, 160)
        : undefined
    decisions.push({ countryId, action, params, narrative })
    if (decisions.length >= 12) break
  }
  if (decisions.length === 0) return { decisions, error: '没有可执行的合法行动' }
  return { decisions }
}

export async function decideForAi(
  $: EngineInterface,
  world: WorldState,
  rng: Rng,
): Promise<AiReport> {
  const candidates = Object.values(world.countries).filter(
    country => !country.isPlayer && (world.ai.suspended[country.id] ?? 0) <= world.tick,
  )

  let decisions: Decision[] = []
  let error: string | undefined

  const interval = Math.max(1, world.ai.intervalTicks ?? 3)
  const shouldAsk = world.tick === 0 || world.tick % interval === 0
  if (candidates.length > 0 && shouldAsk) {
    const result = await $.model.complete({
      model: world.auto.aiModel || 'haiku',
      system: SYSTEM,
      prompt: buildAiPrompt(world),
      maxTokens: 1200,
      effort: 'low',
      timeoutMs: 30000,
    })
    if (result.isAnswered) {
      const parsed = parseDecisions(result.text, world)
      decisions = parsed.decisions
      error = parsed.error
    } else {
      error = `模型未作答：${result.reason}`
    }
  } else if (candidates.length > 0) {
    error = '本轮使用确定性政策'
  }

  if (decisions.length === 0) {
    for (const country of candidates) {
      const fallback = randomDecision(world, country, rng)
      if (fallback !== undefined) decisions.push(fallback)
    }
    error = error ?? '使用确定性政策兜底'
  }

  if (shouldAsk) world.ai.lastDecisionTick = world.tick
  world.ai.lastError = error

  const notes = decisions
    .filter(decision => decision.narrative !== undefined)
    .map(decision => {
      const country = world.countries[decision.countryId]
      return `[${country?.flag ?? '?'}] ${country?.name ?? decision.countryId}：${decision.narrative}`
    })

  return { decisions, notes, error }
}

export function describeWorldForNarrator(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return '（还没有进行中的游戏）'
  const lines: string[] = []
  lines.push(`日期 ${fmtDate(world.date)}｜玩家 ${player.name}`)
  lines.push(
    `国库 ${n1(player.econ.treasury)}（${player.econ.income - player.econ.expense >= 0 ? '+' : ''}${n1(player.econ.income - player.econ.expense)}/月）｜GDP ${n1(player.econ.gdp)}｜合法性 ${Math.round(player.government.legitimacy)}｜激进 ${Math.round(player.pops.radicals)}｜生活水平 ${Math.round(player.pops.sol)}`,
  )
  lines.push(
    `人口 ${n1(player.pops.total)} 万｜识字率 ${Math.round(player.pops.literacy * 100)}%｜陆军 ${n1(player.military.army)} 万｜海军 ${n1(player.military.navy)}｜科技 ${player.tech.level}（${techName(player.tech.level)}）｜研究 ${player.tech.researching}`,
  )
  const goods = GOOD_IDS.slice(0, 6)
    .map(id => `${GOODS[id].name}${n1(player.econ.prices[id])}`)
    .join(' ')
  lines.push(`物价：${goods}`)
  const wars = world.wars
    .filter(war => war.attackers.includes(player.id) || war.defenders.includes(player.id))
    .map(war => `${war.name}(分数 ${Math.round(war.warScore)})`)
  lines.push(`战争：${wars.length > 0 ? wars.join('，') : '无'}`)
  const majors = Object.values(world.countries)
    .filter(country => country.isMajor && !country.isPlayer)
    .map(
      country =>
        `${country.name}(${country.id}) ${country.leader.title}${country.leader.name}：${country.leader.persona}`,
    )
  lines.push('主要列强领袖：')
  for (const line of majors) lines.push(`- ${line}`)
  return lines.join('\n')
}
