import type {
  Condition,
  ConditionOp,
  ConfigBlock,
  Country,
  Modifier,
  ModifierStack,
} from '../types'
import { addModifier, MODIFIER_STATS } from './modifiers'
import { READABLE_STATS, readStatValue } from './scale'

export type BlockEvents = {
  added: string[]
  removed: string[]
}

const VALID_STACKS: ReadonlySet<ModifierStack> = new Set<ModifierStack>([
  'flat',
  'percent',
  'multiply',
])

const VALID_OPS: ReadonlySet<ConditionOp> = new Set<ConditionOp>([
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '!=',
])

export function testCondition(
  value: number,
  op: ConditionOp,
  bound: number,
): boolean {
  switch (op) {
    case '>=':
      return value >= bound
    case '<=':
      return value <= bound
    case '>':
      return value > bound
    case '<':
      return value < bound
    case '==':
      return value === bound
    case '!=':
      return value !== bound
    default:
      return false
  }
}

function conditionsHold(country: Country, conditions: Condition[]): boolean {
  return conditions.every(condition =>
    testCondition(
      readStatValue(country, condition.stat),
      condition.op,
      condition.value,
    ),
  )
}

function effectMonths(block: ConfigBlock, effect: ConfigBlock['effects'][number]): number | undefined {
  if (effect.months !== undefined) return effect.months
  if (block.lifecycle === 'duration') return block.months
  return undefined
}

function withMonths(modifier: Modifier, months: number | undefined): Modifier {
  if (months === undefined) return modifier
  return { ...modifier, monthsLeft: months }
}

/**
 * Runs every block once (same cadence as the old `evaluateThresholds`).
 *
 * - `while`: held while the trigger holds, removed when it lapses.
 * - `once`: installed permanently on first fire.
 * - `duration`: installed for `months` months, then re-armed if still triggered.
 *
 * Each effect's own `potential_trigger` is ANDed with the block's. A modifier's
 * `source` is the block id; its id is `<block.id>:<effectIndex>`. Sources of a
 * managed kind that no longer exist are cleaned up (old-save hygiene).
 */
export function evaluateBlocks(
  country: Country,
  blocks: ConfigBlock[],
): BlockEvents {
  const added: string[] = []
  const removed: string[] = []
  const managedKinds = new Set(blocks.map(block => block.id.split(':')[0]))
  const knownSources = new Set(blocks.map(block => block.id))

  country.modifiers = country.modifiers.filter(modifier => {
    if (!managedKinds.has(modifier.source.split(':')[0])) return true
    if (knownSources.has(modifier.source)) return true
    removed.push(modifier.label ?? modifier.source)
    return false
  })

  for (const block of blocks) {
    const source = block.id
    const active = country.modifiers.some(modifier => modifier.source === source)
    const blockMet = conditionsHold(country, block.potential_trigger)

    block.effects.forEach((effect, index) => {
      const id = `${source}:${index}`
      const present = country.modifiers.some(modifier => modifier.id === id)
      if (!blockMet || present) return
      if (
        effect.potential_trigger !== undefined &&
        !conditionsHold(country, effect.potential_trigger)
      ) {
        return
      }
      addModifier(
        country,
        withMonths(
          {
            id,
            label: effect.label ?? block.label,
            stat: effect.stat,
            stack: effect.stack,
            value: effect.value,
            source,
          },
          effectMonths(block, effect),
        ),
      )
    })

    if (blockMet && !active) {
      added.push(block.label)
    } else if (blockMet === false && active && block.lifecycle === 'while') {
      country.modifiers = country.modifiers.filter(
        modifier => modifier.source !== source,
      )
      removed.push(block.label)
    }
  }

  return { added, removed }
}

/** Returns human-readable invariant violations for a block config (ADR 0024 §11). */
export function validateBlockConfig(blocks: ConfigBlock[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    const where = block.id || '<unnamed>'
    if (seen.has(block.id)) errors.push(`duplicate block id: ${block.id}`)
    seen.add(block.id)

    if (block.lifecycle === 'duration' && !(block.months !== undefined && block.months > 0)) {
      errors.push(`${where}: duration lifecycle needs a positive months`)
    }

    for (const condition of block.potential_trigger) {
      if (!VALID_OPS.has(condition.op)) {
        errors.push(`${where}: invalid condition op '${condition.op}'`)
      }
      if (!READABLE_STATS.has(condition.stat)) {
        errors.push(`${where}: unreadable condition stat '${condition.stat}'`)
      }
    }

    for (const spec of block.scales_with) {
      if (!READABLE_STATS.has(spec.stat)) {
        errors.push(`${where}: scales_with.stat '${spec.stat}' is not a real source`)
      }
      if (spec.curve.kind === 'steps') {
        let previous: number | undefined
        for (const point of spec.curve.points) {
          if (previous !== undefined && point.at <= previous) {
            errors.push(`${where}: steps.points must increase strictly by 'at'`)
            break
          }
          previous = point.at
        }
      }
    }

    for (const effect of block.effects) {
      if (!MODIFIER_STATS.includes(effect.stat)) {
        errors.push(`${where}: invalid effect stat '${effect.stat}'`)
      }
      if (!VALID_STACKS.has(effect.stack)) {
        errors.push(`${where}: invalid effect stack '${effect.stack}'`)
      }
      if (effect.potential_trigger !== undefined) {
        for (const condition of effect.potential_trigger) {
          if (!READABLE_STATS.has(condition.stat)) {
            errors.push(`${where}: unreadable effect condition stat '${condition.stat}'`)
          }
        }
      }
    }
  }

  return errors
}
