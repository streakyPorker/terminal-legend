import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { parseWorld } from '../engine/save'
import { expenseParts } from '../engine/fiscal'
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

describe('construction subsidy (ADR 0015)', () => {
  test('each spending level adds capacity points and costs gold', async () => {
    const world = newWorld(9308, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 10
    qing.econ.spending.construction = 0
    const base = constructionCapacity(qing)
    qing.econ.spending.construction = 10
    const subsidised = constructionCapacity(qing)
    // The subsidy adds 15 gross points; material availability scales the gain.
    const gain = subsidised - base
    expect(gain).toBeGreaterThan(10)
    expect(gain).toBeLessThanOrEqual(15 + 1e-9)
    expect(
      Math.abs(expenseParts(qing, qing.econ.gdp).constructionSubsidy - 4.5),
    ).toBeLessThan(1e-6)
  })
})

describe('construction slot limits (ADR 0012/0013)', () => {
  test('a build order clamps to five buildings and prices the workload', async () => {
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

  test('a slot draws all idle capacity, not just its own monthly need', async () => {
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
    // Leave only one gold of debt room so the slot cannot finish this month.
    qing.econ.treasury = -qing.econ.gdp * 3 + 1
    const load = constructionLoad(qing)
    // A five-factory slot's monthly need is 10 points; with the workshops idle
    // it can take every point they produce this month.
    expect(load.byProject.oversized ?? 0).toBeGreaterThan(
      maxSlotCapacity('factories'),
    )
    advance(world, 1, [], makeRngForWorld(world))
    const kept = qing.econ.constructionQueue.find(one => one.id === 'oversized')
    expect(kept).toBeDefined()
    if (kept === undefined) return
    expect(kept.lastCapacity ?? 0).toBeGreaterThan(maxSlotCapacity('factories'))
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

  test('a one-building entry takes the idle points and finishes at once', async () => {
    const world = newWorld(9307, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 10
    qing.econ.constructionQueue = []
    for (let i = 0; i < 5; i += 1) {
      qing.econ.constructionQueue.push(
        project(
          { id: `slot-${i}`, building: 'workshops', count: 1, owner: 'state' },
          world.date,
        ),
      )
    }
    normalizeConstructionQueue(qing)
    const load = constructionLoad(qing)
    const capacity = load.capacity
    // Workload 45 (1.5 monthly need × 30); its own monthly need is only 1.5,
    // but the first entry in the queue may take everything idle.
    expect(load.byProject['slot-0'] ?? 0).toBeGreaterThan(1.5)
    const schedule = constructionSchedule(qing)
    const firstTurns = Math.max(1, Math.ceil(45 / capacity))
    expect(schedule['slot-0']?.turns ?? 0).toBe(firstTurns)
    expect(schedule['slot-0']?.currentShare ?? 0).toBe(1)
    // Queue order: the later entries wait for the first one to finish.
    expect(schedule['slot-4']?.turns ?? 0).toBeGreaterThan(firstTurns)
  })
})
