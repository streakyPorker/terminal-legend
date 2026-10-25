import { describe, expect, test } from 'claude-code/testing'
import type { Country, War, WorldState } from '../types'
import {
  INDUSTRIAL_BUILDING_IDS,
  TECH_NODES,
  makeRngForWorld,
  techNode,
} from '../engine/data'
import { selectAiResearchNode } from '../engine/tech'
import { TECH_ERA_COSTS, techNodeCost } from '../engine/config/tech'
import { advance, newWorld } from '../engine/sim'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const war = (a: string, b: string): War => ({
  id: `war-test-${a}-${b}`,
  name: `${a}—${b}`,
  attackers: [a],
  defenders: [b],
  started: { year: 1836, month: 1 },
  months: 0,
  warScore: 0,
  battles: 0,
  reason: 'test',
  lastEvent: 'test',
  goal: 'reparations',
  goalOwner: a,
})

/**
 * Puts a country at a clean branch-choice point: the era line has reached
 * `general-1850` (so the next general node is gated on branch progress) and all
 * three era-1 branch roots are ready, with no situation or trait bias.
 */
function clean(world: WorldState, country: Country): void {
  country.tech.era = 2
  country.tech.unlocked = ['general-1836', 'general-1840', 'general-1850']
  country.tech.nodes = {}
  country.tech.researching = ''
  country.tech.points = 0
  country.leader.traits = []
  country.pops.radicals = 0
  country.government.legitimacy = 70
  country.military.army = 100
  for (const id of INDUSTRIAL_BUILDING_IDS) country.econ.buildings[id] = 50
  world.wars = []
}

const choice = (world: WorldState, country: Country): string =>
  selectAiResearchNode(world, country)?.id ?? ''

describe('deterministic AI selection (plan 0005 §2.5, K3)', () => {
  test('is reproducible and breaks ties by node id ascending', () => {
    const world = newWorld(9401, 'QING')
    const fra = countryOf(world, 'FRA')
    clean(world, fra)
    const first = choice(world, fra)
    expect(choice(world, fra)).toBe(first)
    expect(first).toBe('admin-1')
  })

  test('scarce industry and an industry trait tilt toward the industry branch', () => {
    const world = newWorld(9402, 'QING')
    const fra = countryOf(world, 'FRA')

    clean(world, fra)
    for (const id of INDUSTRIAL_BUILDING_IDS) fra.econ.buildings[id] = 0
    expect(choice(world, fra)).toBe('industry-1')

    clean(world, fra)
    fra.leader.traits = ['贸易']
    expect(choice(world, fra)).toBe('industry-1')
  })

  test('high radicals or low legitimacy tilt toward the administration branch', () => {
    const world = newWorld(9403, 'QING')
    const fra = countryOf(world, 'FRA')

    clean(world, fra)
    fra.pops.radicals = 40
    expect(choice(world, fra)).toBe('admin-1')

    clean(world, fra)
    fra.government.legitimacy = 30
    expect(choice(world, fra)).toBe('admin-1')
  })

  test('war or a weak army tilt toward the military branch', () => {
    const world = newWorld(9404, 'QING')
    const fra = countryOf(world, 'FRA')

    clean(world, fra)
    world.wars.push(war('FRA', 'GBR'))
    expect(choice(world, fra)).toBe('military-1')

    clean(world, fra)
    fra.military.army = 5
    expect(choice(world, fra)).toBe('military-1')
  })

  test('the general era line is prioritised when a node is ready', () => {
    const world = newWorld(9405, 'QING')
    const fra = countryOf(world, 'FRA')
    clean(world, fra)
    fra.tech.era = 1
    fra.tech.unlocked = ['general-1836']
    fra.leader.traits = ['军事', '扩张']
    fra.military.army = 5
    world.wars.push(war('FRA', 'GBR'))
    expect(choice(world, fra)).toBe('general-1840')
  })

  test('the whole world keeps one research path per seed over 120 months', () => {
    const left = newWorld(9406, 'QING')
    const right = newWorld(9406, 'QING')
    for (let month = 0; month < 120; month += 1) {
      advance(left, 1, [], makeRngForWorld(left))
      advance(right, 1, [], makeRngForWorld(right))
    }
    for (const id of Object.keys(left.countries)) {
      expect(JSON.stringify(left.countries[id]?.tech)).toBe(
        JSON.stringify(right.countries[id]?.tech),
      )
    }
  })
})

describe('tech pace and bounds (plan 0005 K4)', () => {
  test('every node cost derives from the era table and is positive and finite', () => {
    for (const cost of TECH_ERA_COSTS) {
      expect(Number.isFinite(cost)).toBe(true)
      expect(cost).toBeGreaterThan(0)
    }
    for (const node of TECH_NODES) {
      expect(node.cost).toBe(techNodeCost(node.era))
      expect(Number.isFinite(node.cost)).toBe(true)
      expect(node.cost).toBeGreaterThan(0)
    }
    expect(techNode('industry-1')?.cost).toBe(TECH_ERA_COSTS[0])
    expect(techNode('industry-4')?.cost).toBe(TECH_ERA_COSTS[3])
  })

  test('a 120-month baseline stays finite, monotonic and paced at ~1 node / 2–4 years', () => {
    const world = newWorld(9407, 'QING')
    const qing = countryOf(world, 'QING')
    const startUnlocked = qing.tech.unlocked.length
    let prevUnlocked = startUnlocked
    let prevEra = qing.tech.era
    for (let month = 0; month < 120; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      for (const country of Object.values(world.countries)) {
        const tech = country.tech
        expect(Number.isFinite(tech.points)).toBe(true)
        expect(Number.isFinite(tech.pointsPerMonth)).toBe(true)
        expect(tech.points).toBeGreaterThanOrEqual(0)
        expect(tech.era).toBeGreaterThanOrEqual(1)
        expect(tech.era).toBeLessThanOrEqual(4)
        expect(tech.unlocked.length).toBeLessThanOrEqual(TECH_NODES.length)
      }
      expect(qing.tech.unlocked.length).toBeGreaterThanOrEqual(prevUnlocked)
      expect(qing.tech.era).toBeGreaterThanOrEqual(prevEra)
      prevUnlocked = qing.tech.unlocked.length
      prevEra = qing.tech.era
    }
    const gained = qing.tech.unlocked.length - startUnlocked
    expect(gained).toBeGreaterThanOrEqual(2)
    expect(gained).toBeLessThanOrEqual(5)
  })
})
