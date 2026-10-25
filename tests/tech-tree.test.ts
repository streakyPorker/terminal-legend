import { describe, expect, test } from 'claude-code/testing'
import type { Country, TechState, WorldState } from '../types'
import {
  TECH_NODES,
  canResearchNode,
  eraGateOk,
  makeRngForWorld,
  prereqOk,
  techNode,
  techTier,
  unlockedInBranch,
} from '../engine/data'
import type { Decision } from '../engine/internal'
import { advance, applyDecision, newWorld } from '../engine/sim'
import { CURRENT_WORLD_VERSION, parseWorld } from '../engine/save'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const research = (
  world: WorldState,
  countryId: string,
  tech: string,
): { ok: boolean; text: string } =>
  applyDecision(
    world,
    { countryId, action: 'research', params: { tech } } as Decision,
    makeRngForWorld(world),
  )

const state = (partial: Partial<TechState>): TechState => ({
  era: 1,
  nodes: {},
  unlocked: [],
  researching: '',
  points: 0,
  pointsPerMonth: 0,
  ...partial,
})

const close = (actual: number, expected: number, digits = 9): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(10 ** -digits)
}

describe('tech tree (plan 0005 K1)', () => {
  test('a fresh world seeds era 1, general-1836 and a continuous techTier', () => {
    const world = newWorld(9100, 'QING')
    for (const country of Object.values(world.countries)) {
      const tech = country.tech
      expect(Number.isFinite(techTier(tech))).toBe(true)
      expect(techTier(tech)).toBeGreaterThan(0)
      expect(tech.era).toBeGreaterThanOrEqual(1)
      expect(tech.unlocked).toContain('general-1836')
      expect(tech.researching).not.toBe('')
    }
    expect(world.version).toBe(14)
  })

  test('techTier follows 1 + era×1.5 + unlocked×0.05', () => {
    close(techTier(state({ era: 1, unlocked: ['general-1836'] })), 2.55)
    close(techTier(state({ era: 2, unlocked: ['a', 'b'] })), 4.1)
    close(techTier(state({ era: 4, unlocked: Array.from({ length: 8 }, (_, i) => `${i}`) })), 7.4)
  })

  test('the era gate rejects a branch node above the current era, but not general nodes', () => {
    const s = state({
      era: 1,
      unlocked: ['general-1836', 'general-1850', 'industry-1'],
    })
    const industry2 = techNode('industry-2')
    expect(industry2).toBeDefined()
    if (industry2 === undefined) return
    expect(prereqOk(s, industry2)).toBe(true)
    expect(eraGateOk(s, industry2)).toBe(false)
    expect(canResearchNode(s, industry2)).toBe(false)
    expect(canResearchNode({ ...s, era: 2 }, industry2)).toBe(true)

    const general1850 = techNode('general-1850')
    expect(general1850).toBeDefined()
    if (general1850 === undefined) return
    expect(eraGateOk(s, general1850)).toBe(true)
  })

  test('prerequisites and the any-branch count gate the general line', () => {
    const general1865 = techNode('general-1865')
    expect(general1865).toBeDefined()
    if (general1865 === undefined) return

    const base = state({ era: 2, unlocked: ['general-1836', 'general-1850', 'industry-1'] })
    expect(unlockedInBranch(base, 'industry')).toBe(1)
    expect(prereqOk(base, general1865)).toBe(false)

    const withTwo = state({
      era: 2,
      unlocked: ['general-1836', 'general-1850', 'industry-1', 'industry-2'],
    })
    expect(prereqOk(withTwo, general1865)).toBe(true)

    const noPrereq = state({ era: 3, unlocked: ['industry-1', 'industry-2'] })
    expect(prereqOk(noPrereq, general1865)).toBe(false)
  })

  test('research selects a node, rejects invalid choices, and completion unlocks + raises era', () => {
    const world = newWorld(9101, 'QING')
    const qing = countryOf(world, 'QING')

    const unknown = research(world, 'QING', 'not-a-node')
    expect(unknown.ok).toBe(false)
    expect(unknown.text).toContain('未知科技节点')

    const locked = research(world, 'QING', 'industry-4')
    expect(locked.ok).toBe(false)
    expect(locked.text).toContain('时代')

    qing.tech.era = 4
    const blocked = research(world, 'QING', 'industry-4')
    expect(blocked.ok).toBe(false)
    expect(blocked.text).toContain('前置')
    qing.tech.era = 1

    const chosen = research(world, 'QING', 'general-1850')
    expect(chosen.ok).toBe(true)
    expect(qing.tech.researching).toBe('general-1850')

    qing.tech.points = 500
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.tech.unlocked).toContain('general-1850')
    expect(qing.tech.era).toBe(2)
    expect(Number.isFinite(qing.tech.points)).toBe(true)
  })

  test('a node costs its configured points and cannot be researched twice', () => {
    const world = newWorld(9102, 'QING')
    const qing = countryOf(world, 'QING')
    const node = techNode('admin-1')
    expect(node).toBeDefined()
    if (node === undefined) return
    research(world, 'QING', 'admin-1')
    qing.tech.points = node.cost + 0.5
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.tech.unlocked).toContain('admin-1')
    close(qing.tech.points, 0.5 + qing.tech.pointsPerMonth, 6)
    const again = research(world, 'QING', 'admin-1')
    expect(again.ok).toBe(false)
    expect(again.text).toContain('已解锁')
  })

  test('old v12 saves are rejected; the current shape loads', () => {
    expect(CURRENT_WORLD_VERSION).toBe(14)
    const fresh = newWorld(9103, 'AUS')
    expect(parseWorld(JSON.parse(JSON.stringify(fresh)))).toBeDefined()

    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>
    old.version = 12
    expect(parseWorld(old)).toBeUndefined()
  })

  test('a 120-month baseline stays finite and never exceeds the modelled range', () => {
    const world = newWorld(9104, 'QING')
    for (let month = 0; month < 120; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
    }
    for (const country of Object.values(world.countries)) {
      const tech = country.tech
      expect(Number.isFinite(tech.points)).toBe(true)
      expect(Number.isFinite(tech.pointsPerMonth)).toBe(true)
      expect(Number.isFinite(techTier(tech))).toBe(true)
      expect(tech.era).toBeGreaterThanOrEqual(1)
      expect(tech.era).toBeLessThanOrEqual(4)
      expect(tech.unlocked.length).toBeLessThanOrEqual(TECH_NODES.length)
      expect(tech.points).toBeGreaterThanOrEqual(0)
    }
  })
})
