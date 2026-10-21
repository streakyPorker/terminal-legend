import type { ConfigBlock } from '../../types'
import { THRESHOLD_BLOCKS } from './blocks/thresholds'
import { EVENT_BLOCKS } from './blocks/events'
import { SITUATION_BLOCKS } from './blocks/situations'
import { LAW_BLOCKS } from './blocks/laws'
import { WAR_BLOCKS } from './blocks/war'

/**
 * Aggregates every domain block registry into one list, keyed by namespaced id.
 * C5 adds tech here. `engine/blocks.ts` validates this list.
 */
export const BLOCK_REGISTRY: ConfigBlock[] = [
  ...THRESHOLD_BLOCKS,
  ...EVENT_BLOCKS,
  ...SITUATION_BLOCKS,
  ...LAW_BLOCKS,
  ...WAR_BLOCKS,
]

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  BLOCK_REGISTRY.map(block => [block.id, block]),
)

export function findBlock(id: string): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(id)
}
