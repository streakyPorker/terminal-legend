import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import {
  debtPressure,
  debtRate,
  DEBT_PRESSURE_START,
  fiscalLedger,
} from '../engine/fiscal'
import { advance, newWorld } from '../engine/sim'
import type { ConstructionProject, Country, WorldState } from '../types'

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

describe('debt pressure is smooth, not a cliff (ADR 0007)', () => {
  test('no debuff below 25% debt/GDP, then every penalty grows with the ratio', async () => {
    const world = newWorld(9200, 'FRA')
    const fra = countryOf(world, 'FRA')
    fra.econ.gdp = 1000

    const at = (treasury: number) => {
      fra.econ.treasury = treasury
      return debtPressure(fra)
    }
    const clean = at(0)
    const small = at(-200) // 20% — below the start
    const light = at(-300) // 30%
    const heavy = at(-800) // 80%
    const severe = at(-1500) // 150%

    expect(clean.ratio).toBe(0)
    expect(clean.severity).toBe(0)
    expect(clean.incomePenalty).toBe(0)
    expect(Math.abs(small.ratio - 0.2)).toBeLessThan(1e-6)
    expect(small.severity).toBe(0)
    expect(small.label).toBe('无')

    expect(light.severity).toBeGreaterThan(0)
    expect(heavy.severity).toBeGreaterThan(light.severity)
    expect(severe.severity).toBeGreaterThan(heavy.severity)
    expect(heavy.incomePenalty).toBeGreaterThan(light.incomePenalty)
    expect(heavy.constructionPenalty).toBeGreaterThan(light.constructionPenalty)
    expect(heavy.legitimacyPenalty).toBeGreaterThan(light.legitimacyPenalty)
    expect(heavy.interestSpread).toBeGreaterThan(light.interestSpread)
    expect(DEBT_PRESSURE_START).toBe(0.25)
    expect(light.label).toBe('轻度')
    expect(heavy.label).toBe('中度')
    expect(severe.label).toBe('重度')
  })

  test('the ledger exposes the same pressure and the borrowing rate rises', async () => {
    const world = newWorld(9201, 'FRA')
    const fra = countryOf(world, 'FRA')
    fra.econ.gdp = 1000
    fra.econ.treasury = -100
    const lightRate = debtRate(fra)
    const light = fiscalLedger(fra)
    fra.econ.treasury = -1500
    const heavyRate = debtRate(fra)
    const heavy = fiscalLedger(fra)
    expect(Math.abs(light.debtPressure.ratio - 0.1)).toBeLessThan(1e-6)
    expect(Math.abs(heavy.debtPressure.ratio - 1.5)).toBeLessThan(1e-6)
    expect(heavyRate).toBeGreaterThan(lightRate)
    expect(heavy.debtPressure.severity).toBeGreaterThan(
      light.debtPressure.severity,
    )
  })

  test('a slightly negative treasury no longer freezes state construction', async () => {
    const world = newWorld(9202, 'QING')
    const qing = countryOf(world, 'QING')
    // Keep the test focused: make sure the project is the only state bill.
    qing.econ.constructionQueue = []
    qing.econ.spending.construction = 2
    qing.econ.treasury = -3
    const project: ConstructionProject = {
      id: 'test-deficit-build',
      building: 'mines',
      count: 1,
      owner: 'state',
      monthsLeft: 3,
      monthlyCost: 0.83,
      lastSpend: 0,
      progress: 0,
      startedAt: { ...world.date },
    }
    qing.econ.constructionQueue.push(project)

    advance(world, 1, [], makeRngForWorld(world))

    const kept = qing.econ.constructionQueue.find(one => one.id === project.id)
    expect(kept).toBeDefined()
    if (kept === undefined) return
    expect(kept.lastSpend).toBeGreaterThan(0)
    expect(kept.progress).toBeGreaterThan(0)
  })
})
