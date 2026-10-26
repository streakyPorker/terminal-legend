import type {
  Country,
  EventOption,
  GameEvent,
  ModifierStack,
  ModifierStat,
  WorldState,
} from '../types'
import { GOODS } from './data'
import { MODIFIER_STATS } from './modifiers'
import { clamp } from './internal'
import {
  LIVE_DEBT_RATIO_MIN,
  LIVE_EFFECT_CAPS as EFFECT_CAPS,
  LIVE_FAMINE_GRAIN,
  LIVE_FAMINE_SALIENCE,
  LIVE_FAMINE_SOL,
  LIVE_GDP_CHANGE_MIN,
  LIVE_GRAIN_DEVIATION_MIN,
  LIVE_INFAMY_SALIENCE_COEF,
  LIVE_LEGITIMACY_CENTER,
  LIVE_LEGITIMACY_STRESS_MIN,
  LIVE_LITERACY_TARGET,
  LIVE_MAX_EVENTS,
  LIVE_MAX_MODEL_CALLS,
  LIVE_MAX_MODIFIERS,
  LIVE_MAX_OPTIONS,
  LIVE_MAX_SUBJECTS,
  LIVE_MAX_TOPICS,
  LIVE_MODIFIER_LABEL_MAX,
  LIVE_MODIFIER_MONTHS_MAX as MODIFIER_MONTHS_MAX,
  LIVE_MODIFIER_VALUE_CAP as MODIFIER_VALUE_CAP,
  LIVE_NARRATIVE_PERSPECTIVES,
  LIVE_OPTION_ID_MAX,
  LIVE_OPTION_LABEL_MAX,
  LIVE_OPTION_RESULT_MAX,
  LIVE_PROMPT_RECENT_LOG,
  LIVE_PROMPT_RELATIONS_MAX,
  LIVE_RADICALS_MIN,
  LIVE_ROUTINE_INTERVAL_MONTHS,
  LIVE_SALIENCE_SCALE,
  LIVE_SOL_LOW,
  LIVE_TEXT_MAX,
  LIVE_TOPIC_COOLDOWN_MONTHS,
  LIVE_TITLE_MAX,
  LIVE_UNEMPLOYMENT_MIN,
  LIVE_WAR_SALIENCE,
} from './config/events'

/**
 * Live (per-turn, AI-generated) events: the pure engine half of plan 0010 /
 * ADR 0025. Nothing here calls a model or touches the host; the host seam
 * (`hooks/register.tsx`) feeds a prompt through `$.model.complete`, then runs
 * the reply through `parseLiveEventResponse` before it can reach `world.events`.
 *
 * Determinism: `salientTopics` and every validator below are pure functions of
 * the world state, so the same state always yields the same topics and the same
 * accept/reject decision. The model's non-determinism is confined to the text
 * it writes, which is persisted with the event (ADR 0025 §6).
 */

// ---------------------------------------------------------------- dimensions

/** The four scanning dimensions (ADR 0025 §2). */
export type LiveDimension = 'economy' | 'politics' | 'diplomacy' | 'livelihood'

/** Stable order: also the deterministic tie-break for equal salience. */
export const LIVE_DIMENSIONS: readonly LiveDimension[] = [
  'economy',
  'politics',
  'diplomacy',
  'livelihood',
]

export const DIMENSION_LABELS: Record<LiveDimension, string> = {
  economy: '经济',
  politics: '政治',
  diplomacy: '外交',
  livelihood: '民生',
}

/**
 * The 10 `EVENT_TEMPLATES` downgraded to a topic-direction catalogue (ADR 0025
 * §3): each template `kind` says which direction the LLM should write toward.
 * The live generator never spawns a template as a fixed event; the templates
 * only survive here as directions. `tests/live-events.test.ts` drift-guards
 * that every template kind is mapped.
 */
export const KIND_DIRECTIONS: Record<string, LiveDimension> = {
  harvest: 'economy',
  famine: 'economy',
  boom: 'economy',
  slump: 'economy',
  breakthrough: 'economy',
  revolution: 'politics',
  succession: 'politics',
  border: 'diplomacy',
  diplomatic: 'diplomacy',
  colony: 'diplomacy',
}

