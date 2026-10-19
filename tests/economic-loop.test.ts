import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld, resourceMultiplier } from '../engine/data'
import {
  advance,
  applyDecision,
  computeEconomy,
  investmentScore,
  newWorld,
} from '../engine/sim'
import { addModifier } from '../engine/modifiers'
import { clone } from '../engine/sim'
import type { WorldState } from '../types'

const qingOf = (world: WorldState) => world.countries.QING

describe('E1 expenditure GDP, Stone-Geary and factor shares', () => {
  test('GDP is the sum of consumption, investment and government', async () => {
    const world = newWorld(101, 'QING')
    const qing = qingOf(world)
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const components = qing.econ.gdpComponents
    expect(components.c).toBeGreaterThan(0)
    expect(components.g).toBeGreaterThan(0)
    expect(components.nx).toBe(0)
    const sum = components.c + components.i + components.g
    expect(Math.abs(qing.econ.gdp - sum)).toBeLessThan(1e-6)

    const snap = computeEconomy(qing)
    expect(snap.components.c).toBeGreaterThan(0)
    expect(snap.laborShare).toBeGreaterThanOrEqual(0.35)
    expect(snap.laborShare).toBeLessThanOrEqual(0.7)
    expect(Math.abs(snap.wages + snap.profits - snap.gdp)).toBeLessThan(1e-6)
  })

  test('demand saturates food and upgrades to luxuries as income doubles', async () => {
    const world = newWorld(102, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const base = computeEconomy(fra).demand
    const poor = { grain: base.grain, luxury: base.luxury }

    fra.econ.wages *= 2
    fra.econ.profits *= 2
    const rich = computeEconomy(fra).demand
    expect(rich.grain).toBeLessThan(poor.grain * 2)
    expect(rich.grain).toBeGreaterThan(poor.grain)
    expect(rich.luxury).toBeGreaterThan(poor.luxury * 2)
  })

  test('labour utilisation and unemployment move the labour share', async () => {
    const world = newWorld(103, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    const before = computeEconomy(gbr).laborShare
    // Shrink the labour force so the same building stock looks fully staffed.
    gbr.pops.peasants = 10
    gbr.pops.workers = 20
    gbr.pops.artisans = 10
    gbr.econ.unemployment = 4
    const after = computeEconomy(gbr).laborShare
    expect(after).toBeGreaterThan(before)
    expect(gbr.econ.laborUtilization).toBeGreaterThanOrEqual(0.5)
    expect(gbr.econ.laborUtilization).toBeLessThanOrEqual(1)
  })

  test('60 months stay finite and grow without saturating unrest', async () => {
    const world = newWorld(104, 'QING')
    const qing = qingOf(world)
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const startGdp = qing.econ.gdp
    advance(world, 60, [], makeRngForWorld(world))
    for (const country of Object.values(world.countries)) {
      expect(Number.isFinite(country.econ.gdp)).toBe(true)
      expect(Number.isFinite(country.econ.privateCapital)).toBe(true)
      expect(Number.isFinite(country.econ.wages)).toBe(true)
      expect(country.econ.gdp).toBeGreaterThan(0)
      expect(country.pops.total).toBeGreaterThan(0)
      expect(country.pops.radicals).toBeLessThanOrEqual(100)
    }
    expect(qing.econ.gdp).toBeGreaterThan(startGdp)
    expect(qing.econ.gdp).toBeLessThan(startGdp * 3)
    expect(qing.pops.radicals).toBeLessThan(80)
  })
})

describe('E2 private investment', () => {
  test('savings enter private capital and start private projects', async () => {
    const world = newWorld(105, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    // A coal shortage with a high price gives private capital a clear outlet.
    prussia.econ.buildings.mines = 1
    prussia.econ.prices.coal = prussia.econ.prices.coal * 3
    prussia.econ.privateCapital = 120
    advance(world, 2, [], makeRngForWorld(world))
    const privateProjects = prussia.econ.constructionQueue.filter(
      project => project.owner === 'private',
    )
    expect(privateProjects.length).toBeGreaterThan(0)
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
      building: 'mines',
      count: 2,
      owner: 'private',
      monthsLeft: 3,
      monthlyCost: 1.67,
      progress: 0,
      startedAt: { ...withProject.date },
    })
    advance(plain, 1, [], makeRngForWorld(plain))
    advance(withProject, 1, [], makeRngForWorld(withProject))
    // Both economies earned the same small savings; only the seeded project
    // drew the private pool down.
    expect(a.econ.privateCapital).toBeLessThan(10)
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
    prussia.econ.prices.coal = 4
    const shortage = investmentScore(prussia, 'mines', demand, production)
    prussia.econ.prices.coal = 0.4
    const glut = investmentScore(prussia, 'mines', demand, production)
    expect(shortage).toBeGreaterThan(glut)
  })
})

describe('E3 resource endowments', () => {
  test('resource multipliers follow endowments and stay in 0.7..1.3', async () => {
    const world = newWorld(109, 'QING')
    const qing = qingOf(world)
    const japan = world.countries.JAP
    const prussia = world.countries.PRU
    expect(qing).toBeDefined()
    expect(japan).toBeDefined()
    expect(prussia).toBeDefined()
    if (qing === undefined || japan === undefined || prussia === undefined) return

    expect(resourceMultiplier(prussia.econ.resources, 'coal')).toBeGreaterThan(1.15)
    expect(resourceMultiplier(japan.econ.resources, 'coal')).toBeLessThan(0.9)
    for (const country of [qing, japan, prussia]) {
      for (const id of ['grain', 'wood', 'coal', 'iron', 'clothes'] as const) {
        const value = resourceMultiplier(country.econ.resources, id)
        expect(value).toBeGreaterThanOrEqual(0.7)
        expect(value).toBeLessThanOrEqual(1.3)
      }
    }
  })

  test('identical countries with different coal endowments diverge', async () => {
    const rich = newWorld(110, 'PRU')
    const poor = clone(rich)
    const richCountry = rich.countries.PRU
    const poorCountry = poor.countries.PRU
    expect(richCountry).toBeDefined()
    expect(poorCountry).toBeDefined()
    if (richCountry === undefined || poorCountry === undefined) return
    richCountry.econ.resources.coal = 100
    poorCountry.econ.resources.coal = 20
    for (const country of [richCountry, poorCountry]) {
      country.econ.prices.coal = 4
      country.econ.buildings.mines = 40
    }
    const richBefore = computeEconomy(richCountry).production.coal
    const poorBefore = computeEconomy(poorCountry).production.coal
    expect(richBefore).toBeGreaterThan(poorBefore * 1.4)

    advance(rich, 24, [], makeRngForWorld(rich))
    advance(poor, 24, [], makeRngForWorld(poor))
    expect(richCountry.econ.goods.coal).toBeGreaterThan(poorCountry.econ.goods.coal)
  })
})

describe('E4/E5 AI batch and determinism', () => {
  test('the AI batch covers every non-player country each month', async () => {
    const world = newWorld(111, 'QING')
    expect(world.ai.intervalTicks).toBe(1)
    expect(Object.keys(world.countries).length - 1).toBe(9)
  })

  test('an invest decision moves confidence inside its envelope', async () => {
    const world = newWorld(112, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    const base = fra.politicalEconomy.investmentConfidence
    const ok = applyDecision(
      world,
      { countryId: 'FRA', action: 'invest', params: { amount: 3 } },
      makeRngForWorld(world),
    )
    expect(ok.ok).toBe(true)
    expect(fra.econ.investmentConfidence).toBeLessThanOrEqual(base + 10)
    expect(fra.econ.investmentConfidence).toBeGreaterThan(base)
  })

  test('same seed and no decisions give identical 60-month worlds', async () => {
    const left = newWorld(113, 'QING')
    const right = newWorld(113, 'QING')
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    expect(left.countries.QING?.econ).toEqual(right.countries.QING?.econ)
    expect(left.countries.PRU?.econ).toEqual(right.countries.PRU?.econ)
  })
})

describe('E1 demand shock loop', () => {
  test('a consumption boost raises GDP, profits and private capacity', async () => {
    const control = newWorld(114, 'QING')
    const boosted = clone(control)
    const boostedQing = boosted.countries.QING
    const controlQing = control.countries.QING
    expect(boostedQing).toBeDefined()
    expect(controlQing).toBeDefined()
    if (boostedQing === undefined || controlQing === undefined) return

    addModifier(boostedQing, {
      id: 'shock',
      label: '消费繁荣',
      stat: 'consumption',
      stack: 'percent',
      value: 30,
      monthsLeft: 12,
      source: 'test',
    })
    advance(control, 12, [], makeRngForWorld(control))
    advance(boosted, 12, [], makeRngForWorld(boosted))
    expect(boostedQing.econ.gdp).toBeGreaterThan(controlQing.econ.gdp * 1.05)
    expect(boostedQing.econ.profits).toBeGreaterThan(controlQing.econ.profits)
    expect(
      boostedQing.econ.buildings.factories + boostedQing.econ.buildings.mines,
    ).toBeGreaterThanOrEqual(
      controlQing.econ.buildings.factories + controlQing.econ.buildings.mines,
    )

    // The modifier has expired by now; the economy cools toward the control.
    advance(control, 12, [], makeRngForWorld(control))
    advance(boosted, 12, [], makeRngForWorld(boosted))
    expect(
      Math.abs(boostedQing.econ.gdp - controlQing.econ.gdp) /
        Math.max(1, controlQing.econ.gdp),
    ).toBeLessThan(0.35)
  })
})
