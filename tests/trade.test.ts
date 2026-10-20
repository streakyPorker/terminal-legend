import { describe, expect, test } from 'claude-code/testing'
import { GOODS, GOOD_IDS, makeRngForWorld } from '../engine/data'
import { advance, clone, computeEconomy, inspectEconomy, newWorld } from '../engine/sim'
import {
  clearTrade,
  effectiveSupply,
  REGION_COST,
  TOP_PARTNERS,
  TRADABLE_GOODS,
  type MarketSnapshot,
} from '../engine/trade'
import type { GoodId, WorldState } from '../types'

const zeroRecord = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const market = (
  production: Partial<Record<GoodId, number>>,
  demand: Partial<Record<GoodId, number>>,
): MarketSnapshot => {
  const prod = zeroRecord()
  const dem = zeroRecord()
  for (const [id, value] of Object.entries(production)) prod[id as GoodId] = value as number
  for (const [id, value] of Object.entries(demand)) dem[id as GoodId] = value as number
  return { production: prod, demand: dem }
}

const marketsFor = (
  world: WorldState,
  build: (id: string) => { production: Partial<Record<GoodId, number>>; demand: Partial<Record<GoodId, number>> },
): Record<string, MarketSnapshot> => {
  const out: Record<string, MarketSnapshot> = {}
  for (const country of Object.values(world.countries)) {
    const row = build(country.id)
    out[country.id] = market(row.production, row.demand)
  }
  return out
}

describe('T1a world schema (v6)', () => {
  test('the world is version 6 and carries region, trade and opium', async () => {
    const world = newWorld(9001, 'QING')
    const qing = world.countries.QING
    expect(world.version).toBe(6)
    expect(qing).toBeDefined()
    if (qing === undefined) return
    expect(qing.region).toBe('eastAsia')
    expect(qing.opium).toEqual({ outputFactor: 0.15, demandFactor: 0.2 })
    expect(world.countries.GBR?.region).toBe('europe')
    expect(world.countries.USA?.region).toBe('americas')
    expect(world.countries.OTT?.region).toBe('middleEast')
    expect(world.countries.GBR?.opium.outputFactor).toBe(3)
    expect(qing.trade.exports).toEqual([])
    expect(qing.trade.imports).toEqual([])
    expect(qing.trade.nx).toBe(0)
  })

  test('opium is a tradable good and services is not', async () => {
    expect(Object.keys(GOODS).length).toBe(13)
    expect(GOODS.opium.basePrice).toBe(2.5)
    expect(TRADABLE_GOODS).toContain('opium')
    expect(TRADABLE_GOODS).not.toContain('services')
  })

  test('the region cost matrix has a unit diagonal and is symmetric', async () => {
    const regions = ['europe', 'eastAsia', 'americas', 'middleEast'] as const
    for (const from of regions) {
      for (const to of regions) {
        const value = REGION_COST[from][to]
        expect(value).toBeGreaterThanOrEqual(1)
        expect(REGION_COST[to][from]).toBe(value)
      }
      expect(REGION_COST[from][from]).toBe(1)
    }
  })
})