/** One salient topic the engine hands the LLM as a seed (ADR 0025 §2). */
export type SalientTopic = {
  dimension: LiveDimension
  /** Stable topic id, e.g. `livelihood:sol`. */
  key: string
  /** Non-negative salience; higher ranks first. */
  salience: number
  /** Short human-readable signal, e.g. `生活水平 28`. */
  note: string
}

type DimensionSignal = { salience: number; key: string; note: string }

const signal0 = (): DimensionSignal => ({ salience: 0, key: '', note: '' })

function grainDeviation(country: Country): number {
  const base = GOODS.grain.basePrice
  if (!(base > 0)) return 0
  const price = country.econ.prices.grain ?? base
  return Math.abs(price - base) / base
}

/**
 * Reads one dimension's strongest signal from the current state. Thresholds are
 * a first cut (plan 0010 §10 待定): deliberately blunt so a stable world stays
 * quiet and only a genuine condition produces a topic.
 */
function dimensionSignal(
  world: WorldState,
  country: Country,
  dimension: LiveDimension,
  grainDev: number,
): DimensionSignal {
  const signal = signal0()
  const keep = (candidate: DimensionSignal): void => {
    if (candidate.salience > signal.salience) {
      signal.salience = candidate.salience
      signal.key = candidate.key
      signal.note = candidate.note
    }
  }
  switch (dimension) {
    case 'economy': {
      if (grainDev > LIVE_GRAIN_DEVIATION_MIN) {
        const base = GOODS.grain.basePrice
        const price = country.econ.prices.grain ?? base
        keep({
          salience: grainDev * LIVE_SALIENCE_SCALE,
          key: 'economy:grain',
          note: `粮价 ${price.toFixed(2)}（基准 ${base.toFixed(2)}，偏离 ${Math.round(grainDev * LIVE_SALIENCE_SCALE)}%）`,
        })
      }
      const series = country.econ.history.gdp
      const last = series[series.length - 1]
      const prev = series[series.length - 2]
      if (prev !== undefined && last !== undefined && prev > 0) {
        const change = Math.abs(last - prev) / prev
        if (change > LIVE_GDP_CHANGE_MIN) {
          keep({
            salience: change * LIVE_SALIENCE_SCALE,
            key: 'economy:gdp',
            note: `GDP 环比${last >= prev ? '增长' : '下降'} ${Math.round(change * LIVE_SALIENCE_SCALE)}%`,
          })
        }
      }
      if (country.econ.unemployment > LIVE_UNEMPLOYMENT_MIN) {
        keep({
          salience: country.econ.unemployment - LIVE_UNEMPLOYMENT_MIN,
          key: 'economy:unemployment',
          note: `失业率 ${country.econ.unemployment.toFixed(1)}%`,
        })
      }
      break
    }
    case 'politics': {
      if (country.pops.radicals > LIVE_RADICALS_MIN) {
        keep({
          salience: country.pops.radicals - LIVE_RADICALS_MIN,
          key: 'politics:radicals',
          note: `激进 ${Math.round(country.pops.radicals)}`,
        })
      }
      const legitStress = Math.abs(country.government.legitimacy - LIVE_LEGITIMACY_CENTER)
      if (legitStress > LIVE_LEGITIMACY_STRESS_MIN) {
        keep({
          salience: legitStress,
          key: 'politics:legitimacy',
          note: `合法性 ${Math.round(country.government.legitimacy)}`,
        })
      }
      const gdp = Math.max(1, country.econ.gdp)
      const debt = Math.max(0, -country.econ.treasury)
      const debtRatio = debt / gdp
      if (debtRatio > LIVE_DEBT_RATIO_MIN) {
        keep({
          salience: (debtRatio - LIVE_DEBT_RATIO_MIN) * LIVE_SALIENCE_SCALE,
          key: 'politics:debt',
          note: `债务/GDP ${Math.round(debtRatio * LIVE_SALIENCE_SCALE)}%`,
        })
      }
      break
    }
    case 'diplomacy': {
      const war = world.wars.find(
        one => one.attackers.includes(country.id) || one.defenders.includes(country.id),
      )
      if (war !== undefined) {
        keep({
          salience: LIVE_WAR_SALIENCE,
          key: 'diplomacy:war',
          note: `战争「${war.name}」分数 ${Math.round(war.warScore)}`,
        })
      }
      if (country.diplo.infamy > 0) {
        keep({
          salience: country.diplo.infamy * LIVE_INFAMY_SALIENCE_COEF,
          key: 'diplomacy:infamy',
          note: `恶名 ${Math.round(country.diplo.infamy)}`,
        })
      }
      break
    }
    case 'livelihood': {
      if (country.pops.sol < LIVE_SOL_LOW) {
        keep({
          salience: LIVE_SOL_LOW - country.pops.sol,
          key: 'livelihood:sol',
          note: `生活水平 ${Math.round(country.pops.sol)}`,
        })
      }
      const literacyLow =
        Math.max(0, LIVE_LITERACY_TARGET - country.pops.literacy) * LIVE_SALIENCE_SCALE
      if (literacyLow > 0) {
        keep({
          salience: literacyLow,
          key: 'livelihood:literacy',
          note: `识字率 ${Math.round(country.pops.literacy * 100)}%`,
        })
      }
      if (country.pops.sol < LIVE_FAMINE_SOL && grainDev > LIVE_FAMINE_GRAIN) {
        keep({
          salience: LIVE_FAMINE_SALIENCE,
          key: 'livelihood:famine',
          note: `饥荒风险：生活水平 ${Math.round(country.pops.sol)}，粮价高企`,
        })
      }
      break
    }
    default:
      break
  }
  return signal
}

