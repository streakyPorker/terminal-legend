import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  GOODS,
  GOOD_IDS,
  INCOME_ELASTICITY,
  INVESTMENT_DEMAND,
  SUBSISTENCE,
  createWorld,
  isBuildingUnlocked,
  makeRngForWorld,
} from '../engine/data'
import {
  BUILDING_COST_ADDEND,
  BUILDING_COST_MULTIPLIER,
  CAPACITY_COST,
} from '../engine/construction'
import { applyDecision, inspectEconomy, newWorld } from '../engine/sim'
import { inspectWorld } from '../engine/inspect'
import { CURRENT_WORLD_VERSION, parseWorld } from '../engine/save'
import { MODIFIER_STAT_NAMES } from '../engine/modifiers'
import type { Decision } from '../engine/internal'
import type { BuildingId, Country, GoodId, WorldState } from '../types'

// ============================================================================
// Plan 0015 §S0 + ADR 0031 — the World v14 structural slice.
//
// The S0 structural contract: it pins the new `GoodId`/`BuildingId` ids and the
// S0 placeholder fields, the exhaustive id-keyed value tables (`GOODS`,
// `BUILDINGS`, `BUILDING_IDS`, `buildingTiers`, unlock gates, tool enums), the
// three new buildings locked behind `unlock.techLevel`, the three new goods
// inert (unused by any recipe), and the rejection of v13 saves.
//
// Each scenario guards the container it dereferences before the deep check, so
// a missing structure fails on that assertion rather than a bare TypeError.
// ============================================================================

const NEW_GOODS: GoodId[] = ['chemicals', 'electricity', 'locomotives']
const NEW_BUILDINGS: BuildingId[] = ['chemicalWorks', 'powerPlants', 'locomotiveWorks']

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