describe('T1a clearing (pure, deterministic)', () => {
  test('a shortage country imports from its cheapest partner', async () => {
    const world = newWorld(9002, 'QING')
    const gbr = world.countries.GBR
    const fra = world.countries.FRA
    expect(gbr).toBeDefined()
    expect(fra).toBeDefined()
    if (gbr === undefined || fra === undefined) return
    gbr.econ.prices.coal = 1
    fra.econ.prices.coal = 3
    const markets = marketsFor(world, id => ({
      production: id === 'GBR' || id === 'FRA' ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 100 } : {},
    }))
    const countries = Object.values(world.countries)
    const balance = clearTrade(countries, markets)
    const intoQing = balance.flows.filter(flow => flow.good === 'coal' && flow.to === 'QING')
    expect(intoQing.length).toBeGreaterThan(0)
    expect(intoQing.every(flow => flow.from === 'GBR')).toBe(true)
    const imported = intoQing.reduce((sum, flow) => sum + flow.quantity, 0)
    expect(Math.abs(imported - 100)).toBeLessThan(1e-6)
  })

  test('relations below -50 drop a partner from the candidate list', async () => {
    const world = newWorld(9003, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.diplo.relations.FRA = -60
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const exporters = ['GBR', 'FRA', 'PRU', 'RUS', 'AUS', 'SPA']
    const markets = marketsFor(world, id => ({
      production: exporters.includes(id) ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const balance = clearTrade(Object.values(world.countries), markets)
    const intoQing = balance.flows.filter(flow => flow.good === 'coal' && flow.to === 'QING')
    expect(intoQing.some(flow => flow.from === 'FRA')).toBe(false)
    expect(new Set(intoQing.map(flow => flow.from)).size).toBe(5)
  })

  test('Top-6 caps candidate exporters at six per importer per good', async () => {
    const world = newWorld(9004, 'QING')
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const markets = marketsFor(world, id => ({
      production: id === 'QING' ? {} : { coal: 100 },
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const balance = clearTrade(Object.values(world.countries), markets)
    const intoQing = balance.flows.filter(flow => flow.good === 'coal' && flow.to === 'QING')
    expect(new Set(intoQing.map(flow => flow.from)).size).toBe(TOP_PARTNERS)
    const imported = intoQing.reduce((sum, flow) => sum + flow.quantity, 0)
    expect(Math.abs(imported - TOP_PARTNERS * 100)).toBeLessThan(1e-6)
  })
})

describe('T1a effective supply', () => {
  test('effectiveSupply adds imports and subtracts exports', async () => {
    const production = zeroRecord()
    const imports = zeroRecord()
    const exports = zeroRecord()
    production.grain = 10
    imports.grain = 4
    exports.grain = 3
    const supply = effectiveSupply(production, imports, exports)
    expect(supply.grain).toBe(11)
    expect(supply.wood).toBe(0)
  })

  test('effectiveSupply enters the C/I/G fill and therefore GDP', async () => {
    const world = newWorld(9005, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const production = inspectEconomy(qing).production
    const base = computeEconomy(clone(qing))
    const lifted = computeEconomy(clone(qing), {
      supply: { ...production, luxury: production.luxury + 50 },
    })
    expect(lifted.components.c).toBeGreaterThan(base.components.c)
    expect(lifted.gdp).toBeGreaterThan(base.gdp)
  })

  test('NX is valued at base prices and GDP reconciles to c+i+g+nx', async () => {
    const world = newWorld(9006, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    for (const country of Object.values(world.countries)) {
      const exportBase = country.trade.exports.reduce(
        (sum, flow) => sum + flow.quantity * GOODS[flow.good].basePrice,
        0,
      )
      const importBase = country.trade.imports.reduce(
        (sum, flow) => sum + flow.quantity * GOODS[flow.good].basePrice,
        0,
      )
      expect(Math.abs(exportBase - importBase - country.trade.nx)).toBeLessThan(1e-6)
      expect(Math.abs(country.econ.gdpComponents.nx - country.trade.nx)).toBeLessThan(1e-6)
      const components = country.econ.gdpComponents
      const reconcile = components.c + components.i + components.g + components.nx
      expect(Math.abs(country.econ.gdp - reconcile)).toBeLessThan(1e-6)
    }
  })
})

describe('T1a baseline and determinism', () => {
  test('60 months stay finite; QING net-imports opium and never net-exports it', async () => {
    const world = newWorld(9007, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    let opiumImports = 0
    let opiumExports = 0
    let netExportMonth = false
    for (let month = 0; month < 60; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      const imported = qing.trade.imports
        .filter(flow => flow.good === 'opium')
        .reduce((sum, flow) => sum + flow.quantity, 0)
      const exported = qing.trade.exports
        .filter(flow => flow.good === 'opium')
        .reduce((sum, flow) => sum + flow.quantity, 0)
      opiumImports += imported
      opiumExports += exported
      if (exported > imported + 1e-9) netExportMonth = true
    }
    expect(opiumImports).toBeGreaterThan(0)
    expect(opiumExports).toBe(0)
    expect(netExportMonth).toBe(false)
    for (const country of Object.values(world.countries)) {
      expect(Number.isFinite(country.econ.gdp)).toBe(true)
      expect(Number.isFinite(country.trade.nx)).toBe(true)
      expect(Number.isFinite(country.trade.exportValue)).toBe(true)
      expect(Number.isFinite(country.trade.importValue)).toBe(true)
      expect(Number.isFinite(country.econ.prices.opium)).toBe(true)
      const components = country.econ.gdpComponents
      const reconcile = components.c + components.i + components.g + components.nx
      expect(Math.abs(country.econ.gdp - reconcile)).toBeLessThan(1e-6)
    }
  })

  test('the same seed gives identical trade and NX after 60 months', async () => {
    const left = newWorld(9008, 'QING')
    const right = newWorld(9008, 'QING')
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    for (const id of Object.keys(left.countries)) {
      expect(left.countries[id]?.trade).toEqual(right.countries[id]?.trade)
      expect(left.countries[id]?.econ.gdpComponents.nx).toBe(
        right.countries[id]?.econ.gdpComponents.nx,
      )
    }
  })
})