/**
 * Scans the four dimensions for the most salient condition in each and returns
 * the strongest 1–2 as topic seeds (plan 0010 §3). Pure and deterministic: a
 * world whose signals are all below their thresholds yields `[]`.
 */
export function salientTopics(
  world: WorldState,
  country: Country,
  max = LIVE_MAX_TOPICS,
): SalientTopic[] {
  const limit = clamp(Math.floor(max), 1, LIVE_MAX_TOPICS)
  const grainDev = grainDeviation(country)
  const topics: SalientTopic[] = []
  for (const dimension of LIVE_DIMENSIONS) {
    const signal = dimensionSignal(world, country, dimension, grainDev)
    if (signal.salience > 0) {
      topics.push({
        dimension,
        key: signal.key,
        salience: signal.salience,
        note: signal.note,
      })
    }
  }
  // PT-085: rest any topic that fired recently. A persistent condition (cheap
  // grain, high unemployment) would otherwise seed the same crisis every month;
  // the data still shows it, but the event writer moves on.
  const monthIndex = (date: { year: number; month: number }): number =>
    date.year * 12 + date.month
  const now = monthIndex(world.date)
  const cooled = new Set<string>()
  for (const event of world.events ?? []) {
    if (event.topicKeys === undefined) continue
    if (now - monthIndex(event.date) >= LIVE_TOPIC_COOLDOWN_MONTHS) continue
    for (const key of event.topicKeys) cooled.add(key)
  }
  // Strongest first; equal salience keeps the LIVE_DIMENSIONS order (stable
  // because the source array is in that order and sort is stable).
  topics.sort((a, b) => b.salience - a.salience)
  return topics.filter(topic => !cooled.has(topic.key)).slice(0, limit)
}

/** The template kinds that point at one direction, for prompt guidance. */
function directionKinds(dimension: LiveDimension): string[] {
  return Object.entries(KIND_DIRECTIONS)
    .filter(([, value]) => value === dimension)
    .map(([kind]) => kind)
}

