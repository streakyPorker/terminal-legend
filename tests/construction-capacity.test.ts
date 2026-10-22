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
    qing.econ.buildings.coalMines = 0
    qing.econ.buildings.ironMines = 0
    qing.econ.buildings.lumberMills = 0
    expect(constructionCapacity(qing)).toBeLessThan(eight)
  })

  test('the state queue drains points strictly in order', async () => {
    const world = newWorld(9301, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 2
    qing.econ.constructionQueue = []
    const first = project(
      { id: 'first', building: 'textileMills', count: 3, owner: 'state' },
      world.date,
    )
    const second = project(
      { id: 'second', building: 'coalMines', count: 3, owner: 'state' },
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
    const textilesBefore = qing.econ.buildings.textileMills
    qing.econ.constructionQueue.push(
      project(
        { id: 'private', building: 'textileMills', count: 2, owner: 'private' },
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
    // The rent is credited to the treasury, isolated from the wider fiscal
    // settlement (which can be a net deficit for the seed economy): a control
    // world with no workshops has no idle points to rent, so its treasury
    // differs from this one by the rent the private slot paid.
    const control = newWorld(9302, 'QING')
    const controlQing = countryOf(control, 'QING')
    controlQing.econ.buildings.workshops = 0
    controlQing.econ.constructionQueue = []
    controlQing.econ.privateCapital = 100
    advance(control, 1, [], makeRngForWorld(control))
    expect(controlQing.econ.lastConstructionRent).toBe(0)
    expect(qing.econ.treasury).toBeGreaterThan(controlQing.econ.treasury)
    // A private slot now carries ten rounds of workload; it stays in the
    // queue and has made some progress.
    expect(qing.econ.constructionQueue.length).toBeGreaterThan(0)
    expect(qing.econ.constructionQueue[0]?.progress ?? 0).toBeGreaterThan(0)
    expect(qing.econ.buildings.textileMills).toBeGreaterThan(textilesBefore * 0.99)
  })

  test('an old v7 save without the new fields is normalized on load', async () => {
    const world = newWorld(9303, 'QING')
    const raw = JSON.parse(JSON.stringify(world)) as any
    delete raw.countries.QING.econ.buildings.workshops
    delete raw.countries.QING.econ.lastConstructionRent
    raw.countries.QING.econ.constructionQueue = [
      {
        id: 'old',
        building: 'textileMills',
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

describe('construction completion (PT-027)', () => {
  test('a slot given all its remaining work leaves the queue', async () => {
    const world = newWorld(9309, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 10
    qing.econ.constructionQueue = [
      project(
        {
          id: 'tail',
          building: 'workshops',
          count: 1,
          owner: 'state',
          progress: 0.9999,
          monthsLeft: 1,
        },
        world.date,
      ),
    ]
    // Debt pressure adds a construction-speed penalty; it must not leave the
    // slot at 100% but still queued (PT-027).
    qing.econ.treasury = -qing.econ.gdp * 0.5
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.econ.constructionQueue.some(one => one.id === 'tail')).toBe(false)
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
      { countryId: 'QING', action: 'build', params: { building: 'textileMills', count: 20 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    const project = qing.econ.constructionQueue[0]
    expect(project?.count).toBe(5)
    expect(project?.monthsLeft).toBe(1)
    expect(project?.monthlyCost).toBe(2)
    expect(maxSlotCapacity('textileMills')).toBe(10)
  })

  test('a slot draws all idle capacity, not just its own monthly need', async () => {
    const world = newWorld(9305, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.workshops = 12
    qing.econ.constructionQueue = [
      project(
        {
          id: 'oversized',
          building: 'textileMills',
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
      maxSlotCapacity('textileMills'),
    )
    advance(world, 1, [], makeRngForWorld(world))
    const kept = qing.econ.constructionQueue.find(one => one.id === 'oversized')
    expect(kept).toBeDefined()
    if (kept === undefined) return
    expect(kept.lastCapacity ?? 0).toBeGreaterThan(maxSlotCapacity('textileMills'))
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
        { id: 'first', building: 'textileMills', count: 2, owner: 'state' },
        world.date,
      ),
      project(
        { id: 'second', building: 'textileMills', count: 4, owner: 'state' },
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

describe('construction queue orchestration (PT-037)', () => {
  test('cancel by 1-based index removes exactly that entry', async () => {
    const world = newWorld(9310, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.constructionQueue = [
      project({ id: 'a', building: 'textileMills', count: 1, owner: 'state' }, world.date),
      project({ id: 'b', building: 'coalMines', count: 2, owner: 'state' }, world.date),
      project({ id: 'c', building: 'workshops', count: 3, owner: 'state' }, world.date),
    ]
    const removed = applyDecision(
      world,
      { countryId: 'QING', action: 'cancel', params: { index: 2 } },
      makeRngForWorld(world),
    )
    expect(removed.ok).toBe(true)
    expect(qing.econ.constructionQueue.map(one => one.id)).toEqual(['a', 'c'])

    const missing = applyDecision(
      world,
      { countryId: 'QING', action: 'cancel', params: { index: 9 } },
      makeRngForWorld(world),
    )
    expect(missing.ok).toBe(false)
    expect(missing.text).toContain('可用项目')
    expect(missing.text).toContain('1=a（')
  })

  test('build inserts at head or immediately before an existing project', async () => {
    const world = newWorld(9311, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.constructionQueue = [
      project({ id: 'existing', building: 'textileMills', count: 1, owner: 'state' }, world.date),
    ]
    const head = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'build',
        params: { building: 'coalMines', count: 1, position: 'head' },
      },
      makeRngForWorld(world),
    )
    expect(head.ok).toBe(true)
    expect(qing.econ.constructionQueue.map(one => one.building)).toEqual([
      'coalMines',
      'textileMills',
    ])
    expect(qing.econ.constructionQueue[1]?.id).toBe('existing')

    const before = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'build',
        params: { building: 'workshops', count: 1, position: 'before', before: 'existing' },
      },
      makeRngForWorld(world),
    )
    expect(before.ok).toBe(true)
    expect(qing.econ.constructionQueue.map(one => one.building)).toEqual([
      'coalMines',
      'workshops',
      'textileMills',
    ])
    expect(qing.econ.constructionQueue[2]?.id).toBe('existing')

    const badAnchor = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'build',
        params: { building: 'workshops', count: 1, position: 'before', before: 'nope' },
      },
      makeRngForWorld(world),
    )
    expect(badAnchor.ok).toBe(false)
    expect(badAnchor.text).toContain('可用项目')
  })

  test('reorder moves an entry and preserves its progress; private is refused', async () => {
    const world = newWorld(9312, 'QING')
    const qing = countryOf(world, 'QING')
    const first = project(
      { id: 'first', building: 'textileMills', count: 1, owner: 'state', progress: 0.42 },
      world.date,
    )
    const second = project(
      { id: 'second', building: 'coalMines', count: 2, owner: 'state' },
      world.date,
    )
    qing.econ.constructionQueue = [first, second]

    const moved = applyDecision(
      world,
      { countryId: 'QING', action: 'reorder', params: { projectId: 'second', position: 'head' } },
      makeRngForWorld(world),
    )
    expect(moved.ok).toBe(true)
    expect(qing.econ.constructionQueue.map(one => one.id)).toEqual(['second', 'first'])
    expect(qing.econ.constructionQueue[1]).toBe(first)
    expect(qing.econ.constructionQueue[1]?.progress).toBe(0.42)

    const back = applyDecision(
      world,
      { countryId: 'QING', action: 'reorder', params: { index: 1, position: 'tail' } },
      makeRngForWorld(world),
    )
    expect(back.ok).toBe(true)
    expect(qing.econ.constructionQueue.map(one => one.id)).toEqual(['first', 'second'])
    expect(qing.econ.constructionQueue[0]).toBe(first)
    expect(qing.econ.constructionQueue[0]?.progress).toBe(0.42)

    qing.econ.constructionQueue.push(
      project({ id: 'priv', building: 'textileMills', count: 1, owner: 'private' }, world.date),
    )
    const denied = applyDecision(
      world,
      { countryId: 'QING', action: 'reorder', params: { projectId: 'priv', position: 'head' } },
      makeRngForWorld(world),
    )
    expect(denied.ok).toBe(false)
  })
})
