import type { Country, TechBranch, TechNodeDef, TechState, WorldState } from '../types'
import { canResearchNode, techNodesInBranch } from './data/tech'
import { addModifier, MODIFIER_STAT_NAMES } from './modifiers'
import {
  LEGITIMACY_MAX,
  LOYALISTS_MAX,
  PRESTIGE_MAX,
  RADICALS_MAX,
} from './config/balance'
import { MORALE_MAX, MORALE_MIN } from './config/military'
import {
  TECH_DIFFUSION_ALLIANCE,
  TECH_DIFFUSION_GAP_COEF,
  TECH_DIFFUSION_MAX,
  TECH_DIFFUSION_RELATION_DIVISOR,
  TECH_DIFFUSION_TRADE_COEF,
  TECH_SCORE_ERA_COEF,
  TECH_SPILL_BASE,
  TECH_SPILL_EDUCATION_COEF,
  TECH_SPILL_LITERACY_COEF,
  TECH_SPILL_MAX,
  TECH_SPILL_MIN,
  TECH_SPILL_UNIVERSITY_DIVISOR,
  TECH_SPILL_UNIVERSITY_MAX,
} from './config/tech'

/**
 * Plan 0005 K2: the behaviour of the tech tree beyond selection and progress —
 * installing a completed node's effects, the cross-branch overflow, and the
 * international diffusion speed bonus. Kept out of `data/tech.ts` (a leaf the
 * `./data` barrel re-exports) because these read and write live country state.
 */

/** The three research branches; a general-line node sits outside them. */
const RESEARCH_BRANCHES = ['industry', 'admin', 'military'] as const satisfies readonly TechBranch[]

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** `era × 10 + unlocked.length`: the comparable tech score used by diffusion. */
export function techScore(country: Country): number {
  return country.tech.era * TECH_SCORE_ERA_COEF + country.tech.unlocked.length
}

/** The 15–25% cross-branch overflow fraction (plan 0005 §2.3). */
export function techSpillRate(country: Country): number {
  const raw =
    TECH_SPILL_BASE +
    country.pops.literacy * TECH_SPILL_LITERACY_COEF +
    Math.min(
      country.econ.buildings.universities / TECH_SPILL_UNIVERSITY_DIVISOR,
      TECH_SPILL_UNIVERSITY_MAX,
    ) +
    country.econ.spending.education * TECH_SPILL_EDUCATION_COEF
  return clampValue(raw, TECH_SPILL_MIN, TECH_SPILL_MAX)
}

function bilateralTradeValue(country: Country, partnerId: string): number {
  let value = 0
  for (const flow of country.trade.exports) if (flow.to === partnerId) value += flow.value
  for (const flow of country.trade.imports) if (flow.from === partnerId) value += flow.value
  return value
}

function pairAtWar(world: WorldState, a: string, b: string): boolean {
  return world.wars.some(
    war =>
      (war.attackers.includes(a) && war.defenders.includes(b)) ||
      (war.defenders.includes(a) && war.attackers.includes(b)),
  )
}

function pairEmbargoed(a: Country, b: Country): boolean {
  return (
    a.embargoes.some(embargo => embargo.target === b.id) ||
    b.embargoes.some(embargo => embargo.target === a.id)
  )
}

/**
 * The international diffusion speed bonus (plan 0005 §2.4), capped at +50%.
 * Only a country behind at least one unblocked partner gains; a war or embargo
 * with that partner zeroes its contribution, so with every advanced partner
 * blocked the bonus is 0.
 */
