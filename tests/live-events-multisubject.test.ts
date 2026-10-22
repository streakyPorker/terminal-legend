import { describe, expect, test } from 'claude-code/testing'
import { GOODS } from '../engine/data'
import { newWorld } from '../engine/sim'
import { generateLiveEvents, planLiveSubjects, salientTopics } from '../engine/liveEvents'
import { LIVE_MAX_MODEL_CALLS, LIVE_MAX_SUBJECTS } from '../engine/config/events'
import type { Country, WorldState } from '../types'

/**
 * E5 (plan 0010 §7): multi-subject generation. Each major power is scanned from
 * its own perspective; the same topic generated across subjects is
 * de-duplicated; and the per-turn model-call count stays within the configured
 * cap so cost and latency are bounded.
 */

const GRAIN_BASE = GOODS.grain.basePrice

/** Clears every dimension's signal for one country. */
function neutralise(world: WorldState, country: Country): void {
  country.pops.sol = 60
  country.pops.literacy = 0.5
  country.pops.radicals = 0
  country.government.legitimacy = 50
  country.econ.treasury = 0
  country.econ.prices.grain = GRAIN_BASE
  country.econ.unemployment = 6
  country.econ.history.gdp = [100, 100]
  country.diplo.infamy = 0
  country.econ.gdp = 100
  world.wars = []
}

function neutraliseAll(world: WorldState): void {
  for (const country of Object.values(world.countries)) neutralise(world, country)
}

const politicsReply = JSON.stringify([
  {
    kind: 'politics',
    title: '清国风潮',
    text: '激进四起，朝野震动。',
    options: [{ id: 'p', label: '弹压', result: '风潮暂息。', effects: { radicals: -3 } }],
  },
])

const economyReply = JSON.stringify([
  {
    kind: 'economy',
    title: '英伦谷贱',
    text: '谷价腾贵，市井骚然。',
    options: [{ id: 'e', label: '平粜', result: '谷价回落。', effects: { treasury: -2 } }],
  },
])

describe('live events: E5 multi-subject generation (plan 0010 §7)', () => {
  test('each subject generates its own event with the correct countryId', async () => {
    const world = newWorld(201, 'QING')
    neutraliseAll(world)
    const qing = world.countries.QING
    const gbr = world.countries.GBR
    expect(qing).toBeDefined()
    expect(gbr).toBeDefined()
    if (qing === undefined || gbr === undefined) return
    qing.pops.radicals = 90
    gbr.econ.prices.grain = GRAIN_BASE * 2

    const calls: string[] = []
    const complete = async (prompt: string): Promise<string> => {
      calls.push(prompt)
      return prompt.includes('（GBR）') ? economyReply : politicsReply
    }

    const events = await generateLiveEvents(world, complete)
    expect(calls.length).toBeLessThanOrEqual(LIVE_MAX_MODEL_CALLS)
    expect(calls.length).toBeLessThanOrEqual(LIVE_MAX_SUBJECTS)

    world.events.push(...events)
    const qingEvent = world.events.find(event => event.countryId === 'QING')
    const gbrEvent = world.events.find(event => event.countryId === 'GBR')
    expect(qingEvent?.title).toBe('清国风潮')
    expect(gbrEvent?.title).toBe('英伦谷贱')
    expect(qingEvent?.id).toContain('QING')
    expect(gbrEvent?.id).toContain('GBR')
  })

  test('a topic repeated across subjects is generated once', async () => {
    const world = newWorld(202, 'QING')
    neutraliseAll(world)
    const qing = world.countries.QING
    const gbr = world.countries.GBR
    expect(qing).toBeDefined()
    expect(gbr).toBeDefined()
    if (qing === undefined || gbr === undefined) return
    qing.pops.radicals = 90
    gbr.pops.radicals = 95

    const subjects = planLiveSubjects(world)
    expect(subjects.length).toBe(1)
    expect(subjects[0]?.country.id).toBe('QING')
    expect(subjects[0]?.topics[0]?.key).toBe('politics:radicals')

    let calls = 0
    const complete = async (): Promise<string> => {
      calls += 1
      return politicsReply
    }
    const events = await generateLiveEvents(world, complete)
    expect(calls).toBe(1)
    expect(events.length).toBe(1)
    expect(events[0]?.countryId).toBe('QING')
  })

  test('the per-turn model-call count never exceeds the configured cap', async () => {
    const world = newWorld(203, 'QING')
    neutraliseAll(world)
    const qing = world.countries.QING
    const gbr = world.countries.GBR
    expect(qing).toBeDefined()
    expect(gbr).toBeDefined()
    if (qing === undefined || gbr === undefined) return
    qing.pops.radicals = 90
    gbr.econ.prices.grain = GRAIN_BASE * 2

    let calls = 0
    const complete = async (): Promise<string> => {
      calls += 1
      return politicsReply
    }
    const events = await generateLiveEvents(world, complete, { maxCalls: 1 })
    expect(calls).toBe(1)
    expect(events.length).toBe(1)
  })

  test('a quiet world makes no model call at all', async () => {
    const world = newWorld(204, 'QING')
    neutraliseAll(world)
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    expect(salientTopics(world, qing)).toEqual([])

    let calls = 0
    const complete = async (): Promise<string> => {
      calls += 1
      return politicsReply
    }
    const events = await generateLiveEvents(world, complete)
    expect(events).toEqual([])
    expect(calls).toBe(0)
  })
})