function topRelations(country: Country, world: WorldState): string {
  const rows = Object.values(world.countries)
    .filter(other => other.id !== country.id)
    .map(other => ({
      id: other.id,
      value: Math.round(country.diplo.relations[other.id] ?? 0),
    }))
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || (a.id < b.id ? -1 : 1))
  return rows
    .slice(0, LIVE_PROMPT_RELATIONS_MAX)
    .map(row => `${row.id}${row.value >= 0 ? '+' : ''}${row.value}`)
    .join(' ')
}

// ---------------------------------------------------------------- prompt

/**
 * One-line cue per narratorial voice (plan 0010 E6). The labels themselves live
 * in `config/events.ts`; `tests/live-events-perspectives.test.ts` drift-guards
 * that every configured voice has a cue.
 */
const PERSPECTIVE_CUES: Record<string, string> = {
  史官: '朝廷编年笔法，庄重克制的纪传体',
  市井: '街头百姓口吻，口语、俚俗、切身',
  列国舆论: '他国报章与朝野观感，疏离而带偏见',
}

/**
 * Builds the blocking generation prompt for one turn (ADR 0025 §2/§8): the
 * state facts the LLM needs, the salient topic seeds, the three narrative
 * voices as guidance, and the strict output format. Realism is prompt-only
 * (ADR 0025 §9).
 */
export function buildLiveEventPrompt(
  world: WorldState,
  country: Country,
  topics: SalientTopic[],
): string {
  const war = world.wars.find(
    one => one.attackers.includes(country.id) || one.defenders.includes(country.id),
  )
  const lines: string[] = []
  lines.push('## 终末传奇 · 本回合事件生成')
  lines.push(
    `日期：${world.date.year}年${world.date.month}月｜国家：${country.name}（${country.id}）｜领袖：${country.leader.title}${country.leader.name}`,
  )
  lines.push(`玩家国家：${country.isPlayer ? '是' : '否'}`)
  lines.push('')
  lines.push('### 当前状态')
  lines.push(
    `国库净资产 ${country.econ.treasury.toFixed(1)} 金｜GDP ${country.econ.gdp.toFixed(1)} 金/月｜合法性 ${Math.round(country.government.legitimacy)}｜激进 ${Math.round(country.pops.radicals)}`,
  )
  lines.push(
    `生活水平 ${Math.round(country.pops.sol)}｜识字率 ${Math.round(country.pops.literacy * 100)}%｜失业 ${country.econ.unemployment.toFixed(1)}%｜陆军 ${country.military.army.toFixed(1)} 万｜海军 ${country.military.navy.toFixed(1)}`,
  )
  lines.push(
    `粮价 ${(country.econ.prices.grain ?? GOODS.grain.basePrice).toFixed(2)}（基准 ${GOODS.grain.basePrice.toFixed(2)}）｜威望 ${Math.round(country.diplo.prestige)}｜恶名 ${Math.round(country.diplo.infamy)}`,
  )
  lines.push(`战争：${war === undefined ? '无' : `「${war.name}」分数 ${Math.round(war.warScore)}`}`)
  lines.push(`主要关系：${topRelations(country, world)}`)
  const recent = world.log.slice(-LIVE_PROMPT_RECENT_LOG)
  if (recent.length > 0) {
    lines.push('近事：')
    for (const entry of recent) {
      lines.push(`- ${entry.date.year}年${entry.date.month}月 ${entry.text}`)
    }
  }
  lines.push('')
  lines.push('### 本回合显著题材（按显著性排序，让事件回应这些刚变化的态势）')
  if (topics.length === 0) {
    lines.push('- 本回合无明显异常，可写一个贴合时局的常规事件，或输出空数组。')
  } else {
    topics.forEach((topic, index) => {
      const kinds = directionKinds(topic.dimension)
      const examples = kinds.length > 0 ? kinds.join('、') : '按状态自由发挥'
      lines.push(
        `${index + 1}. [${DIMENSION_LABELS[topic.dimension]}] ${topic.note}（方向：${DIMENSION_LABELS[topic.dimension]}向；可参照的题材方向：${examples}）`,
      )
    })
  }
  lines.push('')
  lines.push('### 叙事指引（三视角）')
  lines.push('以下三种旁白视角只作引导，自行取舍，不设硬结构；同一事件用其中一两种视角落笔即可：')
  for (const voice of LIVE_NARRATIVE_PERSPECTIVES) {
    lines.push(`- ${voice}：${PERSPECTIVE_CUES[voice] ?? ''}。`)
  }
  lines.push('现实主义：文本必须贴合上面的状态与题材，不要凭空创造与状态矛盾的数字或事件。')
  lines.push('')
  lines.push('### 输出格式（严格）')
  lines.push('只输出一个 JSON 数组，不要解释、Markdown 或代码围栏。每个元素形如：')
  lines.push(
    '{"kind":"economy|politics|diplomacy|livelihood","title":"标题","text":"正文","options":[{"label":"选项","result":"结果叙述","effects":{"treasury":-2,"radicals":-3,"modifiers":[{"stat":"income","stack":"percent","value":5,"months":6,"label":"标签"}]}}]}',
  )
  lines.push('- 最多 2 个事件，每个事件 1 至 3 个选项。')
  lines.push(
    '- effects 只能用这些字段：treasury / radicals / legitimacy / prestige / army / popsPercent / techPoints / relationTarget+relationAmount / succeed / modifiers[]。',
  )
  lines.push('- 数值必须是合理的有限数字；未知字段、未知 stat、越界幅度会让该选项被整条丢弃。')
  lines.push('- 若本回合无事可写，输出 []。')
  return lines.join('\n')
}

