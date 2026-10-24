import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_RECIPES, deriveLabor } from '../engine/data'
import { inspectWorld } from '../engine/inspect'
import { newWorld } from '../engine/sim'

/**
 * PT-061: workshops used to carry `labor: 0`, so a building the unemployment
 * curve counted as an employer contributed nothing to labour demand — two
 * panels telling two stories. They now carry 0.8.
 */
describe('workshops are labour demand (PT-061)', () => {
  test('the recipe carries a non-zero labour figure', () => {
    expect(BUILDING_RECIPES.workshops.labor).toBeGreaterThan(0)
  })

  test('ten more workshops add their labour to demand', () => {
    const world = newWorld(41, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const before = deriveLabor(qing).demand
    qing.econ.buildings.workshops = (qing.econ.buildings.workshops ?? 0) + 10
    const after = deriveLabor(qing).demand
    // 10 × 0.8 = 8 ten-thousand workers at full utilisation; the utilisation
    // weight can only scale that down, never to zero.
    expect(after).toBeGreaterThan(before)
    expect(after - before).toBeGreaterThanOrEqual(4)
    expect(after - before).toBeLessThanOrEqual(8.0001)
  })

  test('the labour section says the ratio is not an employment rate', () => {
    const world = newWorld(42, 'QING')
    const text = inspectWorld(world, 'labor')
    expect(text).toContain('营造所')
    expect(text).toContain('不是就业率')
  })
})
