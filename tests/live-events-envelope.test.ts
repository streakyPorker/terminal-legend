import { describe, expect, test } from 'claude-code/testing'
import { applyEventOption, newWorld } from '../engine/sim'
import { parseLiveEventResponse } from '../engine/liveEvents'
import {
  LIVE_EFFECT_CAPS,
  LIVE_MAX_EVENTS,
  LIVE_MAX_MODIFIERS,
  LIVE_MAX_OPTIONS,
  LIVE_MODIFIER_LABEL_MAX,
  LIVE_MODIFIER_MONTHS_MAX,
  LIVE_MODIFIER_VALUE_CAP,
  LIVE_OPTION_ID_MAX,
  LIVE_OPTION_LABEL_MAX,
  LIVE_OPTION_RESULT_MAX,
  LIVE_TEXT_MAX,
  LIVE_TITLE_MAX,
} from '../engine/config/events'
import type { GameEvent } from '../types'

/**
 * E3 (plan 0010 §4, §7): the effect envelope. `parseLiveEventResponse` is the
 * gate every model-written option passes before it can reach `world.events`;
 * these tests pin reject-on-bad-input, drop-the-event-when-empty, the event cap
 * and the exact landing of an accepted effect through `applyEventOption`.
 */

type Option = Record<string, unknown>

function reply(events: unknown[]): string {
  return JSON.stringify(events)
}

function oneEvent(options: Option[], kind = 'economy'): unknown[] {
  return [{ kind, title: '标题', text: '正文', options }]
}

const goodOption = (extra: Option = {}): Option => ({
  id: 'optA',
  label: '选项',
  result: '结果',
  effects: { treasury: -1 },
  ...extra,
})

