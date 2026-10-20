import type {
  LogEntry,
  SituationProposal,
  SituationRecord,
  SituationStance,
  WorldState,
} from '../types'
import { addModifier } from './modifiers'
import { atWar, clamp, declareWar, inspectEconomy, strength } from './sim'
import type { Rng } from './rng'

/**
 * The one situation this slice ships: the opium crisis (plan 0004 §4). There is
 * deliberately no situation framework — a single id, a fixed window, four fixed
 * result packs. A given id may be opened at most once, ever.
 */
export const OPIUM_CRISIS_ID = 'opium-crisis'
export const OPIUM_CRISIS_TITLE = '鸦片危机'
/** Participants, in stable order (plan §4.2). */
export const OPIUM_CRISIS_PARTICIPANTS = ['QING', 'GBR'] as const
/** Months before an incomplete situation settles anyway (plan §4.2). */
export const SITUATION_TIMEOUT_MONTHS = 3
/** Embargo length the crackdown pack imposes (plan §4.3). */
export const OPIUM_CRISIS_EMBARGO_MONTHS = 24
/** Trigger window 1839.01–1842.12 (plan §4.1). */
const WINDOW_START_YEAR = 1839
const WINDOW_END_YEAR = 1842
/** Trigger bars: ≥2 opium units/month, or ≥20% of QING consumption (plan §4.1). */
const TRIGGER_IMPORT_UNITS = 2
const TRIGGER_IMPORT_SHARE = 0.2

export const SITUATION_STANCES: SituationStance[] = [
  'crackdown',
  'compromise',
  'war',
  'aid',
  'neutral',
]

export const SITUATION_STANCE_NAMES: Record<SituationStance, string> = {
  crackdown: '禁烟',
  compromise: '妥协',
  war: '开战',
  aid: '求援',
  neutral: '观望',
}

/** The four fixed result packs arbitration chooses among (plan §4.3). */
export type SituationResultId =
  | 'qing-crackdown'
  | 'compromise'
  | 'war-open-market'
  | 'war-reparations'

export const SITUATION_RESULT_IDS: SituationResultId[] = [
  'qing-crackdown',
  'compromise',
  'war-open-market',
  'war-reparations',
]

export const SITUATION_RESULT_NAMES: Record<SituationResultId, string> = {
  'qing-crackdown': '禁烟成功',
  compromise: '妥协通商',
  'war-open-market': '战争：开放市场',
  'war-reparations': '战争：赔款',
}

const dateIndex = (date: { year: number; month: number }): number =>
  date.year * 12 + (date.month - 1)

const isStance = (value: unknown): value is SituationStance =>
  SITUATION_STANCES.includes(value as SituationStance)

const isResultId = (value: unknown): value is SituationResultId =>
  SITUATION_RESULT_IDS.includes(value as SituationResultId)

/** This month's opium units QING imports from one partner (plan §4.1). */
function opiumImportsFrom(world: WorldState, partnerId: string): number {
  const importer = world.countries.QING
  if (importer === undefined) return 0
  let total = 0
  for (const flow of importer.trade.imports) {
    if (flow.from === partnerId && flow.good === 'opium') total += flow.quantity
  }
  return total
}

function opiumImportsTotal(world: WorldState): number {
  const importer = world.countries.QING
  if (importer === undefined) return 0
  let total = 0
  for (const flow of importer.trade.imports) {
    if (flow.good === 'opium') total += flow.quantity
  }
  return total
}

/**
 * True when the opium crisis should open this month and never has (plan §4.1):
 * inside the window, not at war, relations ≤ −10, and opium flowing from GBR
 * at ≥2 units or ≥20% of QING's consumption (imports + own production).
 */
export function opiumCrisisDue(world: WorldState): boolean {
  if (world.situations.some(one => one.id === OPIUM_CRISIS_ID)) return false
  const year = world.date.year
  if (year < WINDOW_START_YEAR || year > WINDOW_END_YEAR) return false
  if (world.countries.QING === undefined || world.countries.GBR === undefined) return false
  if (atWar(world, 'QING', 'GBR')) return false
  const relation = world.countries.QING.diplo.relations.GBR ?? 0
  if (relation > -10) return false
  const fromGbr = opiumImportsFrom(world, 'GBR')
  if (fromGbr >= TRIGGER_IMPORT_UNITS) return true
  const own = inspectEconomy(world.countries.QING).production.opium
  const consumption = opiumImportsTotal(world) + Math.max(0, own)
  return consumption > 0 && fromGbr / consumption >= TRIGGER_IMPORT_SHARE
}

