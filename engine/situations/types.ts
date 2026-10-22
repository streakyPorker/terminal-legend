import type {
  Condition,
  ModifierStat,
  PolicyEffect,
  WorldState,
} from '../../types'

/** The soft bounds a situation lets a proposal touch (plan 0002 §1). */
export type SituationEnvelope = {
  stats: ModifierStat[]
  maxEffects: number
  monthsRange: [number, number]
}

/**
 * One trigger clause; every clause is AND-connected. A clause holds when its
 * declarative `conditions` (read against `countryId`) hold AND its optional
 * `predicate` returns true. The predicate is the escape hatch for
 * world-spanning triggers a flat condition list cannot express — the
 * opium-crisis gate reads trade flows, wars and a bilateral relation.
 */
export type SituationTrigger = {
  conditions: Condition[]
  countryId?: string
  predicate?: (world: WorldState) => boolean
}

/** A deterministic fallback proposal, used when a participant submits none. */
export type SituationDefaultProposal = {
  stance: string
  narrative: string
  effects: PolicyEffect[]
  pressure?: PolicyEffect[]
}

/**
 * A data-driven situation/event-tree node (plan 0002 §1). The engine owns the
 * trigger, the envelope, the resolution mode and the deterministic modifiers;
 * the agent only ever produces proposals.
 */
export type SituationDefinition = {
  id: string
  title: string
  triggers: SituationTrigger[]
  participants: string[]
  /** Engine-generated historical context fed to a proposing agent. */
  context: (world: WorldState) => string
  envelope: SituationEnvelope
  order: 'simultaneous' | 'sequential'
  resolve: 'engine' | 'arbiter-agent'
  /** Allowed stance ids; any other stance is rejected. */
  stances: string[]
  /** Display names for stances; falls back to the raw stance id. */
  stanceNames?: Record<string, string>
  /** Outcome ids for `resolve: 'arbiter-agent'` (the engine's preset packs). */
  outcomes?: string[]
  /** Display names for outcomes; falls back to a stance name, then the id. */
  outcomeNames?: Record<string, string>
  /** One fallback proposal per participant id, used when none is submitted. */
  defaults?: Record<string, SituationDefaultProposal>
  /** Exact open log line; a generic one is used when absent. */
  openText?: string
  /** Resolution log template; `{title}` and `{outcome}` are substituted. */
  resolveText?: string
}