describe('live events: E3 effect envelope (plan 0010 §4)', () => {
  test('an unknown effect field rejects the option', async () => {
    const bad = reply(oneEvent([{ label: 'L', result: 'R', effects: { wealth: 5 } }]))
    expect(parseLiveEventResponse(bad)).toEqual([])
  })

  test('an unknown modifier stat rejects the option', async () => {
    const bad = reply(
      oneEvent([{ label: 'L', result: 'R', effects: { modifiers: [{ stat: 'nonsense', value: 1 }] } }]),
    )
    expect(parseLiveEventResponse(bad)).toEqual([])
  })

  test('non-finite numbers reject the option', async () => {
    const raw = (key: string): string =>
      `[{"title":"T","text":"X","options":[{"label":"L","result":"R","effects":{${key}}}}]`
    expect(parseLiveEventResponse(raw('"treasury":1e999'))).toEqual([])
    expect(
      parseLiveEventResponse(raw('"modifiers":[{"stat":"income","value":1e999}]')),
    ).toEqual([])
  })

  test('out-of-range magnitudes reject the option', async () => {
    const cases: Option[] = [
      { treasury: LIVE_EFFECT_CAPS.treasury + 1 },
      { radicals: LIVE_EFFECT_CAPS.radicals + 1 },
      { legitimacy: LIVE_EFFECT_CAPS.legitimacy + 1 },
      { prestige: LIVE_EFFECT_CAPS.prestige + 1 },
      { army: LIVE_EFFECT_CAPS.army + 1 },
      { popsPercent: LIVE_EFFECT_CAPS.popsPercent + 1 },
      { techPoints: LIVE_EFFECT_CAPS.techPoints + 1 },
    ]
    for (const effects of cases) {
      const text = reply(oneEvent([{ label: 'L', result: 'R', effects }]))
      expect(parseLiveEventResponse(text)).toEqual([])
    }
    const relation = reply(
      oneEvent([
        {
          label: 'L',
          result: 'R',
          effects: { relationTarget: 'QING', relationAmount: LIVE_EFFECT_CAPS.relationAmount + 1 },
        },
      ]),
    )
    expect(parseLiveEventResponse(relation, { countryIds: ['QING'] })).toEqual([])
  })

  test('succeed must be boolean', async () => {
    expect(parseLiveEventResponse(reply(oneEvent([{ label: 'L', result: 'R', effects: { succeed: 1 } }])))).toEqual([])
    const ok = parseLiveEventResponse(reply(oneEvent([{ label: 'L', result: 'R', effects: { succeed: true } }])))
    expect(ok.length).toBe(1)
    expect(ok[0]?.options[0]?.effects.succeed).toBe(true)
  })

  test('a modifier stack must be a known value', async () => {
    const bad = reply(
      oneEvent([{ label: 'L', result: 'R', effects: { modifiers: [{ stat: 'income', stack: 'huge', value: 1 }] } }]),
    )
    expect(parseLiveEventResponse(bad)).toEqual([])
  })

  test('modifier months must be a bounded non-negative integer', async () => {
    const bad = [-1, 1.5, LIVE_MODIFIER_MONTHS_MAX + 1].map(months =>
      reply(oneEvent([{ label: 'L', result: 'R', effects: { modifiers: [{ stat: 'income', value: 1, months }] } }])),
    )
    for (const text of bad) expect(parseLiveEventResponse(text)).toEqual([])
    const ok = reply(oneEvent([{ label: 'L', result: 'R', effects: { modifiers: [{ stat: 'income', value: 1, months: 0 }] } }]))
    expect(parseLiveEventResponse(ok).length).toBe(1)
  })

  test('a modifier value over the cap rejects the option', async () => {
    const bad = reply(
      oneEvent([
        { label: 'L', result: 'R', effects: { modifiers: [{ stat: 'income', value: LIVE_MODIFIER_VALUE_CAP + 1 }] } },
      ]),
    )
    expect(parseLiveEventResponse(bad)).toEqual([])
  })

  test('more than LIVE_MAX_MODIFIERS modifiers reject the option', async () => {
    const tooMany = Array.from({ length: LIVE_MAX_MODIFIERS + 1 }, () => ({ stat: 'income', value: 1 }))
    const bad = reply(oneEvent([{ label: 'L', result: 'R', effects: { modifiers: tooMany } }]))
    expect(parseLiveEventResponse(bad)).toEqual([])
  })

  test('an event keeps only its trusted options; a wholly-bad event is dropped', async () => {
    const mixed = reply(
      oneEvent([
        { label: 'L', result: 'R', effects: { modifiers: [{ stat: 'nonsense', value: 1 }] } },
        goodOption(),
      ]),
    )
    const kept = parseLiveEventResponse(mixed)
    expect(kept.length).toBe(1)
    expect(kept[0]?.options.length).toBe(1)
    expect(kept[0]?.options[0]?.effects.treasury).toBe(-1)

    const allBad = reply(
      oneEvent([
        { label: 'L', result: 'R', effects: { wealth: 1 } },
        { label: 'L', result: 'R', effects: { radicals: 999 } },
      ]),
    )
    expect(parseLiveEventResponse(allBad)).toEqual([])
  })

  test('over-count events are trimmed to LIVE_MAX_EVENTS', async () => {
    const many = reply([1, 2, 3, 4].map(index => ({ title: `T${index}`, text: 'X', options: [goodOption()] })))
    expect(parseLiveEventResponse(many).length).toBe(LIVE_MAX_EVENTS)
    expect(parseLiveEventResponse(many, { maxEvents: 1 }).length).toBe(1)
    expect(parseLiveEventResponse(many, { maxEvents: 99 }).length).toBe(LIVE_MAX_EVENTS)
  })

  test('options over LIVE_MAX_OPTIONS are trimmed', async () => {
    const many = reply(
      oneEvent(
        Array.from({ length: LIVE_MAX_OPTIONS + 2 }, (_value, index) =>
          goodOption({ id: `o${index}` }),
        ),
      ),
    )
    const candidates = parseLiveEventResponse(many)
    expect(candidates[0]?.options.length).toBe(LIVE_MAX_OPTIONS)
  })

  test('oversized text fields are truncated to the configured caps', async () => {
    const longMod = 'M'.repeat(LIVE_MODIFIER_LABEL_MAX + 50)
    const text = reply([
      {
        title: 'T'.repeat(LIVE_TITLE_MAX + 50),
        text: 'X'.repeat(LIVE_TEXT_MAX + 50),
        options: [
          {
            id: 'a'.repeat(LIVE_OPTION_ID_MAX + 5),
            label: 'L'.repeat(LIVE_OPTION_LABEL_MAX + 50),
            result: 'R'.repeat(LIVE_OPTION_RESULT_MAX + 50),
            effects: { modifiers: [{ stat: 'income', value: 1, label: longMod }] },
          },
        ],
      },
    ])
    const candidate = parseLiveEventResponse(text)[0]
    expect(candidate).toBeDefined()
    expect(candidate?.title.length).toBe(LIVE_TITLE_MAX)
    expect(candidate?.text.length).toBe(LIVE_TEXT_MAX)
    expect(candidate?.options[0]?.label.length).toBe(LIVE_OPTION_LABEL_MAX)
    expect(candidate?.options[0]?.result.length).toBe(LIVE_OPTION_RESULT_MAX)
    // An id beyond the cap is not a valid id, so it falls back to `opt1`.
    expect(candidate?.options[0]?.id).toBe('opt1')
    expect(candidate?.options[0]?.effects.modifiers?.[0]?.label?.length).toBe(LIVE_MODIFIER_LABEL_MAX)
  })

  test('a half-specified relation pair is dropped, leaving a self-contained option', async () => {
    const half = reply(oneEvent([{ label: 'L', result: 'R', effects: { relationTarget: 'GBR' } }]))
    const candidates = parseLiveEventResponse(half, { countryIds: ['QING', 'GBR'] })
    expect(candidates.length).toBe(1)
    expect(candidates[0]?.options[0]?.effects.relationTarget).toBeUndefined()
    expect(candidates[0]?.options[0]?.effects.relationAmount).toBeUndefined()
  })

  test('a legal effect lands exactly through applyEventOption', async () => {
    const world = newWorld(901, 'QING')
    const qing = world.countries.QING
    const gbr = world.countries.GBR
    expect(qing).toBeDefined()
    expect(gbr).toBeDefined()
    if (qing === undefined || gbr === undefined) return

    const candidate = parseLiveEventResponse(
      reply(
        oneEvent([
          {
            id: 'optA',
            label: '选项',
            result: '结果',
            effects: {
              treasury: -3,
              radicals: -2,
              legitimacy: 4,
              prestige: 5,
              army: -1,
              techPoints: 50,
              relationTarget: 'GBR',
              relationAmount: -10,
              modifiers: [{ stat: 'income', stack: 'percent', value: 7, months: 5, label: '平粜' }],
            },
          },
        ]),
      ),
      { countryIds: Object.keys(world.countries) },
    )[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return

    const event: GameEvent = {
      id: 'live-7-QING-0',
      date: { ...world.date },
      kind: candidate.kind,
      title: candidate.title,
      text: candidate.text,
      countryId: 'QING',
      options: candidate.options,
      isResolved: false,
    }
    const before = {
      treasury: qing.econ.treasury,
      radicals: qing.pops.radicals,
      legitimacy: qing.government.legitimacy,
      prestige: qing.diplo.prestige,
      army: qing.military.army,
      tech: qing.tech.points,
      relation: qing.diplo.relations.GBR ?? 0,
      back: gbr.diplo.relations.QING ?? 0,
    }

    const text = applyEventOption(world, event, 'optA')
    const near = (actual: number, expected: number): void =>
      expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
    expect(text).toContain('结果')
    near(qing.econ.treasury, before.treasury - 3)
    near(qing.pops.radicals, before.radicals - 2)
    near(qing.government.legitimacy, before.legitimacy + 4)
    near(qing.diplo.prestige, before.prestige + 5)
    near(qing.military.army, before.army - 1)
    near(qing.tech.points, before.tech + 50)
    near(qing.diplo.relations.GBR ?? 0, before.relation - 10)
    near(gbr.diplo.relations.QING ?? 0, before.back - 10 * 0.6)
    expect(event.isResolved).toBe(true)
    expect(event.resolvedOption).toBe('optA')
  })

  test('modifiers compile through the ADR 0024 block path with source event:<id>', async () => {
    const world = newWorld(902, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const candidate = parseLiveEventResponse(
      reply(
        oneEvent([
          {
            id: 'optA',
            label: '选项',
            result: '结果',
            effects: {
              modifiers: [
                { stat: 'income', stack: 'percent', value: 7, months: 5, label: '甲' },
                { stat: 'sol', stack: 'flat', value: 2, months: 6, label: '乙' },
              ],
            },
          },
        ]),
      ),
    )[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    const event: GameEvent = {
      id: 'live-8-QING-0',
      date: { ...world.date },
      kind: candidate.kind,
      title: candidate.title,
      text: candidate.text,
      countryId: 'QING',
      options: candidate.options,
      isResolved: false,
    }
    applyEventOption(world, event, 'optA')

    const first = qing.modifiers.find(one => one.source === 'event:live-8-QING-0')
    const second = qing.modifiers.find(one => one.id === 'event:live-8-QING-0:1')
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first?.id).toBe('event:live-8-QING-0:0')
    expect(first?.stat).toBe('income')
    expect(first?.stack).toBe('percent')
    expect(first?.value).toBe(7)
    expect(first?.monthsLeft).toBe(5)
    expect(second?.stat).toBe('sol')
    expect(second?.value).toBe(2)
    expect(second?.monthsLeft).toBe(6)
  })
})