function addLog(log: LogEntry[], world: WorldState, text: string): void {
  log.push({ date: { ...world.date }, kind: 'diplomacy', text })
}

function openCrisis(world: WorldState, log: LogEntry[]): SituationRecord {
  const record: SituationRecord = {
    id: OPIUM_CRISIS_ID,
    kind: 'opium-crisis',
    opened: { ...world.date },
    countries: [...OPIUM_CRISIS_PARTICIPANTS],
    proposals: [],
    resolved: false,
    months: 0,
  }
  world.situations.push(record)
  addLog(log, world, `局势「${OPIUM_CRISIS_TITLE}」爆发：中英两国因鸦片贸易剑拔弩张`)
  return record
}

/**
 * Monthly tick run by `advance` (plan §4.1): age every open situation by a
 * month, then open the opium crisis if its conditions hold. Opening must never
 * block the monthly council, and settling is the host's job (it needs the async
 * arbiter), so nothing here awaits.
 */
export function tickSituations(world: WorldState, log: LogEntry[]): void {
  for (const situation of world.situations) {
    if (!situation.resolved) situation.months += 1
  }
  if (opiumCrisisDue(world)) openCrisis(world, log)
}

function openSituation(world: WorldState): SituationRecord | undefined {
  return world.situations.find(one => !one.resolved)
}

/** True when every participant has submitted a proposal (plan §4.2). */
function allProposed(situation: SituationRecord): boolean {
  return situation.countries.every(id =>
    situation.proposals.some(proposal => proposal.countryId === id),
  )
}

/** Situations ready to settle: all proposals in, or 3 months elapsed (plan §4.2). */
export function dueSituations(world: WorldState): SituationRecord[] {
  return world.situations.filter(
    situation =>
      !situation.resolved &&
      (situation.months >= SITUATION_TIMEOUT_MONTHS || allProposed(situation)),
  )
}

/**
 * Records one participant's stance on the open situation. Engine validates the
 * stance enum and clamps the narrative like any other model text; one proposal
 * per participant (a resubmission replaces it). Proposals never carry effects
 * (plan §4.2).
 */
export function recordSituationProposal(
  world: WorldState,
  countryId: string,
  stance: string,
  narrative: string,
): { ok: boolean; text: string } {
  const situation = openSituation(world)
  if (situation === undefined) return { ok: false, text: '当前没有待决的局势。' }
  if (!situation.countries.includes(countryId)) {
    return { ok: false, text: `${countryId} 不是「${OPIUM_CRISIS_TITLE}」的参与方。` }
  }
  if (!isStance(stance)) return { ok: false, text: `无效的立场 ${stance}。` }
  const text = narrative.trim().slice(0, 160)
  if (text === '') return { ok: false, text: '提案需要一句叙事。' }
  const proposal: SituationProposal = { countryId, stance, narrative: text }
  const existing = situation.proposals.find(one => one.countryId === countryId)
  if (existing !== undefined) {
    existing.stance = proposal.stance
    existing.narrative = proposal.narrative
  } else {
    situation.proposals.push(proposal)
  }
  return {
    ok: true,
    text: `${countryId} 就「${OPIUM_CRISIS_TITLE}」提交立场：${SITUATION_STANCE_NAMES[stance]}`,
  }
}

/**
 * Deterministic fallback, in the plan's priority order (plan §4.4): compromise,
 * then crackdown if GBR is not belligerent, then war (open-market, or
 * reparations when GBR is weaker), else compromise.
 */
export function fallbackResult(
  situation: SituationRecord,
  strengthOf: (ids: string[]) => number,
): SituationResultId {
  const qing = situation.proposals.find(one => one.countryId === 'QING')?.stance
  const gbr = situation.proposals.find(one => one.countryId === 'GBR')?.stance
  if (qing === 'compromise') return 'compromise'
  if (qing === 'crackdown' && gbr !== 'war') return 'qing-crackdown'
  if (gbr === 'war') {
    return strengthOf(['GBR']) < strengthOf(['QING']) ? 'war-reparations' : 'war-open-market'
  }
  return 'compromise'
}

