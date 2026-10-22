import type {
  Country,
  LogEntry,
  SituationRecord,
  SituationStance,
  WorldState,
} from '../../types'
import { addModifier } from '../modifiers'
import { installBlock, validateBlockConfig } from '../blocks'
import {
  compileSituationBlock,
  instantiateSituationBlock,
  situationBlockFor,
  situationModifierId,
  situationPacksFor,
  situationSource,
} from '../config/blocks/situations'
import { atWar, declareWar, strength } from '../diplomacy'
import { inspectEconomy } from '../economy'
import { clamp } from '../internal'
import type { Rng } from '../rng'
import {
  OPIUM_CRACKDOWN_AUTHORITY,
  OPIUM_CRACKDOWN_GBR_PRESTIGE,
  OPIUM_CRACKDOWN_LEGITIMACY,
  OPIUM_CRACKDOWN_PRESTIGE,
  OPIUM_CRACKDOWN_RELATION,
  OPIUM_COMPROMISE_LEGITIMACY,
  OPIUM_COMPROMISE_RADICALS,
  OPIUM_COMPROMISE_RELATION,
  OPIUM_COMPROMISE_TARIFF_CUT,
  OPIUM_CRISIS_EMBARGO_MONTHS,
  OPIUM_TRIGGER_IMPORT_SHARE,
  OPIUM_TRIGGER_IMPORT_UNITS,
  OPIUM_TRIGGER_RELATION_MAX,
  OPIUM_WAR_RELATION,
  OPIUM_WINDOW_END_YEAR,
  OPIUM_WINDOW_START_YEAR,
  SITUATION_TIMEOUT_MONTHS,
} from '../config/situations'

/**
 * The bespoke half of the opium crisis (plan 0004 §4): a fixed window, a
 * function-shaped gate, five stances and four fixed result packs. Plan 0002
 * keeps this behaviour bit-for-bit behind the general situation registry; only
 * `kind`/`id` are shared with it.
 */
export const OPIUM_CRISIS_ID = 'opium-crisis'
export const OPIUM_CRISIS_TITLE = '鸦片危机'
/** Participants, in stable order (plan §4.2). */
export const OPIUM_CRISIS_PARTICIPANTS = ['QING', 'GBR'] as const
/** The timeout and crackdown-embargo lengths live in `config/situations.ts`;
 *  re-exported here so the `./situations` import surface is unchanged. */
export { SITUATION_TIMEOUT_MONTHS, OPIUM_CRISIS_EMBARGO_MONTHS }

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
  if (year < OPIUM_WINDOW_START_YEAR || year > OPIUM_WINDOW_END_YEAR) return false
  if (world.countries.QING === undefined || world.countries.GBR === undefined) return false
  if (atWar(world, 'QING', 'GBR')) return false
  const relation = world.countries.QING.diplo.relations.GBR ?? 0
  if (relation > OPIUM_TRIGGER_RELATION_MAX) return false
  const fromGbr = opiumImportsFrom(world, 'GBR')
  if (fromGbr >= OPIUM_TRIGGER_IMPORT_UNITS) return true
  const own = inspectEconomy(world.countries.QING).production.opium
  const consumption = opiumImportsTotal(world) + Math.max(0, own)
  return consumption > 0 && fromGbr / consumption >= OPIUM_TRIGGER_IMPORT_SHARE
}

function addLog(log: LogEntry[], world: WorldState, text: string): void {
  log.push({ date: { ...world.date }, kind: 'diplomacy', text })
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
          : `${SITUATION_STANCE_NAMES[proposal.stance as SituationStance] ?? proposal.stance} — ${proposal.narrative}`
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

/**
 * Installs a result pack's modifiers on `country` through the block engine
 * (ADR 0024). The runtime block is rebound to `source = situation:<situationId>`
 * and its modifier id restored to the pre-C4 shape. A validation failure — which
 * cannot happen for the derived static registry — falls back to the legacy
 * direct install, so behaviour cannot change.
 */
function installSituationResultModifiers(
  country: Country,
  situationId: string,
  resultId: SituationResultId,
): void {
  const source = situationSource(situationId)
  for (const pack of situationPacksFor(resultId, country.id)) {
    const template = situationBlockFor(pack) ?? compileSituationBlock(pack)
    const installed = instantiateSituationBlock(template, situationId)
    if (validateBlockConfig([installed]).length === 0) {
      installBlock(country, installed, {
        modifierId: () => situationModifierId(situationId, pack),
      })
      continue
    }
    addModifier(country, {
      id: situationModifierId(situationId, pack),
      label: pack.label,
      stat: pack.stat,
      stack: pack.stack,
      value: pack.value,
      monthsLeft: pack.months,
      source,
    })
  }
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
        qing.government.legitimacy = clamp(qing.government.legitimacy + OPIUM_CRACKDOWN_LEGITIMACY, 0, 100)
        qing.government.authority = clamp(qing.government.authority + OPIUM_CRACKDOWN_AUTHORITY, 0, 100)
        qing.diplo.prestige = clamp(qing.diplo.prestige + OPIUM_CRACKDOWN_PRESTIGE, 0, 240)
        // A real embargo on QING's side, not a flag (plan §4.3).
        qing.embargoes.push({
          target: 'GBR',
          goods: ['opium'],
          since: { ...world.date },
          months: OPIUM_CRISIS_EMBARGO_MONTHS,
          reason: OPIUM_CRISIS_TITLE,
        })
      }
      if (gbr !== undefined) gbr.diplo.prestige = clamp(gbr.diplo.prestige - OPIUM_CRACKDOWN_GBR_PRESTIGE, 0, 240)
      relation(OPIUM_CRACKDOWN_RELATION)
      break
    }
    case 'compromise': {
      if (qing !== undefined) {
        // `ModifierStat` has no `tariff`, so this lands immediately rather than
        // as a 24-month timed change (plan §4.3 reading).
        const exportRate = qing.econ.exportTariff ?? qing.econ.tariff
        qing.econ.tariff = clamp(qing.econ.tariff - OPIUM_COMPROMISE_TARIFF_CUT, 0, 60)
        qing.econ.exportTariff = clamp(exportRate - OPIUM_COMPROMISE_TARIFF_CUT, 0, 60)
        installSituationResultModifiers(qing, OPIUM_CRISIS_ID, 'compromise')
        qing.government.legitimacy = clamp(qing.government.legitimacy - OPIUM_COMPROMISE_LEGITIMACY, 0, 100)
        qing.pops.radicals = clamp(qing.pops.radicals + OPIUM_COMPROMISE_RADICALS, 0, 100)
      }
      if (gbr !== undefined) {
        installSituationResultModifiers(gbr, OPIUM_CRISIS_ID, 'compromise')
      }
      relation(OPIUM_COMPROMISE_RELATION)
      break
    }
    case 'war-open-market':
    case 'war-reparations': {
      const goal = resultId === 'war-open-market' ? 'openMarket' : 'reparations'
      // Same War construction path as the diplomacy war move (plan §4.3/§5).
      declareWar(world, 'GBR', 'QING', goal, OPIUM_CRISIS_TITLE)
      relation(OPIUM_WAR_RELATION)
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
 * Settles one opium situation: one arbitration call through the injected
 * completer, then the deterministic fallback when the reply is not one of the
 * four ids (plan §4.4). Asynchronous because the real completer is
 * `$.model.complete`; tests inject a stub. The chosen id is recorded so a save
 * reproduces it.
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
