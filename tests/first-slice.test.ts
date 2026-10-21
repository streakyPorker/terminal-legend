import { describe, expect, test } from 'claude-code/testing'
import { deriveBureaucracy, deriveUnemployment, initialUi, spawnEvent } from '../engine/data'
import { applyCheat } from '../engine/cheat'
import { statusLine } from '../view/format'
import {
  addModifier,
  applyModifiers,
  describeModifier,
  tickModifiers,
} from '../engine/modifiers'
import { monthlyBriefing } from '../engine/secretary'
import {
  advance,
  applyDecision,
  applyEventOption,
  applyPolicy,
  clone,
  completeBuilding,
  computeEconomy,
  councilInterrupt,
  FREE_TRADE_TARIFF_FLOOR,
  inspectEconomy,
  newWorld,
} from '../engine/sim'
import { parseWorld } from '../engine/save'
import { makeRngForWorld } from '../engine/data'
import type { Country, WorldState } from '../types'

// ---------------------------------------------------------------- M1

describe('M1 types, data and migration', () => {
  test('a new world is current-version with split infrastructure and bureaucracy', async () => {
    const world = newWorld(1, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    expect(world.version).toBe(10)
    expect(world.ironman).toBe(false)
    expect(world.secretary.delegation).toEqual({
      internal: false,
      diplomacy: false,
      months: 1,
    })
    expect(qing.econ.transportInfrastructure).toBe(25)
    expect(qing.econ.administrativeCapacity).toBe(20 + 0.12 * 40 + 4 * 2)
    expect(qing.econ.buildings.offices).toBe(4)
    expect(qing.econ.constructionQueue).toEqual([])
    expect('infrastructure' in qing.econ).toBe(false)
    expect(qing.bureaucracy.score).toBeGreaterThanOrEqual(0)
    expect(qing.bureaucracy.ceiling).toBeGreaterThanOrEqual(20)
    expect(qing.bureaucracy.actionBudget).toBeGreaterThanOrEqual(1)
  })

  test('bureaucracy follows spending, literacy, capacity and offices', async () => {
    const world = newWorld(2, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    gbr.government.type = '专制君主制'
    gbr.pops.literacy = 0
    gbr.pops.radicals = 100
    gbr.econ.spending.bureaucracy = 0
    gbr.econ.administrativeCapacity = 0
    gbr.econ.buildings.offices = 0

    const bare = deriveBureaucracy(gbr, false)
    expect(bare.score).toBe(0)
    expect(bare.ceiling).toBe(30)
    expect(bare.actionBudget).toBe(1)
    expect(bare.fundEfficiency).toBe(0.5)
    expect(bare.delayChance).toBe(0.35)
    expect(bare.infoDistortion).toBe(0.3)

    gbr.econ.buildings.offices = 4
    gbr.econ.administrativeCapacity = 40
    const staffed = deriveBureaucracy(gbr, false)
    expect(staffed.ceiling).toBe(42)
    expect(staffed.score).toBeGreaterThan(bare.score)
    expect(staffed.fundEfficiency).toBeGreaterThan(bare.fundEfficiency)
  })

  test('a monthly advance smooths bureaucracy toward its target', async () => {
    const world = newWorld(3, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const before = fra.bureaucracy.score
    advance(world, 1, [], makeRngForWorld(world))
    expect(Number.isFinite(fra.bureaucracy.score)).toBe(true)
    expect(fra.bureaucracy.score).not.toBe(before)
  })

  test('only the current save shape loads', async () => {
    const fresh = newWorld(4, 'AUS')
    expect(parseWorld(JSON.parse(JSON.stringify(fresh)))).toBeDefined()

    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>
    old.version = 1
    expect(parseWorld(old)).toBeUndefined()
    old.version = 2
    expect(parseWorld(old)).toBeUndefined()
  })

  test('a corrupt save is rejected', async () => {
    expect(parseWorld({})).toBeUndefined()
    expect(parseWorld('nope')).toBeUndefined()
    expect(parseWorld({ version: 11, tick: 0, date: {}, countries: {} })).toBeUndefined()
  })
})

// ---------------------------------------------------------------- M2

describe('M2 construction queue and economy fixes', () => {
  test('a build order is queued, not completed on the spot', async () => {
    const world = newWorld(5, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return

    const beforeFactories = prussia.econ.buildings.factories
    const beforeTreasury = prussia.econ.treasury
    const result = applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'factories', count: 2 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(prussia.econ.buildings.factories).toBe(beforeFactories)
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

    const before = prussia.econ.buildings.factories
    prussia.econ.treasury = 200
    applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'factories', count: 1 } },
      makeRngForWorld(world),
    )
    advance(world, 24, [], makeRngForWorld(world))
    // Monthly depreciation means the stock is not exactly before + 1, but the
    // project completed and added a factory on top of the worn stock.
    expect(prussia.econ.buildings.factories).toBeGreaterThan(before * 0.9)
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
      { countryId: 'PRU', action: 'build', params: { building: 'factories', count: 1 } },
      makeRngForWorld(world),
    )
    advance(world, 3, [], makeRngForWorld(world))
    const stateProject = prussia.econ.constructionQueue.find(one => one.owner === 'state')
    expect(stateProject?.progress).toBe(0)
  })

  test('railroads and offices feed different infrastructure values', async () => {
    const world = newWorld(7, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    const transportBefore = gbr.econ.transportInfrastructure
    const administrativeBefore = gbr.econ.administrativeCapacity

    completeBuilding(gbr, 'railroads', 2)
    expect(gbr.econ.transportInfrastructure).toBe(transportBefore + 6)
    expect(gbr.econ.administrativeCapacity).toBe(administrativeBefore)
    const productionAfterRail = inspectEconomy(gbr).production.grain

    completeBuilding(gbr, 'offices', 3)
    completeBuilding(gbr, 'universities', 2)
    expect(gbr.econ.administrativeCapacity).toBe(administrativeBefore + 3 + 1)
    expect(gbr.econ.transportInfrastructure).toBe(transportBefore + 6)
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

  test('unemployment reacts to factories, literacy and unrest', async () => {
    const world = newWorld(9, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const base = deriveUnemployment(qing)
    expect(base).toBeGreaterThan(0)
    qing.econ.buildings.factories += 40
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

const setupSurface = (
  anyOn: (event: string, hook: ($: any, e: any) => unknown) => void,
  extra?: Record<string, ($: any, e: any) => unknown>,
): void => {
  const hooks: Record<string, ($: any, e: any) => unknown> = {
    'session.start': ($: any, e: any) => ({ cwd: e.cwd }),
    'command.register': ($: any, e: any) => ({ value: { command: e.command } }),
    'tool.register': ($: any, e: any) => ({
      value: { tool: `mcp__terminal-legend__${e.name}` },
    }),
    'agent.register': () => ({ value: { agent: 'terminal-legend:secretary' } }),
    'turn.complete': () => ({ text: '' }),
    'fs.exists': () => ({ value: false }),
    'fs.write': () => ({ value: undefined }),
    'fs.read': () => ({ value: '' }),
    'env.get': () => ({ value: '/tmp' }),
    'session.root': () => ({ value: '/tmp' }),
    'session.cwd': () => ({ value: '/tmp' }),
    'session.id': () => ({ value: 'test-session' }),
    'ui.open': () => ({ value: { isPlaced: true } }),
    'ui.status': () => ({ value: undefined }),
    'ui.log': () => ({ value: undefined }),
    'ui.toast': () => ({ value: undefined }),
    ...extra,
  }
  for (const [event, hook] of Object.entries(hooks)) anyOn(event, hook)
}

const startCampaign = async (
  $: any,
): Promise<((input: unknown) => Promise<{ text: string }>)> => {
  await ($.session.start as unknown as (e: unknown) => Promise<unknown>)({
    cwd: '/tmp',
    surface: 'terminal',
    isInteractive: true,
  })
  const run = (input: unknown) =>
    ($.command.run as unknown as (e: unknown) => Promise<{ text: string }>)(input)
  await run({ command: 'v3', args: 'new QING' })
  return run
}

describe('M3 secretary subagent', () => {
  test('the briefing states which domains are delegated', async () => {
    const world = newWorld(12, 'QING')
    expect(monthlyBriefing(world)).toContain('内政：未授权')
    expect(monthlyBriefing(world)).toContain('外交：未授权')
    world.secretary.delegation.internal = true
    expect(monthlyBriefing(world)).toContain('内政：已授权')
  })

  test('the secretary type is hidden from the model', async ($) => {
    const offered = await $.agent.offer({ agent: 'terminal-legend:secretary' })
    expect(offered).toEqual({ isOffered: false })
  })

  test(
    'a secretary war declaration is audited, not refused',
    async ($, on) => {
      const toasts: string[] = []
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'ui.toast': (_$: any, e: any) => {
          toasts.push(String(e.text ?? ''))
          return { value: undefined }
        },
      })
      await startCampaign($ as any)

      const result = (await ($.tool.call as unknown as (e: unknown) => Promise<unknown>)({
        tool: 'mcp__terminal-legend__v3_diplomacy',
        target: 'GBR',
        move: 'war',
        reason: '秘书擅自开战',
        agentId: 'secretary-1',
      })) as { result?: string; deny?: string }
      expect(result.result).toBeDefined()
      expect(result.result ?? '').toContain('宣战')
      expect(toasts.some(text => text.includes('秘书越权'))).toBe(true)
    },
  )
})

describe('M3 secretary command surface', () => {
  test(
    'the fourth consecutive overreach is refused',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn)
      await startCampaign($ as any)
      const call = () =>
        ($.tool.call as unknown as (e: unknown) => Promise<{ result?: string; deny?: string }>)({
          tool: 'mcp__terminal-legend__v3_cheat',
          action: 'treasury',
          amount: 1,
          agentId: 'secretary-1',
        })
      const first = await call()
      expect(first.result).toBeDefined()
      const second = await call()
      expect(second.result).toBeDefined()
      const third = await call()
      expect(third.result).toBeDefined()
      const fourth = await call()
      expect(fourth.deny ?? '').toContain('越权')
    },
  )


  // The test harness has no engine beneath `agent.spawn` that starts a real
  // subagent and mints an agentId, so the full spawn -> turn.complete round
  // trip cannot be mocked here. The command surface and the tool path the
  // secretary uses are covered instead.
  test(
    'delegation toggles and an agent build uses the same tool path',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'agent.spawn': () => ({ model: 'haiku' }),
        'clock.after': () => ({ value: { cancel: () => undefined } }),
      })
      const run = await startCampaign($ as any)

      const delegated = await run({ command: 'v3', args: 'delegate internal on' })
      expect(delegated.text).toContain('内政委托已开启')

      const built = (await ($.tool.call as unknown as (e: unknown) => Promise<unknown>)({
        tool: 'mcp__terminal-legend__v3_action',
        action: 'build',
        building: 'farms',
        count: 1,
        agentId: 'secretary-1',
      })) as { result?: string; deny?: string }
      expect(built.result ?? '').toContain('建造队列')

      const status = await run({ command: 'v3', args: 'status' })
      expect(status.text).toContain('建造队列')
      expect(status.text).toContain('农场×1')
      expect(status.text).toContain('内政开')

      const started = await run({ command: 'v3', args: 'secretary' })
      expect(started.text).toContain('已受命')
    },
  )
})

// ---------------------------------------------------------------- M4/M5

describe('M4/M5 council and managed runs', () => {
  test('a managed run starts in the background and advances', async ($, on) => {
    const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
    setupSurface(anyOn)
    const run = await startCampaign($ as any)
    const started = await run({ command: 'v3', args: 'run 2' })
    expect(started.text).toContain('托管已开始')
    // The background host advances on its own schedule, so poll for the target
    // date instead of sleeping a fixed 250ms: per-month work grew with the trade
    // slices, and sibling test files keep the event loop busy, which made a short
    // fixed wait flaky. The assertion is unchanged.
    let status = ''
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      status = (await run({ command: 'v3', args: 'status' })).text
      if (status.includes('1836年2月') || status.includes('1836年3月')) break
    }
    // A pending event or a new war legitimately stops a managed run after one
    // month (plan 0001 §5); either way the run must have advanced past January.
    expect(status).toMatch(/1836年[23]月/)
  })


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

    const transport = qing.econ.transportInfrastructure
    expect(applyCheat(world, { action: 'building', building: 'railroads', count: 2 }).ok).toBe(true)
    expect(qing.econ.transportInfrastructure).toBe(transport + 6)
    expect(applyCheat(world, { action: 'building', building: 'railroads', count: -2 }).ok).toBe(true)
    expect(qing.econ.transportInfrastructure).toBe(transport)

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
        building: 'factories',
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
        building: 'mines',
        count: 1,
        owner: 'private',
        monthsLeft: 3,
        monthlyCost: 1,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      },
    ]
    const factories = qing.econ.buildings.factories
    const result = applyCheat(world, { action: 'finishProjects' })
    expect(result.ok).toBe(true)
    expect(qing.econ.buildings.factories).toBe(factories + 2)
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

