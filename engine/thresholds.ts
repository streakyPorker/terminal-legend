import type { Country, LogEntry, WorldState } from '../types'
import { evaluateBlocks } from './blocks'
import { THRESHOLD_BLOCKS } from './config/blocks/thresholds'

export type ThresholdEvents = {
  added: string[]
  removed: string[]
}

/**
 * Threshold buffs are now ConfigBlocks (kind `threshold`). This adapter keeps
 * the historical call site working; evaluation lives in `engine/blocks.ts`.
 */
export function evaluateThresholds(country: Country): ThresholdEvents {
  return evaluateBlocks(country, THRESHOLD_BLOCKS)
}

/** Logs threshold changes into the chronicle. */
export function logThresholds(
  world: WorldState,
  country: Country,
  events: ThresholdEvents,
  log: LogEntry[],
): void {
  const tag = `[${country.flag}] ${country.name}`
  for (const label of events.added) {
    log.push({
      date: { ...world.date },
      kind: 'politics',
      countryId: country.id,
      text: `${tag}：时势催生「${label}」`,
    })
  }
  for (const label of events.removed) {
    log.push({
      date: { ...world.date },
      kind: 'politics',
      countryId: country.id,
      text: `${tag}：「${label}」随局势消退`,
    })
  }
}