/** The one-arbitration prompt: context in, a single result id out (plan §4.4). */
export function buildArbiterPrompt(world: WorldState, situation: SituationRecord): string {
  const qing = world.countries.QING
  const gbr = world.countries.GBR
  const lines: string[] = []
  lines.push(`日期：${world.date.year}年${world.date.month}月`)
  lines.push(`局势：${OPIUM_CRISIS_TITLE}（${situation.countries.join('、')}）`)
  lines.push('各方提案：')
  for (const id of situation.countries) {
    const proposal = situation.proposals.find(one => one.countryId === id)
    lines.push(
      `- ${id}：${
        proposal === undefined
          ? '（未提交）'
          : `${SITUATION_STANCE_NAMES[proposal.stance]} — ${proposal.narrative}`
      }`,
    )
  }
  if (qing !== undefined && gbr !== undefined) {
    const bilateral =
      qing.trade.exports
        .filter(flow => flow.to === 'GBR')
        .reduce((sum, flow) => sum + flow.value, 0) +
      qing.trade.imports
        .filter(flow => flow.from === 'GBR')
        .reduce((sum, flow) => sum + flow.value, 0)
    lines.push(`中英关系：${Math.round(qing.diplo.relations.GBR ?? 0)}`)
    lines.push(`双边贸易额：${bilateral.toFixed(1)} 金/月`)
    lines.push(`大清军力：${strength(world, ['QING']).toFixed(1)}｜英国军力：${strength(world, ['GBR']).toFixed(1)}`)
    lines.push(`大清领袖：${qing.leader.name}（${qing.leader.persona}）`)
    lines.push(`英国领袖：${gbr.leader.name}（${gbr.leader.persona}）`)
  }
  const recent = world.log.slice(-8)
  if (recent.length > 0) {
    lines.push('近期编年史：')
    for (const entry of recent) lines.push(`- ${entry.date.year}.${entry.date.month} ${entry.text}`)
  }
  lines.push('')
  lines.push('从以下四个结果中择一，只输出其 id，不要任何解释或标点：')
  for (const id of SITUATION_RESULT_IDS) lines.push(`- ${id}：${SITUATION_RESULT_NAMES[id]}`)
  return lines.join('\n')
}

/** Strictly a result id, or a unique id found in the text; else undefined. */
export function parseResultId(text: string): SituationResultId | undefined {
  const trimmed = text.trim()
  if (isResultId(trimmed)) return trimmed
  const found = SITUATION_RESULT_IDS.filter(id => trimmed.includes(id))
  return found.length === 1 ? found[0] : undefined
}

