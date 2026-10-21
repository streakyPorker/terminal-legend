import type { ConfigBlock, ModifierStat, ModifierStack } from '../../../types'

/**
 * Law modifier blocks (ADR 0024 §7). One block per law (`kind: 'law'`); every
 * law installs exactly one **permanent** modifier, mapped 1:1 from the pre-C6
 * inline `addModifier` call in `engine/actions.ts`'s `law` case. The direct
 * (non-modifier) effects — authority cost, literacy/spending/radical/tariff/
 * manpower/legitimacy changes — are NOT multipliers and stay exactly as they
 * were inline in `engine/actions.ts`.
 *
 * The block id is `law:<name>` and doubles as the modifier `source`; the
 * pre-C6 modifier id is preserved separately (some laws carry a slot suffix,
 * e.g. `law:自由贸易:income`), so behaviour is bit-for-bit preserved.
 */

/** One law's modifier entry, pre-C6 mapped 1:1. */
export type LawModifierSpec = {
  /** The law name, e.g. `教育改革` — the block's id/source suffix. */
  law: string
  /** The pre-C6 modifier id (`law:<name>` or `law:<name>:<slot>`). */
  modifierId: string
  stat: ModifierStat
  stack: ModifierStack
  value: number
  label: string
}

/**
 * The modifier entry of every law, 1:1 from the pre-C6 `law` case. The static
 * registry below is derived from this table, so the two cannot drift; the
 * migration test additionally pins it against a frozen spec.
 *
 * Do not reorder — install order is part of the behaviour contract.
 */
export const LAW_MODIFIER_SPECS: LawModifierSpec[] = [
  {
    law: '教育改革',
    modifierId: 'law:教育改革',
    stat: 'literacy',
    stack: 'percent',
    value: 10,
    label: '教育改革',
  },
  {
    law: '福利改革',
    modifierId: 'law:福利改革',
    stat: 'radicals',
    stack: 'flat',
    value: -2,
    label: '福利改革',
  },
  {
    law: '自由贸易',
    modifierId: 'law:自由贸易:income',
    stat: 'income',
    stack: 'percent',
    value: 8,
    label: '自由贸易',
  },
  {
    law: '保护关税',
    modifierId: 'law:保护关税:factory',
    stat: 'factoryOutput',
    stack: 'percent',
    value: 12,
    label: '保护关税',
  },
  {
    law: '征兵制',
    modifierId: 'law:征兵制',
    stat: 'armyStrength',
    stack: 'percent',
    value: 10,
    label: '征兵制',
  },
  {
    law: '宗教宽容',
    modifierId: 'law:宗教宽容',
    stat: 'legitimacy',
    stack: 'flat',
    value: 2,
    label: '宗教宽容',
  },
]

/** The block id (and modifier `source`) for a law: `law:<name>`. */
export function lawBlockId(law: string): string {
  return `law:${law}`
}

/** The modifier `source` for a law: `law:<name>`. */
export function lawSource(law: string): string {
  return `law:${law}`
}

/**
 * Shapes one law's modifier entry into a `ConfigBlock` (ADR 0024 §3). The block
 * carries no trigger and no `scales_with`; `lifecycle: 'once'` and the effect's
 * absent `months` give the permanent modifier the pre-C6 law installed.
 */
export function compileLawBlock(spec: LawModifierSpec): ConfigBlock {
  return {
    id: lawBlockId(spec.law),
    kind: 'law',
    label: spec.label,
    potential_trigger: [],
    lifecycle: 'once',
    scales_with: [],
    effects: [
      {
        stat: spec.stat,
        stack: spec.stack,
        value: spec.value,
        label: spec.label,
      },
    ],
  }
}

/**
 * Static registry of every law modifier block (ADR 0024 §7). Derived from
 * `LAW_MODIFIER_SPECS`, so a drift guard only needs to pin the specs.
 */
export const LAW_BLOCKS: ConfigBlock[] = LAW_MODIFIER_SPECS.map(compileLawBlock)

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  LAW_BLOCKS.map(block => [block.id, block]),
)

/** The registered block for a law, or undefined if the registry drifted. */
export function lawBlockFor(law: string): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(lawBlockId(law))
}

/** The spec for a law, or undefined if the law is unknown. */
export function lawSpecFor(law: string): LawModifierSpec | undefined {
  return LAW_MODIFIER_SPECS.find(spec => spec.law === law)
}
