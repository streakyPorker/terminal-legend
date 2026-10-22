import { describe, expect, test } from 'claude-code/testing'
import { newWorld } from '../engine/sim'
import { EVENT_TEMPLATES, GOODS } from '../engine/data'
import {
  DIMENSION_LABELS,
  KIND_DIRECTIONS,
  LIVE_DIMENSIONS,
  salientTopics,
} from '../engine/liveEvents'
import { LIVE_MAX_TOPICS } from '../engine/config/events'
import type { Country, WorldState } from '../types'

/**
 * E2 (plan 0010 §3, §7): the four-dimension salience scan. `salientTopics` is a
 * pure read of the world — these tests pin the mapping from an anomalous world
 * to the dimension it should select, the ranking, the 1–2 cap and the stable
 * seed object, without touching the (非确定性) model call.
 */

const GRAIN_BASE = GOODS.grain.basePrice

/** Clears every dimension's signal so only a crafted one stands. */
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
  world.wars = []
}

function warOn(world: WorldState, countryId: string): void {
  world.wars.push({
    id: 'war-test',
    name: '测试战争',
    attackers: ['GBR'],
    defenders: [countryId],
    started: { ...world.date },
    months: 0,
    warScore: 0,
    battles: 0,
    reason: '测试',
    lastEvent: '开战',
    goal: 'reparations',
    goalOwner: 'GBR',
  })
}

function playable(seed: number): { world: WorldState; country: Country } {
  const world = newWorld(seed, 'QING')
  const country = world.countries.QING
  if (country === undefined) throw new Error('QING missing from a new world')
  neutralise(world, country)
  return { world, country }
}

describe('live events: E2 four-dimension salience scan (plan 0010 §3)', () => {
  test('a grain-price deviation selects the economy dimension', async () => {
    const { world, country } = playable(101)
    country.econ.prices.grain = GRAIN_BASE * 1.5
    const topics = salientTopics(world, country)
    expect(topics[0]?.dimension).toBe('economy')
    expect(topics[0]?.key).toBe('economy:grain')
  })

  test('a radical spike selects the politics dimension', async () => {
    const { world, country } = playable(102)
    country.pops.radicals = 80
    const topics = salientTopics(world, country)
    expect(topics[0]?.dimension).toBe('politics')
    expect(topics[0]?.key).toBe('politics:radicals')
  })

  test('an active war selects the diplomacy dimension', async () => {
    const { world, country } = playable(103)
    warOn(world, country.id)
    const topics = salientTopics(world, country)
    expect(topics[0]?.dimension).toBe('diplomacy')
    expect(topics[0]?.key).toBe('diplomacy:war')
  })

  test('a low living standard selects the livelihood dimension', async () => {
    const { world, country } = playable(104)
    country.pops.sol = 25
    const topics = salientTopics(world, country)
    expect(topics[0]?.dimension).toBe('livelihood')
    expect(topics[0]?.key).toBe('livelihood:sol')
  })

  test('a quiet world yields 0–1 topics (here none)', async () => {
    const { world, country } = playable(105)
    const topics = salientTopics(world, country)
    expect(topics.length).toBeLessThanOrEqual(1)
    expect(topics).toEqual([])
  })

  test('the result is capped at LIVE_MAX_TOPICS even with many anomalies', async () => {
    const { world, country } = playable(106)
    country.econ.prices.grain = GRAIN_BASE * 3
    country.pops.radicals = 90
    country.pops.sol = 20
    warOn(world, country.id)
    expect(salientTopics(world, country).length).toBe(LIVE_MAX_TOPICS)
    expect(salientTopics(world, country, 1).length).toBe(1)
    expect(salientTopics(world, country, 9).length).toBe(LIVE_MAX_TOPICS)
  })

  test('topics are ranked by descending salience', async () => {
    const { world, country } = playable(107)
    // dev = 0.5 -> salience 50; radicals 60 -> salience 40.
    country.econ.prices.grain = GRAIN_BASE * 1.5
    country.pops.radicals = 60
    const topics = salientTopics(world, country)
    expect(topics.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < topics.length; index += 1) {
      const prev = topics[index - 1]
      const next = topics[index]
      if (prev === undefined || next === undefined) continue
      expect(prev.salience).toBeGreaterThanOrEqual(next.salience)
    }
    expect(topics[0]?.dimension).toBe('economy')
  })

  test('the seed object is stable for an unchanged world', async () => {
    const { world, country } = playable(108)
    country.pops.radicals = 55
    const first = salientTopics(world, country)
    const second = salientTopics(world, country)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
  })

  test('the kind->direction catalogue maps only onto live dimensions', async () => {
    for (const direction of Object.values(KIND_DIRECTIONS)) {
      expect(LIVE_DIMENSIONS).toContain(direction)
    }
    for (const template of EVENT_TEMPLATES) {
      expect(KIND_DIRECTIONS[template.kind]).toBeDefined()
    }
    // The four dimensions are exactly the scan's dimensions and each is labelled.
    for (const dimension of LIVE_DIMENSIONS) {
      expect(DIMENSION_LABELS[dimension]).toBeTruthy()
    }
  })
})
