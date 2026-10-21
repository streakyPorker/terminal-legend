import { describe, expect, test } from 'claude-code/testing'
import type { Country, PolicyEffect, PolicyProposal, WorldState } from '../types'
import { applyPolicy } from '../engine/actions'
import { newWorld } from '../engine/sim'
import {
  MODIFIER_STATS,
  MODIFIER_STAT_NAMES,
  addModifier,
} from '../engine/modifiers'
import { clamp, num } from '../engine/internal'
import { installBlock, validateBlockConfig } from '../engine/blocks'
import { compilePolicyBlock } from '../engine/config/blocks/policies'

const qing = (world: WorldState): Country => {
  const c = world.countries.QING
  if (c === undefined) throw new Error('missing QING')
  return c
}

const tuples = (c: Country): string[] =>
  c.modifiers
    .map(m =>
      [m.id, m.source, m.stat, m.stack, String(m.value), m.label,
        String(m.monthsLeft ?? ''), String(m.upkeep ?? '')].join('|'),
    )
    .sort()

// ---- Frozen copy of the pre-C2 applyPolicy, used only as an equivalence oracle.
// Do not edit to match new behaviour.
const POLICY_FLAT_SCALE_REF: Partial<Record<PolicyEffect['stat'], number>> = {
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

const flatScaleRef = (stat: PolicyEffect['stat']): number => {
  if (stat.endsWith('Output') || stat.endsWith('Demand')) return 2
  return POLICY_FLAT_SCALE_REF[stat] ?? 10
}

function referenceApplyPolicy(
  country: Country,
  proposal: PolicyProposal,
): { ok: boolean; text: string } {
  const name = String(proposal.name ?? '').trim().slice(0, 40)
  if (name === '') return { ok: false, text: '政策需要一个名称。' }
  const effects = Array.isArray(proposal.effects) ? proposal.effects.slice(0, 12) : []
  if (effects.length === 0) return { ok: false, text: '政策至少需要一个效果条目。' }

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

  const weight = parsed.reduce((sum, effect) => {
    const months = effect.months ?? 48
    const magnitude =
      effect.stack === 'flat'
        ? Math.abs(effect.value) * flatScaleRef(effect.stat)
        : Math.abs(effect.value)
    return sum + magnitude * (months / 12)
  }, 0)
  const required = clamp(Math.round(weight * 0.2), 1, 40)
  const requested = clamp(Math.round(num(proposal.authorityCost, 5)), 1, 40)
  const cost = Math.max(required, requested)
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `权威不足，无法推行「${name}」（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)

  parsed.forEach((effect, index) => {
    const id =
      effect.months === undefined
        ? `policy:${effect.stat}:${effect.stack ?? 'flat'}`
        : `policy:${name}:${index}`
    addModifier(country, {
      id,
      label: effect.label ?? name,
      stat: effect.stat,
      stack: effect.stack ?? 'flat',
      value: effect.value,
      monthsLeft: effect.months,
      upkeep: cost / 48 / parsed.length,
      source: `policy:${name}`,
    })
  })

  const summary = parsed
    .map(
      effect =>
        `${MODIFIER_STAT_NAMES[effect.stat]} ${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}${effect.months === undefined ? '' : `（${effect.months} 月）`}`,
    )
    .join('；')
  const text = `[${country.flag}] ${country.name} 推行政策「${name}」：${summary}（权威 -${cost}）`
  return { ok: true, text }
}

type Scenario = { authority?: number; proposals: PolicyProposal[] }

function expectEquivalent(seed: number, scenario: Scenario): void {
  const worldNew = newWorld(seed, 'QING')
  const worldRef = newWorld(seed, 'QING')
  const cNew = qing(worldNew)
  const cRef = qing(worldRef)
  if (scenario.authority !== undefined) {
    cNew.government.authority = scenario.authority
    cRef.government.authority = scenario.authority
  }
  for (const proposal of scenario.proposals) {
    const got = applyPolicy(worldNew, 'QING', proposal)
    const want = referenceApplyPolicy(cRef, proposal)
    expect(got.ok).toBe(want.ok)
    expect(got.text).toBe(want.text)
    expect(cNew.government.authority).toBe(cRef.government.authority)
    expect(tuples(cNew)).toEqual(tuples(cRef))
  }
}

describe('policy migration equivalence (C2, ADR 0024)', () => {
  test('within-cap single effect matches the pre-C2 authority charge and modifier tuple', () => {
    expectEquivalent(5001, {
      authority: 100,
      proposals: [
        { name: '重商主义', effects: [{ stat: 'factoryOutput', stack: 'percent', value: 5 }] },
      ],
    })
  })

  test('over-200 magnitudes are rejected with the same text', () => {
    expectEquivalent(5002, {
      authority: 100,
      proposals: [
        { name: '疯狂', effects: [{ stat: 'gdp', stack: 'percent', value: 100000 }] },
      ],
    })
  })

  test('gdp/demand side caps at 100% match, exactly at and over the boundary', () => {
    expectEquivalent(5003, {
      authority: 200,
      proposals: [
        { name: '过度刺激', effects: [{ stat: 'demand', stack: 'percent', value: 150 }] },
        { name: '适度刺激', effects: [{ stat: 'demand', stack: 'percent', value: 100 }] },
        { name: '生产上限', effects: [{ stat: 'production', stack: 'percent', value: 100 }] },
        { name: '粮食产出超限', effects: [{ stat: 'grainOutput', stack: 'percent', value: 120 }] },
      ],
    })
  })

  test('multi-effect policies (mixed stacks, timed + permanent) match', () => {
    expectEquivalent(5004, {
      authority: 200,
      proposals: [
        {
          name: '大工程',
          authorityCost: 40,
          effects: [
            { stat: 'gdp', stack: 'percent', value: 100 },
            { stat: 'income', stack: 'flat', value: 20 },
            { stat: 'factoryOutput', stack: 'multiply', value: 5, months: 18 },
            { stat: 'radicals', stack: 'flat', value: -2, label: '安抚' },
          ],
        },
      ],
    })
  })

  test('upkeep matches cost/48/effects and is present on every modifier', () => {
    const worldNew = newWorld(5005, 'QING')
    const cNew = qing(worldNew)
    cNew.government.authority = 100
    const worldRef = newWorld(5005, 'QING')
    const cRef = qing(worldRef)
    cRef.government.authority = 100
    const proposal: PolicyProposal = {
      name: '文武并举',
      effects: [
        { stat: 'income', stack: 'percent', value: 10 },
        { stat: 'expense', stack: 'percent', value: -5 },
        { stat: 'armyStrength', stack: 'percent', value: 8, months: 24 },
      ],
    }
    const got = applyPolicy(worldNew, 'QING', proposal)
    const want = referenceApplyPolicy(cRef, proposal)
    expect(got).toEqual(want)
    expect(tuples(cNew)).toEqual(tuples(cRef))
    const spent = 100 - cNew.government.authority
    for (const m of cNew.modifiers) {
      expect(Math.abs((m.upkeep ?? 0) - spent / 48 / 3)).toBeLessThan(1e-12)
    }
  })

  test('a later permanent policy replaces an earlier one on the same stat/stack', () => {
    expectEquivalent(5006, {
      authority: 100,
      proposals: [
        { name: '增长甲', effects: [{ stat: 'gdp', stack: 'percent', value: 50 }] },
        { name: '增长乙', effects: [{ stat: 'gdp', stack: 'percent', value: 50 }] },
      ],
    })
  })

  test('a timed effect keeps its own slot and does not clobber the permanent one', () => {
    expectEquivalent(5007, {
      authority: 200,
      proposals: [
        {
          name: '限时增长',
          effects: [{ stat: 'gdp', stack: 'percent', value: 40, months: 12 }],
        },
        { name: '长期增长', effects: [{ stat: 'gdp', stack: 'percent', value: 20 }] },
      ],
    })
  })

  test('insufficient authority is rejected identically', () => {
    expectEquivalent(5008, {
      authority: 2,
      proposals: [
        { name: '干不起', effects: [{ stat: 'gdp', stack: 'percent', value: 100 }] },
      ],
    })
  })

  test('unknown stat and bad stack are rejected with the same text', () => {
    expectEquivalent(5009, {
      authority: 100,
      proposals: [
        { name: '怪对象', effects: [{ stat: 'nonsense' as never, value: 1 }] },
        { name: '怪单位', effects: [{ stat: 'income', stack: 'weird' as never, value: 1 }] },
        { name: '', effects: [{ stat: 'income', value: 1 }] },
        { name: '空效果', effects: [] },
      ],
    })
  })

  test('flat-valued flow policies are priced by stat scale, identically', () => {
    expectEquivalent(5010, {
      authority: 200,
      proposals: [
        { name: '清除民怨', effects: [{ stat: 'radicals', stack: 'flat', value: -2 }] },
        { name: '全民识字', effects: [{ stat: 'literacy', stack: 'flat', value: 0.5 }] },
        { name: '集中权力', effects: [{ stat: 'authority', stack: 'flat', value: 5 }] },
      ],
    })
  })
})

describe('compilePolicyBlock / installBlock (C2 unit)', () => {
  test('a policy compiles to a valid policy block with 1:1 effects', () => {
    const block = compilePolicyBlock('测试', [
      { stat: 'income', stack: 'percent', value: 10 },
      { stat: 'radicals', stack: 'flat', value: -2, months: 6, label: '安抚' },
    ])
    expect(block.id).toBe('policy:测试')
    expect(block.kind).toBe('policy')
    expect(block.lifecycle).toBe('once')
    expect(block.potential_trigger).toEqual([])
    expect(block.effects).toEqual([
      { stat: 'income', stack: 'percent', value: 10, label: undefined, months: undefined },
      { stat: 'radicals', stack: 'flat', value: -2, label: '安抚', months: 6 },
    ])
    expect(validateBlockConfig([block])).toEqual([])
  })

  test('installBlock installs with source = block id and the given upkeep', () => {
    const world = newWorld(5100, 'QING')
    const c = qing(world)
    const block = compilePolicyBlock('测试', [
      { stat: 'income', stack: 'percent', value: 10 },
    ])
    installBlock(c, block, { upkeep: 0.5 })
    const installed = c.modifiers.filter(m => m.source === 'policy:测试')
    expect(installed.length).toBe(1)
    expect(installed[0]?.id).toBe('policy:测试:0')
    expect(installed[0]?.upkeep).toBe(0.5)
    expect(installed[0]?.monthsLeft).toBeUndefined()
  })
})
