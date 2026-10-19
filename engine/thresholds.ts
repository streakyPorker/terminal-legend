import type {
  Country,
  LogEntry,
  ModifierStat,
  ModifierStack,
  WorldState,
} from '../types'
import { addModifier } from './modifiers'

/** Raw country readings a threshold rule may test. */
export type ThresholdStat =
  | 'radicals'
  | 'loyalists'
  | 'literacy'
  | 'legitimacy'
  | 'authority'
  | 'sol'
  | 'unemployment'
  | 'bureaucracy'
  | 'treasury'
  | 'debt'
  | 'debtRatio'
  | 'gdp'
  | 'army'
  | 'navy'
  | 'techLevel'
  | 'factories'
  | 'prestige'
  | 'income'
  | 'expense'

export type ThresholdCondition = {
  stat: ThresholdStat
  op: '>=' | '<=' | '>' | '<'
  value: number
}

export type ThresholdRule = {
  id: string
  label: string
  description: string
  /** `while`: the buff lifts when the condition falls. `once`: permanent. */
  mode: 'while' | 'once'
  conditions: ThresholdCondition[]
  modifiers: {
    stat: ModifierStat
    stack?: ModifierStack
    value: number
    label?: string
  }[]
}

function readStat(country: Country, stat: ThresholdStat): number {
  switch (stat) {
    case 'radicals':
      return country.pops.radicals
    case 'loyalists':
      return country.pops.loyalists
    case 'literacy':
      return country.pops.literacy
    case 'legitimacy':
      return country.government.legitimacy
    case 'authority':
      return country.government.authority
    case 'sol':
      return country.pops.sol
    case 'unemployment':
      return country.econ.unemployment
    case 'bureaucracy':
      return country.bureaucracy.score
    case 'treasury':
      return country.econ.treasury
    case 'debt':
      return country.econ.debt
    case 'debtRatio':
      return country.econ.debt / Math.max(1, country.econ.gdp)
    case 'gdp':
      return country.econ.gdp
    case 'army':
      return country.military.army
    case 'navy':
      return country.military.navy
    case 'techLevel':
      return country.tech.level
    case 'factories':
      return country.econ.buildings.factories
    case 'prestige':
      return country.diplo.prestige
    case 'income':
      return country.econ.income
    case 'expense':
      return country.econ.expense
    default:
      return 0
  }
}

function test(value: number, op: ThresholdCondition['op'], bound: number): boolean {
  if (op === '>=') return value >= bound
  if (op === '<=') return value <= bound
  if (op === '>') return value > bound
  return value < bound
}

/**
 * Starter rule set. These are state-driven, not story templates: a rule
 * grants a modifier while its conditions hold (or once, permanently), and
 * the buff is visible in the council panel like any other.
 */
