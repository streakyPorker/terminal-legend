import { describe, expect, test } from 'claude-code/testing'
import { BUILDINGS, BUILDING_IDS, makeRngForWorld } from '../engine/data'
import { applyDecision, newWorld, randomDecision } from '../engine/sim'
import type { Decision } from '../engine/internal'
import type { Rng } from '../engine/rng'
import type { BuildingId, Country, WorldState } from '../types'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const build = (
  world: WorldState,
  countryId: string,
  building: string,
  count = 1,
): { ok: boolean; text: string } =>
  applyDecision(
    world,
    { countryId, action: 'build', params: { building, count } } as Decision,
    makeRngForWorld(world),
  )

// Drives the derived tech tier (plan 0005 K0) to an exact value for gate tests:
// techTier = 1 + era×1.5 + unlocked×0.05, held at era 1 with a padded unlock list.
const setTier = (country: Country, tier: number): void => {
  country.tech.era = 1
  const count = Math.max(0, Math.round((tier - 2.5) / 0.05))
  country.tech.unlocked = Array.from({ length: count }, (_, i) => `tier-node-${i}`)
}

// Plan 0015 S0: the three new buildings arrive LOCKED behind `unlock.techLevel`.
const NEW_BUILDINGS: BuildingId[] = ['chemicalWorks', 'powerPlants', 'locomotiveWorks']

// Plan 0011 F6: forward-compatible building unlock. A building is gated while
// `unlock.techLevel` exceeds the country's level; no building sets one today, so
// every build stays bit-for-bit buildable.
describe('F6 building unlock gate', () => {
  test('a building without unlock is always buildable, at any tech level', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    for (const level of [0, 5, 10]) {
      setTier(qing, level)
      const before = qing.econ.constructionQueue.length
      const result = build(world, 'QING', 'farms')
      expect(result.ok, `tech level ${level}`).toBe(true)
      expect(qing.econ.constructionQueue.length).toBe(before + 1)
    }
  })

  test('a building whose unlock.techLevel exceeds the level is rejected and queues nothing', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    setTier(qing, 2)
    const saved = BUILDINGS.farms.unlock
    try {
      BUILDINGS.farms.unlock = { techLevel: 3 }
      const before = qing.econ.constructionQueue.length
      const result = build(world, 'QING', 'farms')
      expect(result.ok).toBe(false)
      expect(result.text).toContain('解锁')
      expect(qing.econ.constructionQueue.length).toBe(before)
    } finally {
      if (saved === undefined) delete BUILDINGS.farms.unlock
      else BUILDINGS.farms.unlock = saved
    }
  })

  test('a building at or above the required level is accepted', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    const saved = BUILDINGS.farms.unlock
    try {
      BUILDINGS.farms.unlock = { techLevel: 3 }
      setTier(qing, 3)
      expect(build(world, 'QING', 'farms').ok).toBe(true)
      setTier(qing, 5)
      expect(build(world, 'QING', 'farms').ok).toBe(true)
    } finally {
      if (saved === undefined) delete BUILDINGS.farms.unlock
      else BUILDINGS.farms.unlock = saved
    }
  })

  test('an unlock.techLevel of undefined never gates the building', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    setTier(qing, 0)
    const saved = BUILDINGS.farms.unlock
    try {
      BUILDINGS.farms.unlock = {}
      expect(build(world, 'QING', 'farms').ok).toBe(true)
    } finally {
      if (saved === undefined) delete BUILDINGS.farms.unlock
      else BUILDINGS.farms.unlock = saved
    }
  })

  test('the existence check still precedes the unlock check', () => {
    const world = newWorld(9100, 'QING')
    const result = build(world, 'QING', 'not-a-building')
    expect(result.ok).toBe(false)
    expect(result.text).toContain('未知建筑')
  })

  test('the legacy roster is ungated and buildable; the three new buildings are locked', () => {
    const legacy = (BUILDING_IDS as BuildingId[]).filter(id => !NEW_BUILDINGS.includes(id))
    for (const id of legacy) {
      expect(BUILDINGS[id].unlock?.techLevel, `${id} tech gate`).toBeUndefined()
    }
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 10000
    setTier(qing, 0)
    for (const id of legacy) {
      expect(build(world, 'QING', id).ok, `build ${id}`).toBe(true)
    }

    for (const id of NEW_BUILDINGS) {
      expect(BUILDING_IDS, `roster is missing ${id}`).toContain(id)
      const def = BUILDINGS[id]
      expect(def, `BUILDINGS is missing ${id}`).toBeDefined()
      expect(def?.unlock?.techLevel, `${id} lock`).toBeDefined()
      const before = qing.econ.constructionQueue.length
      const result = build(world, 'QING', id)
      expect(result.ok, `build ${id} is locked`).toBe(false)
      expect(result.text).toContain('未解锁')
      expect(qing.econ.constructionQueue.length).toBe(before)
    }
  })

  test('the AI build candidate list still yields an applicable build decision', () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 1000
    qing.econ.constructionQueue = []
    // chance() is true only for the build branch's 0.45 roll, so the earlier
    // debt / spending / invest branches (0.5 / 0.3 / 0.15) are skipped.
    const rng: Rng = {
      next: () => 0,
      int: () => 0,
      range: (min: number) => min,
      chance: (probability: number) => probability === 0.45,
      pick: <T>(items: readonly T[]): T => items[0] as T,
    }
    const decision = randomDecision(world, qing, rng)
    expect(decision?.action).toBe('build')
    if (decision === undefined) return
    const building = String(decision.params.building) as BuildingId
    expect(BUILDING_IDS).toContain(building)
    const applied = applyDecision(world, decision, makeRngForWorld(world))
    expect(applied.ok).toBe(true)
  })

  test('the world stays at version 14', () => {
    expect(newWorld(9100, 'QING').version).toBe(14)
  })
})
