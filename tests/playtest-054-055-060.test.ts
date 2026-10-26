import { describe, expect, test } from 'claude-code/testing'
import type { Country, PolicyEffect, WorldState } from '../types'
import { applyCheat } from '../engine/cheat'
import { addModifier, applyModifiers } from '../engine/modifiers'
import { applyPolicy, constructionCapacity, inspectEconomy, newWorld } from '../engine/sim'

const qing = (world: WorldState): Country => {
  const country = world.countries.QING
  if (country === undefined) throw new Error('missing QING')
  return country
}

const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

const cheatCount = (c: Country): number =>
  c.modifiers.filter(one => one.source === 'cheat').length

// ---------------------------------------------------------------- PT-054

describe('PT-054: cheat modifiers can be revoked', () => {
  test('removeModifier drops a天命 modifier and reverses its effect', () => {
    const world = newWorld(5401, 'QING')
    const c = qing(world)
    c.modifiers = []
    const baseline = applyModifiers(c, 'income', 100)

    const applied = applyCheat(world, {
      action: 'modifier',
      stat: 'income',
      stack: 'percent',
      value: 40,
      label: '天命·增收',
    })
    expect(applied.ok).toBe(true)
    expect(cheatCount(c)).toBe(1)
    close(applyModifiers(c, 'income', 100), baseline * 1.4)

    const removed = applyCheat(world, { action: 'removeModifier', label: '天命·增收' })
    expect(removed.ok).toBe(true)
    expect(cheatCount(c)).toBe(0)
    close(applyModifiers(c, 'income', 100), baseline)
  })

  test('removeModifier targets a stable id and refuses when nothing matches', () => {
    const world = newWorld(5402, 'QING')
    const c = qing(world)
    c.modifiers = []
    applyCheat(world, {
      action: 'modifier',
      id: 'cheat:prod',
      stat: 'production',
      stack: 'flat',
      value: 5,
    })
    applyCheat(world, {
      action: 'modifier',
      id: 'cheat:other',
      stat: 'income',
      stack: 'flat',
      value: 3,
    })
    expect(cheatCount(c)).toBe(2)

    const removed = applyCheat(world, { action: 'removeModifier', id: 'cheat:prod' })
    expect(removed.ok).toBe(true)
    expect(c.modifiers.map(one => one.id)).toEqual(['cheat:other'])

    const missing = applyCheat(world, { action: 'removeModifier', id: 'cheat:prod' })
    expect(missing.ok).toBe(false)
    const noFilter = applyCheat(world, { action: 'removeModifier' })
    expect(noFilter.ok).toBe(false)
  })

  test('clearModifiers drops only天命 modifiers, leaving laws/policies', () => {
    const world = newWorld(5403, 'QING')
    const c = qing(world)
    c.modifiers = []
    addModifier(c, {
      id: 'law:test',
      label: '法案',
      stat: 'income',
      stack: 'percent',
      value: 5,
      source: 'law:test',
    })
    applyCheat(world, { action: 'modifier', stat: 'income', stack: 'flat', value: 4 })
    applyCheat(world, { action: 'modifier', stat: 'radicals', stack: 'flat', value: -3 })
    expect(c.modifiers.length).toBe(3)

    const cleared = applyCheat(world, { action: 'clearModifiers' })
    expect(cleared.ok).toBe(true)
    expect(c.modifiers.map(one => one.source)).toEqual(['law:test'])
  })

  test('clearModifiers can filter by stat', () => {
    const world = newWorld(5404, 'QING')
    const c = qing(world)
    c.modifiers = []
    applyCheat(world, { action: 'modifier', stat: 'income', stack: 'flat', value: 4 })
    applyCheat(world, { action: 'modifier', stat: 'radicals', stack: 'flat', value: -3 })

    const cleared = applyCheat(world, { action: 'clearModifiers', stat: 'income' })
    expect(cleared.ok).toBe(true)
    expect(c.modifiers.map(one => one.stat)).toEqual(['radicals'])
  })
})

// ---------------------------------------------------------------- PT-055

describe('PT-055: marketAccess (a 0–1 scalar) is clamped before use', () => {
  test('a flat +20 cheat is clamped to 1.0 at the read seam', () => {
    const world = newWorld(5501, 'QING')
    const c = qing(world)
    applyCheat(world, { action: 'modifier', stat: 'marketAccess', stack: 'flat', value: 20 })
    expect(applyModifiers(c, 'marketAccess', c.econ.marketAccess)).toBe(1)
  })

  test('a percent +2000 cheat is clipped to the same 1.0 ceiling', () => {
    const world = newWorld(5505, 'QING')
    const c = qing(world)
    applyCheat(world, { action: 'modifier', stat: 'marketAccess', stack: 'percent', value: 2000 })
    expect(applyModifiers(c, 'marketAccess', c.econ.marketAccess)).toBe(1)
  })

  test('construction capacity saturates at the access=1 ceiling, not ~19×', () => {
    const world = newWorld(5502, 'QING')
    const c = qing(world)
    c.econ.buildings.workshops = 12

    const control = newWorld(5502, 'QING')
    const controlQing = qing(control)
    controlQing.econ.buildings.workshops = 12
    controlQing.econ.marketAccess = 1

    const before = constructionCapacity(c)
    applyCheat(world, { action: 'modifier', stat: 'marketAccess', stack: 'flat', value: 20 })
    const after = constructionCapacity(c)

    close(after, constructionCapacity(controlQing))
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(before * 2)
  })

  test('production is clamped on the same seam as construction', () => {
    const world = newWorld(5503, 'QING')
    const c = qing(world)
    const control = newWorld(5503, 'QING')
    const controlQing = qing(control)
    controlQing.econ.marketAccess = 1

    const before = inspectEconomy(c).production.grain
    applyCheat(world, { action: 'modifier', stat: 'marketAccess', stack: 'flat', value: 20 })
    const after = inspectEconomy(c).production.grain

    close(after, inspectEconomy(controlQing).production.grain)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(before * 2)
  })
})

// ---------------------------------------------------------------- PT-060

function drillEffects(): PolicyEffect[] {
  return [
    { stat: 'armyStrength', stack: 'percent', value: 15 },
    { stat: 'morale', stack: 'flat', value: 10 },
    { stat: 'manpower', stack: 'flat', value: 10 },
    { stat: 'prestige', stack: 'flat', value: 5 },
  ]
}

describe('PT-060: v3_policy honours the supplied authorityCost', () => {
  test('a supplied cost is charged verbatim, not the magnitude-derived 40', () => {
    const world = newWorld(6001, 'QING')
    const c = qing(world)
    c.government.authority = 100

    const result = applyPolicy(world, 'QING', {
      name: '练兵策',
      authorityCost: 15,
      effects: drillEffects(),
    })

    expect(result.ok).toBe(true)
    expect(100 - c.government.authority).toBe(15)
    expect(result.text).toContain('权威 -15')
    expect(c.modifiers.filter(one => one.source === 'policy:练兵策').length).toBe(4)
  })

  test('an omitted cost still charges the magnitude-derived 40', () => {
    const world = newWorld(6002, 'QING')
    const c = qing(world)
    c.government.authority = 100

    const result = applyPolicy(world, 'QING', { name: '练兵策', effects: drillEffects() })

    expect(result.ok).toBe(true)
    expect(100 - c.government.authority).toBe(40)
  })
})