/** Applies one result pack's exact effects (plan §4.3), then closes the record. */
export function applySituationResult(
  world: WorldState,
  situation: SituationRecord,
  resultId: SituationResultId,
  log: LogEntry[],
): void {
  const qing = world.countries.QING
  const gbr = world.countries.GBR
  const relation = (delta: number): void => {
    if (qing === undefined || gbr === undefined) return
    qing.diplo.relations.GBR = clamp((qing.diplo.relations.GBR ?? 0) + delta, -100, 100)
    gbr.diplo.relations.QING = clamp((gbr.diplo.relations.QING ?? 0) + delta, -100, 100)
  }

  switch (resultId) {
    case 'qing-crackdown': {
      if (qing !== undefined) {
        qing.government.legitimacy = clamp(qing.government.legitimacy + 6, 0, 100)
        qing.government.authority = clamp(qing.government.authority + 8, 0, 100)
        qing.diplo.prestige = clamp(qing.diplo.prestige + 8, 0, 240)
        // A real embargo on QING's side, not a flag (plan §4.3).
        qing.embargoes.push({
          target: 'GBR',
          goods: ['opium'],
          since: { ...world.date },
          months: OPIUM_CRISIS_EMBARGO_MONTHS,
          reason: OPIUM_CRISIS_TITLE,
        })
      }
      if (gbr !== undefined) gbr.diplo.prestige = clamp(gbr.diplo.prestige - 5, 0, 240)
      relation(-15)
      break
    }
    case 'compromise': {
      if (qing !== undefined) {
        // `ModifierStat` has no `tariff`, so this lands immediately rather than
        // as a 24-month timed change (plan §4.3 reading).
        qing.econ.tariff = clamp(qing.econ.tariff - 8, 0, 60)
        addModifier(qing, {
          id: `situation:${OPIUM_CRISIS_ID}:compromise:access`,
          label: '通商口岸',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.1,
          monthsLeft: 24,
          source: `situation:${OPIUM_CRISIS_ID}`,
        })
        qing.government.legitimacy = clamp(qing.government.legitimacy - 4, 0, 100)
        qing.pops.radicals = clamp(qing.pops.radicals + 5, 0, 100)
      }
      if (gbr !== undefined) {
        addModifier(gbr, {
          id: `situation:${OPIUM_CRISIS_ID}:compromise:income`,
          label: '通商红利',
          stat: 'income',
          stack: 'percent',
          value: 5,
          monthsLeft: 24,
          source: `situation:${OPIUM_CRISIS_ID}`,
        })
      }
      relation(10)
      break
    }
    case 'war-open-market':
    case 'war-reparations': {
      const goal = resultId === 'war-open-market' ? 'openMarket' : 'reparations'
      // Same War construction path as the diplomacy war move (plan §4.3/§5).
      declareWar(world, 'GBR', 'QING', goal, OPIUM_CRISIS_TITLE)
      relation(-40)
      break
    }
  }

  situation.resultId = resultId
  situation.resolved = true
  situation.resolvedAt = { ...world.date }
  // Plan §4.5: keep only a summary — drop proposal narratives once settled.
  for (const proposal of situation.proposals) proposal.narrative = ''
  addLog(
    log,
    world,
    `「${OPIUM_CRISIS_TITLE}」以「${SITUATION_RESULT_NAMES[resultId]}」收场`,
  )
}

/**
 * Settles one situation: one arbitration call through the injected completer,
 * then the deterministic fallback when the reply is not one of the four ids
 * (plan §4.4). Asynchronous because the real completer is `$.model.complete`;
 * tests inject a stub. The chosen id is recorded so a save reproduces it.
 */
export async function resolveSituation(
  world: WorldState,
  situation: SituationRecord,
  complete: (prompt: string) => Promise<string>,
  rng: Rng,
  log: LogEntry[],
): Promise<SituationResultId> {
  let resultId: SituationResultId | undefined
  try {
    resultId = parseResultId(await complete(buildArbiterPrompt(world, situation)))
  } catch {
    // A failed arbitration is not a failed crisis: fall through to the fallback.
    resultId = undefined
  }
  if (resultId === undefined) {
    resultId = fallbackResult(situation, ids => strength(world, ids))
  }
  applySituationResult(world, situation, resultId, log)
  return resultId
}

/** Settles every due situation in order (stable: `world.situations` order). */
export async function settleDueSituations(
  world: WorldState,
  complete: (prompt: string) => Promise<string>,
  rng: Rng,
  log: LogEntry[],
): Promise<SituationResultId[]> {
  const settled: SituationResultId[] = []
  for (const situation of dueSituations(world)) {
    settled.push(await resolveSituation(world, situation, complete, rng, log))
  }
  return settled
}

/** `QING:禁烟  GBR:待定` — each participant's declared stance (plan §4.5). */
export function stanceSummary(situation: SituationRecord): string {
  return situation.countries
    .map(id => {
      const proposal = situation.proposals.find(one => one.countryId === id)
      return `${id}:${proposal === undefined ? '待定' : SITUATION_STANCE_NAMES[proposal.stance]}`
    })
    .join('  ')
}

/** Chinese name of a recorded result id, or '' when unknown/absent. */
export function resultName(id: string | undefined): string {
  return id !== undefined && isResultId(id) ? SITUATION_RESULT_NAMES[id] : ''
}

/** One line for the HUD/status output, or '' when nothing is open (plan §4.5). */
export function situationStatus(world: WorldState): string {
  const situation = openSituation(world)
  if (situation === undefined) return ''
  const countdown =
    situation.months >= SITUATION_TIMEOUT_MONTHS
      ? '待仲裁'
      : `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
  return `局势「${OPIUM_CRISIS_TITLE}」${stanceSummary(situation)} · ${countdown}`
}