export function techDiffusionBonus(world: WorldState, country: Country): number {
  const own = techScore(country)
  const totalTrade = country.trade.exportValue + country.trade.importValue
  let best = 0
  for (const partner of Object.values(world.countries)) {
    if (partner.id === country.id) continue
    if (pairAtWar(world, country.id, partner.id)) continue
    if (pairEmbargoed(country, partner)) continue
    const gap = techScore(partner) - own
    if (gap <= 0) continue
    const tradeShare =
      totalTrade > 0 ? bilateralTradeValue(country, partner.id) / totalTrade : 0
    const relation = country.diplo.relations[partner.id] ?? 0
    const alliance = country.diplo.alliances.includes(partner.id) ? 1 : 0
    const bonus =
      gap * TECH_DIFFUSION_GAP_COEF +
      tradeShare * TECH_DIFFUSION_TRADE_COEF +
      relation / TECH_DIFFUSION_RELATION_DIVISOR +
      alliance * TECH_DIFFUSION_ALLIANCE
    if (bonus > best) best = bonus
  }
  return clampValue(best, 0, TECH_DIFFUSION_MAX)
}

/**
 * Installs a completed node's effects (plan 0005 §4). Permanent/timed modifiers
 * go through `addModifier` with `source: 'tech:<id>'`; one-time immediate
 * effects change a stock once, clamped to its range, and never become a monthly
 * flow (ADR 0004). Callers run this exactly once per node completion.
 */
export function installTechNodeEffects(country: Country, node: TechNodeDef): void {
  node.effects.forEach((effect, index) => {
    if (effect.kind === 'modifier') {
      addModifier(country, {
        id: `tech:${node.id}:${index}`,
        label: effect.label ?? `${node.name}·${MODIFIER_STAT_NAMES[effect.stat]}`,
        stat: effect.stat,
        stack: effect.stack,
        value: effect.value,
        source: `tech:${node.id}`,
      })
      return
    }
    if (effect.morale !== undefined) {
      country.military.morale = clampValue(
        country.military.morale + effect.morale,
        MORALE_MIN,
        MORALE_MAX,
      )
    }
    if (effect.loyalists !== undefined) {
      country.pops.loyalists = clampValue(
        country.pops.loyalists + effect.loyalists,
        0,
        LOYALISTS_MAX,
      )
    }
    if (effect.radicals !== undefined) {
      country.pops.radicals = clampValue(
        country.pops.radicals + effect.radicals,
        0,
        RADICALS_MAX,
      )
    }
    if (effect.legitimacy !== undefined) {
      country.government.legitimacy = clampValue(
        country.government.legitimacy + effect.legitimacy,
        0,
        LEGITIMACY_MAX,
      )
    }
    if (effect.prestige !== undefined) {
      country.diplo.prestige = clampValue(
        country.diplo.prestige + effect.prestige,
        0,
        PRESTIGE_MAX,
      )
    }
  })
}

/**
 * The current-era node each *other* branch would research next: the first node
 * in table order whose era gate and prerequisites are satisfied. A general-line
 * main node overflows to all three branches; a branch node to the other two
 * (plan 0005 §2.3).
 */
export function crossBranchTargets(state: TechState, main: TechNodeDef): TechNodeDef[] {
  const targets: TechNodeDef[] = []
  for (const branch of RESEARCH_BRANCHES) {
    if (branch === main.branch) continue
    const node = techNodesInBranch(branch).find(candidate => canResearchNode(state, candidate))
    if (node !== undefined) targets.push(node)
  }
  return targets
}

/**
 * Adds `amount × spillRate` as *extra* progress, split evenly across the other
 * branches' current nodes — the main node keeps its full flow (plan §2.3).
 * Returns the nodes this overflow completed, so the caller can log them; each
 * completion installs its effects exactly once.
 */
export function flowTechOverflow(
  country: Country,
  main: TechNodeDef,
  amount: number,
): TechNodeDef[] {
  const targets = crossBranchTargets(country.tech, main)
  if (targets.length === 0 || amount <= 0) return []
  const perTarget = (amount * techSpillRate(country)) / targets.length
  const completed: TechNodeDef[] = []
  for (const target of targets) {
    if (country.tech.unlocked.includes(target.id)) continue
    const progress = (country.tech.nodes[target.id] ?? 0) + perTarget / target.cost
    if (progress >= 1) {
      country.tech.nodes[target.id] = 1
      country.tech.unlocked.push(target.id)
      installTechNodeEffects(country, target)
      completed.push(target)
    } else {
      country.tech.nodes[target.id] = progress
    }
  }
  return completed
}
