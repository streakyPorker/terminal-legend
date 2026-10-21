import type { ConfigBlock } from '../../types'
import { THRESHOLD_BLOCKS } from './blocks/thresholds'
import { EVENT_BLOCKS } from './blocks/events'
import { SITUATION_BLOCKS } from './blocks/situations'
import { LAW_BLOCKS } from './blocks/laws'
import { WAR_BLOCKS } from './blocks/war'
import { TECH_MULTIPLIER_BLOCK } from './blocks/tech'
import { DEBT_PRESSURE_BLOCK } from './blocks/fiscal'
import { GATE_BLOCKS } from './blocks/gates'

/**
 * Aggregates every domain block registry into one list, keyed by namespaced id.
 * `engine/blocks.ts` validates this list. The `tech` / `fiscal` / `economy`
 * declarations (C5, C7) are multipliers read at their own seams, not installed
 * as modifiers, but they live here so the invariants are checked in one place.
 */
export const BLOCK_REGISTRY: ConfigBlock[] = [
  ...THRESHOLD_BLOCKS,
  ...EVENT_BLOCKS,
  ...SITUATION_BLOCKS,
  ...LAW_BLOCKS,
  ...WAR_BLOCKS,
  TECH_MULTIPLIER_BLOCK,
  DEBT_PRESSURE_BLOCK,
  ...GATE_BLOCKS,
]

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  BLOCK_REGISTRY.map(block => [block.id, block]),
)

export function findBlock(id: string): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(id)
}
