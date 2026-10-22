import { describe, expect, test } from 'claude-code/testing'
import {
  deriveUnemployment,
  INFRA_SUPPLY,
  infrastructureSupply,
  makeRngForWorld,
} from '../engine/data'
import { applyCheat } from '../engine/cheat'
import { statusLine } from '../view/format'
import { monthlyBriefing } from '../engine/secretary'
import {
  advance,
  applyDecision,
  clone,
  completeBuilding,
  computeEconomy,
  councilInterrupt,
  FREE_TRADE_TARIFF_FLOOR,
  inspectEconomy,
  newWorld,
} from '../engine/sim'

// Split out of `first-slice.test.ts` (plan 0012 S6): the engine-side slices —
// M2 construction/economy, the M3 briefing, the M4/M5 council interrupts, the
// M6 destiny actions, and the modifier stacking mechanics. The command-surface
// halves of those milestones live in `first-slice-commands.test.ts`.

// ---------------------------------------------------------------- M2

describe('M2 construction queue and economy fixes', () => {
  test('a build order is queued, not completed on the spot', async () => {
    const world = newWorld(5, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return

    const beforeTextiles = prussia.econ.buildings.textileMills
    const beforeTreasury = prussia.econ.treasury
    const result = applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'textileMills', count: 2 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(prussia.econ.buildings.textileMills).toBe(beforeTextiles)
    expect(prussia.econ.treasury).toBe(beforeTreasury)
    expect(prussia.econ.constructionQueue.length).toBe(1)
    const project = prussia.econ.constructionQueue[0]
    expect(project?.monthsLeft).toBe(1)
    expect(project?.monthlyCost).toBe(0.8)
  })

  test('a queued factory finishes after several funded months', async () => {
    const world = newWorld(5, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return

    const before = prussia.econ.buildings.textileMills
    prussia.econ.treasury = 200
    applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'textileMills', count: 1 } },
      makeRngForWorld(world),
    )
    advance(world, 24, [], makeRngForWorld(world))
    // Monthly depreciation means the stock is not exactly before + 1, but the
    // project completed and added a factory on top of the worn stock.
    expect(prussia.econ.buildings.textileMills).toBeGreaterThan(before * 0.9)
    // Private replacement projects may still be in the queue; the state project
    // under test has completed.
    expect(prussia.econ.constructionQueue.filter(one => one.owner === 'state').length).toBe(0)
  })

  test('without a construction budget projects make no progress', async () => {
    const world = newWorld(6, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return

    prussia.econ.spending.construction = 0
    prussia.econ.buildings.workshops = 0
    applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'textileMills', count: 1 } },
      makeRngForWorld(world),
    )
    advance(world, 3, [], makeRngForWorld(world))
    const stateProject = prussia.econ.constructionQueue.find(one => one.owner === 'state')
    expect(stateProject?.progress).toBe(0)
  })

  test('infrastructure and offices feed different infrastructure values', async () => {
    const world = newWorld(7, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    const supplyBefore = infrastructureSupply(gbr)
    const administrativeBefore = gbr.econ.administrativeCapacity

    completeBuilding(gbr, 'infrastructure', 2)
    // Plan 0014: the single infrastructure building raises unified SUPPLY, and the
    // derived level tracks it. Offices only move admin capacity.
    expect(infrastructureSupply(gbr)).toBe(supplyBefore + 2 * (INFRA_SUPPLY.infrastructure ?? 0))
    expect(gbr.econ.administrativeCapacity).toBe(administrativeBefore)
    const productionAfterRail = inspectEconomy(gbr).production.grain

    completeBuilding(gbr, 'offices', 3)
    completeBuilding(gbr, 'universities', 2)
    expect(gbr.econ.administrativeCapacity).toBe(administrativeBefore + 3 + 1)
    expect(infrastructureSupply(gbr)).toBe(supplyBefore + 2 * (INFRA_SUPPLY.infrastructure ?? 0))
    expect(inspectEconomy(gbr).production.grain).toBe(productionAfterRail)
  })

  test('army and navy appropriations cost money', async () => {
    const world = newWorld(8, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return

    fra.econ.spending.army = 0
    fra.econ.spending.navy = 0
    const leanExpense = computeEconomy(fra).expense
    fra.econ.spending.army = 10
    fra.econ.spending.navy = 10
    const armedExpense = computeEconomy(fra).expense
    // Prices drift between the two calls, so compare the appropriation itself
    // within a small tolerance.
    expect(armedExpense - leanExpense).toBeGreaterThan(9.5)
    expect(armedExpense - leanExpense).toBeLessThan(10.5)
  })

  test('unemployment reacts to industry, literacy and unrest', async () => {
    const world = newWorld(9, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const base = deriveUnemployment(qing)
    expect(base).toBeGreaterThan(0)
    qing.econ.buildings.textileMills += 40
    expect(deriveUnemployment(qing)).toBeLessThan(base)
    qing.pops.literacy += 0.2
    expect(deriveUnemployment(qing)).toBeLessThan(base)
    qing.pops.radicals = 100
    expect(deriveUnemployment(qing)).toBeGreaterThan(base)
  })

  test('laws spend authority and fail when authority is gone', async () => {
    const world = newWorld(10, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return

    aus.government.authority = 3
    const denied = applyDecision(
      world,
      { countryId: 'AUS', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    expect(denied.ok).toBe(false)

    aus.government.authority = 100
    const passed = applyDecision(
      world,
      { countryId: 'AUS', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    expect(passed.ok).toBe(true)
    expect(aus.government.authority).toBeLessThan(100)
    expect(aus.government.authority).toBeGreaterThanOrEqual(85)
  })

  test('free trade lowers the tariff but keeps its 5% floor', async () => {
    const world = newWorld(10, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    qing.econ.tariff = 12
    expect(
      applyDecision(
        world,
        { countryId: 'QING', action: 'law', params: { name: '自由贸易' } },
        makeRngForWorld(world),
      ).ok,
    ).toBe(true)
    expect(qing.econ.tariff).toBe(FREE_TRADE_TARIFF_FLOOR)

    qing.government.authority = 100
    qing.econ.tariff = 4
    applyDecision(
      world,
      { countryId: 'QING', action: 'law', params: { name: '自由贸易' } },
      makeRngForWorld(world),
    )
    expect(qing.econ.tariff).toBe(FREE_TRADE_TARIFF_FLOOR)
  })

  test('infamy drags relations down', async () => {
    const clean = newWorld(11, 'RUS')
    const infamous = newWorld(11, 'RUS')
    const cleanRus = clean.countries.RUS
    const infamousRus = infamous.countries.RUS
    expect(cleanRus).toBeDefined()
    expect(infamousRus).toBeDefined()
    if (cleanRus === undefined || infamousRus === undefined) return

    infamousRus.diplo.infamy = 50
    advance(clean, 1, [], makeRngForWorld(clean))
    advance(infamous, 1, [], makeRngForWorld(infamous))
    expect(infamousRus.diplo.relations.GBR ?? 0).toBeLessThan(
      cleanRus.diplo.relations.GBR ?? 0,
    )
  })
})

// ---------------------------------------------------------------- M3

describe('M3 secretary subagent', () => {
  test('the briefing states which domains are delegated', async () => {
    const world = newWorld(12, 'QING')
    expect(monthlyBriefing(world)).toContain('内政：未授权')
    expect(monthlyBriefing(world)).toContain('外交：未授权')
    world.secretary.delegation.internal = true
    expect(monthlyBriefing(world)).toContain('内政：已授权')
  })
})

// ---------------------------------------------------------------- M4/M5

describe('M4/M5 council and managed runs', () => {
  test('interrupts fire on events, new wars and wars ending', async () => {
    const before = newWorld(14, 'QING')

    const withEvent = clone(before)
    withEvent.events.push({
      id: 'ev-test',
      date: { ...withEvent.date },
      kind: 'harvest',
      title: '测试事件',
      text: '测试',
      countryId: 'QING',
      options: [],
      isResolved: false,
    })
    expect(councilInterrupt(before, withEvent)).toBe('有待决事件')

    const withWar = clone(before)
    withWar.wars.push({
      id: 'war-test',
      name: '测试战争',
      attackers: ['GBR'],
      defenders: ['QING'],
      started: { ...withWar.date },
      months: 0,
      warScore: 0,
      battles: 0,
      reason: '测试',
      lastEvent: '开战',
      goal: 'reparations',
      goalOwner: 'GBR',
    })
    expect(councilInterrupt(before, withWar)).toBe('新的战争')
    expect(councilInterrupt(withWar, before)).toBe('战争结束')
  })

  test('a managed run advances and stops when a war arrives', async () => {
    const world = newWorld(15, 'QING')
    // A short deterministic check of the underlying month loop: one month
    // then a war involving the player appears.
    advance(world, 1, [], makeRngForWorld(world))
    expect(world.tick).toBe(1)
    const beforeWar = clone(world)
    world.wars.push({
      id: 'war-managed',
      name: '托管测试战争',
      attackers: ['GBR'],
      defenders: ['QING'],
      started: { ...world.date },
      months: 0,
      warScore: 0,
      battles: 0,
      reason: '测试',
      lastEvent: '开战',
      goal: 'reparations',
      goalOwner: 'GBR',
    })
    expect(councilInterrupt(beforeWar, world)).toBe('新的战争')
  })
})

// ---------------------------------------------------------------- M6

describe('M6 destiny and ironman', () => {
  test('destiny edits money, buildings, dates and leaders', async () => {
    const world = newWorld(16, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const before = qing.econ.treasury
    expect(applyCheat(world, { action: 'treasury', amount: 50 }).ok).toBe(true)
    expect(qing.econ.treasury).toBe(before + 50)

    const farms = qing.econ.buildings.farms
    expect(applyCheat(world, { action: 'building', building: 'farms', count: 3 }).ok).toBe(true)
    expect(qing.econ.buildings.farms).toBe(farms + 3)

    // Plan 0014: cheat building edits go through `completeBuilding`, which
    // moves the unified infrastructure SUPPLY (single merged building).
    const supply = infrastructureSupply(qing)
    expect(applyCheat(world, { action: 'building', building: 'infrastructure', count: 2 }).ok).toBe(true)
    expect(infrastructureSupply(qing)).toBe(supply + 2 * (INFRA_SUPPLY.infrastructure ?? 0))
    expect(applyCheat(world, { action: 'building', building: 'infrastructure', count: -2 }).ok).toBe(true)
    expect(infrastructureSupply(qing)).toBe(supply)

    expect(applyCheat(world, { action: 'date', year: 1840, month: 6 }).ok).toBe(true)
    expect(world.date).toEqual({ year: 1840, month: 6 })

    expect(applyCheat(world, { action: 'leader', name: '测试皇帝', title: '皇帝' }).ok).toBe(true)
    expect(qing.leader.name).toBe('测试皇帝')
    expect(world.log.some(entry => entry.text.includes('[天命]'))).toBe(true)
  })

  test('destiny completes every state project and leaves private ones', async () => {
    const world = newWorld(19, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.constructionQueue = [
      {
        id: 'state-1',
        building: 'textileMills',
        count: 2,
        owner: 'state',
        monthsLeft: 4,
        monthlyCost: 2,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      },
      {
        id: 'private-1',
        building: 'coalMines',
        count: 1,
        owner: 'private',
        monthsLeft: 3,
        monthlyCost: 1,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      },
    ]
    const textiles = qing.econ.buildings.textileMills
    const result = applyCheat(world, { action: 'finishProjects' })
    expect(result.ok).toBe(true)
    expect(qing.econ.buildings.textileMills).toBe(textiles + 2)
    expect(qing.econ.constructionQueue.map(one => one.id)).toEqual(['private-1'])
  })

  test('ironman refuses every destiny action', async () => {
    const world = newWorld(17, 'FRA')
    world.ironman = true
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const before = fra.econ.treasury
    const result = applyCheat(world, { action: 'treasury', amount: 50 })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('铁人')
    expect(fra.econ.treasury).toBe(before)
    expect(statusLine(world)).toContain('铁人')
  })

  test('destiny can push net assets negative, which is national debt', async () => {
    const world = newWorld(18, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const amount = -(qing.econ.treasury + 50)
    expect(applyCheat(world, { action: 'treasury', amount }).ok).toBe(true)
    expect(qing.econ.treasury).toBeLessThan(0)
    expect(Math.abs(qing.econ.treasury + 50)).toBeLessThan(1e-9)
  })
})
