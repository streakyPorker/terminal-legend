import type { Country, PolicyEffect, PolicyProposal, WorldState } from '../../types'
import { MODIFIER_STATS, MODIFIER_STAT_NAMES } from '../modifiers'
import { installBlock, validateBlockConfig } from '../blocks'
import { compilePolicyBlock } from '../config/blocks/policies'
import { clamp, num } from '../internal'
import type { ActionResult } from './types'

/**
 * Validates and applies a policy proposal from the model or the secretary.
 * Magnitudes are free (ADR 0002); the engine checks shapes, costs authority,
 * and turns each effect entry into a modifier (ADR 0003/0004).
 */
/**
 * How a flat policy value translates into "one percent of effect" for
 * authority pricing. Percent/multiply values already are percentages; flat
 * values need a stat-specific scale (e.g. literacy is a 0..1 fraction, so a
 * flat +0.5 is +50 points, not +0.5).
 */
const POLICY_FLAT_SCALE: Partial<Record<PolicyEffect['stat'], number>> = {
  literacy: 100,
  marketAccess: 100,
  laborShare: 100,
  privateInvestment: 100,
  consumption: 100,
  growth: 1000,
  taxEfficiency: 100,
  gdp: 2,
  income: 2,
  expense: 2,
  techPoints: 2,
  production: 2,
  demand: 2,
  farmOutput: 2,
  mineOutput: 2,
  factoryOutput: 2,
}

const flatScale = (stat: PolicyEffect['stat']): number => {
  if (stat.endsWith('Output') || stat.endsWith('Demand')) return 2
  // The default treats one flat point of a 0..100 stock/flow stat as a
  // substantial effect (10 "percent-equivalent" points).
  return POLICY_FLAT_SCALE[stat] ?? 10
}

export type EffectValidation =
  | { ok: true; effects: PolicyEffect[] }
  | { ok: false; text: string }

/**
 * The single effect-entry validator shared by policies and situations (ADR 0003:
 * the engine checks shapes, magnitudes are free). Rejects a non-`ModifierStat`,
 * a non-finite value, `|value| > 200`, a >100% capped-stat entry and a bad
 * stack; clamps `months` into 1..240. Returns normalized entries. Slicing to
 * `maxCount` happens here so a situation's `maxEffects` envelope reuses the
 * exact policy rule.
 */
export function validateEffects(raw: PolicyEffect[], maxCount = 12): EffectValidation {
  const effects = Array.isArray(raw) ? raw.slice(0, maxCount) : []
  const parsed: PolicyEffect[] = []
  for (const effect of effects) {
    if (!MODIFIER_STATS.includes(effect.stat)) {
      return { ok: false, text: `未知修正对象 ${String(effect.stat)}` }
    }
    const value = Number(effect.value)
    if (!Number.isFinite(value)) return { ok: false, text: '效果数值必须是有限数字。' }
    if (Math.abs(value) > 200) {
      return { ok: false, text: '单个效果数值不能超过 200（防止无界政策）' }
    }
    const cappedStat =
      effect.stat === 'gdp' ||
      effect.stat === 'consumption' ||
      effect.stat === 'demand' ||
      effect.stat === 'production' ||
      effect.stat.endsWith('Output') ||
      effect.stat.endsWith('Demand')
    if (cappedStat && (effect.stack ?? 'flat') !== 'flat' && Math.abs(value) > 100) {
      return {
        ok: false,
        text: `「${MODIFIER_STAT_NAMES[effect.stat]}」类修正单条不得超过 100%`,
      }
    }
    const stack = effect.stack ?? 'flat'
    if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
      return { ok: false, text: '效果单位必须是 flat / percent / multiply。' }
    }
    const months =
      effect.months === undefined
        ? undefined
        : Math.min(240, Math.max(1, Math.round(Number(effect.months))))
    if (months !== undefined && !Number.isFinite(months)) {
      return { ok: false, text: '持续月数必须是数字。' }
    }
    parsed.push({
      stat: effect.stat,
      stack,
      value,
      months,
      label: effect.label,
    })
  }
  return { ok: true, effects: parsed }
}

export function applyPolicy(
  world: WorldState,
  countryId: string,
  proposal: PolicyProposal,
): ActionResult {
  const country = world.countries[countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${countryId}` }
  const name = String(proposal.name ?? '').trim().slice(0, 40)
  if (name === '') return { ok: false, text: '政策需要一个名称。' }
  const rawEffects = Array.isArray(proposal.effects) ? proposal.effects : []
  if (rawEffects.length === 0) return { ok: false, text: '政策至少需要一个效果条目。' }
  const validated = validateEffects(rawEffects)
  if (!validated.ok) return { ok: false, text: validated.text }
  const parsed = validated.effects

  // Compile the proposal into a `policy:<name>` block and re-run the C1
  // invariant validator on it. The shape checks above already produce today's
  // error surface, so this branch is a guard, not a user-facing path.
  const block = compilePolicyBlock(name, parsed)
  const violations = validateBlockConfig([block])
  if (violations.length > 0) {
    return { ok: false, text: violations.join('；') }
  }

  // Authority cost scales with the effect's magnitude and duration. This keeps
  // a permanent +50% GDP policy from costing the same 5 points as a +2% one
  // (round-2 playtest P0-3).
  const weight = parsed.reduce((sum, effect) => {
    // A permanent effect is priced as 48 months; flat values are converted to
    // percentage-equivalent units by stat scale.
    const months = effect.months ?? 48
    const magnitude =
      effect.stack === 'flat'
        ? Math.abs(effect.value) * flatScale(effect.stat)
        : Math.abs(effect.value)
    return sum + magnitude * (months / 12)
  }, 0)
  const required = clamp(Math.round(weight * 0.2), 1, 40)
  // PT-060: a caller-supplied `authorityCost` is authoritative. The old
  // `Math.max(required, requested)` silently overrode it, so a 4-entry policy
  // priced at 40 by magnitude charged 40 even when the caller passed 15. Only
  // when the caller omits the cost does the magnitude-derived charge apply.
  const requested = clamp(Math.round(num(proposal.authorityCost, 5)), 1, 40)
  const cost = proposal.authorityCost === undefined ? Math.max(required, requested) : requested
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `权威不足，无法推行「${name}」（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)

  // Install through the block engine: the modifiers get `source = policy:<name>`
  // and flow through the same stack path as thresholds. The id scheme stays the
  // historical one — a permanent effect replaces any earlier permanent effect on
  // the same stat/stack (`policy:<stat>:<stack>`), a timed effect keeps its own
  // slot (`policy:<name>:<index>`) and expires normally.
  installBlock(country, block, {
    upkeep: cost / 48 / parsed.length,
    modifierId: (effect, index) =>
      effect.months === undefined
        ? `policy:${effect.stat}:${effect.stack}`
        : `${block.id}:${index}`,
  })

  const summary = parsed
    .map(
      effect =>
        `${MODIFIER_STAT_NAMES[effect.stat]} ${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}${effect.months === undefined ? '' : `（${effect.months} 月）`}`,
    )
    .join('；')
  const text = `[${country.flag}] ${country.name} 推行政策「${name}」：${summary}（权威 -${cost}）`
  world.log.push({
    date: { ...world.date },
    kind: 'politics',
    countryId: country.id,
    text,
  })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text }
}
