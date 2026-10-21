import { describe, expect, test } from 'claude-code/testing'
import type { Country, WorldState } from '../types'
import { newWorld } from '../engine/sim'
import { makeRngForWorld } from '../engine/data'
import { applyDecision } from '../engine/actions'
import { addModifier } from '../engine/modifiers'
import { clamp } from '../engine/internal'
import { validateBlockConfig } from '../engine/blocks'
import { findBlock } from '../engine/config/blocks'
import {
  LAW_BLOCKS,
  LAW_MODIFIER_SPECS,
  compileLawBlock,
  lawBlockId,
  lawBlockFor,
  lawSource,
  lawSpecFor,
  type LawModifierSpec,
} from '../engine/config/blocks/laws'

const LAWS = [
  '教育改革',
  '福利改革',
  '自由贸易',
  '保护关税',
  '征兵制',
  '宗教宽容',
] as const

const clone = (c: Country): Country => JSON.parse(JSON.stringify(c)) as Country

const countryOf = (world: WorldState, id: string): Country => {
  const c = world.countries[id]
  if (c === undefined) throw new Error(`missing ${id}`)
  return c
}

const modifierTuples = (c: Country): string[] =>
  c.modifiers
    .map(
      m =>
        `${m.id}|${m.source}|${m.stat}|${m.stack}|${m.value}|${m.label}|${m.monthsLeft ?? ''}`,
    )
    .sort()

// ---- Frozen copy of the pre-C6 `law` branch, used only as an equivalence
// oracle. Do not edit to match new behaviour.
const REF_LAW_AUTHORITY_COST: Record<string, number> = {
  教育改革: 8,
  福利改革: 10,
  自由贸易: 12,
  保护关税: 10,
  征兵制: 15,
  宗教宽容: 5,
}

const REF_FREE_TRADE_TARIFF_FLOOR = 5

