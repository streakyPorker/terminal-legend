import type { Country, Modifier, ModifierStat } from '../types'
import { MODIFIER_CAP } from './config/balance'
import { effectiveModifierValue } from './scale'

/** Every seam a modifier may target, with its Chinese display name. */
export const MODIFIER_STAT_NAMES: Record<ModifierStat, string> = {
  production: '生产',
  grainOutput: '粮食产出',
  woodOutput: '木材产出',
  coalOutput: '煤炭产出',
  ironOutput: '铁矿石产出',
  steelOutput: '钢铁产出',
  fabricOutput: '布料产出',
  clothesOutput: '成衣产出',
  liquorOutput: '酒类产出',
  furnitureOutput: '家具产出',
  machineryOutput: '机械产出',
  armsOutput: '军械产出',
  luxuryOutput: '奢侈品产出',
  opiumOutput: '鸦片产出',
  servicesOutput: '服务产出',
  // Plan 0015 S4: the four new goods (`ships` from PT-066, then the three S4
  // goods) are first-class modifier seams like every other good.
  shipsOutput: '船只产出',
  chemicalsOutput: '化工品产出',
  electricityOutput: '电力产出',
  locomotivesOutput: '机车产出',
  farmOutput: '农业产出',
  mineOutput: '矿业产出',
  factoryOutput: '工厂产出',
  demand: '需求',
  grainDemand: '粮食需求',
  woodDemand: '木材需求',
  coalDemand: '煤炭需求',
  ironDemand: '铁矿石需求',
  steelDemand: '钢铁需求',
  fabricDemand: '布料需求',
  clothesDemand: '成衣需求',
  liquorDemand: '酒类需求',
  furnitureDemand: '家具需求',
  machineryDemand: '机械需求',
  armsDemand: '军械需求',
  luxuryDemand: '奢侈品需求',
  opiumDemand: '鸦片需求',
  servicesDemand: '服务需求',
  // Plan 0015 S4 (see the output block above).
  shipsDemand: '船只需求',
  chemicalsDemand: '化工品需求',
  electricityDemand: '电力需求',
  locomotivesDemand: '机车需求',
  gdp: '国内生产总值',
  income: '收入',
  expense: '支出',
  taxEfficiency: '税收效率',
  literacy: '识字',
  radicals: '激进',
  loyalists: '忠诚',
  legitimacy: '合法性',
  authority: '权威',
  sol: '生活水平',
  growth: '人口增长',
  techPoints: '科技点',
  armyStrength: '陆军战力',
  navyStrength: '海军战力',
  morale: '士气',
  manpower: '人力',
  prestige: '威望',
  unemployment: '失业',
  bureaucracy: '官僚效能',
  bureaucracyCeiling: '官僚上限',
  constructionSpeed: '建造速度',
  constructionCost: '建造花费',
  tariffBargaining: '关税议价能力',
  marketAccess: '市场接入',
  transportInfrastructure: '基础设施',
  administrativeCapacity: '行政能力',
  privateInvestment: '私人投资',
  laborShare: '劳动份额',
  consumption: '消费倾向',
}

export const MODIFIER_STATS = Object.keys(MODIFIER_STAT_NAMES) as ModifierStat[]

/**
 * The documented numeric domain of a modifier seam, where it has one. A stat
 * listed here is clamped to its range **after** stacking, so an out-of-domain
 * modifier cannot blow up its consumers (PT-055). `marketAccess` is a 0–1
 * fraction (0 = autarky, 1 = fully open) that feeds the shared
 * `0.55 + access × 0.9` gate in BOTH construction capacity and production;
 * nothing stopped a天命 `flat +20` from turning that gate into an ~18×
 * multiplier in both paths.
 */
export const MODIFIER_STAT_RANGES: Partial<
  Record<ModifierStat, readonly [number, number]>
> = {
  marketAccess: [0, 1],
  // A price multiplier around 1. The floor keeps a stack of percentage
  // debuffs from turning construction into a source of gold; the ceiling keeps
  // one bad entry bounded.
  constructionCost: [0, 10],
  // Bargaining power is a direct value: 0 (no leverage) to 0.9 (almost the whole
  // tariff is absorbed abroad). The floor keeps a negative stack from flipping
  // the sign and *amplifying* duties.
  tariffBargaining: [0, 0.9],
}

