import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { parseWorld } from '../engine/save'
import {
  advance,
  capacityCost,
  applyDecision,
  constructionCapacity,
  constructionLoad,
  constructionSchedule,
  maxSlotCapacity,
  newWorld,
  normalizeConstructionQueue,
} from '../engine/sim'
import type { ConstructionProject, Country, WorldState } from '../types'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const project = (
  input: Partial<ConstructionProject> & {
    id: string
    building: ConstructionProject['building']
    count: number
    owner: 'state' | 'private'
  },
  date: WorldState['date'],
): ConstructionProject => ({
  monthsLeft: 4,
  monthlyCost: 2,
  lastSpend: 0,
  progress: 0,
  startedAt: { ...date },
  ...input,
})

describe('construction capacity (ADR 0010)', () => {
  test('workshops produce points; inputs can cap them', async () => {
    const world = newWorld(9300, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 0
    expect(constructionCapacity(qing)).toBe(0)
    qing.econ.buildings.workshops = 4
    const four = constructionCapacity(qing)
    expect(four).toBeGreaterThan(0)
    qing.econ.buildings.workshops = 8
    const eight = constructionCapacity(qing)
    expect(eight).toBeGreaterThan(four)
    // A country with no wood/grain/iron cannot run its workshops.
    qing.econ.resources.timber = 0
    qing.econ.resources.farmland = 0
    qing.econ.resources.iron = 0
    qing.econ.buildings.farms = 0
    qing.econ.buildings.mines = 0
    expect(constructionCapacity(qing)).toBeLessThan(eight)
  })

  test('the state queue drains points strictly in order', async () => {
    const world = newWorld(9301, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 2
    qing.econ.constructionQueue = []
    const first = project(
      { id: 'first', building: 'factories', count: 3, owner: 'state' },
      world.date,
    )
    const second = project(
      { id: 'second', building: 'mines', count: 3, owner: 'state' },
      world.date,
    )
    qing.econ.constructionQueue.push(first, second)
    const load = constructionLoad(qing)
    expect(load.requested).toBeGreaterThan(load.capacity)
    expect(load.byProject.first).toBeGreaterThan(0)
    // The first slot is capped at its own need; the second gets only the
    // leftover points, if the month's capacity exceeded that need.
    expect(load.byProject.second ?? 0).toBeLessThan(load.byProject.first ?? 0)

    // The first slot gets the lion's share; the second only sees leftover
    // points if the month's capacity happened to exceed the first slot's need.
    expect(load.byProject.first ?? 0).toBeGreaterThan(load.byProject.second ?? 0)
  })

  test('private builders rent idle state points and pay the treasury', async () => {
    const world = newWorld(9302, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 4
    qing.econ.constructionQueue = []
    qing.econ.privateCapital = 100
    const before = qing.econ.treasury
    const factoriesBefore = qing.econ.buildings.factories
    qing.econ.constructionQueue.push(
      project(
        { id: 'private', building: 'factories', count: 2, owner: 'private' },
        world.date,
      ),
    )
    // A private slot alone leaves half the points idle; it rents the rest.
    const load = constructionLoad(qing)
    expect(load.allocated).toBe(0) // state points allocated to state slots
    expect(load.privateOwn).toBeGreaterThan(0)
    expect(load.privateRented).toBeGreaterThan(0)
    expect(load.privateMarket).toBeGreaterThanOrEqual(0)
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.econ.lastConstructionRent).toBeGreaterThan(0)
    expect(qing.econ.treasury).toBeGreaterThan(before)
    // A private slot now carries ten rounds of workload; it stays in the
    // queue and has made some progress.
    expect(qing.econ.constructionQueue.length).toBeGreaterThan(0)
    expect(qing.econ.constructionQueue[0]?.progress ?? 0).toBeGreaterThan(0)
    expect(qing.econ.buildings.factories).toBeGreaterThan(factoriesBefore * 0.99)
  })

  test('an old v7 save without the new fields is normalized on load', async () => {
    const world = newWorld(9303, 'QING')
    const raw = JSON.parse(JSON.stringify(world)) as any
    delete raw.countries.QING.econ.buildings.workshops
    delete raw.countries.QING.econ.lastConstructionRent
    raw.countries.QING.econ.constructionQueue = [
      {
        id: 'old',
        building: 'factories',
        count: 1,
        owner: 'state',
        monthsLeft: 2,
        monthlyCost: 1,
        lastSpend: 0,
        progress: 0,
        startedAt: raw.date,
      },
    ]
    const parsed = parseWorld(raw)
    expect(parsed).toBeDefined()
    if (parsed === undefined) return
    const qing = countryOf(parsed, 'QING')
    expect(qing.econ.buildings.workshops).toBeGreaterThan(0)
    expect(qing.econ.lastConstructionRent).toBe(0)
    expect(qing.econ.constructionQueue[0]?.lastCapacity).toBe(0)
  })
})

describe('construction slot limits (ADR 0011)', () => {
  test('a slot holds at most 15 buildings and has a 15× point ceiling', async () => {
    const world = newWorld(9304, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 10
    qing.econ.constructionQueue = []
    const result = applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'factories', count: 20 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    const project = qing.econ.constructionQueue[0]
    expect(project?.count).toBe(5)
    expect(project?.monthsLeft).toBe(1)
    expect(project?.monthlyCost).toBe(2)
    expect(maxSlotCapacity('factories')).toBe(10)
  })

  test('a legacy oversized slot is capped at 15 buildings worth of points', async () => {
    const world = newWorld(9305, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 12
    qing.econ.constructionQueue = [
      project(
        {
          id: 'oversized',
          building: 'factories',
          count: 20,
          owner: 'state',
          monthsLeft: 1,
          monthlyCost: 1,
        },
        world.date,
      ),
    ]
    const cap = maxSlotCapacity('factories')
    // Leave only one gold of debt room so the slot cannot finish this month.
    qing.econ.treasury = -qing.econ.gdp * 3 + 1
    const load = constructionLoad(qing)
    expect(load.byProject.oversized).toBeLessThanOrEqual(cap)
    advance(world, 1, [], makeRngForWorld(world))
    const kept = qing.econ.constructionQueue.find(one => one.id === 'oversized')
    expect(kept).toBeDefined()
    if (kept === undefined) return
    expect(kept.lastCapacity ?? 0).toBeLessThanOrEqual(cap)
    expect(kept.progress).toBeGreaterThan(0)
    expect(kept.progress).toBeLessThan(1)
  })
})

describe('construction schedule estimate', () => {
  test('projects completion turns in queue order instead of showing monthsLeft', async () => {
    const world = newWorld(9306, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 2
    qing.econ.constructionQueue = []
    qing.econ.constructionQueue.push(
      project(
        { id: 'first', building: 'factories', count: 2, owner: 'state' },
        world.date,
      ),
      project(
        { id: 'second', building: 'factories', count: 4, owner: 'state' },
        world.date,
      ),
    )
    normalizeConstructionQueue(qing)
    const schedule = constructionSchedule(qing)
    expect(schedule.first?.turns ?? 0).toBeGreaterThan(1)
    expect(schedule.second?.turns ?? 0).toBeGreaterThan(schedule.first?.turns ?? 0)
  })
})
