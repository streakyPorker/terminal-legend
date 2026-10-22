import type {
  LogEntry,
  Modifier,
  PolicyEffect,
  SituationProposal,
  SituationRecord,
  WorldState,
} from '../../types'
import { addModifier } from '../modifiers'
import { testCondition } from '../blocks'
import { readStatValue } from '../scale'
import { strength } from '../diplomacy'
import { validateEffects } from '../actions/policy'
import { SITUATION_NARRATIVE_MAX, SITUATION_TIMEOUT_MONTHS } from '../config/situations'
import type { Rng } from '../rng'
import type { SituationDefinition, SituationTrigger } from './types'
import { resolveSituation } from './opium'
import { pressureShare } from './conflict'
import {
  SITUATIONS,
  situationById,
  situationOutcomeName,
  situationStanceName,
} from './registry'

/** Raw proposal a submitting agent produces, before validation (plan 0002 §2). */
export type SituationProposalInput = {
  countryId: string
  stance: string
  narrative: string
  effects?: PolicyEffect[]
  pressure?: PolicyEffect[]
}

function addLog(log: LogEntry[], world: WorldState, text: string): void {
  log.push({ date: { ...world.date }, kind: 'diplomacy', text })
}

/** True when every participant has submitted a proposal (plan 0004 §4.2). */
function allProposed(situation: SituationRecord): boolean {
  return situation.countries.every(id =>
    situation.proposals.some(proposal => proposal.countryId === id),
  )
}

function openSituationRecord(
  world: WorldState,
  definition: SituationDefinition,
  log: LogEntry[],
): SituationRecord {
  const record: SituationRecord = {
    id: definition.id,
    kind: definition.id,
    opened: { ...world.date },
    countries: [...definition.participants],
    proposals: [],
    resolved: false,
    months: 0,
  }
  world.situations.push(record)
  addLog(log, world, definition.openText ?? `局势「${definition.title}」爆发`)
  return record
}

function clauseHolds(world: WorldState, clause: SituationTrigger): boolean {
  if (clause.predicate !== undefined && !clause.predicate(world)) return false
  if (clause.conditions.length === 0) return true
  const country = clause.countryId === undefined ? undefined : world.countries[clause.countryId]
  if (country === undefined) return false
  return clause.conditions.every(condition =>
    testCondition(readStatValue(country, condition.stat), condition.op, condition.value),
  )
}

/** True when every clause of a definition's trigger holds (AND-connected). */
export function situationDue(world: WorldState, definition: SituationDefinition): boolean {
  return definition.triggers.every(clause => clauseHolds(world, clause))
}

/**
 * Monthly tick run by `advance` (plan 0004 §4.1 / 0002 §1): age every open
 * situation by a month, then open each registered definition whose trigger
 * holds and whose id has never been recorded. Opening must never block the
 * monthly council, and settling is the host's job (the arbiter is async), so
 * nothing here awaits.
 */
export function tickSituations(
  world: WorldState,
  log: LogEntry[],
  registry: readonly SituationDefinition[] = SITUATIONS,
): void {
  for (const situation of world.situations) {
    if (!situation.resolved) situation.months += 1
  }
  for (const definition of registry) {
    if (world.situations.some(one => one.id === definition.id)) continue
    if (situationDue(world, definition)) openSituationRecord(world, definition, log)
  }
}

/** The first unresolved situation, or undefined (plan 0004 §4.2). */
export function openSituation(world: WorldState): SituationRecord | undefined {
  return world.situations.find(one => !one.resolved)
}

/** Situations ready to settle: all proposals in, or 3 months elapsed. */
export function dueSituations(world: WorldState): SituationRecord[] {
  return world.situations.filter(
    situation =>
      !situation.resolved &&
      (situation.months >= SITUATION_TIMEOUT_MONTHS || allProposed(situation)),
  )
}

function definitionOf(
  record: SituationRecord,
  registry: readonly SituationDefinition[],
): SituationDefinition | undefined {
  return situationById(record.kind, registry) ?? situationById(record.id, registry)
}

function targetSituation(
  world: WorldState,
  situationId: string | undefined,
): SituationRecord | undefined {
  if (situationId === undefined) return openSituation(world)
  return world.situations.find(one => one.id === situationId && !one.resolved)
}

const clampMonths = (months: number, range: [number, number]): number =>
  Math.min(range[1], Math.max(range[0], Math.round(months)))

/**
 * Validates a rough list of effects against a definition's envelope, reusing
 * `validateEffects` — the exact rules `applyPolicy` uses — then clamps each
 * entry's duration into the envelope's months range. Effects targeting a stat
 * outside the envelope are rejected wholesale so the deterministic fallback
 * can take over (plan 0002 §2).
 */
