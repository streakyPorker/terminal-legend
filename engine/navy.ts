import type { Blockade, Country, GoodId, SeaControlTier, War, WarSeaControl, WorldState } from '../types'
import { applyModifiers } from './modifiers'
import { clamp } from './internal'
import {
  NAVAL_CONTROL_ADVANTAGE,
  NAVAL_CONTROL_COMPLETE,
  NAVAL_CONTROL_DISADVANTAGE,
  NAVAL_CONTROL_PARITY,
  SEA_SCORE_ADVANTAGE,
  SEA_SCORE_COMPLETE,
  WAR_SCORE_LIMIT,
} from './config/military'

// Plan 0015 §S5 / ADR 0031 §7: the minimal navy. `navalQuality` (seeded per
// country in `data/countries.ts`) scales `navy` into `seaPower`; the monthly
// belligerent ratio yields a five-tier sea control that scores war points and
// lets the stronger side cut its enemy's third-party trade. Split out of
// `diplomacy.ts` so neither module carries two concerns.

/**
 * A country's fleet strength, `navy × navalQuality × (1 + navyStrength/100)`.
 * `navyStrength` is read through `applyModifiers` (exactly as `strength()` reads
 * `armyStrength`), so a percent modifier is the `(1 + percent/100)` factor;
 * `techTier` is deliberately NOT a factor (review M11). No tech node grants
 * `navyStrength` in the 20-node table, so the factor is 1.0 in the baseline and
 * moves only via a policy/modifier.
 */
export function seaPowerOf(country: Country): number {
  const base = country.military.navy * country.military.navalQuality
  return applyModifiers(country, 'navyStrength', base)
}

/** Chinese display names for the five sea-control tiers (plan §S5). */
export const SEA_CONTROL_TIER_NAMES: Record<SeaControlTier, string> = {
  complete: '完全控制',
  advantage: '优势',
  parity: '均势',
  disadvantage: '劣势',
  lost: '丧失',
}

const SEA_SCORE_BY_TIER: Record<SeaControlTier, number> = {
  complete: SEA_SCORE_COMPLETE,
  advantage: SEA_SCORE_ADVANTAGE,
  parity: 0,
  disadvantage: 0,
  lost: 0,
}

const HOLDS_SEA_CONTROL: readonly SeaControlTier[] = ['advantage', 'complete']

/** Own:enemy sea-power ratio; infinite when the enemy has no sea power at all. */
function controlRatio(own: number, enemy: number): number {
  if (enemy <= 0) return own > 0 ? Number.POSITIVE_INFINITY : 1
  return own / enemy
}

/** The tier a `seaPower` ratio earns (plan §S5: 2.0 / 1.25 / 0.8 / 0.5 edges). */
export function seaControlTier(ratio: number): SeaControlTier {
  if (!Number.isFinite(ratio) || ratio >= NAVAL_CONTROL_COMPLETE) return 'complete'
  if (ratio >= NAVAL_CONTROL_ADVANTAGE) return 'advantage'
  if (ratio >= NAVAL_CONTROL_PARITY) return 'parity'
  if (ratio >= NAVAL_CONTROL_DISADVANTAGE) return 'disadvantage'
  return 'lost'
}

function sideSeaPower(world: WorldState, ids: string[]): number {
  let total = 0
  for (const id of ids) {
    const country = world.countries[id]
    if (country !== undefined) total += seaPowerOf(country)
  }
  return total
}

/**
 * Recomputes and stores one war's `seaControl` (plan §S5), preserving any
 * blockades already declared. Exported so a blockade declaration can read the
 * current reading without waiting for the next monthly tick.
 */
export function updateSeaControl(world: WorldState, war: War): WarSeaControl {
  const attackerTier = seaControlTier(
    controlRatio(sideSeaPower(world, war.attackers), sideSeaPower(world, war.defenders)),
  )
  const defenderTier = seaControlTier(
    controlRatio(sideSeaPower(world, war.defenders), sideSeaPower(world, war.attackers)),
  )
  const power: Record<string, number> = {}
  const tier: Record<string, SeaControlTier> = {}
  for (const id of war.attackers) {
    const country = world.countries[id]
    power[id] = country === undefined ? 0 : seaPowerOf(country)
    tier[id] = attackerTier
  }
  for (const id of war.defenders) {
    const country = world.countries[id]
    power[id] = country === undefined ? 0 : seaPowerOf(country)
    tier[id] = defenderTier
  }
  const control: WarSeaControl = { power, tier, blockades: war.seaControl?.blockades ?? [] }
  war.seaControl = control
  return control
}

