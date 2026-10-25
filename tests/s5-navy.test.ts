import { describe, expect, test } from 'claude-code/testing'
import { GOOD_IDS, makeRngForWorld } from '../engine/data'
import { inspectWorld } from '../engine/inspect'
import { parseWorld } from '../engine/save'
import {
  SEA_CONTROL_TIER_NAMES,
  advance,
  applyDecision,
  blockadeBlocks,
  declareBlockade,
  liftBlockade,
  newWorld,
  resolveSeaControl,
  seaControlTier,
  seaPowerOf,
} from '../engine/sim'
import { clearTrade, routeId, type MarketSnapshot } from '../engine/trade'
import { tradeBlocker } from '../engine/diplomacy'
import type { Rng } from '../engine/rng'
import type { Country, Decision, GoodId, TradeRoute, WorldState } from '../types'

// ============================================================================
// Plan 0015 §S5 — the minimal navy (navalQuality, sea control, blockade).
// Every acceptance case uses a reproducible fixture (`newWorld(seed,'QING')`
// plus hand-set fleets and a declared war), never the live save (review M15).
// ============================================================================

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-9): void => {
  expect(Math.abs(actual - expected), `expected ${expected}, got ${actual}`).toBeLessThan(eps)
}

const rngFor = (world: WorldState): Rng => makeRngForWorld(world)

/**
 * Deterministic rng that keeps the real mulberry stream but zeroes the war
 * score noise, so a pure-sea-control run lands on exact monthly scores.
 */
const calmRng = (world: WorldState): Rng => {
  const base = makeRngForWorld(world)
  return { ...base, range: () => 0 }
}

type Fleet = {
  attackerNavy: number
  attackerQuality: number
  defenderNavy: number
  defenderQuality: number
}

/** Reproducible fixture: a fresh world with hand-set fleets and one war. */
const warFixture = (seed: number, fleet: Fleet): WorldState => {
  const world = newWorld(seed, 'QING')
  const qing = countryOf(world, 'QING')
  const gbr = countryOf(world, 'GBR')
  qing.military.navy = fleet.attackerNavy
  qing.military.navalQuality = fleet.attackerQuality
  gbr.military.navy = fleet.defenderNavy
  gbr.military.navalQuality = fleet.defenderQuality
  const declared = applyDecision(
    world,
    {
      countryId: 'QING',
      action: 'diplomacy',
      params: { target: 'GBR', move: 'war', goal: 'reparations' },
    } as Decision,
    rngFor(world),
  )
  expect(declared.ok).toBe(true)
  expect(world.wars.length).toBe(1)
  return world
}

const dominant = (seed: number): WorldState =>
  warFixture(seed, { attackerNavy: 200, attackerQuality: 1, defenderNavy: 1, defenderQuality: 0.1 })

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

type Pair = { exporter: string; importer: string; good: GoodId; qty: number }

const marketsFor = (world: WorldState, pairs: Pair[]): Record<string, MarketSnapshot> => {
  const out: Record<string, MarketSnapshot> = {}
  for (const country of Object.values(world.countries)) {
    const production = zeroGoods()
    const demand = zeroGoods()
    for (const pair of pairs) {
      if (country.id === pair.exporter) production[pair.good] += pair.qty
      if (country.id === pair.importer) demand[pair.good] += pair.qty
    }
    out[country.id] = { production, demand }
  }
  return out
}

const route = (good: GoodId, from: string, to: string, level = 3): TradeRoute => ({
  id: routeId(good, from, to),
  good,
  from,
  to,
  level,
  owner: 'private',
  openedAt: { year: 1836, month: 1 },
  lastQty: 0,
  lastMargin: 0,
})

const hasFlow = (flows: readonly { good: GoodId; from: string; to: string }[], good: GoodId, from: string, to: string): boolean =>
  flows.some(flow => flow.good === good && flow.from === from && flow.to === to)