function normalizeEffects(
  definition: SituationDefinition,
  raw: PolicyEffect[],
): { ok: boolean; effects: PolicyEffect[]; text?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: true, effects: [] }
  const validated = validateEffects(raw, definition.envelope.maxEffects)
  if (!validated.ok) return { ok: false, effects: [], text: validated.text }
  const effects: PolicyEffect[] = []
  for (const effect of validated.effects) {
    if (!definition.envelope.stats.includes(effect.stat)) {
      return { ok: false, effects: [], text: `「${effect.stat}」不在局势信封范围内。` }
    }
    effects.push({
      ...effect,
      months: clampMonths(effect.months ?? definition.envelope.monthsRange[1], definition.envelope.monthsRange),
    })
  }
  return { ok: true, effects }
}

/**
 * Records one participant's proposal. Structural errors (unknown participant,
 * an illegal stance, an empty narrative) reject the proposal; an out-of-envelope
 * effect is dropped from the stored proposal and reported, so resolution falls
 * back deterministically (plan 0002 §2). One proposal per participant: a
 * resubmission replaces it.
 */
export function submitSituationProposal(
  world: WorldState,
  input: SituationProposalInput,
  situationId?: string,
  registry: readonly SituationDefinition[] = SITUATIONS,
): { ok: boolean; text: string } {
  const record = targetSituation(world, situationId)
  if (record === undefined) return { ok: false, text: '当前没有待决的局势。' }
  const definition = definitionOf(record, registry)
  if (definition === undefined) return { ok: false, text: `未知局势 ${record.kind}。` }
  if (!definition.participants.includes(input.countryId)) {
    return { ok: false, text: `${input.countryId} 不是「${definition.title}」的参与方。` }
  }
  if (!definition.stances.includes(input.stance)) {
    return { ok: false, text: `无效的立场 ${input.stance}。` }
  }
  const narrative = input.narrative.trim().slice(0, SITUATION_NARRATIVE_MAX)
  if (narrative === '') return { ok: false, text: '提案需要一句叙事。' }

  const effects = normalizeEffects(definition, input.effects ?? [])
  const pressure = normalizeEffects(definition, input.pressure ?? [])
  const proposal: SituationProposal = { countryId: input.countryId, stance: input.stance, narrative }
  if (effects.ok && effects.effects.length > 0) proposal.effects = effects.effects
  if (pressure.ok && pressure.effects.length > 0) proposal.pressure = pressure.effects
  const index = record.proposals.findIndex(one => one.countryId === input.countryId)
  if (index >= 0) record.proposals[index] = proposal
  else record.proposals.push(proposal)

  const note = effects.ok && pressure.ok ? '' : '（效果越界，退回确定性兜底）'
  return {
    ok: true,
    text: `${input.countryId} 就「${definition.title}」提交立场：${situationStanceName(input.stance)}${note}`,
  }
}

/**
 * The stance/narrative entry point used by `v3_situation`, the AI batch and the
 * secretary. Proposals carry effects only through `submitSituationProposal`;
 * this keeps the historical signature and messages of the opium path.
 */
export function recordSituationProposal(
  world: WorldState,
  countryId: string,
  stance: string,
  narrative: string,
  situationId?: string,
  registry: readonly SituationDefinition[] = SITUATIONS,
): { ok: boolean; text: string } {
  return submitSituationProposal(world, { countryId, stance, narrative }, situationId, registry)
}

function leverage(world: WorldState, id: string): number {
  return Math.max(0, strength(world, [id]))
}

function installProposalModifiers(
  world: WorldState,
  countryId: string,
  situationId: string,
  slot: string,
  effects: PolicyEffect[],
  scale: number,
  label: string,
): void {
  const country = world.countries[countryId]
  if (country === undefined) return
  effects.forEach((effect, index) => {
    const modifier: Modifier = {
      id: `situation:${situationId}:${slot}:${index}`,
      label: effect.label ?? label,
      stat: effect.stat,
      stack: effect.stack ?? 'flat',
      value: effect.value * scale,
      source: `situation:${situationId}`,
    }
    if (effect.months !== undefined) modifier.monthsLeft = effect.months
    addModifier(country, modifier)
  })
}

type ResolvedParticipant = {
  id: string
  stance: string
  effects: PolicyEffect[]
  pressure: PolicyEffect[]
}

function participantsFor(
  definition: SituationDefinition | undefined,
  situation: SituationRecord,
): ResolvedParticipant[] {
  const resolved: ResolvedParticipant[] = []
  for (const id of situation.countries) {
    const submitted = situation.proposals.find(proposal => proposal.countryId === id)
    const fallback = definition?.defaults?.[id]
    const stance = submitted?.stance ?? fallback?.stance
    if (stance === undefined) continue
    let effects: PolicyEffect[] = []
    let pressure: PolicyEffect[] = []
    if (submitted !== undefined && definition !== undefined) {
      const self = normalizeEffects(definition, submitted.effects ?? [])
      const against = normalizeEffects(definition, submitted.pressure ?? [])
      effects = self.ok ? self.effects : normalizeEffects(definition, fallback?.effects ?? []).effects
      pressure = against.ok
        ? against.effects
        : normalizeEffects(definition, fallback?.pressure ?? []).effects
    } else if (fallback !== undefined && definition !== undefined) {
      effects = normalizeEffects(definition, fallback.effects).effects
      pressure = normalizeEffects(definition, fallback.pressure ?? []).effects
    }
    resolved.push({ id, stance, effects, pressure })
  }
  return resolved
}