function referenceApplyLaw(country: Country, name: string): { ok: boolean; text: string } {
  const tag = `[${country.flag}] ${country.name}`
  if (name === '') return { ok: false, text: `${tag} 未知法案` }
  const legal: Record<string, () => string> = {
    教育改革: () => {
      country.pops.literacy = clamp(country.pops.literacy + 0.04, 0, 1)
      country.econ.spending.education += 0.5
      addModifier(country, {
        id: 'law:教育改革',
        label: '教育改革',
        stat: 'literacy',
        stack: 'percent',
        value: 10,
        source: 'law:教育改革',
      })
      return `${tag} 推行教育改革，识字率上升`
    },
    福利改革: () => {
      country.pops.radicals = clamp(country.pops.radicals - 6, 0, 100)
      country.econ.spending.welfare += 0.5
      addModifier(country, {
        id: 'law:福利改革',
        label: '福利改革',
        stat: 'radicals',
        stack: 'flat',
        value: -2,
        source: 'law:福利改革',
      })
      return `${tag} 推行福利改革，民怨稍减`
    },
    自由贸易: () => {
      const exportRate = country.econ.exportTariff ?? country.econ.tariff
      country.econ.tariff = clamp(
        country.econ.tariff - 8,
        REF_FREE_TRADE_TARIFF_FLOOR,
        60,
      )
      country.econ.exportTariff = clamp(
        exportRate - 8,
        REF_FREE_TRADE_TARIFF_FLOOR,
        60,
      )
      country.econ.marketAccess = clamp(country.econ.marketAccess + 0.08, 0, 1)
      addModifier(country, {
        id: 'law:自由贸易:income',
        label: '自由贸易',
        stat: 'income',
        stack: 'percent',
        value: 8,
        source: 'law:自由贸易',
      })
      return `${tag} 推行自由贸易，进口关税 ${country.econ.tariff.toFixed(0)}%、出口关税 ${country.econ.exportTariff.toFixed(0)}%（下限 ${REF_FREE_TRADE_TARIFF_FLOOR}%），市场接入提高`
    },
    保护关税: () => {
      const exportRate = country.econ.exportTariff ?? country.econ.tariff
      country.econ.tariff = clamp(country.econ.tariff + 8, 0, 60)
      country.econ.exportTariff = clamp(exportRate + 8, 0, 60)
      country.econ.marketAccess = clamp(country.econ.marketAccess - 0.04, 0, 1)
      addModifier(country, {
        id: 'law:保护关税:factory',
        label: '保护关税',
        stat: 'factoryOutput',
        stack: 'percent',
        value: 12,
        source: 'law:保护关税',
      })
      return `${tag} 推行保护关税，国库与工厂受益`
    },
    征兵制: () => {
      country.military.manpower = clamp(
        country.military.manpower + 10,
        0,
        country.pops.total * 0.06,
      )
      country.pops.radicals = clamp(country.pops.radicals + 3, 0, 100)
      addModifier(country, {
        id: 'law:征兵制',
        label: '征兵制',
        stat: 'armyStrength',
        stack: 'percent',
        value: 10,
        source: 'law:征兵制',
      })
      return `${tag} 推行征兵制，人力池扩大`
    },
    宗教宽容: () => {
      country.pops.radicals = clamp(country.pops.radicals - 4, 0, 100)
      country.government.legitimacy = clamp(country.government.legitimacy + 2, 0, 100)
      addModifier(country, {
        id: 'law:宗教宽容',
        label: '宗教宽容',
        stat: 'legitimacy',
        stack: 'flat',
        value: 2,
        source: 'law:宗教宽容',
      })
      return `${tag} 推行宗教宽容，社会稳定`
    },
  }
  const apply = legal[name]
  if (apply === undefined) return { ok: false, text: `${tag} 未知法案 ${name}` }
  const cost = REF_LAW_AUTHORITY_COST[name] ?? 8
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `${tag} 权威不足，无法通过${name}（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)
  return { ok: true, text: apply() }
}

function expectLawEquivalent(seed: number, name: string): void {
  const world = newWorld(seed, 'QING')
  const live = countryOf(world, 'QING')
  live.government.authority = 100
  const ref = clone(live)

  const expected = referenceApplyLaw(ref, name)
  const got = applyDecision(
    world,
    { countryId: 'QING', action: 'law', params: { name } },
    makeRngForWorld(world),
  )

  expect(got).toEqual(expected)
  expect(countryOf(world, 'QING')).toEqual(ref)
}

describe('law migration equivalence (C6, ADR 0024)', () => {
  for (const [index, name] of LAWS.entries()) {
    test(`${name}: direct effects, authority spend and modifier tuple match the pre-C6 oracle`, () => {
      expectLawEquivalent(8200 + index, name)
    })
  }

  test('every law is equivalent on a second seed', () => {
    for (const [index, name] of LAWS.entries()) expectLawEquivalent(8300 + index, name)
  })

  test('the law modifiers keep the pre-C6 id/source shape and stay permanent', () => {
    const world = newWorld(8207, 'QING')
    const qing = countryOf(world, 'QING')
    qing.government.authority = 100
    applyDecision(
      world,
      { countryId: 'QING', action: 'law', params: { name: '自由贸易' } },
      makeRngForWorld(world),
    )
    const modifier = qing.modifiers.find(m => m.source.startsWith('law:'))
    expect(modifier?.id).toBe('law:自由贸易:income')
    expect(modifier?.source).toBe('law:自由贸易')
    expect(modifier?.stat).toBe('income')
    expect(modifier?.stack).toBe('percent')
    expect(modifier?.value).toBe(8)
    expect(modifier?.monthsLeft).toBeUndefined()
  })

  test('re-applying a law overwrites the same modifier id instead of stacking', () => {
    const world = newWorld(8208, 'QING')
    const qing = countryOf(world, 'QING')
    qing.government.authority = 100
    applyDecision(
      world,
      { countryId: 'QING', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    applyDecision(
      world,
      { countryId: 'QING', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    expect(qing.modifiers.filter(m => m.id === 'law:教育改革')).toHaveLength(1)
  })

  test('insufficient authority changes nothing (no modifier installed)', () => {
    const world = newWorld(8209, 'QING')
    const qing = countryOf(world, 'QING')
    qing.government.authority = 1
    const before = modifierTuples(qing)
    const result = applyDecision(
      world,
      { countryId: 'QING', action: 'law', params: { name: '征兵制' } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(false)
    expect(modifierTuples(qing)).toEqual(before)
  })
})

describe('law block registry drift guard (C6)', () => {
  const EXPECTED: LawModifierSpec[] = [
    {
      law: '教育改革',
      modifierId: 'law:教育改革',
      stat: 'literacy',
      stack: 'percent',
      value: 10,
      label: '教育改革',
    },
    {
      law: '福利改革',
      modifierId: 'law:福利改革',
      stat: 'radicals',
      stack: 'flat',
      value: -2,
      label: '福利改革',
    },
    {
      law: '自由贸易',
      modifierId: 'law:自由贸易:income',
      stat: 'income',
      stack: 'percent',
      value: 8,
      label: '自由贸易',
    },
    {
      law: '保护关税',
      modifierId: 'law:保护关税:factory',
      stat: 'factoryOutput',
      stack: 'percent',
      value: 12,
      label: '保护关税',
    },
    {
      law: '征兵制',
      modifierId: 'law:征兵制',
      stat: 'armyStrength',
      stack: 'percent',
      value: 10,
      label: '征兵制',
    },
    {
      law: '宗教宽容',
      modifierId: 'law:宗教宽容',
      stat: 'legitimacy',
      stack: 'flat',
      value: 2,
      label: '宗教宽容',
    },
  ]

  test('the shipped specs match the pre-C6 law table exactly', () => {
    expect(LAW_MODIFIER_SPECS).toEqual(EXPECTED)
    expect(LAW_BLOCKS.map(b => b.id)).toEqual(EXPECTED.map(spec => lawBlockId(spec.law)))
  })

  test('every law maps to exactly one valid block and no extras', () => {
    for (const spec of LAW_MODIFIER_SPECS) {
      const block = findBlock(lawBlockId(spec.law))
      expect(block?.kind).toBe('law')
      expect(block?.label).toBe(spec.label)
      expect(block?.lifecycle).toBe('once')
      expect(block?.potential_trigger).toEqual([])
      expect(block?.scales_with).toEqual([])
      expect(block?.effects).toEqual([
        {
          stat: spec.stat,
          stack: spec.stack,
          value: spec.value,
          label: spec.label,
        },
      ])
      expect(lawBlockFor(spec.law)).toEqual(block)
      expect(lawSpecFor(spec.law)).toEqual(spec)
      expect(lawSource(spec.law)).toBe(lawBlockId(spec.law))
    }
    expect(LAW_BLOCKS.length).toBe(LAW_MODIFIER_SPECS.length)
    expect(validateBlockConfig(LAW_BLOCKS)).toEqual([])
  })

  test('compile shapes a stable block', () => {
    const block = compileLawBlock(EXPECTED[0] as LawModifierSpec)
    expect(block.id).toBe('law:教育改革')
    expect(block.kind).toBe('law')
    expect(validateBlockConfig([block])).toEqual([])
  })
})
