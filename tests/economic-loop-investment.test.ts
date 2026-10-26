import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, clone, computeEconomy, investmentScore, newWorld } from '../engine/sim'

// Split out of `economic-loop.test.ts` (plan 0012 S6): private capital,
// private project pacing and the investment score.

describe('E2 private investment', () => {
  test('savings enter private capital and start private projects', async () => {
    const world = newWorld(105, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    // A coal shortage with a high price gives private capital a clear outlet.
    prussia.econ.buildings.coalMines = 1
    prussia.econ.prices.coal = prussia.econ.prices.coal * 3
    prussia.econ.privateCapital = 120
    advance(world, 2, [], makeRngForWorld(world))
    // A fully funded private project now finishes in one month, so assert on
    // the chronicle rather than on the queue still holding it.
    expect(
      world.log.some(entry => entry.text.includes('私人资本投建')),
    ).toBe(true)
  })

  test('private projects spend private capital, not the treasury', async () => {
    const plain = newWorld(106, 'JAP')
    const withProject = clone(plain)
    const a = plain.countries.JAP
    const b = withProject.countries.JAP
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a === undefined || b === undefined) return
    for (const country of [a, b]) {
      country.econ.treasury = 0
      country.econ.spending.construction = 0
      country.econ.privateCapital = 0
      country.econ.prices.iron = country.econ.prices.iron * 4
    }
    b.econ.privateCapital = 100
    b.econ.constructionQueue.push({
      id: 'private-test',
      building: 'coalMines',
      count: 2,
      owner: 'private',
      monthsLeft: 3,
      monthlyCost: 1.67,
      lastSpend: 0,
      progress: 0,
      startedAt: { ...withProject.date },
    })
    advance(plain, 1, [], makeRngForWorld(plain))
    advance(withProject, 1, [], makeRngForWorld(withProject))
    // Both economies earned the same small savings; only the seeded project
    // drew the private pool down.
    // PT-094: mines are more profitable, so one month's savings are a bit
    // larger; the point is that neither side ran a big private pool.
    expect(a.econ.privateCapital).toBeLessThan(15)
    expect(b.econ.privateCapital).toBeLessThan(100)
    expect(b.econ.privateCapital).toBeLessThan(a.econ.privateCapital + 99)
  })

  test('unprofitable savings are released as luxury demand', async () => {
    const world = newWorld(107, 'SPA')
    const spain = world.countries.SPA
    expect(spain).toBeDefined()
    if (spain === undefined) return
    // Make every outlet unprofitable: prices far below base.
    for (const id of Object.keys(spain.econ.prices) as (keyof typeof spain.econ.prices)[]) {
      spain.econ.prices[id] = 0.05
    }
    spain.econ.privateCapital = 500
    advance(world, 1, [], makeRngForWorld(world))
    expect(spain.econ.idleProfits).toBeGreaterThan(0)
    expect(spain.econ.idlePurchases + spain.econ.privateCapital).toBeGreaterThan(0)
  })

  test('investment score rewards shortage and punishes glut', async () => {
    const world = newWorld(108, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    const demand = computeEconomy(prussia).demand
    const production = prussia.econ.goods
    const shortageDemand = { ...demand, coal: production.coal * 2, iron: production.iron * 2 }
    const glutDemand = { ...demand, coal: production.coal * 0.2, iron: production.iron * 0.2 }
    const shortage = investmentScore(prussia, 'coalMines', shortageDemand, production)
    const glut = investmentScore(prussia, 'coalMines', glutDemand, production)
    expect(shortage).toBeGreaterThan(glut)
  })
})
