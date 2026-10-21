import type { ConfigBlock } from '../../types'
import { THRESHOLD_BLOCKS } from './blocks/thresholds'

/**
 * Aggregates every domain block registry into one list, keyed by namespaced id.
 * C2+ adds policies/events/etc. here. `engine/blocks.ts` validates this list.
 */
export const BLOCK_REGISTRY: ConfigBlock[] = [...THRESHOLD_BLOCKS]

const BLOCK_BY_ID = new Map<string, ConfigBlock>(
  BLOCK_REGISTRY.map(block => [block.id, block]),
)

export function findBlock(id: string): ConfigBlock | undefined {
  return BLOCK_BY_ID.get(id)
}
