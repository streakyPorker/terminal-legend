import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  INVESTMENT_DEMAND,
  makeRngForWorld,
} from '../engine/data'
import { CAPACITY_COST } from '../engine/construction'
import { advance, inspectEconomy, newWorld } from '../engine/sim'
import type { BuildingId, GoodId, WorldState } from '../types'

// Plan 0011 F2: the bundled `mines` splits into three single-output extraction
// buildings (coal / iron ore / wood). The COUNTRY_SEEDS rule keeps the total
// extraction building count equal to the old mine count, so the world's coal /
// iron / wood capacity stays comparable.
const NEW_EXTRACTION: BuildingId[] = ['coalMines', 'ironMines', 'lumberMills']

const oldMineCounts: Record<string, number> = {
  QING: 35,
  GBR: 90,
  FRA: 55,
  PRU: 70,
  RUS: 70,
  AUS: 60,
  USA: 55,
  JAP: 22,
  OTT: 25,
  SPA: 30,
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

describe('F2 extraction split: mines → coalMines / ironMines / lumberMills', () => {
  test('each new building produces exactly one good with the mine technology gate', () => {
    const specs = new Map<BuildingId, { good: GoodId; coef: number; labor: number }>([
      ['coalMines', { good: 'coal', coef: 1.2, labor: 0.6 }],
      ['ironMines', { good: 'iron', coef: 1.2, labor: 0.6 }],
      ['lumberMills', { good: 'wood', coef: 0.96, labor: 0.4 }],
    ])
    for (const id of NEW_EXTRACTION) {
      const recipe = BUILDING_RECIPES[id]
      const spec = specs.get(id)
      if (spec === undefined) throw new Error(`missing spec for ${id}`)
      expect(Object.keys(recipe.output)).toEqual([spec.good])
      expect(recipe.output[spec.good]).toBe(spec.coef)
      // PT-096: extraction carries a token machinery draw, so its margin is no
      // longer a bookkeeping 100% — it buys tools like any other works.
      expect(Object.keys(recipe.input)).toEqual(['machinery'])
      expect(recipe.labor).toBe(spec.labor)
      expect(recipe.gates?.tech).toBe(true)
      expect(recipe.outputModifier).toBe('mineOutput')
    }
  })

  test('the old `mines` id is gone from every BuildingId table', () => {
    expect(BUILDING_IDS as string[]).not.toContain('mines')
    const tables: Record<string, Record<string, unknown>> = {
      BUILDING_RECIPES: BUILDING_RECIPES as unknown as Record<string, unknown>,
      BUILDINGS: BUILDINGS as unknown as Record<string, unknown>,
      BUILDING_OUTPUT: BUILDING_OUTPUT as unknown as Record<string, unknown>,
      INVESTMENT_DEMAND: INVESTMENT_DEMAND as unknown as Record<string, unknown>,
      CAPACITY_COST: CAPACITY_COST as unknown as Record<string, unknown>,
    }
    for (const [name, table] of Object.entries(tables)) {
      expect(Object.keys(table), `${name} still lists mines`).not.toContain('mines')
      for (const id of NEW_EXTRACTION) {
        expect(table[id], `${name} is missing ${id}`).toBeDefined()
      }
    }
  })

  test('costs / times / capacity live in the spirit of the plan table', () => {
    expect(BUILDINGS.coalMines.cost).toBe(2.5)
    expect(BUILDINGS.ironMines.cost).toBe(2.5)
    expect(BUILDINGS.lumberMills.cost).toBe(2)
    expect(CAPACITY_COST.coalMines).toBe(1)
    expect(CAPACITY_COST.ironMines).toBe(1)
    expect(CAPACITY_COST.lumberMills).toBe(0.8)
  })

  test('the seed split keeps each country total extraction count equal to its old mine count', () => {
    const world = newWorld(9100, 'QING')
    for (const [id, old] of Object.entries(oldMineCounts)) {
      const b = countryOf(world, id).econ.buildings
      const sum = b.coalMines + b.ironMines + b.lumberMills
      expect(sum, `${id} extraction count`).toBe(old)
    }
  })

  test('coal / iron / wood stay two-sided on the 24-month baseline', () => {
    const world = newWorld(9100, 'QING')
    let coal = 0
    let iron = 0
    let wood = 0
    for (let month = 1; month <= 24; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      const market = globalMarket(world)
      if (market.coal.bid > 1e-9 && market.coal.offer > 1e-9) coal += 1
      if (market.iron.bid > 1e-9 && market.iron.offer > 1e-9) iron += 1
      if (market.wood.bid > 1e-9 && market.wood.offer > 1e-9) wood += 1
    }
    expect(coal).toBeGreaterThan(0)
    expect(iron).toBeGreaterThan(0)
    expect(wood).toBeGreaterThan(0)
  })
})