// ---------------------------------------------------------------- tool schema
// Copied from tests/first-slice-commands.test.ts so the v3_action / v3_cheat
// building enums are captured exactly the way the plugin registers them.
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
): Promise<(input: unknown) => Promise<{ text: string }>> => {
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

describe('World v14 structural skeleton (plan 0015 S0)', () => {
  test('S1 happy — version is 14 and the three new goods sit at base price at t0', () => {
    const world = newWorld(9100, 'QING')
    expect(world.version).toBe(14)
    expect(CURRENT_WORLD_VERSION).toBe(14)

    // `createWorld` runs BEFORE calibration, so prices are still at base price.
    const fresh = createWorld(9100, 'QING')
    const qing = countryOf(fresh, 'QING')
    for (const good of NEW_GOODS) {
      expect(GOODS[good], `GOODS is missing ${good}`).toBeDefined()
      expect(qing.econ.prices[good], `base price ${good}`).toBe(GOODS[good]?.basePrice)
    }
  })

  test('S2 happy — every country holds all buildings at tier I (tiers ≡ [buildings])', () => {
    const world = newWorld(9101, 'QING')
    const countries = Object.values(world.countries)
    expect(countries.length).toBe(10)
    for (const country of countries) {
      expect(country.econ.buildingTiers, `${country.id} buildingTiers`).toBeDefined()
      for (const id of BUILDING_IDS) {
        const tiers = country.econ.buildingTiers[id]
        expect(tiers, `${country.id}.${id} tiers`).toBeDefined()
        expect(tiers, `${country.id}.${id} tiers`).toEqual([country.econ.buildings[id]])
        const sum = tiers.reduce((total, n) => total + n, 0)
        expect(sum, `${country.id}.${id} Σ tiers`).toBe(country.econ.buildings[id])
      }
    }
  })

  test('S3 edge — the three new goods are inert in a fresh world (0 production, 0 demand)', () => {
    const world = newWorld(9102, 'QING')
    const snapshot = inspectEconomy(countryOf(world, 'QING'))
    for (const good of NEW_GOODS) {
      expect(GOODS[good], `GOODS is missing ${good}`).toBeDefined()
      expect(snapshot.production[good], `${good} production`).toBe(0)
      expect(snapshot.demand[good], `${good} demand`).toBe(0)
    }
  })

  test('S4 edge — every BuildingId table is exhaustive across the 23 ids', () => {
    expect(BUILDING_IDS.length).toBe(23)
    for (const id of NEW_BUILDINGS) {
      expect(BUILDING_IDS, `BUILDING_IDS is missing ${id}`).toContain(id)
    }
    const tables: Record<string, Record<string, unknown>> = {
      BUILDINGS: BUILDINGS as unknown as Record<string, unknown>,
      BUILDING_RECIPES: BUILDING_RECIPES as unknown as Record<string, unknown>,
      BUILDING_OUTPUT: BUILDING_OUTPUT as unknown as Record<string, unknown>,
      INVESTMENT_DEMAND: INVESTMENT_DEMAND as unknown as Record<string, unknown>,
      CAPACITY_COST: CAPACITY_COST as unknown as Record<string, unknown>,
      BUILDING_COST_MULTIPLIER: BUILDING_COST_MULTIPLIER as unknown as Record<string, unknown>,
      BUILDING_COST_ADDEND: BUILDING_COST_ADDEND as unknown as Record<string, unknown>,
    }
    const expected = [...BUILDING_IDS].sort()
    for (const [name, table] of Object.entries(tables)) {
      expect(Object.keys(table).sort(), `${name} keys`).toEqual(expected)
    }
  })

  test('S5 edge — every GoodId table is exhaustive across the 18 ids', () => {
    expect(GOOD_IDS.length).toBe(18)
    for (const good of NEW_GOODS) {
      expect(GOOD_IDS, `GOOD_IDS is missing ${good}`).toContain(good)
    }
    const expected = [...GOOD_IDS].sort()
    expect(Object.keys(GOODS).sort()).toEqual(expected)
    expect(Object.keys(SUBSISTENCE).sort()).toEqual(expected)
    expect(Object.keys(INCOME_ELASTICITY).sort()).toEqual(expected)
    const statNames = MODIFIER_STAT_NAMES as unknown as Record<string, string>
    for (const good of GOOD_IDS) {
      expect(statNames[`${good}Output`], `${good}Output modifier stat`).toBeDefined()
      expect(statNames[`${good}Demand`], `${good}Demand modifier stat`).toBeDefined()
    }
  })

  test('S6 edge — the three new buildings are LOCKED by tech, not merely unknown', () => {
    const world = newWorld(9103, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.treasury = 100000
    for (const id of NEW_BUILDINGS) {
      expect(BUILDING_IDS, `BUILDING_IDS is missing ${id}`).toContain(id)
      const def = BUILDINGS[id]
      expect(def, `BUILDINGS is missing ${id}`).toBeDefined()
      // S4: the gate is the derived `unlockBuilding`, not a `techLevel` field.
      expect(isBuildingUnlocked(qing, id), `${id} is tech-locked`).toBe(false)
      const before = qing.econ.constructionQueue.length
      const result = applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: id, count: 1 } } as Decision,
        makeRngForWorld(world),
      )
      expect(result.ok, `build ${id} is locked`).toBe(false)
      // Proves it is the tech LOCK, not the "unknown building" fallback.
      expect(result.text, `${id} lock message`).toContain('未解锁')
      expect(qing.econ.constructionQueue.length, `${id} queue unchanged`).toBe(before)
    }
  })

  test('S7 edge — the three new buildings ship a real tier-I recipe and signal', () => {
    for (const id of NEW_BUILDINGS) {
      const recipe = BUILDING_RECIPES[id]
      expect(recipe, `BUILDING_RECIPES is missing ${id}`).toBeDefined()
      expect(Object.keys(recipe?.output ?? {}).length, `${id} recipe output`).toBeGreaterThan(0)
      expect(Object.keys(recipe?.input ?? {}).length, `${id} recipe input`).toBeGreaterThan(0)
      // S4: private investment has a real shortage weight (its admission is still
      // gated by `isBuildingUnlocked`).
      const outputSignal = BUILDING_OUTPUT[id]
      expect(outputSignal, `BUILDING_OUTPUT is missing ${id}`).toBeDefined()
      expect(Object.keys(outputSignal ?? {}).length, `${id} output signal`).toBeGreaterThan(0)
      expect(INVESTMENT_DEMAND[id], `INVESTMENT_DEMAND entry ${id}`).toBeDefined()
    }
    // ADR 0031 §6 good sets.
    expect(BUILDING_RECIPES.chemicalWorks.output).toHaveProperty('chemicals')
    expect(BUILDING_RECIPES.powerPlants.output).toHaveProperty('electricity')
    expect(BUILDING_RECIPES.locomotiveWorks.output).toHaveProperty('locomotives')
  })

  test('S8 regression — v13 is rejected and v14 round-trips', () => {
    const fresh = newWorld(9104, 'QING')
    const downleveled = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>
    downleveled.version = 13
    expect(parseWorld(downleveled)).toBeUndefined()
    expect(parseWorld(JSON.parse(JSON.stringify(newWorld(9104, 'QING'))))).toBeDefined()
  })

  test('S9 edge — v3_action and v3_cheat building enums cover all 23 ids', async ($, on) => {
    const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
    const specs = new Map<
      string,
      { inputSchema: { properties?: Record<string, { enum?: string[] }> } }
    >()
    setupSurface(anyOn, {
      'tool.register': (_$: any, e: any) => {
        specs.set(String(e.name), e)
        return { value: undefined }
      },
    })
    await startCampaign($ as any)

    for (const tool of ['v3_action', 'v3_cheat']) {
      const spec = specs.get(tool)
      expect(spec, `${tool} is registered`).toBeDefined()
      const ids = spec?.inputSchema.properties?.building?.enum ?? []
      for (const id of NEW_BUILDINGS) {
        expect(ids, `${tool} building enum is missing ${id}`).toContain(id)
      }
      expect(ids.length, `${tool} building enum length`).toBe(BUILDING_IDS.length)
    }
  })

  test('S10 edge (inspect seam) — v3_inspect buildings lists the three new names', () => {
    const world = newWorld(9105, 'QING')
    const text = inspectWorld(world, 'buildings')
    for (const id of NEW_BUILDINGS) {
      const def = BUILDINGS[id]
      expect(def, `BUILDINGS is missing ${id}`).toBeDefined()
      expect(text, `inspect buildings is missing ${id}`).toContain(def?.name ?? '')
    }
  })
})
