/**
 * Situation/event-tree barrel (plan 0002). The folder replaces the old
 * `engine/situations.ts` file so every `./situations` import path is unchanged;
 * `opium.ts` keeps the original crisis bit-for-bit, `registry.ts` is the
 * data-driven definition list, and `engine.ts` is the generic mechanism.
 */
export * from './opium'
export * from './registry'
export * from './engine'
export * from './conflict'
export type {
  SituationDefinition,
  SituationDefaultProposal,
  SituationEnvelope,
  SituationTrigger,
} from './types'
