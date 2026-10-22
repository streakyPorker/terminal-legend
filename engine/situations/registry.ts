import type { WorldState } from '../../types'
import type { SituationDefinition } from './types'
import {
  OPIUM_CRISIS_ID,
  OPIUM_CRISIS_PARTICIPANTS,
  OPIUM_CRISIS_TITLE,
  SITUATION_RESULT_IDS,
  SITUATION_RESULT_NAMES,
  SITUATION_STANCE_NAMES,
  SITUATION_STANCES,
  opiumCrisisDue,
} from './opium'
import { SAMPLE_LINES } from './lines'

/** The historical context the opium-crisis definition hands to an agent. */
function opiumContext(world: WorldState): string {
  const qing = world.countries.QING
  const gbr = world.countries.GBR
  const lines = [`${world.date.year}年${world.date.month}月，鸦片贸易令中英交恶。`]
  if (qing !== undefined && gbr !== undefined) {
    const qingRelation = Math.round(qing.diplo.relations.GBR ?? 0)
    const gbrRelation = Math.round(gbr.diplo.relations.QING ?? 0)
    lines.push(
      `${qing.leader.name}（${qing.leader.persona}）治下的大清，对英关系 ${qingRelation}；` +
        `${gbr.leader.name}（${gbr.leader.persona}）治下的英国，对华关系 ${gbrRelation}。`,
    )
    lines.push(`大清议程：${qing.leader.agenda}｜英国议程：${gbr.leader.agenda}。`)
  }
  return lines.join('\n')
}

/**
 * The data-driven situation registry (plan 0002 §1). Each entry is a
 * self-contained event-tree node: a trigger, participants, engine-generated
 * context, a proposal envelope, an order and a resolution mode. The opium
 * crisis is the original, kept bit-for-bit.
 *
 * Order matters: `tickSituations` opens definitions in this order, and the
 * registry-consistency test pins the ids.
 */
export const SITUATIONS: SituationDefinition[] = [
  {
    id: OPIUM_CRISIS_ID,
    title: OPIUM_CRISIS_TITLE,
    triggers: [{ conditions: [], predicate: opiumCrisisDue }],
    participants: [...OPIUM_CRISIS_PARTICIPANTS],
    context: opiumContext,
    envelope: { stats: ['marketAccess', 'income'], maxEffects: 2, monthsRange: [1, 24] },
    order: 'simultaneous',
    resolve: 'arbiter-agent',
    stances: [...SITUATION_STANCES],
    stanceNames: SITUATION_STANCE_NAMES,
    outcomes: [...SITUATION_RESULT_IDS],
    outcomeNames: SITUATION_RESULT_NAMES,
    openText: '局势「鸦片危机」爆发：中英两国因鸦片贸易剑拔弩张',
  },
  ...SAMPLE_LINES,
]

const BY_ID = new Map<string, SituationDefinition>(
  SITUATIONS.map(definition => [definition.id, definition]),
)

const OUTCOME_NAMES = new Map<string, string>()
const STANCE_NAMES = new Map<string, string>()
for (const definition of SITUATIONS) {
  for (const [id, name] of Object.entries(definition.outcomeNames ?? {})) {
    OUTCOME_NAMES.set(id, name)
  }
  for (const [id, name] of Object.entries(definition.stanceNames ?? {})) {
    STANCE_NAMES.set(id, name)
  }
}

/** The registered definition for `id`, or undefined when unregistered. */
export function situationById(
  id: string,
  registry: readonly SituationDefinition[] = SITUATIONS,
): SituationDefinition | undefined {
  if (registry === SITUATIONS) return BY_ID.get(id)
  return registry.find(definition => definition.id === id)
}

/** Display name of a recorded outcome id, or '' when unknown/absent. */
export function situationOutcomeName(id: string | undefined): string {
  if (id === undefined) return ''
  return OUTCOME_NAMES.get(id) ?? STANCE_NAMES.get(id) ?? ''
}

/** Display name of a stance id, or the id itself when unknown. */
export function situationStanceName(id: string): string {
  return STANCE_NAMES.get(id) ?? id
}
