import { describe, expect, test } from 'claude-code/testing'
import type {
  Country,
  GameEvent,
  LogEntry,
  WorldState,
} from '../types'
import { applyEventOption } from '../engine/events'
import { newWorld } from '../engine/sim'
import {
  EVENT_TEMPLATES,
  makeRngForWorld,
  spawnEvent,
  successorFor,
} from '../engine/data'
import { addModifier } from '../engine/modifiers'
import { clamp } from '../engine/internal'
import { validateBlockConfig } from '../engine/blocks'
import { findBlock } from '../engine/config/blocks'
import {
  EVENT_BLOCKS,
  compileEventBlock,
  eventBlockId,
  instantiateEventBlock,
} from '../engine/config/blocks/events'
import type { Rng } from '../engine/rng'

const qing = (world: WorldState): Country => {
  const c = world.countries.QING
  if (c === undefined) throw new Error('missing QING')
  return c
}

const modifierTuples = (c: Country): string[] =>
  c.modifiers
    .map(
      m =>
        `${m.id}|${m.source}|${m.stat}|${m.stack}|${m.value}|${m.label}|${m.monthsLeft ?? ''}`,
    )
    .sort()

// ---- Frozen copy of the pre-C3 applyEventOption, used only as an equivalence
// oracle. Do not edit to match new behaviour.
function referenceApplyEventOption(
  world: WorldState,
  event: GameEvent,
  optionId: string,
  log?: LogEntry[],
  rng?: Rng,
): string {
  if (event.isResolved) return '该事件已经处理过了。'
  const option = event.options.find(one => one.id === optionId)
  if (option === undefined) return `没有找到选项 ${optionId}。`
  const country = world.countries[event.countryId]
  if (country === undefined) return '事件所属国家不存在。'

  const effects = option.effects
  if (effects.treasury !== undefined) country.econ.treasury += effects.treasury
  if (effects.radicals !== undefined) {
    country.pops.radicals = clamp(country.pops.radicals + effects.radicals, 0, 100)
  }
  if (effects.legitimacy !== undefined) {
    country.government.legitimacy = clamp(
      country.government.legitimacy + effects.legitimacy,
      0,
      100,
    )
  }
  if (effects.prestige !== undefined) {
    country.diplo.prestige = clamp(country.diplo.prestige + effects.prestige, 0, 240)
  }
  if (effects.army !== undefined) {
    country.military.army = Math.max(0, country.military.army + effects.army)
  }
  if (effects.popsPercent !== undefined) {
    country.pops.total = Math.max(1, country.pops.total * (1 + effects.popsPercent / 100))
  }
  if (effects.techPoints !== undefined) country.tech.points += effects.techPoints
  if (effects.relationTarget !== undefined && effects.relationAmount !== undefined) {
    const target = world.countries[effects.relationTarget]
    if (target !== undefined) {
      const current = country.diplo.relations[target.id] ?? 0
      country.diplo.relations[target.id] = clamp(
        current + effects.relationAmount,
        -100,
        100,
      )
      const back = target.diplo.relations[country.id] ?? 0
      target.diplo.relations[country.id] = clamp(
        back + effects.relationAmount * 0.6,
        -100,
        100,
      )
    }
  }
  if (effects.modifiers !== undefined) {
    effects.modifiers.forEach((one, index) => {
      addModifier(country, {
        id: `event:${event.id}:${index}`,
        label: one.label ?? event.title,
        stat: one.stat,
        stack: one.stack ?? 'flat',
        value: one.value,
        monthsLeft: one.months,
        source: `event:${event.id}`,
      })
    })
  }
  if (effects.succeed === true) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng ?? makeRngForWorld(world))
    if (log !== undefined) {
      log.push({
        date: { ...world.date },
        kind: 'leader',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}：${oldName}退位，${country.leader.title}${country.leader.name}继位`,
      })
    }
  }

  event.isResolved = true
  event.resolvedOption = option.id
  country.leader.memory.push(`「${event.title}」：${option.label}`)
  if (country.leader.memory.length > 8) country.leader.memory.shift()

  const line: LogEntry = {
    date: { ...world.date },
    kind: 'event',
    countryId: country.id,
    text: `[${country.flag}] ${event.title}：${option.result}`,
  }
  if (log !== undefined) log.push(line)

  return `${event.title}：${option.result}`
}

function forceEvent(world: WorldState, kind: string): GameEvent {
  const event = spawnEvent(world, qing(world), makeRngForWorld(world), kind)
  if (event === undefined) throw new Error(`no event for kind ${kind}`)
  return event
}

const directFields = (c: Country): unknown => ({
  treasury: c.econ.treasury,
  radicals: c.pops.radicals,
  legitimacy: c.government.legitimacy,
  prestige: c.diplo.prestige,
  army: c.military.army,
  popsTotal: c.pops.total,
  techPoints: c.tech.points,
  relations: c.diplo.relations,
  memory: c.leader.memory,
})

function expectEquivalent(seed: number, kind: string, optionId: string): void {
  const worldNew = newWorld(seed, 'QING')
  const worldRef = newWorld(seed, 'QING')
  const eventNew = forceEvent(worldNew, kind)
  const eventRef = forceEvent(worldRef, kind)
  expect(eventNew.id).toBe(eventRef.id)
  expect(eventNew.options.map(o => o.id)).toEqual(eventRef.options.map(o => o.id))

  const textNew = applyEventOption(worldNew, eventNew, optionId)
  const textRef = referenceApplyEventOption(worldRef, eventRef, optionId)

  expect(textNew).toBe(textRef)
  expect(modifierTuples(qing(worldNew))).toEqual(modifierTuples(qing(worldRef)))
  expect(directFields(qing(worldNew))).toEqual(directFields(qing(worldRef)))
  expect(qing(worldNew)).toEqual(qing(worldRef))
  expect(eventNew.isResolved).toBe(eventRef.isResolved)
  expect(eventNew.resolvedOption).toBe(eventRef.resolvedOption)
}

describe('event migration equivalence (C3, ADR 0024)', () => {
  test('harvest/celebrate installs two timed modifiers identically', () => {
    expectEquivalent(7001, 'harvest', 'celebrate')
  })

  test('harvest/store installs one timed modifier identically', () => {
    expectEquivalent(7002, 'harvest', 'store')
  })

  test('boom/invest installs two 12-month modifiers identically', () => {
    expectEquivalent(7003, 'boom', 'invest')
  })

  test('slump/bailout installs two 6-month modifiers identically', () => {
    expectEquivalent(7004, 'slump', 'bailout')
  })

  test('options without modifiers keep their direct effects unchanged', () => {
    expectEquivalent(7005, 'revolution', 'repress')
    expectEquivalent(7006, 'border', 'hard')
    expectEquivalent(7007, 'diplomatic', 'accept')
  })

  test('the installed tuple keeps the pre-C3 id/source shape', () => {
    const world = newWorld(7008, 'QING')
    qing(world).modifiers = []
    const event = forceEvent(world, 'harvest')
    applyEventOption(world, event, 'celebrate')
    const c = qing(world)
    expect(c.modifiers.map(m => m.id).sort()).toEqual([
      `event:${event.id}:0`,
      `event:${event.id}:1`,
    ])
    for (const m of c.modifiers) {
      expect(m.source).toBe(`event:${event.id}`)
    }
    expect(c.modifiers.map(m => m.label)).toEqual(['丰年余庆', '丰年余庆'])
    expect(c.modifiers.map(m => m.monthsLeft)).toEqual([6, 6])
  })

  test('synthetic options outside the registry still install via a compiled block', () => {
    const world = newWorld(7009, 'QING')
    const c = qing(world)
    c.modifiers = []
    const event: GameEvent = {
      id: 'ev-synthetic',
      date: { ...world.date },
      kind: 'synthetic',
      title: '测试恩泽',
      text: '测试',
      countryId: 'QING',
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
    }
    applyEventOption(world, event, 'take')
    expect(c.modifiers.some(m => m.id === 'event:ev-synthetic:0')).toBe(true)
    expect(c.modifiers[0]?.source).toBe('event:ev-synthetic')
  })

  test('resolving the same event twice does not double-install', () => {
    const world = newWorld(7010, 'QING')
    const event = forceEvent(world, 'harvest')
    applyEventOption(world, event, 'celebrate')
    const before = modifierTuples(qing(world))
    const text = applyEventOption(world, event, 'celebrate')
    expect(text).toBe('该事件已经处理过了。')
    expect(modifierTuples(qing(world))).toEqual(before)
  })
})

describe('event block registry drift guard (C3)', () => {
  test('every EVENT_TEMPLATES effects.modifiers entry maps to exactly one block', () => {
    const world = newWorld(1, 'QING')
    const country = qing(world)
    const expectedIds: string[] = []

    for (const template of EVENT_TEMPLATES) {
      for (const option of template.options(country)) {
        const modifiers = option.effects.modifiers
        if (modifiers === undefined || modifiers.length === 0) continue
        const id = eventBlockId(template.kind, option.id)
        expectedIds.push(id)
        const block = findBlock(id)
        expect(block?.kind).toBe('event')
        expect(block?.label).toBe(template.title)
        expect(block?.lifecycle).toBe('once')
        expect(block?.potential_trigger).toEqual([])
        expect(block?.effects).toEqual(
          modifiers.map(one => ({
            stat: one.stat,
            stack: one.stack ?? 'flat',
            value: one.value,
            label: one.label,
            months: one.months,
          })),
        )
      }
    }

    expect(EVENT_BLOCKS.map(b => b.id).sort()).toEqual(expectedIds.sort())
    expect(validateBlockConfig(EVENT_BLOCKS)).toEqual([])
  })

  test('compileEventBlock / instantiateEventBlock shape is stable', () => {
    const block = compileEventBlock('harvest', 'store', '丰年', [
      { stat: 'income', stack: 'percent', value: 4, months: 6, label: '囤粮溢价' },
    ])
    expect(block.id).toBe('event:harvest:store')
    expect(block.kind).toBe('event')
    expect(validateBlockConfig([block])).toEqual([])

    const runtime = instantiateEventBlock(block, 'ev-1-QING-42')
    expect(runtime.id).toBe('event:ev-1-QING-42')
    expect(runtime.effects).toEqual(block.effects)
    expect(validateBlockConfig([runtime])).toEqual([])
  })
})