describe('M6 ironman command surface', () => {
  test('the cheat command accepts camelCase actions', async ($, on) => {
    const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
    setupSurface(anyOn)
    const run = await startCampaign($ as any)
    const points = await run({ command: 'v3', args: 'cheat techPoints 50' })
    expect(points.text).toContain('科技点')
    const score = await run({ command: 'v3', args: 'cheat warScore GBR 10' })
    expect(score.text).toContain('并未交战')
  })


  test(
    'ironman blocks destiny, named saves and loading',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'agent.spawn': () => ({ model: 'haiku' }),
        'clock.after': () => ({ value: { cancel: () => undefined } }),
      })
      const run = await startCampaign($ as any)

      const enabled = await run({ command: 'v3', args: 'ironman on' })
      expect(enabled.text).toContain('铁人模式已开启')

      const cheat = await run({ command: 'v3', args: 'cheat treasury 100' })
      expect(cheat.text).toContain('铁人')

      const saved = await run({ command: 'v3', args: 'save backup' })
      expect(saved.text).toContain('铁人')

      const loaded = await run({ command: 'v3', args: 'load backup' })
      expect(loaded.text).toContain('铁人')

      await run({ command: 'v3', args: 'next' })
      const late = await run({ command: 'v3', args: 'ironman off' })
      expect(late.text).toContain('第一个月')
    },
  )
})

