import type { EngineInterface } from 'claude-code'
import type { Country, GameDate, SituationStance, WorldState } from '../types'
import { BUILDING_IDS, GOODS, GOOD_IDS, SPENDING, WAR_GOAL_NAMES, techName } from './data'

import { nationalDebt, sovereignFund } from './fiscal'
import type { Rng } from './rng'
import { SENSITIVE_GOODS, randomDecision, type Decision } from './sim'
import { SITUATION_STANCES } from './situations'

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
- action 只能是：build, tax, tariff, spending, research, conscript, law, diplomacy, invest, situation。
- build 的 building 只能是：farms, mines, factories, railroads, ports, universities, barracks, offices；params.count 为 1..20 的数字。官署提供行政能力与官僚上限。
- tax/tariff 用 params.rate（0..60）；spending 用 params.category（army/navy/bureaucracy/education/welfare/construction）与 params.amount（0..50）；数值必须是 JSON 数字，不能写成字符串。
- invest 调整投资信心：params.amount 取 -3..3，结果被限制在该国基准上下 10 点内。
- diplomacy 需要 params.target（国家代码）与 params.move（improve, insult, alliance, rival, gift, war, peace, embargo, unembargo, tension）。
  - embargo/unembargo 可选 params.good（商品代码，缺省=全部）与 params.months（1..60，缺省=永久）。
  - war 可选 params.goal（reparations=赔款, openMarket=开放市场, sphere=势力范围, humiliation=威望羞辱，缺省=reparations），决定停战时的和约条款。
  - tension 需要 params.good（只能取 opium/arms/grain）与 params.relationDelta（-10..10），表示对 target 的关系张力。
