import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_RECIPES, GOODS, makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'

/**
 * PT-066: ships are a tradeable good. Shipyards lay down hulls; naval bases
 * consume delivered hulls and commission them into `military.navy`.
 */
describe('ships, shipyards and naval bases (PT-066)', () => {
  test('ships are a priced, tradeable good and no consumer demand exists for them', () => {
    expect(GOODS.ships.name).toBe('船只')
    expect(GOODS.ships.basePrice).toBeGreaterThan(0)
    expect(BUILDING_RECIPES.navalYards.output.ships).toBeGreaterThan(0)
    expect(Object.keys(BUILDING_RECIPES.navalBases.output)).toEqual([])
    expect(BUILDING_RECIPES.navalBases.input.ships).toBe(0.5)
  })

  test('naval bases grow the navy when hulls are delivered', () => {
    const world = newWorld(71, 'QING')
    const qing = world.countries.QING
    if (qing === undefined) throw new Error('missing QING')
    const before = qing.military.navy
    qing.econ.buildings.navalYards = 10
    qing.econ.buildings.navalBases = 3
    advance(world, 4, [], makeRngForWorld(world))
    expect(qing.military.navy).toBeGreaterThan(before)
  })

  test('no bases, no new tonnage', () => {
    const world = newWorld(72, 'QING')
    const qing = world.countries.QING
    if (qing === undefined) throw new Error('missing QING')
    const before = qing.military.navy
    qing.econ.buildings.navalYards = 10
    qing.econ.buildings.navalBases = 0
    advance(world, 4, [], makeRngForWorld(world))
    expect(qing.military.navy).toBe(before)
  })
})
