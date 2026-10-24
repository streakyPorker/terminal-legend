import { describe, expect, test } from 'claude-code/testing'
import { debtPressure } from '../engine/fiscal'
import { newWorld } from '../engine/sim'

/**
 * PT-063: heavy debt must genuinely hurt. Before, a state at twice GDP lost
 * only ~10% of income; now it loses a quarter, sheds nearly half its state
 * construction speed and pays a real interest spread.
 */
function pressureAt(ratio: number) {
  const world = newWorld(63, 'FRA')
  const fra = world.countries.FRA
  if (fra === undefined) throw new Error('missing FRA')
  fra.econ.gdp = 100
  fra.econ.treasury = -ratio * 100
  return debtPressure(fra)
}

describe('debt pressure is punitive (PT-063)', () => {
  test('nothing is charged below the 25% start', () => {
    expect(pressureAt(0.2).incomePenalty).toBe(0)
    expect(pressureAt(0.2).label).toBe('无')
  })

  test('debt at 100% of GDP already costs real money', () => {
    const p = pressureAt(1)
    expect(p.incomePenalty).toBeGreaterThanOrEqual(0.1)
    expect(p.constructionPenalty).toBeGreaterThanOrEqual(0.15)
    expect(p.label).toBe('重度')
  })

  test('debt at 200% of GDP is a crisis', () => {
    const p = pressureAt(2)
    expect(p.incomePenalty).toBeGreaterThanOrEqual(0.25)
    expect(p.constructionPenalty).toBeGreaterThanOrEqual(0.44)
    expect(p.legitimacyPenalty).toBeGreaterThanOrEqual(11)
    expect(p.interestSpread).toBeGreaterThanOrEqual(0.008)
    expect(p.label).toBe('危重')
  })

  test('severity stops at twice the start-to-full stretch', () => {
    const deep = pressureAt(10)
    // Severity is clamped at 2, so 0.18 × 2 is the ceiling.
    expect(deep.incomePenalty).toBe(0.36)
    expect(deep.incomePenalty).toBeLessThanOrEqual(0.361)
    expect(deep.constructionPenalty).toBeLessThanOrEqual(0.641)
  })

  test('penalties rise monotonically with the ratio', () => {
    const ratios = [0.3, 0.5, 0.8, 1, 1.5, 2, 2.5]
    for (let i = 1; i < ratios.length; i += 1) {
      const a = pressureAt(ratios[i - 1] ?? 0)
      const b = pressureAt(ratios[i] ?? 0)
      expect(b.incomePenalty).toBeGreaterThan(a.incomePenalty)
      expect(b.constructionPenalty).toBeGreaterThan(a.constructionPenalty)
    }
  })
})
