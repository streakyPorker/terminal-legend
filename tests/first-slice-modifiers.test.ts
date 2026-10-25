import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld, spawnEvent } from '../engine/data'
import {
  addModifier,
  applyModifiers,
  describeModifier,
  tickModifiers,
} from '../engine/modifiers'
import {
  advance,
  applyDecision,
  applyEventOption,
  applyPolicy,
  clone,
  inspectEconomy,
  newWorld,
} from '../engine/sim'

// Split out of `first-slice.test.ts` (plan 0012 S6): the buff/debuff stacking
// mechanics and the policy / threshold / event modifier sources.

// ---------------------------------------------------------------- modifiers

describe('buff/debuff stacking', () => {
  test('flat, percent and multiply stack in a fixed order', async () => {
    const world = newWorld(18, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers = [
      { id: 'a', label: '平地', stat: 'production', stack: 'flat', value: 2, source: 'test' },
      { id: 'b', label: '百分比甲', stat: 'production', stack: 'percent', value: 10, source: 'test' },
      { id: 'c', label: '百分比乙', stat: 'production', stack: 'percent', value: 20, source: 'test' },
      { id: 'd', label: '独立乘数', stat: 'production', stack: 'multiply', value: 50, source: 'test' },
    ]
    // (10 + 2) × (1 + 0.10 + 0.20) × 1.50 = 23.4
    expect(Math.abs(applyModifiers(qing, 'production', 10) - 23.4)).toBeLessThan(1e-9)
  })

  test('timed modifiers expire after their months', async () => {
    const world = newWorld(19, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers = []
    addModifier(qing, {
      id: 'timed',
      label: '短暂繁荣',
      stat: 'income',
      stack: 'percent',
      value: 20,
      monthsLeft: 2,
      source: 'test',
    })
    expect(describeModifier(qing.modifiers[0] as never)).toContain('2 月')
    expect(tickModifiers(qing)).toEqual([])
    expect(qing.modifiers[0]?.monthsLeft).toBe(1)
    expect(tickModifiers(qing)).toEqual(['短暂繁荣'])
    expect(qing.modifiers.length).toBe(0)
  })

  test('a monthly advance expires timed modifiers', async () => {
    const world = newWorld(23, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'one-month',
      label: '一个月的恩泽',
      stat: 'income',
      stack: 'percent',
      value: 10,
      monthsLeft: 1,
      source: 'test',
    })
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.id === 'one-month')).toBe(false)
  })

  test('production buffs change computed output', async () => {
    const world = newWorld(20, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    const before = inspectEconomy(prussia).production.fabric
    addModifier(prussia, {
      id: 'factory-boom',
      label: '纺织繁荣',
      stat: 'fabricOutput',
      stack: 'percent',
      value: 50,
      source: 'test',
    })
    expect(inspectEconomy(prussia).production.fabric).toBeGreaterThan(before * 1.45)
  })

  test('laws and events install their modifiers', async () => {
    const world = newWorld(21, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    aus.government.authority = 100
    aus.tech.unlocked.push('admin-2')
    applyDecision(
      world,
      { countryId: 'AUS', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    expect(aus.modifiers.some(one => one.id === 'law:教育改革')).toBe(true)

    const event = {
      id: 'ev-mod',
      date: { ...world.date },
      kind: 'test',
      title: '测试恩泽',
      text: '测试',
      countryId: 'AUS',
      options: [
        {
          id: 'take',
          label: '领受',
          result: '得到祝福',
          effects: {
            modifiers: [
              { stat: 'income', stack: 'percent', value: 15, months: 6, label: '恩泽' },
            ],
          },
        },
      ],
      isResolved: false,
    } as never
    applyEventOption(world, event as never, 'take')
    expect(aus.modifiers.some(one => one.label === '恩泽' && one.monthsLeft === 6)).toBe(true)
  })
})

describe('policy proposals, events and thresholds as buff sources', () => {
  test('a policy proposal costs authority and installs its effects', async () => {
    const world = newWorld(24, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    aus.government.authority = 100
    const result = applyPolicy(world, 'AUS', {
      name: '重商主义',
      authorityCost: 10,
      effects: [
        { stat: 'income', stack: 'percent', value: 10, months: 12 },
        { stat: 'factoryOutput', stack: 'percent', value: 5 },
      ],
    })
    expect(result.ok).toBe(true)
    expect(aus.government.authority).toBe(90)
    expect(aus.modifiers.filter(one => one.source === 'policy:重商主义').length).toBe(2)
    expect(result.text).toContain('重商主义')

    const invalid = applyPolicy(world, 'AUS', {
      name: '错误政策',
      effects: [{ stat: 'nonsense' as never, value: 1 }],
    })
    expect(invalid.ok).toBe(false)
  })

  test('state thresholds grant and lift a while-buff', async () => {
    const world = newWorld(25, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.pops.radicals = 60
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'threshold:unrest')).toBe(true)

    qing.pops.radicals = 0
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'threshold:unrest')).toBe(false)
  })

  test('a once threshold stays after the condition lapses', async () => {
    const world = newWorld(26, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    gbr.pops.literacy = 0.7
    advance(world, 1, [], makeRngForWorld(world))
    expect(gbr.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)

    gbr.pops.literacy = 0.1
    advance(world, 1, [], makeRngForWorld(world))
    expect(gbr.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)
  })

  test('an event option can carry timed modifiers', async () => {
    const world = newWorld(27, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const event = spawnEvent(world, qing, makeRngForWorld(world), 'harvest')
    expect(event).toBeDefined()
    if (event === undefined) return
    applyEventOption(world, event, 'celebrate')
    expect(
      qing.modifiers.some(one => one.label === '丰年余庆' && one.monthsLeft === 6),
    ).toBe(true)
  })
})

describe('modifier stock/flow semantics', () => {
  test('a percent growth buff scales the monthly flow, not the stock', async () => {
    const plain = newWorld(22, 'QING')
    const boosted = clone(plain)
    const qing = boosted.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'growth-buff',
      label: '鼓励生育',
      stat: 'growth',
      stack: 'percent',
      value: 100,
      source: 'test',
    })
    advance(plain, 1, [], makeRngForWorld(plain))
    advance(boosted, 1, [], makeRngForWorld(boosted))
    const plainGrowth = plain.countries.QING?.pops.growth ?? 0
    const boostedGrowth = boosted.countries.QING?.pops.growth ?? 0
    expect(Math.abs(boostedGrowth - plainGrowth * 2)).toBeLessThan(1e-9)
  })
})