// ---------------------------------------------------------------- parse

/** One validated candidate event, ready for the host to wrap in a GameEvent. */
export type LiveEventCandidate = {
  kind: string
  title: string
  text: string
  options: EventOption[]
}

export type LiveEventParseOptions = {
  /** Known country ids; when given, `relationTarget` must be one of them. */
  countryIds?: readonly string[]
  /** Max events to accept; clamped to 1–2 (plan 0010 §4). Default 2. */
  maxEvents?: number
}

/** The magnitude caps and salience thresholds live in `config/events.ts`. */

const EFFECT_KEYS = new Set([
  'treasury',
  'radicals',
  'legitimacy',
  'prestige',
  'army',
  'popsPercent',
  'techPoints',
  'relationTarget',
  'relationAmount',
  'succeed',
  'modifiers',
])

const MODIFIER_KEYS = new Set(['stat', 'stack', 'value', 'months', 'label'])

/** A model option id must be short and shell-safe; otherwise it is renamed. */
const OPTION_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${LIVE_OPTION_ID_MAX}}$`)

/** A finite number within ±cap, or undefined (absent OR invalid). */
function boundedNumber(value: unknown, cap: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (Math.abs(value) > cap) return undefined
  return value
}

function parseModifiers(
  raw: unknown,
): NonNullable<EventOption['effects']['modifiers']> | undefined {
  if (!Array.isArray(raw)) return undefined
  if (raw.length > LIVE_MAX_MODIFIERS) return undefined
  const out: NonNullable<EventOption['effects']['modifiers']> = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined
    const rawModifier = item as Record<string, unknown>
    for (const key of Object.keys(rawModifier)) {
      if (!MODIFIER_KEYS.has(key)) return undefined
    }
    const stat = rawModifier.stat
    if (typeof stat !== 'string' || !(MODIFIER_STATS as string[]).includes(stat)) {
      return undefined
    }
    const value = boundedNumber(rawModifier.value, MODIFIER_VALUE_CAP)
    if (value === undefined) return undefined
    let stack: ModifierStack | undefined
    if (rawModifier.stack !== undefined) {
      if (
        rawModifier.stack !== 'flat' &&
        rawModifier.stack !== 'percent' &&
        rawModifier.stack !== 'multiply'
      ) {
        return undefined
      }
      stack = rawModifier.stack
    }
    let months: number | undefined
    if (rawModifier.months !== undefined) {
      if (
        typeof rawModifier.months !== 'number' ||
        !Number.isInteger(rawModifier.months) ||
        rawModifier.months < 0 ||
        rawModifier.months > MODIFIER_MONTHS_MAX
      ) {
        return undefined
      }
      months = rawModifier.months
    }
    let label: string | undefined
    if (rawModifier.label !== undefined) {
      if (typeof rawModifier.label !== 'string') return undefined
      label = rawModifier.label.slice(0, LIVE_MODIFIER_LABEL_MAX)
    }
    out.push({
      stat: stat as ModifierStat,
      ...(stack === undefined ? {} : { stack }),
      value,
      ...(months === undefined ? {} : { months }),
      ...(label === undefined ? {} : { label }),
    })
  }
  return out
}

/**
 * Validates one option's effects against the existing envelope (ADR 0025 §5):
 * known fields only, finite values within their caps, known `ModifierStat`s.
 * Any violation drops the whole option; a lone `relationTarget`/`relationAmount`
 * pair is dropped (the engine only applies them together). Returns undefined to
 * reject the option, an object (possibly empty) otherwise.
 */
function parseEffects(
  raw: unknown,
  countryIds?: readonly string[],
): EventOption['effects'] | undefined {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  const effects: EventOption['effects'] = {}
  for (const key of Object.keys(source)) {
    if (!EFFECT_KEYS.has(key)) return undefined
    const value = source[key]
    switch (key) {
      case 'treasury':
      case 'radicals':
      case 'legitimacy':
      case 'prestige':
      case 'army':
      case 'popsPercent':
      case 'techPoints':
      case 'relationAmount': {
        const n = boundedNumber(value, EFFECT_CAPS[key])
        if (n === undefined) return undefined
        effects[key] = n
        break
      }
      case 'succeed': {
        if (typeof value !== 'boolean') return undefined
        effects.succeed = value
        break
      }
      case 'relationTarget': {
        if (typeof value !== 'string' || value.trim() === '') return undefined
        if (countryIds !== undefined && !countryIds.includes(value)) return undefined
        effects.relationTarget = value
        break
      }
      case 'modifiers': {
        const modifiers = parseModifiers(value)
        if (modifiers === undefined) return undefined
        effects.modifiers = modifiers
        break
      }
      default:
        return undefined
    }
  }
  if ((effects.relationTarget === undefined) !== (effects.relationAmount === undefined)) {
    delete effects.relationTarget
    delete effects.relationAmount
  }
  return effects
}

function parseOption(
  raw: unknown,
  index: number,
  countryIds?: readonly string[],
): EventOption | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (key !== 'id' && key !== 'label' && key !== 'result' && key !== 'effects') {
      return undefined
    }
  }
  const label = typeof source.label === 'string' ? source.label.trim().slice(0, LIVE_OPTION_LABEL_MAX) : ''
  const result = typeof source.result === 'string' ? source.result.trim().slice(0, LIVE_OPTION_RESULT_MAX) : ''
  if (label === '' || result === '') return undefined
  const effects = parseEffects(source.effects, countryIds)
  if (effects === undefined) return undefined
  const rawId = typeof source.id === 'string' ? source.id.trim() : ''
  const id = OPTION_ID_PATTERN.test(rawId) ? rawId : `opt${index + 1}`
  return { id, label, result, effects }
}

/**
 * Strict parse of the model's reply (ADR 0025 §5, plan 0010 §4). The format is
 * a JSON array of `{kind?, title, text, options[]}`. Every option's effects are
 * validated and bounded; invalid options are dropped, an event with no usable
 * option is dropped, and unparseable output yields `[]`. This function never
 * throws.
 */
export function parseLiveEventResponse(
  text: string,
  options: LiveEventParseOptions = {},
): LiveEventCandidate[] {
  const maxEvents = clamp(options.maxEvents ?? LIVE_MAX_EVENTS, 1, LIVE_MAX_EVENTS)
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const candidates: LiveEventCandidate[] = []
  for (const item of parsed) {
    if (candidates.length >= maxEvents) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const title = typeof source.title === 'string' ? source.title.trim().slice(0, LIVE_TITLE_MAX) : ''
    const body = typeof source.text === 'string' ? source.text.trim().slice(0, LIVE_TEXT_MAX) : ''
    if (title === '' || body === '') continue
    if (!Array.isArray(source.options) || source.options.length === 0) continue
    const eventOptions: EventOption[] = []
    const seen = new Set<string>()
    source.options.forEach((rawOption, index) => {
      if (eventOptions.length >= LIVE_MAX_OPTIONS) return
      const option = parseOption(rawOption, index, options.countryIds)
      if (option === undefined) return
      if (seen.has(option.id)) option.id = `opt${index + 1}`
      if (seen.has(option.id)) return
      seen.add(option.id)
      eventOptions.push(option)
    })
    if (eventOptions.length === 0) continue
    // Namespace the kind so `event:<kind>:<optionId>` can never collide with a
    // static EVENT_BLOCKS registry key (which would shadow the model's
    // modifiers at install time, engine/config/blocks/events.ts).
    const kind =
      typeof source.kind === 'string' &&
      (LIVE_DIMENSIONS as readonly string[]).includes(source.kind)
        ? `live:${source.kind}`
        : 'live'
    candidates.push({ kind, title, text: body, options: eventOptions })
  }
  return candidates
}

// ---------------------------------------------------------------- subjects

/** One generation subject: a power and the topics it is written from. */
export type LiveSubject = {
  country: Country
  topics: SalientTopic[]
}

/**
 * Chooses the subjects for one turn (plan 0010 E5): the player first, then the
 * largest economies by GDP (id tie-break). A topic already claimed by an earlier
 * subject is dropped from later ones — the cross-subject de-duplication rule
 * left 待定 in plan §10 — and a subject left with no topics is skipped. Pure and
 * deterministic in the world state alone.
 */
export function planLiveSubjects(
  world: WorldState,
  maxSubjects = LIVE_MAX_SUBJECTS,
  maxTopics = LIVE_MAX_TOPICS,
): LiveSubject[] {
  const limit = clamp(Math.floor(maxSubjects), 1, LIVE_MAX_SUBJECTS)
  const rows = Object.values(world.countries)
    .map(country => ({
      country,
      topics: salientTopics(world, country, maxTopics),
      gdp: country.econ.gdp,
    }))
    .filter(row => row.topics.length > 0)
  rows.sort((a, b) => {
    if (a.country.isPlayer !== b.country.isPlayer) return a.country.isPlayer ? -1 : 1
    if (b.gdp !== a.gdp) return b.gdp - a.gdp
    return a.country.id < b.country.id ? -1 : 1
  })
  const subjects: LiveSubject[] = []
  const claimed = new Set<string>()
  for (const row of rows) {
    if (subjects.length >= limit) break
    const topics = row.topics.filter(topic => !claimed.has(topic.key))
    if (topics.length === 0) continue
    for (const topic of topics) claimed.add(topic.key)
    subjects.push({ country: row.country, topics })
  }
  return subjects
}

// ---------------------------------------------------------------- generation

export type LiveEventGenerationOptions = {
  /** Max subjects to scan; clamped to LIVE_MAX_SUBJECTS. Default the cap. */
  maxSubjects?: number
  /** Hard cap on model calls this turn. Default LIVE_MAX_MODEL_CALLS. */
  maxCalls?: number
  /** Known country ids for relationTarget validation. Default all countries. */
  countryIds?: readonly string[]
}

/**
 * The per-turn generation loop (plan 0010 §2/§7): one prompt per subject, one
 * model call per subject, strict parse, candidates wrapped as `GameEvent`s
 * attributed to their subject. Never throws; a failed or timed-out call yields
 * nothing for that subject so the caller degrades silently. Live events for the
 * turn are capped at LIVE_MAX_EVENTS whatever the subject count, and calls never
 * exceed `maxCalls` (the cost/latency guard of plan §7).
 */
export async function generateLiveEvents(
  world: WorldState,
  complete: (prompt: string) => Promise<string>,
  options: LiveEventGenerationOptions = {},
): Promise<GameEvent[]> {
  const maxCalls = Math.max(1, Math.floor(options.maxCalls ?? LIVE_MAX_MODEL_CALLS))
  const subjects = planLiveSubjects(world, options.maxSubjects ?? LIVE_MAX_SUBJECTS)
  const countryIds = options.countryIds ?? Object.keys(world.countries)
  const events: GameEvent[] = []
  let calls = 0
  for (const subject of subjects) {
    if (calls >= maxCalls) break
    if (events.length >= LIVE_MAX_EVENTS) break
    calls += 1
    let text = ''
    try {
      text = await complete(buildLiveEventPrompt(world, subject.country, subject.topics))
    } catch {
      text = ''
    }
    if (text === '') continue
    const candidates = parseLiveEventResponse(text, {
      countryIds,
      maxEvents: LIVE_MAX_EVENTS,
    })
    candidates.forEach((candidate, index) => {
      if (events.length >= LIVE_MAX_EVENTS) return
      events.push({
        id: `live-${world.tick}-${subject.country.id}-${index}`,
        date: { ...world.date },
        kind: candidate.kind,
        title: candidate.title,
        text: candidate.text,
        countryId: subject.country.id,
        options: candidate.options,
        isResolved: false,
        topicKeys: subject.topics.map(topic => topic.key),
      })
    })
  }
  return events
}

// ---------------------------------------------------------------- routine scenes

/** A deterministic, effect-free calendar scene template (plan 0010 E7). */
export type RoutineSceneTemplate = {
  key: string
  title: string
  text: string
  options: EventOption[]
}

/**
 * The routine-scene catalogue. Every option is deliberately effect-free: these
 * are flavour beats, so engaging or skipping one never moves a stat and can
 * never disturb the economy or balance.
 */
export const ROUTINE_SCENES: readonly RoutineSceneTemplate[] = [
  {
    key: 'audience',
    title: '岁首朝会',
    text: '岁首例行的朝会如常举行，百官依班进贺，报章照例铺陈天朝威仪。',
    options: [
      { id: 'attend', label: '亲临朝会', result: '朝会依礼而成，朝野安堵。', effects: {} },
      { id: 'skip', label: '略过不问', result: '朝会循例代行，波澜不惊。', effects: {} },
    ],
  },
  {
    key: 'census',
    title: '编户清册',
    text: '地方照例递上编户清册，数目琐碎，无关大局，却是一年一度的仪式。',
    options: [
      { id: 'review', label: '亲自过目', result: '清册归档，吏治如常。', effects: {} },
      { id: 'skip', label: '交有司处置', result: '清册循例归档，无人置意。', effects: {} },
    ],
  },
]

/** The scene month index: consecutive months since year 0, January = 0. */
function routineMonthIndex(world: WorldState): number {
  return world.date.year * 12 + (world.date.month - 1)
}

/** True when this month is on the routine cadence (plan 0010 E7). */
export function routineSceneDue(world: WorldState): boolean {
  return routineMonthIndex(world) % LIVE_ROUTINE_INTERVAL_MONTHS === 0
}

/**
 * The routine scene for this month, or undefined off-cadence (plan 0010 E7).
 * Deterministic in the world state; the catalogue alternates by cadence slot so
 * consecutive scenes differ. Never touches `world.events` and never blocks.
 */
export function buildRoutineScene(world: WorldState): GameEvent | undefined {
  if (!routineSceneDue(world)) return undefined
  const slot = routineMonthIndex(world) / LIVE_ROUTINE_INTERVAL_MONTHS
  const template = ROUTINE_SCENES[slot % ROUTINE_SCENES.length]
  if (template === undefined) return undefined
  return {
    id: `routine-${world.tick}-${template.key}`,
    date: { ...world.date },
    kind: `routine:${template.key}`,
    title: template.title,
    text: template.text,
    countryId: world.playerId,
    options: template.options.map(option => ({ ...option, effects: { ...option.effects } })),
    isResolved: false,
  }
}
