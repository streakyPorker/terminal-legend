import type {
  ConfigBlock,
  ModifierStat,
  ModifierStack,
} from '../../../types'
import type { SituationResultId } from '../../situations'

/**
 * Situation modifier blocks (ADR 0024 §7). The one situation this slice ships —
 * the opium crisis (plan 0004 §4.3) — installs timed modifiers only from its
 * `compromise` result pack: QING gains flat market access, GBR a percent income
 * buff, both for 24 months. Each entry is one `ConfigBlock` (`kind: 'situation'`)
 * so this registry is the single source of truth for those modifiers.
 *
 * At install time a block is rebound to the situation source
 * (`situation:<situationId>`) and its modifier id restored to the pre-C4 shape
 * (`situation:<situationId>:<resultId>:<slot>`), so behaviour is bit-for-bit
 * preserved. The direct effects (legitimacy/authority/prestige/embargo/
 * declareWar and the tariff/radical/relation changes) are NOT multipliers and
 * stay exactly as they were inline in `engine/situations.ts`.
 */

/** One modifier entry of a result pack (plan §4.3), pre-C4 mapped 1:1. */
export type SituationModifierPack = {
  /** The result pack this modifier belongs to. */
  resultId: SituationResultId
  /** Country the modifier lands on. */
  countryId: string
  /** Slot suffix distinguishing entries within one (result, country) pair. */
  slot: string
  stat: ModifierStat
  stack: ModifierStack
  value: number
  label: string
  /** Timed length in months; the pre-C4 `monthsLeft`. */
  months: number
}

/**
 * The modifier entries of every result pack, 1:1 from plan §4.3 / the pre-C4
 * `applySituationResult`. Only `compromise` installs modifiers. The static
 * registry below is derived from this table, so the two cannot drift; the
 * migration test additionally pins it against a frozen spec.
 *
 * Do not reorder — install order is part of the behaviour contract.
 */
export const SITUATION_MODIFIER_PACKS: SituationModifierPack[] = [
  {
    resultId: 'compromise',
    countryId: 'QING',
    slot: 'access',
    stat: 'marketAccess',
    stack: 'flat',
    value: 0.1,
    label: '通商口岸',
    months: 24,
  },
  {
    resultId: 'compromise',
    countryId: 'GBR',
    slot: 'income',
    stat: 'income',
    stack: 'percent',
    value: 5,
    label: '通商红利',
    months: 24,
  },
]

/** Registry key for one pack: `situation:<resultId>:<countryId>:<slot>`. */
export function situationBlockId(pack: SituationModifierPack): string {
  return `situation:${pack.resultId}:${pack.countryId}:${pack.slot}`
}

/** The modifier `source` for a situation: `situation:<situationId>`. */
export function situationSource(situationId: string): string {
  return `situation:${situationId}`
}

/** The pre-C4 modifier id for one pack: `situation:<situationId>:<resultId>:<slot>`. */
export function situationModifierId(
  situationId: string,
  pack: SituationModifierPack,
): string {
  return `${situationSource(situationId)}:${pack.resultId}:${pack.slot}`
}

/**
 * Shapes one modifier pack into a `ConfigBlock` (ADR 0024 §3). The block carries
 * no trigger and no `scales_with`; `lifecycle: 'once'` and the effect's own
 * `months` give the timed case (the pre-C4 `monthsLeft`).
 */
export function compileSituationBlock(pack: SituationModifierPack): ConfigBlock {
  return {
    id: situationBlockId(pack),
    kind: 'situation',
    label: pack.label,
    potential_trigger: [],
    lifecycle: 'once',
    scales_with: [],
    effects: [
      {
        stat: pack.stat,
        stack: pack.stack,
        value: pack.value,
        label: pack.label,
        months: pack.months,
      },
    ],
  }
}

/**
 * Rebinds a registry block to a concrete situation instance. `installBlock`
 * derives `source` from the block id, and the pre-C4 source was
 * `situation:<situationId>`, so the runtime block's id is that source. The
 * modifier id is restored separately through `installBlock`'s `modifierId`.
 */
export function instantiateSituationBlock(
  block: ConfigBlock,
  situationId: string,
): ConfigBlock {
  return { ...block, id: situationSource(situationId) }
}

/**
 * Static registry of every situation modifier pack (ADR 0024 §7). Derived from
 * `SITUATION_MODIFIER_PACKS`, so a drift guard only needs to pin the packs.
 */
export const SITUATION_BLOCKS: ConfigBlock[] =
  SITUATION_MODIFIER_PACKS.map(pack => compileSituationBlock(pack))

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  SITUATION_BLOCKS.map(block => [block.id, block]),
)

/** The registered block for one pack, or undefined if the registry drifted. */
export function situationBlockFor(
  pack: SituationModifierPack,
): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(situationBlockId(pack))
}

/** The registered packs that land on `countryId` for `resultId`. */
export function situationPacksFor(
  resultId: SituationResultId,
  countryId: string,
): SituationModifierPack[] {
  return SITUATION_MODIFIER_PACKS.filter(
    pack => pack.resultId === resultId && pack.countryId === countryId,
  )
}
