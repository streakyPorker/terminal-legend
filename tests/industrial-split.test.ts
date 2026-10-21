import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  BUILDING_TIME,
  INVESTMENT_DEMAND,
  makeRngForWorld,
} from '../engine/data'
import { CAPACITY_COST } from '../engine/construction'
import { advance, inspectEconomy, newWorld } from '../engine/sim'
import type { BuildingId, GoodId, WorldState } from '../types'

// Plan 0011 F3: the bundled `factories` splits into seven single/few-output
// industrial buildings. The COUNTRY_SEEDS rule splits each country's old
// factories count across the seven by the OLD output-value share, so the total
// industrial count (and each good's national supply) is conserved.
const INDUSTRIAL: BuildingId[] = [
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
]

// Old `factories` count per country (the sum each seed must conserve).
const OLD_FACTORY_COUNTS: Record<string, number> = {
  QING: 20,
  GBR: 160,
  FRA: 95,
  PRU: 60,
  RUS: 35,
  AUS: 45,
  USA: 55,
  JAP: 12,
  OTT: 14,
  SPA: 20,
}

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const globalMarket = (world: WorldState): Record<GoodId, { bid: number; offer: number }> => {
  const out = {} as Record<GoodId, { bid: number; offer: number }>
  for (const country of Object.values(world.countries)) {
    const market = inspectEconomy(country)
    for (const [good, value] of Object.entries(market.production) as [GoodId, number][]) {
      const demand = market.demand[good] ?? 0
      if (out[good] === undefined) out[good] = { bid: 0, offer: 0 }
      const surplus = value - demand
      if (surplus > 1e-9) out[good].offer += surplus
      else if (surplus < -1e-9) out[good].bid += -surplus
    }
  }
  return out
}

describe('F3 industrial split: factories → seven single/few-output works', () => {
  test('every industrial building outputs ≤2 goods and carries the tech+industrial gate', () => {
    for (const id of INDUSTRIAL) {
      const recipe = BUILDING_RECIPES[id]
      expect(Object.keys(recipe.output).length, `${id} outputs`).toBeLessThanOrEqual(2)
      expect(recipe.gates?.tech).toBe(true)
      expect(recipe.gates?.industrial).toBe(true)
      expect(recipe.outputModifier).toBe('factoryOutput')
    }
    // Only textiles is a two-output chain (fabric → clothes).
    expect(Object.keys(BUILDING_RECIPES.textileMills.output).sort()).toEqual(['clothes', 'fabric'])
    for (const id of INDUSTRIAL.filter(one => one !== 'textileMills')) {
      expect(Object.keys(BUILDING_RECIPES[id].output).length, `${id} single output`).toBe(1)
    }
  })

  test('the heavy-industry chain consumes iron ore → steel → machinery/arms', () => {
    expect(BUILDING_RECIPES.steelMills.output.steel ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.steelMills.input.iron ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.machineryWorks.output.machinery ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.machineryWorks.input.steel ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.arsenals.output.arms ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.arsenals.input.steel ?? 0).toBeGreaterThan(0)
    // Furniture, like the other heavy consumers, buys steel not ore (ADR 0026).
    expect(BUILDING_RECIPES.furnitureWorks.input.steel ?? 0).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.furnitureWorks.input.iron).toBeUndefined()
    // Only the smelters consume raw ore.
    for (const id of INDUSTRIAL) {
      if (id === 'steelMills' || id === 'arsenals') continue
      expect(BUILDING_RECIPES[id].input.iron, `${id} consumes ore`).toBeUndefined()
    }
  })

  test('the old liquor-only-industrial override is kept on distilleries', () => {
    const recipe = BUILDING_RECIPES.distilleries
    expect(recipe.outputGates?.liquor).toEqual({ industrial: true })
    expect(recipe.gates?.industrial).toBe(true)
  })

  test('the old `factories` id is gone from every BuildingId table', () => {
    expect(BUILDING_IDS as string[]).not.toContain('factories')
    const tables: Record<string, Record<string, unknown>> = {
      BUILDING_RECIPES: BUILDING_RECIPES as unknown as Record<string, unknown>,
      BUILDINGS: BUILDINGS as unknown as Record<string, unknown>,
      BUILDING_TIME: BUILDING_TIME as unknown as Record<string, unknown>,
      BUILDING_OUTPUT: BUILDING_OUTPUT as unknown as Record<string, unknown>,
      INVESTMENT_DEMAND: INVESTMENT_DEMAND as unknown as Record<string, unknown>,
      CAPACITY_COST: CAPACITY_COST as unknown as Record<string, unknown>,
    }
    for (const [name, table] of Object.entries(tables)) {
      expect(Object.keys(table), `${name} still lists factories`).not.toContain('factories')
      for (const id of INDUSTRIAL) {
        expect(table[id], `${name} is missing ${id}`).toBeDefined()
      }
    }
  })

  test('costs / times / capacity live in the spirit of the plan table', () => {
    expect(BUILDINGS.textileMills.cost).toBe(4)
    expect(BUILDINGS.furnitureWorks.cost).toBe(3.5)
    expect(BUILDINGS.distilleries.cost).toBe(3.5)
    expect(BUILDINGS.machineryWorks.cost).toBe(5)
    expect(BUILDINGS.steelMills.cost).toBe(5)
    expect(BUILDINGS.arsenals.cost).toBe(4.5)
    expect(BUILDINGS.luxuryWorks.cost).toBe(5)
    expect(BUILDING_TIME.textileMills).toBe(4)
    expect(BUILDING_TIME.machineryWorks).toBe(5)
    expect(BUILDING_TIME.steelMills).toBe(5)
    expect(CAPACITY_COST.textileMills).toBe(2)
    expect(CAPACITY_COST.machineryWorks).toBe(2.5)
    expect(CAPACITY_COST.steelMills).toBe(2.5)
    expect(CAPACITY_COST.luxuryWorks).toBe(2)
  })

  test('the seed split keeps each country total industrial count equal to its old factories count', () => {
    const world = newWorld(9100, 'QING')
    let grand = 0
    for (const [id, old] of Object.entries(OLD_FACTORY_COUNTS)) {
      const b = countryOf(world, id).econ.buildings
      const sum = INDUSTRIAL.reduce((acc, one) => acc + b[one], 0)
      expect(sum, `${id} industrial count`).toBe(old)
      grand += old
    }
    // 516 old factories split across the ten seeds, count conserved.
    expect(grand).toBe(516)
  })

  test('the industrial goods stay two-sided over the 24-month baseline', () => {
    const world = newWorld(9100, 'QING')
    const twoSided: Record<string, number> = { fabric: 0, machinery: 0, steel: 0, iron: 0 }
    for (let month = 1; month <= 24; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      const market = globalMarket(world)
      for (const good of Object.keys(twoSided) as GoodId[]) {
        if (market[good].bid > 1e-9 && market[good].offer > 1e-9) twoSided[good] += 1
      }
    }
    expect(twoSided.fabric).toBeGreaterThan(0)
    expect(twoSided.machinery).toBeGreaterThan(0)
    expect(twoSided.steel).toBeGreaterThan(0)
    expect(twoSided.iron).toBeGreaterThan(0)
  })
})
