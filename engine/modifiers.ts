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
  marketAccess: '市场接入',
  transportInfrastructure: '基础设施',
  administrativeCapacity: '行政能力',
  privateInvestment: '私人投资',
  laborShare: '劳动份额',
  consumption: '消费倾向',
}

export const MODIFIER_STATS = Object.keys(MODIFIER_STAT_NAMES) as ModifierStat[]

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
  return (base + totals.flat) * (1 + totals.percent / 100) * totals.multiplier
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
