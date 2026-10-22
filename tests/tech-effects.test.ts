import { describe, expect, test } from 'claude-code/testing'
import type { Country, TradeFlow, War, WorldState } from '../types'
import {
  TECH_NODES,
  makeRngForWorld,
  techNode,
} from '../engine/data'
import type { Decision } from '../engine/internal'
import { advance, applyDecision, newWorld } from '../engine/sim'
import { addModifier, applyModifiers } from '../engine/modifiers'
import {
  crossBranchTargets,
  flowTechOverflow,
  installTechNodeEffects,
  techDiffusionBonus,
  techScore,
  techSpillRate,
} from '../engine/tech'
import { MODIFIER_CAP } from '../engine/config/balance'
import { TECH_DIFFUSION_MAX, TECH_SPILL_MAX, TECH_SPILL_MIN } from '../engine/config/tech'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const research = (world: WorldState, countryId: string, tech: string): { ok: boolean } =>
  applyDecision(
    world,
    { countryId, action: 'research', params: { tech } } as Decision,
    makeRngForWorld(world),
  )

const close = (actual: number, expected: number, digits = 9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(10 ** -digits)
}

const flow = (from: string, to: string, value: number): TradeFlow => ({
  good: 'grain',
  from,
  to,
  quantity: value,
  unitPrice: 1,
  landedPrice: 1,
  tariffPaid: 0,
  exportDuty: 0,
  value,
})

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

describe('tech node effects (plan 0005 K2 §4)', () => {
  test('installTechNodeEffects installs modifiers with source tech:<id> and applies immediate stocks once', () => {
    const world = newWorld(9301, 'QING')
    const qing = countryOf(world, 'QING')

    const industry1 = techNode('industry-1')
    expect(industry1).toBeDefined()
    if (industry1 === undefined) return
    installTechNodeEffects(qing, industry1)

    const fabric = qing.modifiers.filter(m => m.source === 'tech:industry-1')
    expect(fabric.length).toBe(2)
    expect(fabric[0]?.id).toBe('tech:industry-1:0')
    expect(fabric[0]?.stat).toBe('fabricOutput')
    expect(fabric[1]?.stat).toBe('factoryOutput')
    close(applyModifiers(qing, 'fabricOutput', 100), 110)

    const military4 = techNode('military-4')
    expect(military4).toBeDefined()
    if (military4 === undefined) return
    const moraleBefore = qing.military.morale
    installTechNodeEffects(qing, military4)
    close(qing.military.morale, moraleBefore + 5)
    expect(qing.modifiers.filter(m => m.source === 'tech:military-4').length).toBe(1)
  })

  test('military-3 installs the navyStrength seam alongside armyStrength', () => {
    const world = newWorld(9311, 'QING')
    const qing = countryOf(world, 'QING')
    const military3 = techNode('military-3')
    expect(military3).toBeDefined()
    if (military3 === undefined) return
    installTechNodeEffects(qing, military3)
    expect(
      qing.modifiers.some(m => m.source === 'tech:military-3' && m.stat === 'navyStrength'),
    ).toBe(true)
    close(applyModifiers(qing, 'navyStrength', 100), 105)
  })

  test('completing a node installs its effects through the engine exactly once', () => {
    const world = newWorld(9302, 'QING')
    const qing = countryOf(world, 'QING')
    const node = techNode('industry-1')
    expect(node).toBeDefined()
    if (node === undefined) return

    research(world, 'QING', 'industry-1')
    qing.tech.points = node.cost + 0.5

    const moraleWorld = newWorld(9302, 'QING')
    const moraleQing = countryOf(moraleWorld, 'QING')
    moraleQing.tech.era = 4
    moraleQing.tech.unlocked = [
      'general-1836',
      'general-1850',
      'general-1865',
      'general-1880',
      'military-1',
      'military-2',
      'military-3',
    ]
    research(moraleWorld, 'QING', 'military-4')
    const military4 = techNode('military-4')
    if (military4 === undefined) return
    moraleQing.tech.points = military4.cost

    const controlWorld = newWorld(9302, 'QING')
    const controlQing = countryOf(controlWorld, 'QING')
    controlQing.tech.era = 4
    controlQing.tech.unlocked = [...moraleQing.tech.unlocked]
    controlQing.tech.researching = ''
    controlQing.tech.points = 0

    const moraleBefore = moraleQing.military.morale
    const controlBefore = controlQing.military.morale
    advance(world, 1, [], makeRngForWorld(world))
    advance(moraleWorld, 1, [], makeRngForWorld(moraleWorld))
    advance(controlWorld, 1, [], makeRngForWorld(controlWorld))

    expect(qing.tech.unlocked).toContain('industry-1')
    expect(qing.modifiers.filter(m => m.source === 'tech:industry-1').length).toBe(2)
    expect(qing.tech.unlocked.filter(id => id === 'industry-1').length).toBe(1)
    expect(research(world, 'QING', 'industry-1').ok).toBe(false)

    expect(moraleQing.tech.unlocked.filter(id => id === 'military-4').length).toBe(1)
    expect(moraleQing.modifiers.filter(m => m.source === 'tech:military-4').length).toBe(1)
    const gained = moraleQing.military.morale - moraleBefore
    const controlGained = controlQing.military.morale - controlBefore
    close(gained - controlGained, 5)
  })
})

