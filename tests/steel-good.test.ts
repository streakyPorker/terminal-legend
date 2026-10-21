import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_RECIPES,
  CONSUMER_GOODS,
  GOODS,
  GOOD_IDS,
  GOVERNMENT_DEMAND,
  INCOME_ELASTICITY,
  INVESTMENT_DEMAND,
  SUBSISTENCE,
  makeRngForWorld,
} from '../engine/data'
import { TRADABLE_GOODS } from '../engine/trade'
import { advance, inspectEconomy, newWorld } from '../engine/sim'
import type { GoodId, WorldState } from '../types'

// Plan 0011 F1: the iron-ore / steel split. `iron` keeps its id but becomes raw
// ORE (铁矿石); `steel` (钢铁) is the new worked metal. The bundled `factories`
// smelt ore + coal into steel for F1 (steelMills arrives in F3) and the heavy
// consumers move from `iron` to `steel`.
const BASELINE_SEED = 9100
const MONTHS = 24

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-6) => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

const globalMarket = (world: WorldState): Record<GoodId, { bid: number; offer: number }> => {
  const out = {} as Record<GoodId, { bid: number; offer: number }>
  for (const id of GOOD_IDS) out[id] = { bid: 0, offer: 0 }
  for (const country of Object.values(world.countries)) {
    const market = inspectEconomy(country)
    for (const id of GOOD_IDS) {
      const surplus = (market.production[id] ?? 0) - (market.demand[id] ?? 0)
      if (surplus > 1e-9) out[id].offer += surplus
      else if (surplus < -1e-9) out[id].bid += -surplus
    }
  }
  return out
}

describe('steel good and the iron-ore rename (plan 0011 F1)', () => {
  test('iron is renamed to iron ore and a new steel good is defined', async () => {
    expect(GOODS.iron.name).toBe('铁矿石')
    expect(GOODS.steel).toBeDefined()
    expect(GOODS.steel.name).toBe('钢铁')
    // Ore is the cheap raw input; steel sits between the ore and machinery.
    expect(GOODS.steel.basePrice).toBeGreaterThan(GOODS.iron.basePrice)
    expect(GOODS.steel.basePrice).toBeLessThan(GOODS.machinery.basePrice)
    expect(GOOD_IDS).toContain('steel')
    expect(GOOD_IDS).toContain('iron')
    // The new key is wired into every good record: price and quantity are live.
    const world = newWorld(BASELINE_SEED, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    expect(Number.isFinite(qing?.econ.goods.steel)).toBe(true)
    expect(qing?.econ.prices.steel ?? 0).toBeGreaterThan(0)
  })

  test('steel is a tradable, non-consumer, heavy-industry good', async () => {
    expect(TRADABLE_GOODS).toContain('steel')
    expect(CONSUMER_GOODS).not.toContain('steel')
    expect(SUBSISTENCE.steel).toBe(0)
    expect(INCOME_ELASTICITY.steel).toBe(0)
    // Government construction and heavy-industry investment buy steel, not ore.
    expect(GOVERNMENT_DEMAND.construction.steel).toBeGreaterThan(0)
    expect(GOVERNMENT_DEMAND.construction.iron).toBeUndefined()
    for (const building of Object.values(INVESTMENT_DEMAND)) {
      expect(building.iron).toBeUndefined()
    }
    expect(Object.values(INVESTMENT_DEMAND).some(basket => (basket.steel ?? 0) > 0)).toBe(true)
    expect(BUILDING_RECIPES.railroads.input.steel).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.railroads.input.iron).toBeUndefined()
  })

  test('the ore→steel chain: factories consume ore + coal and produce steel', async () => {
    const recipe = BUILDING_RECIPES.factories
    expect(recipe.input.iron ?? 0).toBeGreaterThan(0)
    expect(recipe.input.coal ?? 0).toBeGreaterThan(0)
    expect(recipe.output.steel ?? 0).toBeGreaterThan(0)
    // Ore is not an output of industry any more — only the mines produce it.
    expect(BUILDING_RECIPES.factories.output.iron).toBeUndefined()

    const world = newWorld(9702, 'GBR')
    const gbr = countryOf(world, 'GBR')
    const factories = gbr.econ.buildings.factories
    const delta = 0.25

    // Raising the ore input raises ore demand by count × Δ (the chain consumes).
    const savedIron = recipe.input.iron ?? 0
    const ironBefore = inspectEconomy(gbr).demand.iron
    try {
      recipe.input.iron = savedIron + delta
      close(inspectEconomy(gbr).demand.iron - ironBefore, factories * delta, 1e-6)
    } finally {
      recipe.input.iron = savedIron
    }

    // Doubling the steel output doubles steel production (the chain produces).
    const savedSteel = recipe.output.steel ?? 0
    const steelBefore = inspectEconomy(gbr).production.steel
    try {
      recipe.output.steel = savedSteel * 2
      close(inspectEconomy(gbr).production.steel, steelBefore * 2, 1e-6)
    } finally {
      recipe.output.steel = savedSteel
    }
    close(inspectEconomy(gbr).production.steel, steelBefore, 1e-9)
  })

  test('steel and ore are both traded (two-sided) over the 24-month baseline', async () => {
    const world = newWorld(BASELINE_SEED, 'QING')
    let steelTwoSided = 0
    let ironTwoSided = 0
    let sawSteelExport = false
    let sawSteelImport = false
    for (let month = 1; month <= MONTHS; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      const market = globalMarket(world)
      if (market.steel.bid > 1e-9 && market.steel.offer > 1e-9) steelTwoSided += 1
      if (market.iron.bid > 1e-9 && market.iron.offer > 1e-9) ironTwoSided += 1
      for (const country of Object.values(world.countries)) {
        if (country.trade.exports.some(flow => flow.good === 'steel')) sawSteelExport = true
        if (country.trade.imports.some(flow => flow.good === 'steel')) sawSteelImport = true
      }
    }
    // The ore→steel chain keeps both goods genuinely traded, not one-sided.
    expect(steelTwoSided).toBeGreaterThan(0)
    expect(ironTwoSided).toBeGreaterThan(0)
    expect(sawSteelExport).toBe(true)
    expect(sawSteelImport).toBe(true)
  })
})