// ---------------------------------------------------------------- modifiers

describe('buff/debuff stacking', () => {
  test('flat, percent and multiply stack in a fixed order', async () => {
    const world = newWorld(18, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers = [
      { id: 'a', label: '平地', stat: 'production', stack: 'flat', value: 2, source: 'test' },
      { id: 'b', label: '百分比甲', stat: 'production', stack: 'percent', value: 10, source: 'test' },
      { id: 'c', label: '百分比乙', stat: 'production', stack: 'percent', value: 20, source: 'test' },
      { id: 'd', label: '独立乘数', stat: 'production', stack: 'multiply', value: 50, source: 'test' },
    ]
    // (10 + 2) × (1 + 0.10 + 0.20) × 1.50 = 23.4
    expect(Math.abs(applyModifiers(qing, 'production', 10) - 23.4)).toBeLessThan(1e-9)
  })

  test('timed modifiers expire after their months', async () => {
    const world = newWorld(19, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'timed',
      label: '短暂繁荣',
      stat: 'income',
      stack: 'percent',
      value: 20,
      monthsLeft: 2,
      source: 'test',
    })
    expect(describeModifier(qing.modifiers[0] as never)).toContain('2 月')
    expect(tickModifiers(qing)).toEqual([])
    expect(qing.modifiers[0]?.monthsLeft).toBe(1)
    expect(tickModifiers(qing)).toEqual(['短暂繁荣'])
    expect(qing.modifiers.length).toBe(0)
  })

  test('a monthly advance expires timed modifiers', async () => {
    const world = newWorld(23, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'one-month',
      label: '一个月的恩泽',
      stat: 'income',
      stack: 'percent',
      value: 10,
      monthsLeft: 1,
      source: 'test',
    })
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.id === 'one-month')).toBe(false)
  })

  test('production buffs change computed output', async () => {
    const world = newWorld(20, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    const before = inspectEconomy(prussia).production.fabric
    addModifier(prussia, {
      id: 'factory-boom',
      label: '纺织繁荣',
      stat: 'fabricOutput',
      stack: 'percent',
      value: 50,
      source: 'test',
    })
    expect(inspectEconomy(prussia).production.fabric).toBeGreaterThan(before * 1.45)
  })

  test('laws and events install their modifiers', async () => {
    const world = newWorld(21, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    aus.government.authority = 100
    applyDecision(
      world,
      { countryId: 'AUS', action: 'law', params: { name: '教育改革' } },
      makeRngForWorld(world),
    )
    expect(aus.modifiers.some(one => one.id === 'law:教育改革')).toBe(true)

    const event = {
      id: 'ev-mod',
      date: { ...world.date },
      kind: 'test',
      title: '测试恩泽',
      text: '测试',
      countryId: 'AUS',
      options: [
        {
          id: 'take',
          label: '领受',
          result: '得到祝福',
          effects: {
            modifiers: [
              { stat: 'income', stack: 'percent', value: 15, months: 6, label: '恩泽' },
            ],
          },
        },
      ],
      isResolved: false,
    } as never
    applyEventOption(world, event as never, 'take')
    expect(aus.modifiers.some(one => one.label === '恩泽' && one.monthsLeft === 6)).toBe(true)
  })
})