/**
 * Per-month sea control (plan §S5). Called **before** the trade clearing so a
 * blockade bites the same month; adds the war score too — 优势 +0.75/month,
 * 完全控制 +1.5 (the enemy's tier scores for the other side), 均势 0.
 */
export function resolveSeaControl(world: WorldState): void {
  for (const war of world.wars) {
    const control = updateSeaControl(world, war)
    const attackerId = war.attackers[0]
    const defenderId = war.defenders[0]
    const attackerTier =
      attackerId === undefined ? 'parity' : (control.tier[attackerId] ?? 'parity')
    const defenderTier =
      defenderId === undefined ? 'parity' : (control.tier[defenderId] ?? 'parity')
    const delta = SEA_SCORE_BY_TIER[attackerTier] - SEA_SCORE_BY_TIER[defenderTier]
    if (delta !== 0) {
      war.warScore = clamp(war.warScore + delta, -WAR_SCORE_LIMIT, WAR_SCORE_LIMIT)
    }
  }
}

/**
 * Whether a candidate trade is severed by a standing blockade (plan §S5): the
 * blockader still holds sea control over the enemy, the trade's other end is the
 * enemy's third party (or the named `party`), and the good matches when the
 * blockade names one. The enemy↔blockader route is already cut by `atWar`.
 */
export function blockadeBlocks(
  world: WorldState,
  importerId: string,
  exporterId: string,
  good: GoodId,
): boolean {
  for (const war of world.wars) {
    const control = war.seaControl
    if (control === undefined) continue
    for (const blockade of control.blockades) {
      const holder = control.tier[blockade.by]
      if (holder === undefined || !HOLDS_SEA_CONTROL.includes(holder)) continue
      let other: string
      if (importerId === blockade.enemy) other = exporterId
      else if (exporterId === blockade.enemy) other = importerId
      else continue
      if (other === blockade.enemy || other === blockade.by) continue
      if (blockade.party !== undefined && other !== blockade.party) continue
      if (blockade.good !== undefined && good !== blockade.good) continue
      return true
    }
  }
  return false
}

/**
 * Declares a blockade (plan §S5): the pair must be at war and `by` must hold
 * advantage/complete sea control. `party` narrows it to one third country,
 * `good` to one good. Returns the war, or undefined when the prerequisite
 * fails; the caller owns the infamy/relation cost.
 */
export function declareBlockade(world: WorldState, blockade: Blockade): War | undefined {
  const war = world.wars.find(
    one =>
      (one.attackers.includes(blockade.by) && one.defenders.includes(blockade.enemy)) ||
      (one.defenders.includes(blockade.by) && one.attackers.includes(blockade.enemy)),
  )
  if (war === undefined) return undefined
  if (
    blockade.party !== undefined &&
    (blockade.party === blockade.by ||
      blockade.party === blockade.enemy ||
      world.countries[blockade.party] === undefined)
  ) {
    return undefined
  }
  const control = updateSeaControl(world, war)
  const holder = control.tier[blockade.by]
  if (holder === undefined || !HOLDS_SEA_CONTROL.includes(holder)) return undefined
  const exists = control.blockades.some(
    one =>
      one.by === blockade.by &&
      one.enemy === blockade.enemy &&
      one.party === blockade.party &&
      one.good === blockade.good,
  )
  if (!exists) {
    control.blockades.push({
      by: blockade.by,
      enemy: blockade.enemy,
      party: blockade.party,
      good: blockade.good,
    })
  }
  return war
}

/** Lifts every matching blockade; returns how many records were removed. */
export function liftBlockade(world: WorldState, blockade: Blockade): number {
  let lifted = 0
  for (const war of world.wars) {
    const control = war.seaControl
    if (control === undefined) continue
    const before = control.blockades.length
    control.blockades = control.blockades.filter(
      one =>
        !(
          one.by === blockade.by &&
          one.enemy === blockade.enemy &&
          one.party === blockade.party &&
          one.good === blockade.good
        ),
    )
    lifted += before - control.blockades.length
  }
  return lifted
}
