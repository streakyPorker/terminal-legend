import type {
  ConfigBlock,
  ModifierStat,
  ModifierStack,
  WarGoal,
} from '../../../types'

/**
 * War-goal modifier blocks (ADR 0024 §7). One block per modifier a victorious
 * war goal installs (`kind: 'war'`), mapped 1:1 from the pre-C6 inline
 * `addModifier` calls in `engine/diplomacy.ts`'s `applyWarGoal`. Only
 * `openMarket` and `sphere` install modifiers; the direct (non-modifier)
 * effects — tariff/legitimacy changes, sphere assignment, relation declines,
 * indemnities and prestige — stay exactly as they were inline.
 *
 * The static key is `war:<goal>:<side>:<slot>`; at install time the block is
 * rebound to the runtime war (`war:<warId>`) so the modifier `source` and id
 * prefix stay exactly what they were before C6.
 */

/** Which side of a war receives a war-goal modifier. */
export type WarSide = 'winner' | 'loser'

/** One war-goal modifier entry, pre-C6 mapped 1:1. */
export type WarModifierSpec = {
  /** The goal that installs it (`openMarket` / `sphere`). */
  goal: WarGoal
  /** Country the modifier lands on. */
  side: WarSide
  /** Slot suffix distinguishing entries within one (goal, side) pair. */
  slot: string
  stat: ModifierStat
  stack: ModifierStack
  value: number
  label: string
  /** Timed length in months; the pre-C6 `monthsLeft`. */
  months: number
}

/**
 * The modifier entries of every war goal, 1:1 from the pre-C6 `applyWarGoal`.
 * The static registry below is derived from this table, so the two cannot
 * drift; the migration test additionally pins it against a frozen spec.
 *
 * Do not reorder — install order is part of the behaviour contract.
 */
export const WAR_MODIFIER_SPECS: WarModifierSpec[] = [
  {
    goal: 'openMarket',
    side: 'loser',
    slot: 'access',
    stat: 'marketAccess',
    stack: 'flat',
    value: 0.15,
    label: '门户开放',
    months: 24,
  },
  {
    goal: 'openMarket',
    side: 'winner',
    slot: 'income',
    stat: 'income',
    stack: 'percent',
    value: 5,
    label: '通商特权',
    months: 24,
  },
  {
    goal: 'sphere',
    side: 'winner',
    slot: 'access',
    stat: 'marketAccess',
    stack: 'flat',
    value: 0.05,
    label: '势力范围',
    months: 24,
  },
]

/** Registry key for one spec: `war:<goal>:<side>:<slot>`. */
export function warBlockId(spec: WarModifierSpec): string {
  return `war:${spec.goal}:${spec.side}:${spec.slot}`
}

/** The modifier `source` for a war: `war:<warId>`. */
export function warSource(warId: string): string {
  return `war:${warId}`
}

/** The pre-C6 modifier id for one spec: `war:<warId>:<goal>:<slot>`. */
export function warModifierId(warId: string, spec: WarModifierSpec): string {
  return `${warSource(warId)}:${spec.goal}:${spec.slot}`
}

/**
 * Shapes one war modifier spec into a `ConfigBlock` (ADR 0024 §3). The block
 * carries no trigger and no `scales_with`; `lifecycle: 'once'` and the effect's
 * own `months` give the timed case (the pre-C6 `monthsLeft`).
 */
export function compileWarBlock(spec: WarModifierSpec): ConfigBlock {
  return {
    id: warBlockId(spec),
    kind: 'war',
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
        months: spec.months,
      },
    ],
  }
}

/**
 * Rebinds a registry block to a concrete war instance. `installBlock` derives
 * `source` from the block id, and the pre-C6 source was `war:<warId>`, so the
 * runtime block's id is that source. The modifier id is restored separately
 * through `installBlock`'s `modifierId`.
 */
export function instantiateWarBlock(block: ConfigBlock, warId: string): ConfigBlock {
  return { ...block, id: warSource(warId) }
}

/**
 * Static registry of every war-goal modifier entry (ADR 0024 §7). Derived from
 * `WAR_MODIFIER_SPECS`, so a drift guard only needs to pin the specs.
 */
export const WAR_BLOCKS: ConfigBlock[] = WAR_MODIFIER_SPECS.map(compileWarBlock)

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  WAR_BLOCKS.map(block => [block.id, block]),
)

/** The registered block for one spec, or undefined if the registry drifted. */
export function warBlockFor(spec: WarModifierSpec): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(warBlockId(spec))
}

/** The registered specs that land on one side of a goal, in install order. */
export function warSpecsFor(goal: WarGoal, side: WarSide): WarModifierSpec[] {
  return WAR_MODIFIER_SPECS.filter(spec => spec.goal === goal && spec.side === side)
}