- situation 只在鸦片危机等局势开启、本国为参与方时提交：params.stance（crackdown=禁烟, compromise=妥协, war=开战, aid=求援, neutral=观望）与 params.narrative（一句叙事，必填）。提案只用于仲裁，不直接生效。
- law 的 name 只能是：教育改革, 福利改革, 自由贸易, 保护关税, 征兵制, 宗教宽容。
- 贸易简报给出各国贸易收支、Top-3 伙伴、鸦片进口、关税收入与资源进口；禁运与战争会切断对应贸易，若被禁运应寻找替代伙伴。
- 每月为每个 AI 国家给出一次决策；行动要服从领袖的人格、当前财政与国内稳定；不要凭空创造数值。
- GDP 是月度支出法流量（消费+投资+政府），价格与资源乘数会影响产能。`

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

/** Top-3 trade partners by this month's bilateral value (plan §6: not Top-6). */
function topPartners(country: Country): string {
  const value = new Map<string, number>()
  for (const flow of country.trade.exports) value.set(flow.to, (value.get(flow.to) ?? 0) + flow.value)
  for (const flow of country.trade.imports) value.set(flow.from, (value.get(flow.from) ?? 0) + flow.value)
  const rows = [...value.entries()].sort(
    ([a, av], [b, bv]) => bv - av || (a < b ? -1 : a > b ? 1 : 0),
  )
  return rows.slice(0, 3).map(([id, amount]) => `${id}(${n1(amount)})`).join(' ') || '无'
}

/** This month's opium imports, the number the crisis trigger reads (plan §4.1). */
function opiumImports(country: Country): number {
  let total = 0
  for (const flow of country.trade.imports) if (flow.good === 'opium') total += flow.quantity
  return total
}

function countryLine(country: Country, world: WorldState): string {
  const surplus = country.econ.income - country.econ.expense
  const debt = nationalDebt(country)
  const fund = sovereignFund(country)
  const war = world.wars.some(
    one => one.attackers.includes(country.id) || one.defenders.includes(country.id),
  )
  return [
    `${country.id}=${country.name}`,
    `领袖:${country.leader.name}(${country.leader.traits.join(',')})`,
    `议程:${country.leader.agenda}`,
    `情绪:${Math.round(country.leader.mood)}`,
    `净资产:${n1(country.econ.treasury)}金(${debt > 0 ? `国债${n1(debt)}` : `基金${n1(fund)}`})`,
    `债务率:${n1(debt / Math.max(1, country.econ.gdp))}`,
    `赔款:付${n1(country.econ.reparationsPaid)}/收${n1(country.econ.reparationsReceived)}`,
    `GDP:${n1(country.econ.gdp)}金/月(消费${n1(country.econ.gdpComponents.c)}/投资${n1(country.econ.gdpComponents.i)}/政府${n1(country.econ.gdpComponents.g)})`,
    `税:${country.econ.taxRate}%关税:${country.econ.tariff}%`,
    `支出:陆${n1(country.econ.spending.army)}/海${n1(country.econ.spending.navy)}/官${n1(country.econ.spending.bureaucracy)}/教${n1(country.econ.spending.education)}/福${n1(country.econ.spending.welfare)}/建${n1(country.econ.spending.construction)}`,
    `在建:${country.econ.constructionQueue.length}(上月实付${n1(country.econ.lastStateConstructionSpend)})`,
    `建筑:农场${country.econ.buildings.farms}/矿${country.econ.buildings.mines}/工厂${country.econ.buildings.factories}/铁路${country.econ.buildings.railroads}/官署${country.econ.buildings.offices}`,
    `权威:${Math.round(country.government.authority)}人力:${n1(country.military.manpower)}`,
    `私人资本:${n1(country.econ.privateCapital)}金`,
    `投资信心:${Math.round(country.econ.investmentConfidence)}`,
    `失业:${n1(country.econ.unemployment)}%`,
    `劳动份额:${Math.round(country.econ.laborShare * 100)}%`,
    `资源:农${country.econ.resources.farmland}/林${country.econ.resources.timber}/煤${country.econ.resources.coal}/铁${country.econ.resources.iron}`,
    `贸易:出口${n1(country.econ.lastExportRevenue)}/进口${n1(country.econ.lastImportBill)}/净${n1(country.econ.lastTradeBalance)}/关税${n1(country.econ.lastTariffRevenue)}`,
    `伙伴Top3:${topPartners(country)}`,
    `鸦片进口:${n1(opiumImports(country))}资源进口:煤${n1(country.econ.resourceImports.coal)}/铁${n1(country.econ.resourceImports.iron)}/木${n1(country.econ.resourceImports.timber)}`,
    `合法性:${Math.round(country.government.legitimacy)}`,
    `激进:${Math.round(country.pops.radicals)}`,
    `生活:${Math.round(country.pops.sol)}`,
    `陆军:${n1(country.military.army)}`,
    `海军:${n1(country.military.navy)}`,
    `科技:${country.tech.level}`,
    `月盈余:${surplus >= 0 ? '+' : ''}${n1(surplus)}金/月`,
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
  const recent = world.log.slice(-16)
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
  'invest',
  'situation',
])

const LAWS = new Set([
  '教育改革',
  '福利改革',
  '自由贸易',
  '保护关税',
  '征兵制',
  '宗教宽容',
])

const DIPLOMACY_MOVES = new Set([
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
])

/** Rejects malformed model output before it can shadow the fallback. */
function validParams(
  action: string,
  params: Record<string, string | number | boolean | undefined>,
  world: WorldState,
  countryId: string,
): boolean {
  const finite = (value: unknown, min: number, max: number): boolean => {
    if (value === undefined) return true
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= min && parsed <= max
  }
  switch (action) {
    case 'build':
      return (
        (BUILDING_IDS as string[]).includes(String(params.building ?? '')) &&
        finite(params.count, 1, 20)
      )
    case 'tax':
    case 'tariff':
      return finite(params.rate, 0, 60)
    case 'spending':
      return (
        Object.prototype.hasOwnProperty.call(SPENDING, String(params.category ?? '')) &&
        finite(params.amount, 0, 50)
      )
    case 'law':
      return LAWS.has(String(params.name ?? ''))
    case 'conscript':
      return finite(params.amount, 1, 20)
    case 'diplomacy': {
      const target = String(params.target ?? '')
      const move = String(params.move ?? '')
      if (world.countries[target] === undefined || target === countryId) return false
      if (!DIPLOMACY_MOVES.has(move)) return false
      // A war goal is optional (defaults to reparations) but must be known.
      if (
        move === 'war' &&
        params.goal !== undefined &&
        !(Object.keys(WAR_GOAL_NAMES) as string[]).includes(String(params.goal))
      ) {
        return false
      }
      const knownGood = (value: unknown): boolean => {
        const id = String(value ?? '')
        return (GOOD_IDS as readonly string[]).includes(id)
      }
      if (move === 'tension') {
        const good = String(params.good ?? '')
        if (!(SENSITIVE_GOODS as readonly string[]).includes(good)) return false
        const delta = Number(params.relationDelta ?? params.amount)
        return Number.isFinite(delta) && Math.abs(delta) <= 10
      }
      if (move === 'embargo') {
        if (params.good !== undefined && !knownGood(params.good)) return false
        return finite(params.months, 1, 60)
      }
      if (move === 'unembargo') {
        return params.good === undefined || knownGood(params.good)
      }
      return finite(params.amount, 1, 30)
    }
    case 'invest':
      return finite(params.amount, -3, 3)
    case 'situation': {
      if (!(SITUATION_STANCES as readonly string[]).includes(String(params.stance ?? ''))) {
        return false
      }
      return typeof params.narrative === 'string' && params.narrative.trim() !== ''
    }
    default:
      return true
  }
}

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
    const params = coerceParams(raw.params)
    if (!validParams(action, params, world, countryId)) continue
    seen.add(countryId)

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
      model: world.ai.model || 'haiku',
      system: SYSTEM,
      prompt: buildAiPrompt(world),
      // Ten leaders, each with an action, params and a short narrative;
      // 3000 leaves room for Chinese output without truncating the JSON.
      maxTokens: 3000,
      effort: 'low',
      // A `$` call in flight does not count against the hook's own budget, so
      // the model may take its time; the cap still bounds a stuck gateway.
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

  // Every AI country gets one decision: if the model skipped a country or
  // returned malformed output for it, the deterministic policy fills the gap.
  const decidedCountries = new Set(decisions.map(decision => decision.countryId))
  let fallbackCount = 0
  for (const country of candidates) {
    if (decidedCountries.has(country.id)) continue
    const fallback = randomDecision(world, country, rng)
    if (fallback !== undefined) {
      decisions.push(fallback)
      fallbackCount += 1
    }
  }
  if (fallbackCount > 0) {
    const suffix = `${fallbackCount} 国使用确定性政策兜底`
    error =
      error === undefined || error === '没有可执行的合法行动'
        ? suffix
        : `${error}；${suffix}`
  }

  if (shouldAsk) world.ai.lastDecisionTick = world.tick
  world.ai.lastError = error

  const notes = decisions
    .filter(decision => decision.narrative !== undefined)
    .map(decision => {
      const country = world.countries[decision.countryId]
      return `[${country?.flag ?? '?'}] ${country?.name ?? decision.countryId}：${decision.narrative}`
    })
  // Record countries that took no action, so a quiet month is explicit
  // rather than looking like a dropped batch entry.
  const decided = new Set(decisions.map(decision => decision.countryId))
  for (const country of candidates) {
    if (decided.has(country.id)) continue
    notes.push(`[${country.flag}] ${country.name}：按兵不动`)
  }

  return { decisions, notes, error }
}

export function describeWorldForNarrator(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return '（还没有进行中的游戏）'
  const lines: string[] = []
  lines.push(`日期 ${fmtDate(world.date)}｜玩家 ${player.name}`)
  const net = player.econ.income - player.econ.expense
  const debt = nationalDebt(player)
  const stock =
    debt > 0 ? `国债 ${n1(debt)}` : `主权基金 ${n1(sovereignFund(player))}`
  lines.push(
    `国库净资产 ${n1(player.econ.treasury)} 金（${net >= 0 ? '+' : ''}${n1(net)} 金/月，${stock}）｜GDP ${n1(player.econ.gdp)} 金/月（消费 ${n1(player.econ.gdpComponents.c)} / 投资 ${n1(player.econ.gdpComponents.i)} / 政府 ${n1(player.econ.gdpComponents.g)}）｜合法性 ${Math.round(player.government.legitimacy)}｜激进 ${Math.round(player.pops.radicals)}｜生活水平 ${Math.round(player.pops.sol)}`,
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