/** Clamps a stacked reading to its declared domain; undeclared stats pass through. */
function clampToDomain(stat: ModifierStat, value: number): number {
  const range = MODIFIER_STAT_RANGES[stat]
  if (range === undefined) return value
  if (!Number.isFinite(value)) return range[0]
  return Math.min(range[1], Math.max(range[0], value))
}

/**
 * Buffs and debuffs. Every numeric seam reads through `applyModifiers`, so a
 * policy, law, event or天命 can stack effects without touching the formula
 * itself.
 *
 * Stacking order (ADR 0004): flat values add, percent values sum into one
 * multiplier, multiply values compound one by one:
 *
 *   (base + Σflat) × (1 + Σpercent / 100) × Π(1 + multiply / 100)
 */
export type ModifierTotals = {
  flat: number
  percent: number
  multiplier: number
}

export function totalsFor(country: Country, stat: ModifierStat): ModifierTotals {
  const totals: ModifierTotals = { flat: 0, percent: 0, multiplier: 1 }
  for (const modifier of country.modifiers ?? []) {
    if (modifier.stat !== stat) continue
    // A block's `scales_with` is applied here, at the consume seam (ADR 0024 §5).
    const value = effectiveModifierValue(country, modifier)
    if (modifier.stack === 'flat') totals.flat += value
    else if (modifier.stack === 'percent') totals.percent += value
    else totals.multiplier *= 1 + value / 100
  }
  return totals
}

/** Reads a base value through every active modifier on `stat`. */
export function applyModifiers(
  country: Country,
  stat: ModifierStat,
  base: number,
): number {
  const totals = totalsFor(country, stat)
  const value = (base + totals.flat) * (1 + totals.percent / 100) * totals.multiplier
  return clampToDomain(stat, value)
}

/** Adds a modifier, replacing one with the same id. */
export function addModifier(country: Country, modifier: Modifier): Modifier {
  if (!Array.isArray(country.modifiers)) country.modifiers = []
  const index = country.modifiers.findIndex(one => one.id === modifier.id)
  if (index >= 0) country.modifiers[index] = modifier
  else country.modifiers.push(modifier)
  if (country.modifiers.length > MODIFIER_CAP) {
    // Plan 0005 §4: evict a timed modifier before a permanent one, so early
    // permanent tech effects are not silently pushed out by later buffs; only
    // when every slot is permanent does the oldest go.
    const timed = country.modifiers.findIndex(one => one.monthsLeft !== undefined)
    country.modifiers.splice(timed >= 0 ? timed : 0, 1)
  }
  return modifier
}

/**
 * Removes every modifier matching `match` and returns how many were dropped.
 * The天命 revoke path (PT-054) uses it so a mistaken cheat buff can be taken
 * back outright instead of being counter-buffed with a permanent opposite entry
 * that still clutters the list.
 */
export function removeModifiers(
  country: Country,
  match: (modifier: Modifier) => boolean,
): number {
  if (!Array.isArray(country.modifiers)) {
    country.modifiers = []
    return 0
  }
  const before = country.modifiers.length
  country.modifiers = country.modifiers.filter(modifier => !match(modifier))
  return before - country.modifiers.length
}

/** Ages timed modifiers by one month and returns the labels that expired. */
export function tickModifiers(country: Country): string[] {
  if (!Array.isArray(country.modifiers)) {
    country.modifiers = []
    return []
  }
  const expired: string[] = []
  const remaining: Modifier[] = []
  for (const modifier of country.modifiers) {
    if (modifier.monthsLeft === undefined) {
      remaining.push(modifier)
      continue
    }
    const monthsLeft = modifier.monthsLeft - 1
    if (monthsLeft <= 0) {
      expired.push(modifier.label)
      continue
    }
    remaining.push({ ...modifier, monthsLeft })
  }
  country.modifiers = remaining
  return expired
}

/** One line for the UI: `label +10%（3 月）` or `label -2（长期）`. */
export function describeModifier(modifier: Modifier): string {
  const value =
    modifier.stack === 'flat'
      ? `${modifier.value >= 0 ? '+' : ''}${modifier.value}`
      : `${modifier.value >= 0 ? '+' : ''}${modifier.value}%`
  const duration =
    modifier.monthsLeft === undefined ? '长期' : `${modifier.monthsLeft} 月`
  return `${modifier.label} ${value}（${duration}）`
}