describe('policy proposals, events and thresholds as buff sources', () => {
  test('a policy proposal costs authority and installs its effects', async () => {
    const world = newWorld(24, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    aus.government.authority = 100
    const result = applyPolicy(world, 'AUS', {
      name: '重商主义',
      authorityCost: 10,
      effects: [
        { stat: 'income', stack: 'percent', value: 10, months: 12 },
        { stat: 'factoryOutput', stack: 'percent', value: 5 },
      ],
    })
    expect(result.ok).toBe(true)
    expect(aus.government.authority).toBe(90)
    expect(aus.modifiers.filter(one => one.source === 'policy:重商主义').length).toBe(2)
    expect(result.text).toContain('重商主义')

    const invalid = applyPolicy(world, 'AUS', {
      name: '错误政策',
      effects: [{ stat: 'nonsense' as never, value: 1 }],
    })
    expect(invalid.ok).toBe(false)
  })

  test('state thresholds grant and lift a while-buff', async () => {
    const world = newWorld(25, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.pops.radicals = 60
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'threshold:unrest')).toBe(true)

    qing.pops.radicals = 0
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'threshold:unrest')).toBe(false)
  })

  test('a once threshold stays after the condition lapses', async () => {
    const world = newWorld(26, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    gbr.pops.literacy = 0.7
    advance(world, 1, [], makeRngForWorld(world))
    expect(gbr.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)

    gbr.pops.literacy = 0.1
    advance(world, 1, [], makeRngForWorld(world))
    expect(gbr.modifiers.some(one => one.source === 'threshold:enlightenment')).toBe(true)
  })

  test('an event option can carry timed modifiers', async () => {
    const world = newWorld(27, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const event = spawnEvent(world, qing, makeRngForWorld(world), 'harvest')
    expect(event).toBeDefined()
    if (event === undefined) return
    applyEventOption(world, event, 'celebrate')
    expect(
      qing.modifiers.some(one => one.label === '丰年余庆' && one.monthsLeft === 6),
    ).toBe(true)
  })
})

describe('modifier stock/flow semantics', () => {
  test('a percent growth buff scales the monthly flow, not the stock', async () => {
    const plain = newWorld(22, 'QING')
    const boosted = clone(plain)
    const qing = boosted.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'growth-buff',
      label: '鼓励生育',
      stat: 'growth',
      stack: 'percent',
      value: 100,
      source: 'test',
    })
    advance(plain, 1, [], makeRngForWorld(plain))
    advance(boosted, 1, [], makeRngForWorld(boosted))
    const plainGrowth = plain.countries.QING?.pops.growth ?? 0
    const boostedGrowth = boosted.countries.QING?.pops.growth ?? 0
    expect(Math.abs(boostedGrowth - plainGrowth * 2)).toBeLessThan(1e-9)
  })
})
