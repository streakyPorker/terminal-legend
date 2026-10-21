import type { ConfigBlock, EventOption } from '../../../types'

/**
 * Event modifier blocks (ADR 0024 §7). One block per `EVENT_TEMPLATES` option
 * that carries `effects.modifiers`; `kind: 'event'`. The static registry key is
 * `event:<templateKind>:<optionId>`, but at install time the block is rebound to
 * the runtime event instance (`event:<runtimeEventId>`) so the modifier `source`
 * and id prefix stay exactly what they were before C3.
 */

/** Static registry key for one event option: `event:<templateKind>:<optionId>`. */
export function eventBlockId(kind: string, optionId: string): string {
  return `event:${kind}:${optionId}`
}

/**
 * Shapes one event option into a `ConfigBlock` (ADR 0024 §3). The block carries
 * no trigger and no `scales_with`; `lifecycle: 'once'` and each effect owns its
 * own `months` (the pre-C3 `monthsLeft`). Modifier entries map 1:1.
 */
export function compileEventBlock(
  kind: string,
  optionId: string,
  title: string,
  modifiers: NonNullable<EventOption['effects']['modifiers']>,
): ConfigBlock {
  return {
    id: eventBlockId(kind, optionId),
    kind: 'event',
    label: title,
    potential_trigger: [],
    lifecycle: 'once',
    scales_with: [],
    effects: modifiers.map(one => ({
      stat: one.stat,
      stack: one.stack ?? 'flat',
      value: one.value,
      label: one.label,
      months: one.months,
    })),
  }
}

/**
 * Rebinds a template block to a concrete event instance. `installBlock` derives
 * `source` from the block id, and the pre-C3 event source was `event:<event.id>`,
 * so the runtime block's id is the runtime event id. The effects (and therefore
 * the `<source>:<index>` modifier ids) are unchanged.
 */
export function instantiateEventBlock(
  block: ConfigBlock,
  runtimeEventId: string,
): ConfigBlock {
  return { ...block, id: `event:${runtimeEventId}` }
}

/**
 * Static registry of every `EVENT_TEMPLATES` option carrying `effects.modifiers`
 * (ADR 0024 §7). Hand-written but drift-guarded: `tests/event-migration.test.ts`
 * asserts a 1:1 match against `EVENT_TEMPLATES`, so the two cannot silently
 * diverge. Do not reorder — install order is part of the behaviour contract.
 */
export const EVENT_BLOCKS: ConfigBlock[] = [
  compileEventBlock('harvest', 'celebrate', '丰年', [
    { stat: 'sol', stack: 'flat', value: 2, months: 6, label: '丰年余庆' },
    { stat: 'growth', stack: 'percent', value: 10, months: 6, label: '丰年余庆' },
  ]),
  compileEventBlock('harvest', 'store', '丰年', [
    { stat: 'income', stack: 'percent', value: 4, months: 6, label: '囤粮溢价' },
  ]),
  compileEventBlock('boom', 'invest', '工业繁荣', [
    { stat: 'factoryOutput', stack: 'percent', value: 10, months: 12, label: '工业投资' },
    { stat: 'techPoints', stack: 'percent', value: 10, months: 12, label: '工业投资' },
  ]),
  compileEventBlock('slump', 'bailout', '经济萧条', [
    { stat: 'income', stack: 'percent', value: 5, months: 6, label: '救市余波' },
    { stat: 'expense', stack: 'percent', value: 5, months: 6, label: '救市余波' },
  ]),
]