describe('cross-branch overflow (plan 0005 K2 §2.3)', () => {
  test('the spill rate stays within 15–25% and rises with literacy / universities / education', () => {
    const world = newWorld(9303, 'QING')
    const qing = countryOf(world, 'QING')

    qing.pops.literacy = 0
    qing.econ.buildings.universities = 0
    qing.econ.spending.education = 0
    const floor = techSpillRate(qing)
    close(floor, TECH_SPILL_MIN)

    qing.pops.literacy = 0.3
    const higher = techSpillRate(qing)
    expect(higher).toBeGreaterThan(floor)
    expect(higher).toBeLessThanOrEqual(TECH_SPILL_MAX)

    qing.pops.literacy = 1
    qing.econ.buildings.universities = 100
    qing.econ.spending.education = 20
    expect(techSpillRate(qing)).toBe(TECH_SPILL_MAX)
    expect(TECH_SPILL_MAX).toBeLessThanOrEqual(0.25)
  })

  test('overflow adds exactly its fraction to the other branches without deducting the main node', () => {
    const world = newWorld(9304, 'QING')
    const qing = countryOf(world, 'QING')
    const main = techNode('industry-1')
    expect(main).toBeDefined()
    if (main === undefined) return

    research(world, 'QING', 'industry-1')
    qing.tech.points = main.cost / 2
    const targets = crossBranchTargets(qing.tech, main)
    expect(targets.map(node => node.id)).toEqual(['admin-1', 'military-1'])

    advance(world, 1, [], makeRngForWorld(world))

    expect(qing.tech.unlocked).not.toContain('industry-1')
    expect(qing.tech.researching).toBe('industry-1')
    const spill = techSpillRate(qing)
    expect(spill).toBeGreaterThanOrEqual(0.15)
    expect(spill).toBeLessThanOrEqual(0.25)
    const each = (qing.tech.pointsPerMonth * spill) / targets.length
    close(qing.tech.nodes['admin-1'] ?? 0, each / 80)
    close(qing.tech.nodes['military-1'] ?? 0, each / 80)
  })

  test('flowTechOverflow completes a node and installs its effects once', () => {
    const world = newWorld(9305, 'QING')
    const qing = countryOf(world, 'QING')
    const main = techNode('industry-1')
    expect(main).toBeDefined()
    if (main === undefined) return
    qing.tech.nodes['admin-1'] = 0.999
    const completed = flowTechOverflow(qing, main, 1000)
    expect(completed.map(node => node.id)).toContain('admin-1')
    expect(qing.tech.unlocked).toContain('admin-1')
    expect(qing.modifiers.filter(m => m.source === 'tech:admin-1').length).toBe(2)
  })
})

