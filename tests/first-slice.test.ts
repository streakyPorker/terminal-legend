import { describe, expect, test } from 'claude-code/testing'
import { deriveBureaucracy, deriveUnemployment, initialUi } from '../engine/data'
import { monthlyBriefing } from '../engine/secretary'
import {
  advance,
  applyDecision,
  completeBuilding,
  computeEconomy,
  inspectEconomy,
  newWorld,
} from '../engine/sim'
import { migrateWorld } from '../engine/save'
import { makeRngForWorld } from '../engine/data'
import type { Country, WorldState } from '../types'

// ---------------------------------------------------------------- M1

describe('M1 types, data and migration', () => {
  test('a new world is version 2 with split infrastructure and bureaucracy', async () => {
    const world = newWorld(1, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    expect(world.version).toBe(2)
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

  test('a v1 save migrates to a playable v2 world', async () => {
    const fresh = newWorld(4, 'AUS')
    const v1 = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown> & {
      countries: Record<string, Country & { econ: Record<string, unknown> }>
    }
    v1.version = 1
    delete v1.secretary
    delete v1.ironman
    for (const country of Object.values(v1.countries)) {
      const econ = country.econ
      econ.infrastructure = econ.transportInfrastructure
      delete econ.transportInfrastructure
      delete econ.administrativeCapacity
      delete econ.constructionQueue
      delete (country as Record<string, unknown>).bureaucracy
      delete (country.econ.buildings as Record<string, unknown>).offices
    }

    const migrated = migrateWorld(v1) as WorldState
    expect(migrated).toBeDefined()
    expect(migrated.version).toBe(2)
    expect(migrated.ironman).toBe(false)
    expect(migrated.secretary.delegation.months).toBe(1)

    const aus = migrated.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    expect('infrastructure' in aus.econ).toBe(false)
    expect(aus.econ.transportInfrastructure).toBe(45)
    expect(aus.econ.administrativeCapacity).toBe(
      20 + aus.pops.literacy * 40 + aus.econ.spending.bureaucracy * 2,
    )
    expect(aus.econ.buildings.offices).toBe(0)
    expect(aus.econ.constructionQueue).toEqual([])
    expect(aus.bureaucracy.ceiling).toBeGreaterThanOrEqual(20)
    expect(Number.isFinite(aus.econ.unemployment)).toBe(true)

    advance(migrated, 2, [], makeRngForWorld(migrated))
    expect(migrated.date).toEqual({ year: 1836, month: 3 })
    expect(Number.isFinite(migrated.countries.AUS?.econ.gdp ?? NaN)).toBe(true)
  })

  test('a corrupt save is rejected', async () => {
    expect(migrateWorld({})).toBeUndefined()
    expect(migrateWorld('nope')).toBeUndefined()
    expect(migrateWorld({ version: 9, tick: 0, date: {}, countries: {} })).toBeUndefined()
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
    expect(project?.monthsLeft).toBe(4)
    expect(project?.monthlyCost).toBe(2)
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
    expect(prussia.econ.buildings.factories).toBe(before + 1)
    expect(prussia.econ.constructionQueue.length).toBe(0)
  })

  test('without a construction budget projects make no progress', async () => {
    const world = newWorld(6, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return

    prussia.econ.spending.construction = 0
    applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'factories', count: 1 } },
      makeRngForWorld(world),
    )
    advance(world, 3, [], makeRngForWorld(world))
    expect(prussia.econ.constructionQueue[0]?.progress).toBe(0)
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
    { options: { autoStart: false } },
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
  // The test harness has no engine beneath `agent.spawn` that starts a real
  // subagent and mints an agentId, so the full spawn -> turn.complete round
  // trip cannot be mocked here. The command surface and the tool path the
  // secretary uses are covered instead.
  test(
    'delegation toggles and an agent build uses the same tool path',
    { options: { autoStart: false } },
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn)
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
    },
  )
})