/** The stance with the greatest aggregate leverage; ties break lexicographically. */
function winningStance(
  world: WorldState,
  participants: ResolvedParticipant[],
): string | undefined {
  const totals = new Map<string, number>()
  for (const participant of participants) {
    totals.set(participant.stance, (totals.get(participant.stance) ?? 0) + leverage(world, participant.id))
  }
  let outcome: string | undefined
  let best = -Infinity
  for (const [stance, total] of totals) {
    if (total > best || (total === best && (outcome === undefined || stance < outcome))) {
      best = total
      outcome = stance
    }
  }
  return outcome
}

function resolutionText(definition: SituationDefinition | undefined, outcome: string): string {
  const name = situationOutcomeName(outcome) || outcome
  const title = definition?.title ?? outcome
  return definition?.resolveText !== undefined
    ? definition.resolveText.replace('{title}', title).replace('{outcome}', name)
    : `「${title}」以「${name}」收场`
}

/**
 * Resolves an `engine` situation deterministically (plan 0002 §2/§3): every
 * participant's validated `effects` land on itself, every `pressure` entry lands
 * on each other participant scaled by leverage (`stronger side presses harder`,
 * ties split evenly), and the outcome is the stance holding the most aggregate
 * leverage. No RNG, no arbiter — a save reproduces it exactly. Proposals that
 * failed validation fall back to the definition's default proposal.
 */
export function resolveEngineSituation(
  world: WorldState,
  situation: SituationRecord,
  log: LogEntry[],
  registry: readonly SituationDefinition[] = SITUATIONS,
): string {
  const definition = definitionOf(situation, registry)
  const participants = participantsFor(definition, situation)
  if (participants.length === 0) {
    situation.resultId = 'resolved'
    situation.resolved = true
    situation.resolvedAt = { ...world.date }
    for (const proposal of situation.proposals) proposal.narrative = ''
    addLog(log, world, `「${definition?.title ?? situation.id}」无果而终`)
    return 'resolved'
  }

  for (const participant of participants) {
    installProposalModifiers(
      world,
      participant.id,
      situation.id,
      `${participant.id}:self`,
      participant.effects,
      1,
      definition?.title ?? situation.id,
    )
    for (const other of participants) {
      if (other.id === participant.id) continue
      const mine = leverage(world, participant.id)
      const theirs = leverage(world, other.id)
      const share = pressureShare(mine, theirs)
      installProposalModifiers(
        world,
        other.id,
        situation.id,
        `${participant.id}:pressure:${other.id}`,
        participant.pressure,
        share,
        definition?.title ?? situation.id,
      )
    }
  }

  const outcome = winningStance(world, participants) ?? 'resolved'
  situation.resultId = outcome
  situation.resolved = true
  situation.resolvedAt = { ...world.date }
  for (const proposal of situation.proposals) proposal.narrative = ''
  addLog(log, world, resolutionText(definition, outcome))
  return outcome
}

/**
 * Settles every due situation in stable order. `arbiter-agent` definitions go
 * through the async arbiter (opium); `engine` definitions resolve synchronously.
 */
export async function settleDueSituations(
  world: WorldState,
  complete: (prompt: string) => Promise<string>,
  rng: Rng,
  log: LogEntry[],
  registry: readonly SituationDefinition[] = SITUATIONS,
): Promise<string[]> {
  const settled: string[] = []
  for (const situation of dueSituations(world)) {
    const definition = definitionOf(situation, registry)
    if (definition?.resolve === 'arbiter-agent') {
      settled.push(await resolveSituation(world, situation, complete, rng, log))
    } else {
      settled.push(resolveEngineSituation(world, situation, log, registry))
    }
  }
  return settled
}

/** `QING:禁烟  GBR:待定` — each participant's declared stance (plan §4.5). */
export function stanceSummary(situation: SituationRecord): string {
  return situation.countries
    .map(id => {
      const proposal = situation.proposals.find(one => one.countryId === id)
      const name = proposal === undefined ? '待定' : situationStanceName(proposal.stance)
      return `${id}:${name}`
    })
    .join('  ')
}

/** Chinese name of a recorded outcome id, or '' when unknown/absent. */
export function resultName(id: string | undefined): string {
  return situationOutcomeName(id)
}

/** The registry title of a situation record, falling back to its kind. */
export function situationTitleOf(situation: SituationRecord): string {
  return situationById(situation.kind)?.title ?? situation.kind
}

/** The countdown or recorded outcome of one situation, for the UI. */
export function situationStateText(situation: SituationRecord): string {
  if (situation.resolved) return `已解决：${resultName(situation.resultId) || '—'}`
  if (situation.months >= SITUATION_TIMEOUT_MONTHS) return '待仲裁'
  return `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
}

/** One line for the HUD/status output, or '' when nothing is open (plan §4.5). */
export function situationStatus(world: WorldState): string {
  const situation = openSituation(world)
  if (situation === undefined) return ''
  return `局势「${situationTitleOf(situation)}」${stanceSummary(situation)} · ${situationStateText(situation)}`
}