describe('international diffusion (plan 0005 K2 §2.4)', () => {
  const setScores = (world: WorldState, laggard: Country, leaderId: string): void => {
    for (const country of Object.values(world.countries)) {
      if (country.id === leaderId) continue
      country.tech.era = 1
      country.tech.unlocked = ['general-1836']
    }
    const leader = countryOf(world, leaderId)
    leader.tech.era = 4
    leader.tech.unlocked = Array.from({ length: 12 }, (_, i) => `leader-node-${i}`)
    void laggard
  }

  test('a lagging country gains a positive bonus capped at +50%', () => {
    const world = newWorld(9306, 'QING')
    const qing = countryOf(world, 'QING')
    setScores(world, qing, 'GBR')
    qing.diplo.relations.GBR = 100
    if (!qing.diplo.alliances.includes('GBR')) qing.diplo.alliances.push('GBR')

    expect(techScore(qing)).toBeLessThan(techScore(countryOf(world, 'GBR')))
    const bonus = techDiffusionBonus(world, qing)
    expect(bonus).toBeGreaterThan(0)
    expect(bonus).toBeLessThanOrEqual(TECH_DIFFUSION_MAX)
    expect(bonus).toBe(TECH_DIFFUSION_MAX)
  })

  test('trade share raises the bonus and it never exceeds the cap', () => {
    const world = newWorld(9307, 'QING')
    const qing = countryOf(world, 'QING')
    for (const country of Object.values(world.countries)) {
      country.tech.era = 1
      country.tech.unlocked = ['general-1836']
    }
    const leader = countryOf(world, 'GBR')
    leader.tech.era = 2
    leader.tech.unlocked = ['general-1836', 'general-1850']
    qing.diplo.relations.GBR = 0
    qing.diplo.alliances = []
    const withoutTrade = techDiffusionBonus(world, qing)
    expect(withoutTrade).toBeGreaterThan(0)
    expect(withoutTrade).toBeLessThan(TECH_DIFFUSION_MAX)

    qing.trade.exportValue = 10
    qing.trade.exports = [flow('QING', 'GBR', 10)]
    const withTrade = techDiffusionBonus(world, qing)
    expect(withTrade).toBeGreaterThan(withoutTrade)
    expect(withTrade).toBeLessThanOrEqual(TECH_DIFFUSION_MAX)
  })

  test('war or embargo with the advanced partner zeroes the bonus', () => {
    const world = newWorld(9308, 'QING')
    const qing = countryOf(world, 'QING')
    setScores(world, qing, 'GBR')
    qing.diplo.relations.GBR = 100
    if (!qing.diplo.alliances.includes('GBR')) qing.diplo.alliances.push('GBR')
    qing.trade.exportValue = 10
    qing.trade.exports = [flow('QING', 'GBR', 10)]
    expect(techDiffusionBonus(world, qing)).toBeGreaterThan(0)

    world.wars.push(war('GBR', 'QING'))
    expect(techDiffusionBonus(world, qing)).toBe(0)

    world.wars = []
    qing.embargoes.push({ target: 'GBR', goods: 'all', since: { year: 1836, month: 1 } })
    expect(techDiffusionBonus(world, qing)).toBe(0)
  })
})

describe('tech K2 invariants', () => {
  test('the modifier ceiling is 128 and evicts timed before permanent', () => {
    const world = newWorld(9309, 'AUS')
    const aus = countryOf(world, 'AUS')
    aus.modifiers = []
    for (let i = 0; i < MODIFIER_CAP + 2; i += 1) {
      addModifier(aus, {
        id: `m-${i}`,
        label: 'x',
        stat: 'factoryOutput',
        stack: 'percent',
        value: 1,
        source: 'test',
      })
    }
    expect(MODIFIER_CAP).toBe(128)
    expect(aus.modifiers.length).toBe(MODIFIER_CAP)

    aus.modifiers = []
    addModifier(aus, {
      id: 'tech:keep',
      label: 'keep',
      stat: 'armyStrength',
      stack: 'percent',
      value: 5,
      source: 'tech:keep',
    })
    for (let i = 0; i < MODIFIER_CAP + 5; i += 1) {
      addModifier(aus, {
        id: `t-${i}`,
        label: 'timed',
        stat: 'factoryOutput',
        stack: 'percent',
        value: 1,
        monthsLeft: 3,
        source: 'test',
      })
    }
    expect(aus.modifiers.length).toBe(MODIFIER_CAP)
    expect(aus.modifiers.some(modifier => modifier.id === 'tech:keep')).toBe(true)
  })

  test('the same seed yields the same research path and tech state', () => {
    const a = newWorld(9310, 'QING')
    const b = newWorld(9310, 'QING')
    for (let month = 0; month < 60; month += 1) {
      advance(a, 1, [], makeRngForWorld(a))
      advance(b, 1, [], makeRngForWorld(b))
    }
    for (const id of Object.keys(a.countries)) {
      expect(JSON.stringify(a.countries[id]?.tech)).toBe(JSON.stringify(b.countries[id]?.tech))
    }
    expect(a.countries.QING?.tech.unlocked.length).toBeGreaterThan(1)
    expect(a.countries.QING?.tech.unlocked.length).toBeLessThanOrEqual(TECH_NODES.length)
  })
})
