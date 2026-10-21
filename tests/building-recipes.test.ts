import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_IDS, BUILDING_RECIPES, makeRngForWorld } from '../engine/data'
import { UTIL_IDLE_FLOOR, advance, computeEconomy, inspectEconomy, newWorld } from '../engine/sim'
import type { WorldState } from '../types'

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-6) => {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

describe('BUILDING_RECIPES: output drives production (ADR 0021 B1)', () => {
  test('doubling a recipe output coefficient doubles that good production', async () => {
    const world = newWorld(9701, 'GBR')
    const gbr = countryOf(world, 'GBR')
    const recipe = BUILDING_RECIPES.factories
    const saved = recipe.output.fabric
    if (saved === undefined) throw new Error('factories has no fabric output')

    const original = inspectEconomy(gbr).production.fabric
    try {
      recipe.output.fabric = saved * 2
      const doubled = inspectEconomy(gbr).production.fabric
      // fabric comes only from factories and every multiplier is linear in the
      // coefficient, so the ratio is exact.
      close(doubled, original * 2, 1e-6)
    } finally {
      recipe.output.fabric = saved
    }
    close(inspectEconomy(gbr).production.fabric, original, 1e-9)
  })
})

describe('BUILDING_RECIPES: input drives intermediate demand (ADR 0021 B1)', () => {
  test('raising a recipe input coefficient raises that good demand by count × Δ', async () => {
    const world = newWorld(9702, 'GBR')
    const gbr = countryOf(world, 'GBR')
    const recipe = BUILDING_RECIPES.factories
    const saved = recipe.input.coal ?? 0
    const delta = 0.25
    const factories = gbr.econ.buildings.factories

    const before = inspectEconomy(gbr).demand.coal
    try {
      recipe.input.coal = saved + delta
      const after = inspectEconomy(gbr).demand.coal
      close(after - before, factories * delta, 1e-6)
    } finally {
      recipe.input.coal = saved
    }
  })
})

describe('buildingProfits snapshot (ADR 0021 B2)', () => {
  test('every building type has a reconciled profit row', async () => {
    const world = newWorld(9703, 'QING')
    const qing = countryOf(world, 'QING')
    advance(world, 1, [], makeRngForWorld(world))

    const profits = qing.econ.buildingProfits
    expect(Object.keys(profits).sort()).toEqual([...BUILDING_IDS].sort())
    for (const id of BUILDING_IDS) {
      const row = profits[id]
      expect(row).toBeDefined()
      if (row === undefined) continue
      expect(Number.isFinite(row.revenue)).toBe(true)
      expect(Number.isFinite(row.inputCost)).toBe(true)
      expect(Number.isFinite(row.wages)).toBe(true)
      // B3 drives the operating rate from last month's profit (ADR 0022); it is
      // a valid rate between the idle floor and full capacity.
      expect(row.utilization).toBeGreaterThanOrEqual(UTIL_IDLE_FLOOR)
      expect(row.utilization).toBeLessThanOrEqual(1)
      close(row.profit, row.revenue - row.inputCost - row.wages, 1e-6)
    }
  })

  test('the wage allocation is exhaustive and reconciles to the national bill', async () => {
    const world = newWorld(9704, 'QING')
    const qing = countryOf(world, 'QING')
    advance(world, 1, [], makeRngForWorld(world))
    const snap = computeEconomy(qing)

    let sumRevenue = 0
    let sumInput = 0
    let sumWages = 0
    let sumProfit = 0
    for (const id of BUILDING_IDS) {
      const row = snap.buildingProfits[id]
      sumRevenue += row.revenue
      sumInput += row.inputCost
      sumWages += row.wages
      sumProfit += row.profit
    }

    // The per-type wage shares partition the national wage bill exactly.
    close(sumWages, snap.wages, 1e-6)
    // Identity: Σ profit = Σ(revenue − inputCost) − Σ wages.
    close(sumProfit, sumRevenue - sumInput - sumWages, 1e-6)

    // Loose band vs the macro profit line: gross operating surplus is valued at
    // market prices over gross (not value-added) output, so it is a different
    // and larger quantity than realGdp × (1 − laborShare). Documented in
    // ADR 0021; only assert the same order of magnitude, not a tight fit.
    expect(Number.isFinite(sumProfit)).toBe(true)
    expect(sumProfit).toBeGreaterThan(-Math.abs(snap.profits) - 100)
    expect(sumProfit).toBeLessThan(5 * snap.realGdp + 500)
  })
})