describe('S5.1 navalQuality seeding and round-trip (plan 0015 §S5)', () => {
  test('is seeded per country from the military seeds, GBR far above QING, all within 0..1', () => {
    const world = newWorld(9201, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qing = countryOf(world, 'QING')
    expect(gbr.military.navalQuality).toBeGreaterThan(qing.military.navalQuality)
    for (const country of Object.values(world.countries)) {
      expect(country.military.navalQuality).toBeGreaterThan(0)
      expect(country.military.navalQuality).toBeLessThanOrEqual(1)
    }
    // Per-country seeds, not the old flat 0.5 placeholder.
    const distinct = new Set(Object.values(world.countries).map(c => c.military.navalQuality))
    expect(distinct.size).toBeGreaterThan(3)
  })

  test('survives the save/load round-trip and stays the tech `immediate` target', () => {
    const world = newWorld(9202, 'QING')
    const qing = countryOf(world, 'QING')
    qing.military.navalQuality = 0.77
    const parsed = parseWorld(JSON.parse(JSON.stringify(world)))
    expect(parsed?.countries.QING?.military.navalQuality).toBe(0.77)
  })
})

describe('S5.2 seaPower = navy × navalQuality (never techTier) (plan 0015 §S5 / ADR M11)', () => {
  test('scales with both navy and navalQuality', () => {
    const world = newWorld(9203, 'QING')
    const qing = countryOf(world, 'QING')
    qing.military.navy = 50
    qing.military.navalQuality = 0.4
    close(seaPowerOf(qing), 20)
  })

  test('techTier does not enter seaPower', () => {
    const low = newWorld(9204, 'QING')
    const high = newWorld(9204, 'QING')
    for (const country of [countryOf(low, 'QING'), countryOf(high, 'QING')]) {
      country.military.navy = 50
      country.military.navalQuality = 0.4
    }
    const highQing = countryOf(high, 'QING')
    highQing.tech.era = 4
    highQing.tech.unlocked = Array.from({ length: 12 }, (_, i) => `node-${i}`)
    close(seaPowerOf(highQing), seaPowerOf(countryOf(low, 'QING')))

    // Equal seaPower is parity regardless of the tech gap.
    const a = warFixture(9205, {
      attackerNavy: 50,
      attackerQuality: 0.5,
      defenderNavy: 50,
      defenderQuality: 0.5,
    })
    countryOf(a, 'QING').tech.era = 4
    countryOf(a, 'QING').tech.unlocked = Array.from({ length: 12 }, (_, i) => `node-${i}`)
    resolveSeaControl(a)
    expect(a.wars[0]?.seaControl?.tier.QING).toBe('parity')
  })
})

describe('S5.3 sea-control tiers (plan 0015 §S5)', () => {
  test('the five tiers follow the 2.0 / 1.25 / 0.8 / 0.5 edges', () => {
    expect(seaControlTier(3)).toBe('complete')
    expect(seaControlTier(2)).toBe('complete')
    expect(seaControlTier(1.99)).toBe('advantage')
    expect(seaControlTier(1.25)).toBe('advantage')
    expect(seaControlTier(1.24)).toBe('parity')
    expect(seaControlTier(1)).toBe('parity')
    expect(seaControlTier(0.8)).toBe('parity')
    expect(seaControlTier(0.79)).toBe('disadvantage')
    expect(seaControlTier(0.5)).toBe('disadvantage')
    expect(seaControlTier(0.49)).toBe('lost')
  })

  test('equal quantity with disparate quality is decided by seaPower', () => {
    const complete = warFixture(9206, {
      attackerNavy: 50,
      attackerQuality: 0.9,
      defenderNavy: 50,
      defenderQuality: 0.3,
    })
    resolveSeaControl(complete)
    expect(complete.wars[0]?.seaControl?.tier.QING).toBe('complete')
    expect(complete.wars[0]?.seaControl?.tier.GBR).toBe('lost')

    const advantage = warFixture(9207, {
      attackerNavy: 50,
      attackerQuality: 0.5,
      defenderNavy: 50,
      defenderQuality: 0.3,
    })
    resolveSeaControl(advantage)
    expect(advantage.wars[0]?.seaControl?.tier.QING).toBe('advantage')
    expect(advantage.wars[0]?.seaControl?.tier.GBR).toBe('disadvantage')
  })
})

describe('S5.4 monthly war score (plan 0015 §S5)', () => {
  test('complete control adds +1.5/month and reaches exactly 75 over 50 months', () => {
    const world = dominant(9208)
    const war = world.wars[0]
    if (war === undefined) throw new Error('no war')
    for (let month = 0; month < 50; month += 1) resolveSeaControl(world)
    close(war.warScore, 75)
  })

  test('advantage adds +0.75/month; parity adds nothing', () => {
    const advantage = warFixture(9209, {
      attackerNavy: 50,
      attackerQuality: 0.5,
      defenderNavy: 50,
      defenderQuality: 0.3,
    })
    resolveSeaControl(advantage)
    close(advantage.wars[0]?.warScore ?? 0, 0.75)

    const even = warFixture(9210, {
      attackerNavy: 50,
      attackerQuality: 0.5,
      defenderNavy: 50,
      defenderQuality: 0.5,
    })
    resolveSeaControl(even)
    close(even.wars[0]?.warScore ?? 0, 0)
  })

  test('pure blockade can end a war: complete control for 50 months reaches 75', () => {
    const world = dominant(9211)
    // Zero both belligerents' armies so only sea control moves the score.
    countryOf(world, 'QING').military.army = 0
    countryOf(world, 'GBR').military.army = 0
    for (let month = 0; month < 49; month += 1) advance(world, 1, [], calmRng(world))
    expect(world.wars.length).toBe(1)
    close(world.wars[0]?.warScore ?? 0, 73.5)
    advance(world, 1, [], calmRng(world))
    expect(world.wars.length).toBe(0)
  })
})

describe('S5.5 blockade (plan 0015 §S5)', () => {
  test('cuts an enemy↔third-party route in the same clearing; restores on lift', () => {
    const world = dominant(9212)
    const countries = Object.values(world.countries)
    const markets = marketsFor(world, [{ exporter: 'GBR', importer: 'FRA', good: 'coal', qty: 100 }])
    const routes = [route('coal', 'GBR', 'FRA')]

    const open = clearTrade(countries, markets, tradeBlocker(world), routes, new Map())
    expect(hasFlow(open.flows, 'coal', 'GBR', 'FRA')).toBe(true)

    const declared = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'blockade', party: 'FRA' },
      } as Decision,
      rngFor(world),
    )
    expect(declared.ok).toBe(true)
    const services = new Map()
    const cut = clearTrade(countries, markets, tradeBlocker(world), routes, services)
    expect(hasFlow(cut.flows, 'coal', 'GBR', 'FRA')).toBe(false)
    expect(services.has(routeId('coal', 'GBR', 'FRA'))).toBe(false)

    const lifted = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'unblockade', party: 'FRA' },
      } as Decision,
      rngFor(world),
    )
    expect(lifted.ok).toBe(true)
    const restored = clearTrade(countries, markets, tradeBlocker(world), routes, new Map())
    expect(hasFlow(restored.flows, 'coal', 'GBR', 'FRA')).toBe(true)
  })

  test('a good-scoped blockade cuts only that good', () => {
    const world = dominant(9213)
    const countries = Object.values(world.countries)
    const markets = marketsFor(world, [
      { exporter: 'GBR', importer: 'FRA', good: 'coal', qty: 100 },
      { exporter: 'GBR', importer: 'FRA', good: 'iron', qty: 100 },
    ])
    const routes = [route('coal', 'GBR', 'FRA'), route('iron', 'GBR', 'FRA')]
    const declared = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'blockade', party: 'FRA', good: 'coal' },
      } as Decision,
      rngFor(world),
    )
    expect(declared.ok).toBe(true)
    const cut = clearTrade(countries, markets, tradeBlocker(world), routes, new Map())
    expect(hasFlow(cut.flows, 'coal', 'GBR', 'FRA')).toBe(false)
    expect(hasFlow(cut.flows, 'iron', 'GBR', 'FRA')).toBe(true)
  })

  test('a blockade declared this month cuts the route the very next month through advance', () => {
    const world = dominant(9214)
    advance(world, 1, [], rngFor(world))
    const gbr = countryOf(world, 'GBR')
    const partner = gbr.trade.exports
      .map(flow => flow.to)
      .concat(gbr.trade.imports.map(flow => flow.from))
      .find(id => id !== 'QING')
    expect(partner).toBeDefined()
    if (partner === undefined) return
    const tradeWith = (id: string): number =>
      gbr.trade.exports.filter(flow => flow.to === id).length +
      gbr.trade.imports.filter(flow => flow.from === id).length
    expect(tradeWith(partner)).toBeGreaterThan(0)

    const declared = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'blockade', party: partner },
      } as Decision,
      rngFor(world),
    )
    expect(declared.ok).toBe(true)
    advance(world, 1, [], rngFor(world))
    expect(tradeWith(partner)).toBe(0)
  })

  test('blockading a named neutral costs infamy and relations', () => {
    const world = dominant(9215)
    const qing = countryOf(world, 'QING')
    const fra = countryOf(world, 'FRA')
    const qingRelation = qing.diplo.relations.FRA ?? 0
    const fraRelation = fra.diplo.relations.QING ?? 0
    const infamy = qing.diplo.infamy
    const result = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'blockade', party: 'FRA' },
      } as Decision,
      rngFor(world),
    )
    expect(result.ok).toBe(true)
    close(qing.diplo.infamy, infamy + 5)
    close(qing.diplo.relations.FRA ?? 0, qingRelation - 12)
    close(fra.diplo.relations.QING ?? 0, fraRelation - 8)
  })

  test('a peace clears every blockade record', () => {
    const world = dominant(9216)
    advance(world, 1, [], rngFor(world))
    applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'blockade', party: 'FRA' },
      } as Decision,
      rngFor(world),
    )
    expect(world.wars[0]?.seaControl?.blockades.length).toBe(1)
    expect(blockadeBlocks(world, 'FRA', 'GBR', 'coal')).toBe(true)

    const war = world.wars[0]
    if (war !== undefined) war.warScore = 0
    const peace = applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'peace' } } as Decision,
      rngFor(world),
    )
    expect(peace.ok).toBe(true)
    expect(world.wars.length).toBe(0)
    expect(blockadeBlocks(world, 'FRA', 'GBR', 'coal')).toBe(false)
  })

  test('rejects a blockade without a war, without sea control, or with no record to lift', () => {
    const noWar = newWorld(9217, 'QING')
    const unattached = applyDecision(
      noWar,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'blockade' } } as Decision,
      rngFor(noWar),
    )
    expect(unattached.ok).toBe(false)
    expect(unattached.text).toContain('并未交战')

    const weak = warFixture(9218, {
      attackerNavy: 1,
      attackerQuality: 0.1,
      defenderNavy: 200,
      defenderQuality: 1,
    })
    const noControl = applyDecision(
      weak,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'blockade' } } as Decision,
      rngFor(weak),
    )
    expect(noControl.ok).toBe(false)
    expect(noControl.text).toContain('制海权')

    const nothing = applyDecision(
      weak,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'unblockade' } } as Decision,
      rngFor(weak),
    )
    expect(nothing.ok).toBe(false)
    expect(nothing.text).toContain('并无')
  })

  test('declareBlockade / liftBlockade / blockadeBlocks agree as a bare API', () => {
    const world = dominant(9219)
    resolveSeaControl(world)
    const war = declareBlockade(world, { by: 'QING', enemy: 'GBR', party: 'FRA' })
    expect(war).toBeDefined()
    expect(world.wars[0]?.seaControl?.blockades.length).toBe(1)
    expect(blockadeBlocks(world, 'GBR', 'FRA', 'coal')).toBe(true)
    expect(blockadeBlocks(world, 'GBR', 'PRU', 'coal')).toBe(false)
    expect(liftBlockade(world, { by: 'QING', enemy: 'GBR', party: 'FRA' })).toBe(1)
    expect(blockadeBlocks(world, 'GBR', 'FRA', 'coal')).toBe(false)
  })
})

describe('S5.6 v3_inspect military shows seaPower and the tier (plan 0015 §S5)', () => {
  test('the war line carries both the seaPower figure and the Chinese tier', () => {
    const world = dominant(9220)
    resolveSeaControl(world)
    const text = inspectWorld(world, 'military')
    expect(text).toContain('seaPower')
    expect(text).toContain(SEA_CONTROL_TIER_NAMES.complete)
  })
})