export const THRESHOLD_RULES: ThresholdRule[] = [
  {
    id: 'unrest',
    label: '民怨沸腾',
    description: '激进达到 50',
    mode: 'while',
    conditions: [{ stat: 'radicals', op: '>=', value: 50 }],
    modifiers: [
      { stat: 'income', stack: 'percent', value: -8 },
      { stat: 'constructionSpeed', stack: 'percent', value: -10 },
    ],
  },
  {
    id: 'stability',
    label: '社会安定',
    description: '激进不高于 10 且合法性达到 65',
    mode: 'while',
    conditions: [
      { stat: 'radicals', op: '<=', value: 10 },
      { stat: 'legitimacy', op: '>=', value: 65 },
    ],
    modifiers: [
      { stat: 'taxEfficiency', stack: 'percent', value: 6 },
      { stat: 'growth', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'revolutionary-crisis',
    label: '革命危机',
    description: '激进达到 80',
    mode: 'while',
    conditions: [{ stat: 'radicals', op: '>=', value: 80 }],
    modifiers: [
      { stat: 'income', stack: 'percent', value: -20 },
      { stat: 'constructionSpeed', stack: 'percent', value: -30 },
      { stat: 'legitimacy', stack: 'flat', value: -2 },
      { stat: 'armyStrength', stack: 'percent', value: -10 },
    ],
  },
  {
    id: 'state-collapse',
    label: '国家崩解',
    description: '激进达到 95',
    mode: 'while',
    conditions: [{ stat: 'radicals', op: '>=', value: 95 }],
    modifiers: [
      { stat: 'income', stack: 'percent', value: -35 },
      { stat: 'constructionSpeed', stack: 'percent', value: -50 },
      { stat: 'armyStrength', stack: 'percent', value: -20 },
      { stat: 'authority', stack: 'flat', value: -3 },
    ],
  },
  {
    id: 'debt-crisis',
    label: '债台高筑',
    description: '债务超过 GDP 的 1.5 倍',
    mode: 'while',
    conditions: [{ stat: 'debtRatio', op: '>=', value: 1.5 }],
    modifiers: [
      { stat: 'expense', stack: 'percent', value: 10 },
      { stat: 'taxEfficiency', stack: 'percent', value: -8 },
    ],
  },
  {
    id: 'bankrupt',
    label: '财政崩溃',
    description: '国库见底且债务达到 50',
    mode: 'while',
    conditions: [
      { stat: 'treasury', op: '<=', value: 0 },
      { stat: 'debt', op: '>=', value: 50 },
    ],
    modifiers: [
      { stat: 'income', stack: 'percent', value: -10 },
      { stat: 'legitimacy', stack: 'flat', value: -3 },
    ],
  },
  {
    id: 'industrial-takeoff',
    label: '工业起飞',
    description: '工厂达到 100 座',
    mode: 'while',
    conditions: [{ stat: 'factories', op: '>=', value: 100 }],
    modifiers: [{ stat: 'factoryOutput', stack: 'percent', value: 10 }],
  },
  {
    id: 'mass-unemployment',
    label: '失业潮',
    description: '失业率达到 20%',
    mode: 'while',
    conditions: [{ stat: 'unemployment', op: '>=', value: 20 }],
    modifiers: [
      { stat: 'income', stack: 'percent', value: -5 },
      { stat: 'legitimacy', stack: 'flat', value: -1 },
    ],
  },
  {
    id: 'efficient-state',
    label: '高效行政',
    description: '官僚效能达到 70',
    mode: 'while',
    conditions: [{ stat: 'bureaucracy', op: '>=', value: 70 }],
    modifiers: [
      { stat: 'constructionSpeed', stack: 'percent', value: 10 },
      { stat: 'income', stack: 'percent', value: 4 },
    ],
  },
  {
    id: 'enlightenment',
    label: '启蒙时代',
    description: '识字率达到 60%（一次性）',
    mode: 'once',
    conditions: [{ stat: 'literacy', op: '>=', value: 0.6 }],
    modifiers: [
      { stat: 'techPoints', stack: 'percent', value: 15 },
      { stat: 'legitimacy', stack: 'flat', value: 2 },
    ],
  },
]

export type ThresholdEvents = {
  added: string[]
  removed: string[]
}

/**
 * Evaluates every rule after the month's numbers settle. `while` buffs are
 * removed when their condition lapses; `once` buffs stay forever.
 */
export function evaluateThresholds(country: Country): ThresholdEvents {
  const added: string[] = []
  const removed: string[] = []
  for (const rule of THRESHOLD_RULES) {
    const source = `threshold:${rule.id}`
    const active = country.modifiers.some(modifier => modifier.source === source)
    const met = rule.conditions.every(condition =>
      test(readStat(country, condition.stat), condition.op, condition.value),
    )
    if (met && !active) {
      rule.modifiers.forEach((modifier, index) => {
        addModifier(country, {
          id: `${source}:${index}`,
          label: modifier.label ?? rule.label,
          stat: modifier.stat,
          stack: modifier.stack ?? 'flat',
          value: modifier.value,
          source,
        })
      })
      added.push(rule.label)
    } else if (!met && active && rule.mode === 'while') {
      country.modifiers = country.modifiers.filter(modifier => modifier.source !== source)
      removed.push(rule.label)
    }
  }
  return { added, removed }
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
