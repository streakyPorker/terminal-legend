import { describe, expect, test } from 'claude-code/testing'
import type {
  Condition,
  ConditionStat,
  ConfigBlock,
  Country,
  Modifier,
  ModifierStack,
  ScaleSpec,
  WorldState,
} from '../types'
import { evaluateBlocks, testCondition, validateBlockConfig } from '../engine/blocks'
import {
  curveOutput,
  effectiveModifierValue,
  scaleProduct,
  scaledValue,
} from '../engine/scale'
import { BLOCK_REGISTRY, findBlock } from '../engine/config/blocks'
import { THRESHOLD_BLOCKS } from '../engine/config/blocks/thresholds'
import { evaluateThresholds } from '../engine/thresholds'
import { addModifier, applyModifiers, tickModifiers } from '../engine/modifiers'
import { makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'

const country = (seed: number, id = 'QING'): { world: WorldState; c: Country } => {
  const world = newWorld(seed, id)
  const c = world.countries[id]
  if (c === undefined) throw new Error(`missing ${id}`)
  return { world, c }
}

const clone = (c: Country): Country => JSON.parse(JSON.stringify(c)) as Country

const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

const stripThresholds = (c: Country): void => {
  c.modifiers = c.modifiers.filter(modifier => !modifier.source.startsWith('threshold:'))
}

const thresholdTuples = (c: Country): string[] =>
  c.modifiers
    .filter(modifier => modifier.source.startsWith('threshold:'))
    .map(
      modifier =>
        `${modifier.id}|${modifier.source}|${modifier.stat}|${modifier.stack}|${modifier.value}|${modifier.label}|${modifier.monthsLeft ?? ''}`,
    )
    .sort()

type OldCondition = { stat: ConditionStat; op: '>=' | '<=' | '>' | '<'; value: number }
type OldRule = {
  id: string
  label: string
  mode: 'while' | 'once'
  conditions: OldCondition[]
  modifiers: { stat: Modifier['stat']; stack?: ModifierStack; value: number; label?: string }[]
}

// Frozen copy of the pre-C1 THRESHOLD_RULES, used purely as an equivalence
// oracle in the tests below. Do not edit to match new behaviour.
const OLD_RULES: OldRule[] = [
  {
    id: 'unrest',
    label: '民怨沸腾',
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
    mode: 'while',
    conditions: [{ stat: 'radicals', op: '>=', value: 78 }],
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
    mode: 'while',
    conditions: [{ stat: 'radicals', op: '>=', value: 92 }],
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
    mode: 'while',
    conditions: [{ stat: 'debtRatio', op: '>=', value: 1.5 }],
    modifiers: [
      { stat: 'expense', stack: 'percent', value: 10 },
      { stat: 'taxEfficiency', stack: 'percent', value: -8 },
    ],
  },
  {
    id: 'industrial-takeoff',
    label: '工业起飞',
    mode: 'while',
    conditions: [{ stat: 'factories', op: '>=', value: 100 }],
    modifiers: [{ stat: 'factoryOutput', stack: 'percent', value: 10 }],
  },
  {
    id: 'mass-unemployment',
    label: '失业潮',
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
    mode: 'once',
    conditions: [{ stat: 'literacy', op: '>=', value: 0.6 }],
    modifiers: [
      { stat: 'techPoints', stack: 'percent', value: 15 },
      { stat: 'legitimacy', stack: 'flat', value: 2 },
    ],
  },
]

function oldReadStat(c: Country, stat: ConditionStat): number {
  switch (stat) {
    case 'radicals':
      return c.pops.radicals
    case 'loyalists':
      return c.pops.loyalists
    case 'literacy':
      return c.pops.literacy
    case 'legitimacy':
      return c.government.legitimacy
    case 'authority':
      return c.government.authority
    case 'sol':
      return c.pops.sol
    case 'unemployment':
      return c.econ.unemployment
    case 'bureaucracy':
      return c.bureaucracy.score
    case 'treasury':
      return c.econ.treasury
    case 'debt':
      return Math.max(0, -c.econ.treasury)
    case 'debtRatio':
      return Math.max(0, -c.econ.treasury) / Math.max(1, c.econ.gdp)
    case 'gdp':
      return c.econ.gdp
    case 'army':
      return c.military.army
    case 'navy':
      return c.military.navy
    case 'techLevel':
      return c.tech.level
    case 'factories':
      return c.econ.buildings.factories
    case 'prestige':
      return c.diplo.prestige
    case 'income':
      return c.econ.income
    case 'expense':
      return c.econ.expense
    default:
      return 0
  }
}

function oldTest(value: number, op: OldCondition['op'], bound: number): boolean {
  if (op === '>=') return value >= bound
  if (op === '<=') return value <= bound
  if (op === '>') return value > bound
  return value < bound
}

function referenceEvaluateThresholds(c: Country): { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  const known = new Set(OLD_RULES.map(rule => `threshold:${rule.id}`))
  c.modifiers = c.modifiers.filter(modifier => {
    if (!modifier.source.startsWith('threshold:')) return true
    if (known.has(modifier.source)) return true
    removed.push(modifier.label ?? modifier.source)
    return false
  })
  for (const rule of OLD_RULES) {
    const source = `threshold:${rule.id}`
    const active = c.modifiers.some(modifier => modifier.source === source)
    const met = rule.conditions.every(condition =>
      oldTest(oldReadStat(c, condition.stat), condition.op, condition.value),
    )
    if (met && !active) {
      rule.modifiers.forEach((modifier, index) => {
        addModifier(c, {
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
      c.modifiers = c.modifiers.filter(modifier => modifier.source !== source)
      removed.push(rule.label)
    }
  }
  return { added, removed }
}

describe('ConfigBlock lifecycle (engine/blocks.ts)', () => {
  test('while adds on fire and removes when the trigger lapses', () => {
    const { c } = country(9010)
    c.pops.radicals = 60
    const fired = evaluateBlocks(c, THRESHOLD_BLOCKS)
    expect(fired.added).toContain('民怨沸腾')
    expect(c.modifiers.some(one => one.source === 'threshold:unrest')).toBe(true)

    c.pops.radicals = 0
    const lapsed = evaluateBlocks(c, THRESHOLD_BLOCKS)
    expect(lapsed.removed).toContain('民怨沸腾')
    expect(c.modifiers.some(one => one.source === 'threshold:unrest')).toBe(false)
  })

  test('once installs permanently and survives a lapsed trigger', () => {
    const { c } = country(9011, 'GBR')
    c.pops.literacy = 0.7
    expect(evaluateBlocks(c, THRESHOLD_BLOCKS).added).toContain('启蒙时代')
    expect(c.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)

    c.pops.literacy = 0.1
    const lapsed = evaluateBlocks(c, THRESHOLD_BLOCKS)
    expect(lapsed.removed).not.toContain('启蒙时代')
    expect(c.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)
  })

  test('duration installs for N months, expires, then re-arms if still triggered', () => {
    const { c } = country(9012)
    const block: ConfigBlock = {
      id: 'threshold:test-duration',
      kind: 'threshold',
      label: '限时',
      potential_trigger: [{ stat: 'radicals', op: '>=', value: 1 }],
      lifecycle: 'duration',
      months: 3,
      scales_with: [],
      effects: [{ stat: 'income', stack: 'flat', value: 5 }],
    }
    c.pops.radicals = 50
    evaluateBlocks(c, [block])
    const installed = c.modifiers.find(one => one.source === block.id)
    expect(installed?.monthsLeft).toBe(3)

    tickModifiers(c)
    expect(c.modifiers.find(one => one.source === block.id)?.monthsLeft).toBe(2)
    tickModifiers(c)
    tickModifiers(c)
    expect(c.modifiers.some(one => one.source === block.id)).toBe(false)

    evaluateBlocks(c, [block])
    expect(c.modifiers.find(one => one.source === block.id)?.monthsLeft).toBe(3)
  })

  test('an effect’s own trigger is ANDed with the block’s', () => {
    const { c } = country(9013)
    const block: ConfigBlock = {
      id: 'threshold:test-and',
      kind: 'threshold',
      label: 'AND',
      potential_trigger: [{ stat: 'radicals', op: '>=', value: 50 }],
      lifecycle: 'while',
      scales_with: [],
      effects: [
        { stat: 'income', stack: 'flat', value: 1 },
        {
          stat: 'expense',
          stack: 'flat',
          value: 2,
          potential_trigger: [{ stat: 'legitimacy', op: '>=', value: 90 }],
        },
      ],
    }
    c.pops.radicals = 60
    c.government.legitimacy = 10
    evaluateBlocks(c, [block])
    expect(c.modifiers.some(one => one.id === 'threshold:test-and:0')).toBe(true)
    expect(c.modifiers.some(one => one.id === 'threshold:test-and:1')).toBe(false)

    c.government.legitimacy = 95
    evaluateBlocks(c, [block])
    expect(c.modifiers.some(one => one.id === 'threshold:test-and:1')).toBe(true)
  })
})

describe('scales_with curves and the consume seam (engine/scale.ts)', () => {
  test('linear and steps curves clamp to their min/max', () => {
    close(curveOutput({ kind: 'linear', slope: 0.1 }, 30), 3)
    close(curveOutput({ kind: 'linear', slope: 0.1, max: 2 }, 30), 2)
    close(curveOutput({ kind: 'linear', slope: 0.01, min: 0.5 }, 30), 0.5)
    close(curveOutput({ kind: 'linear', slope: 1, offset: 2 }, 3), 5)
    const steps = {
      kind: 'steps' as const,
      points: [
        { at: 0, value: 1 },
        { at: 50, value: 2 },
      ],
      max: 1.5,
    }
    close(curveOutput(steps, 60), 1.5)
    close(curveOutput(steps, 10), 1)
    expect(curveOutput(steps, -1)).toBe(0)
  })

  test('scale product multiplies curves; effective value scales at the seam', () => {
    const { c } = country(9014)
    c.pops.radicals = 30
    c.government.legitimacy = 60
    const specs: ScaleSpec[] = [
      { stat: 'radicals', curve: { kind: 'linear', slope: 0.1, min: 0.5, max: 2 } },
      {
        stat: 'legitimacy',
        curve: {
          kind: 'steps',
          points: [
            { at: 0, value: 1 },
            { at: 50, value: 2 },
          ],
          max: 1.5,
        },
      },
    ]
    close(scaleProduct(c, specs), 3)
    close(scaledValue(c, 10, specs), 30)

    const scaled: ConfigBlock = {
      id: 'threshold:scaled',
      kind: 'threshold',
      label: '缩放',
      potential_trigger: [],
      lifecycle: 'while',
      scales_with: specs,
      effects: [],
    }
    const modifier: Modifier = {
      id: 'threshold:scaled:0',
      label: '缩放',
      stat: 'income',
      stack: 'flat',
      value: 10,
      source: 'threshold:scaled',
    }
    close(effectiveModifierValue(c, modifier, () => scaled), 30)
    expect(effectiveModifierValue(c, modifier, () => undefined)).toBe(10)
    expect(
      effectiveModifierValue(c, modifier, () => ({ ...scaled, scales_with: [] })),
    ).toBe(10)
  })

  test('applyModifiers keeps the ADR-0004 stacking for unscaled sources', () => {
    const { c } = country(9015)
    c.modifiers = []
    addModifier(c, { id: 'a', label: 'a', stat: 'income', stack: 'flat', value: 10, source: 'policy:x' })
    addModifier(c, { id: 'b', label: 'b', stat: 'income', stack: 'percent', value: 20, source: 'event:y' })
    addModifier(c, { id: 'c', label: 'c', stat: 'income', stack: 'multiply', value: 50, source: 'law:z' })
    close(applyModifiers(c, 'income', 100), (100 + 10) * 1.2 * 1.5)
  })
})

describe('config invariants (ADR 0024 §11)', () => {
  test('the shipped registry is valid with 9 threshold blocks', () => {
    expect(validateBlockConfig(BLOCK_REGISTRY)).toEqual([])
    expect(BLOCK_REGISTRY.length).toBe(9)
    expect(findBlock('threshold:stability')?.kind).toBe('threshold')
  })

  test('validation rejects duplicates, bad stats, unordered steps and bare duration', () => {
    const base: ConfigBlock = {
      id: 'threshold:bad',
      kind: 'threshold',
      label: 'bad',
      potential_trigger: [],
      lifecycle: 'while',
      scales_with: [],
      effects: [{ stat: 'income', stack: 'flat', value: 1 }],
    }
    const badStat: ConfigBlock = {
      ...base,
      effects: [{ stat: 'nonsense' as never, stack: 'flat', value: 1 }],
    }
    const unreadableScale: ConfigBlock = {
      ...base,
      id: 'threshold:scale',
      scales_with: [{ stat: 'production', curve: { kind: 'linear', slope: 1 } }],
    }
    const unordered: ConfigBlock = {
      ...base,
      id: 'threshold:steps',
      scales_with: [
        {
          stat: 'radicals',
          curve: {
            kind: 'steps',
            points: [
              { at: 5, value: 1 },
              { at: 1, value: 2 },
            ],
          },
        },
      ],
    }
    const bareDuration: ConfigBlock = {
      ...base,
      id: 'threshold:bare',
      lifecycle: 'duration',
    }
    const duplicated: ConfigBlock[] = [base, { ...base }]

    expect(validateBlockConfig([base])).toEqual([])
    expect(validateBlockConfig(duplicated)).toContain('duplicate block id: threshold:bad')
    expect(validateBlockConfig([badStat]).some(e => e.includes('invalid effect stat'))).toBe(true)
    expect(validateBlockConfig([unreadableScale]).some(e => e.includes('not a real source'))).toBe(true)
    expect(validateBlockConfig([unordered]).some(e => e.includes('increase strictly'))).toBe(true)
    expect(validateBlockConfig([bareDuration]).some(e => e.includes('positive months'))).toBe(true)
  })

  test('testCondition covers all six operators', () => {
    const cases: { v: number; op: Condition['op']; b: number; want: boolean }[] = [
      { v: 2, op: '>', b: 1, want: true },
      { v: 1, op: '>', b: 1, want: false },
      { v: 1, op: '>=', b: 1, want: true },
      { v: 0, op: '<', b: 1, want: true },
      { v: 1, op: '<=', b: 1, want: true },
      { v: 1, op: '==', b: 1, want: true },
      { v: 1, op: '!=', b: 2, want: true },
      { v: 1, op: '!=', b: 1, want: false },
    ]
    for (const one of cases) expect(testCondition(one.v, one.op, one.b)).toBe(one.want)
  })
})

describe('migration equivalence with the old thresholds system', () => {
  test('the adapter delegates to the block engine', () => {
    const a = country(9016).c
    const b = country(9016).c
    a.pops.radicals = 80
    b.pops.radicals = 80
    expect(evaluateThresholds(a)).toEqual(evaluateBlocks(b, THRESHOLD_BLOCKS))
    expect(thresholdTuples(a)).toEqual(thresholdTuples(b))
  })

  test('synthetic states produce identical fired blocks and modifier values', () => {
    const states: Partial<Record<string, number>>[] = [
      { radicals: 5, legitimacy: 70, literacy: 0.7, debtRatio: 0, factories: 0, unemployment: 0, bureaucracy: 0 },
      { radicals: 55, legitimacy: 70, literacy: 0.5, debtRatio: 0, factories: 0, unemployment: 0, bureaucracy: 0 },
      { radicals: 99, legitimacy: 30, literacy: 0.5, debtRatio: 2, factories: 120, unemployment: 25, bureaucracy: 80 },
      { radicals: 0, legitimacy: 20, literacy: 0, debtRatio: 0.5, factories: 0, unemployment: 3, bureaucracy: 10 },
    ]
    for (const state of states) {
      const fresh = country(9017).c
      fresh.modifiers = []
      fresh.pops.radicals = state.radicals ?? 0
      fresh.government.legitimacy = state.legitimacy ?? 0
      fresh.pops.literacy = state.literacy ?? 0
      fresh.econ.gdp = 100
      fresh.econ.treasury = -((state.debtRatio ?? 0) * fresh.econ.gdp)
      fresh.econ.buildings.factories = state.factories ?? 0
      fresh.econ.unemployment = state.unemployment ?? 0
      fresh.bureaucracy.score = state.bureaucracy ?? 0

      const now = stripClone(fresh)
      const ref = stripClone(fresh)
      const nowEvents = evaluateBlocks(now, THRESHOLD_BLOCKS)
      const refEvents = referenceEvaluateThresholds(ref)
      expect(nowEvents).toEqual(refEvents)
      expect(thresholdTuples(now)).toEqual(thresholdTuples(ref))
    }
  })

  test('a 3-seed × 18-month multi-country run stays bit-identical to the reference', () => {
    for (const seed of [100, 200, 300]) {
      const world = newWorld(seed, 'QING')
      for (let month = 0; month < 18; month += 1) {
        advance(world, 1, [], makeRngForWorld(world))
        for (const live of Object.values(world.countries)) {
          const now = stripClone(live)
          const ref = stripClone(live)
          const nowEvents = evaluateBlocks(now, THRESHOLD_BLOCKS)
          const refEvents = referenceEvaluateThresholds(ref)
          expect(nowEvents).toEqual(refEvents)
          expect(thresholdTuples(now)).toEqual(thresholdTuples(ref))
        }
      }
    }
  })
})

function stripClone(c: Country): Country {
  const copy = clone(c)
  stripThresholds(copy)
  return copy
}
