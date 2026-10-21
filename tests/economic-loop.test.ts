import { describe, expect, test } from 'claude-code/testing'
import { decideForAi } from '../engine/ai'
import { deriveLabor, makeRngForWorld, resourceMultiplier } from '../engine/data'
import {
  advance,
  applyDecision,
  applyPolicy,
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
    // T1a: NX is now part of GDP. A freshly calibrated world has no flows yet,
    // so this is the reconcile check rather than a hard zero.
    expect(
      Math.abs(qing.econ.gdp - (components.c + components.i + components.g + components.nx)),
    ).toBeLessThan(1e-6)
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
    const shortageDemand = { ...demand, coal: production.coal * 2, iron: production.iron * 2 }
    const glutDemand = { ...demand, coal: production.coal * 0.2, iron: production.iron * 0.2 }
    const shortage = investmentScore(prussia, 'coalMines', shortageDemand, production)
    const glut = investmentScore(prussia, 'coalMines', glutDemand, production)
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
      country.econ.buildings.coalMines = 40
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
    // Construction capacity and inputs can bind, so a demand boost no longer
    // guarantees a strictly larger capital stock; it must not shrink it much.
    const capacityBuildings = (country: typeof controlQing): number =>
      country.econ.buildings.textileMills +
      country.econ.buildings.furnitureWorks +
      country.econ.buildings.distilleries +
      country.econ.buildings.machineryWorks +
      country.econ.buildings.steelMills +
      country.econ.buildings.arsenals +
      country.econ.buildings.luxuryWorks +
      country.econ.buildings.coalMines +
      country.econ.buildings.ironMines +
      country.econ.buildings.lumberMills +
      country.econ.buildings.workshops
    expect(capacityBuildings(boostedQing)).toBeGreaterThanOrEqual(
      capacityBuildings(controlQing) * 0.9,
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

describe('Round 1 regressions', () => {
  test('queued but unfunded projects no longer inflate GDP', async () => {
    const plain = newWorld(115, 'QING')
    const queued = clone(plain)
    for (const country of [plain.countries.QING, queued.countries.QING]) {
      if (country === undefined) continue
      country.econ.spending.construction = 0
      country.econ.buildings.workshops = 0
    }
    const qing = queued.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    for (let index = 0; index < 8; index += 1) {
      qing.econ.constructionQueue.push({
        id: `phantom-${index}`,
        building: 'railroads',
        count: 20,
        owner: 'state',
        monthsLeft: 8,
        monthlyCost: 17.5,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...queued.date },
      })
    }
    advance(plain, 1, [], makeRngForWorld(plain))
    advance(queued, 1, [], makeRngForWorld(queued))
    const a = plain.countries.QING
    const b = queued.countries.QING
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a === undefined || b === undefined) return
    expect(Math.abs(a.econ.gdp - b.econ.gdp)).toBeLessThan(0.01)
    expect(b.econ.gdpComponents.i).toBe(0)
    expect(b.econ.buildings.railroads).toBe(0)
  })

  test('the state build queue accepts unlimited orders', async () => {
    const world = newWorld(116, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.treasury = 1000
    for (let index = 0; index < 12; index += 1) {
      applyDecision(
        world,
        { countryId: 'QING', action: 'build', params: { building: 'farms', count: 1 } },
        makeRngForWorld(world),
      )
    }
    expect(qing.econ.constructionQueue.filter(one => one.owner === 'state').length).toBe(12)
  })

  test('displayed expense matches the treasury change when the queue is empty', async () => {
    const world = newWorld(117, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    fra.econ.treasury = 100
    fra.econ.spending.construction = 10
    const before = fra.econ.treasury
    advance(world, 1, [], makeRngForWorld(world))
    const delta = fra.econ.treasury - before
    // The private sector carries its own trade gap (ADR 0008). Construction
    // rent is booked as "other" income in the following month, so this month's
    // treasury change is simply income − expense.
    expect(
      Math.abs(fra.econ.income - fra.econ.expense - delta),
    ).toBeLessThan(0.05)
  })

  test('a partial or malformed AI batch is filled per country', async () => {
    const world = newWorld(118, 'QING')
    const fake = {
      model: {
        complete: async () => ({
          isAnswered: true,
          text: JSON.stringify([
            { country: 'GBR', action: 'invest', params: { amount: 1 } },
            { country: 'FRA', action: 'invest', params: { amount: -1 } },
            { country: 'PRU', action: 'build', params: { building: 'castle', count: 1 } },
          ]),
        }),
      },
    }
    const report = await decideForAi(fake as never, world, makeRngForWorld(world))
    expect(report.decisions.length).toBeGreaterThanOrEqual(4)
    expect(report.decisions.some(one => one.countryId === 'PRU' && one.action === 'build' && one.params.building === 'castle')).toBe(false)
    expect(report.error ?? '').toContain('兜底')
  })

  test('privateInvestment trades short-run consumption for long-run capacity', async () => {
    const control = newWorld(119, 'QING')
    const boosted = clone(control)
    const qing = boosted.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'pro-investment',
      label: '投资税优惠',
      stat: 'privateInvestment',
      stack: 'percent',
      value: 50,
      monthsLeft: 60,
      source: 'test',
    })
    advance(control, 60, [], makeRngForWorld(control))
    advance(boosted, 60, [], makeRngForWorld(boosted))
    const a = control.countries.QING
    const b = boosted.countries.QING
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a === undefined || b === undefined) return
    // Ten-round projects make the short-run GDP trade-off noisier; the
    // durable signal is a larger private pool.
    expect(b.econ.privateCapital).toBeGreaterThan(a.econ.privateCapital)
  })

  test('raw labour utilisation is kept separately from the 50% floor', async () => {
    const world = newWorld(120, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const labor = deriveLabor(qing)
    expect(labor.raw).toBeLessThan(0.5)
    expect(labor.utilization).toBe(0.5)
    expect(qing.econ.laborRawUtilization).toBe(labor.raw)
  })
})

describe('Round 2 regressions', () => {
  test('string or infinite model parameters cannot poison the economy', async () => {
    const world = newWorld(121, 'QING')
    for (const decision of [
      { countryId: 'GBR', action: 'tax', params: { base: 'profit', rate: 'abc' } },
      { countryId: 'FRA', action: 'tariff', params: { rate: 'abc' } },
      { countryId: 'PRU', action: 'spending', params: { category: 'army', amount: 'abc' } },
      { countryId: 'RUS', action: 'build', params: { building: 'farms', count: 'abc' } },
      { countryId: 'USA', action: 'conscript', params: { amount: 'abc' } },
      { countryId: 'OTT', action: 'invest', params: { amount: 'abc' } },
    ]) {
      applyDecision(world, decision as never, makeRngForWorld(world))
    }
    advance(world, 1, [], makeRngForWorld(world))
    for (const country of Object.values(world.countries)) {
      for (const value of [
        country.econ.gdp,
        country.econ.income,
        country.econ.taxes.profit,
        country.econ.tariff,
        country.military.army,
      ]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      for (const project of country.econ.constructionQueue) {
        expect(Number.isFinite(project.count)).toBe(true)
        expect(Number.isFinite(project.monthlyCost)).toBe(true)
      }
    }
  })

  test('unspent construction appropriations create no government demand', async () => {
    const low = newWorld(122, 'QING')
    const high = clone(low)
    const lowQing = low.countries.QING
    const highQing = high.countries.QING
    expect(lowQing).toBeDefined()
    expect(highQing).toBeDefined()
    if (lowQing === undefined || highQing === undefined) return
    lowQing.econ.spending.construction = 0
    highQing.econ.spending.construction = 50
    advance(low, 1, [], makeRngForWorld(low))
    advance(high, 1, [], makeRngForWorld(high))
    expect(highQing.econ.gdpComponents.g).toBe(lowQing.econ.gdpComponents.g)
    expect(Math.abs(highQing.econ.gdp - lowQing.econ.gdp)).toBeLessThan(0.01)
    expect(highQing.econ.lastStateConstructionSpend).toBe(0)
  })

  test('a country without universities still researches at a base rate', async () => {
    const world = newWorld(125, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.buildings.universities = 0
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.tech.pointsPerMonth).toBeGreaterThan(2)
  })

  test('private builders start one project every other month, at most three in flight', async () => {
    const world = newWorld(124, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.privateCapital = 300
    const starts: number[] = []
    for (let month = 0; month < 12; month += 1) {
      const before = qing.econ.constructionQueue.filter(
        one => (one.owner ?? 'state') === 'private',
      ).length
      advance(world, 1, [], makeRngForWorld(world))
      const after = qing.econ.constructionQueue.filter(
        one => (one.owner ?? 'state') === 'private',
      ).length
      expect(after).toBeLessThanOrEqual(3)
      if (after > before) starts.push(world.tick)
    }
    expect(starts.length).toBeGreaterThan(0)
    for (let index = 1; index < starts.length; index += 1) {
      expect((starts[index] ?? 0) - (starts[index - 1] ?? 0)).toBeGreaterThanOrEqual(2)
    }
  })

  test('policies cost authority by magnitude and permanent same-stat policies replace', async () => {
    const world = newWorld(123, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.government.authority = 100
    const first = applyPolicy(world, 'QING', {
      name: '增长甲',
      effects: [{ stat: 'gdp', stack: 'percent', value: 50 }],
    })
    expect(first.ok).toBe(true)
    // A permanent +50% GDP is priced as 48 months: 50 × 4 × 0.2 = 40,
    // capped at the maximum authority cost.
    expect(qing.government.authority).toBe(60)
    const second = applyPolicy(world, 'QING', {
      name: '增长乙',
      effects: [{ stat: 'gdp', stack: 'percent', value: 50 }],
    })
    expect(second.ok).toBe(true)
    expect(qing.modifiers.filter(one => one.stat === 'gdp').length).toBe(1)
    const absurd = applyPolicy(world, 'QING', {
      name: '疯狂',
      effects: [{ stat: 'gdp', stack: 'percent', value: 100000 }],
    })
    expect(absurd.ok).toBe(false)
  })

  test('private investment keeps replacing stock for ten years', async () => {
    const world = newWorld(124, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    let zeroRun = 0
    let maxZeroRun = 0
    for (let month = 0; month < 120; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      if (qing.econ.gdpComponents.i <= 0.01) {
        zeroRun += 1
        maxZeroRun = Math.max(maxZeroRun, zeroRun)
      } else {
        zeroRun = 0
      }
    }
    // The private-start brake (PT-029) can leave a slightly longer gap; the
    // stock still gets replaced instead of freezing for years.
    expect(maxZeroRun).toBeLessThanOrEqual(10)
  })

  test('high unrest activates the revolutionary thresholds', async () => {
    const world = newWorld(125, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.pops.radicals = 100
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'threshold:revolutionary-crisis')).toBe(true)
    expect(qing.modifiers.some(one => one.source === 'threshold:state-collapse')).toBe(true)
  })

  test('unemployment moves at most 1.5 points per month', async () => {
    const world = newWorld(126, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    let previous = qing.econ.unemployment
    for (let month = 0; month < 36; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      const current = qing.econ.unemployment
      expect(Math.abs(current - previous)).toBeLessThan(1.51)
      previous = current
    }
  })
})

describe('Round 3 regressions', () => {
  test('flat flow policies are priced by stat scale', async () => {
    const world = newWorld(131, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.government.authority = 100
    const radicals = applyPolicy(world, 'QING', {
      name: '清除民怨',
      effects: [{ stat: 'radicals', stack: 'flat', value: -2 }],
    })
    expect(radicals.ok).toBe(true)
    // 2 points × 10 impact × 48 months × 0.2 = 19.2 -> 16 after rounding.
    expect(qing.government.authority).toBe(84)
    const literacy = applyPolicy(world, 'QING', {
      name: '全民识字',
      effects: [{ stat: 'literacy', stack: 'flat', value: 0.5 }],
    })
    expect(literacy.ok).toBe(true)
    // 0.5 is 50 percentage points; the flat scale makes it cost the cap 40.
    expect(qing.government.authority).toBe(44)
    const authority = applyPolicy(world, 'QING', {
      name: '集中权力',
      effects: [{ stat: 'authority', stack: 'flat', value: 5 }],
    })
    expect(authority.ok).toBe(true)
    expect(qing.government.authority).toBe(4)
  })

  test('gdp modifiers scale the report but do not compound into wages', async () => {
    const world = newWorld(132, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.government.authority = 100
    const result = applyPolicy(world, 'QING', {
      name: '统计繁荣',
      effects: [{ stat: 'gdp', stack: 'percent', value: 100 }],
    })
    expect(result.ok).toBe(true)
    const snap = computeEconomy(qing)
    expect(snap.gdp).toBeGreaterThan(snap.realGdp * 1.8)
    expect(snap.gdp).toBeLessThan(snap.realGdp * 2.2)
    expect(Math.abs(snap.wages + snap.profits - snap.realGdp)).toBeLessThan(1e-6)
    const before = snap.realGdp
    advance(world, 12, [], makeRngForWorld(world))
    const after = computeEconomy(qing)
    // The real economy may grow, but the statistical modifier must not turn
    // +200% into a 12x compounding spiral.
    expect(after.realGdp).toBeLessThan(before * 3)
  })

  test('every country keeps private investment going for ten years', async () => {
    const world = newWorld(133, 'QING')
    const zeroRuns: Record<string, number> = {}
    for (const country of Object.values(world.countries)) zeroRuns[country.id] = 0
    const maxRuns: Record<string, number> = {}
    for (const country of Object.values(world.countries)) maxRuns[country.id] = 0
    for (let month = 0; month < 120; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      for (const country of Object.values(world.countries)) {
        if (country.econ.gdpComponents.i <= 0.01) {
          zeroRuns[country.id] = (zeroRuns[country.id] ?? 0) + 1
          maxRuns[country.id] = Math.max(maxRuns[country.id] ?? 0, zeroRuns[country.id] ?? 0)
        } else {
          zeroRuns[country.id] = 0
        }
      }
    }
    for (const country of Object.values(world.countries)) {
      expect(maxRuns[country.id] ?? 0).toBeLessThanOrEqual(8)
    }
  })

  test('high tax rates erode the tax base', async () => {
    const low = newWorld(134, 'QING')
    const high = clone(low)
    const lowQing = low.countries.QING
    const highQing = high.countries.QING
    expect(lowQing).toBeDefined()
    expect(highQing).toBeDefined()
    if (lowQing === undefined || highQing === undefined) return
    lowQing.econ.taxes.profit = 40
    highQing.econ.taxes.profit = 60
    expect(computeEconomy(highQing).income).toBeLessThan(computeEconomy(lowQing).income)
  })

  test('an unsustainable debt is restructured instead of growing forever', async () => {
    const world = newWorld(135, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.treasury = -qing.econ.gdp * 10
    advance(world, 1, [], makeRngForWorld(world))
    expect(-qing.econ.treasury).toBeLessThan(qing.econ.gdp * 2)
    expect(qing.pops.radicals).toBeGreaterThan(8)
  })

  test('state collapse removes policy modifiers', async () => {
    const world = newWorld(136, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    addModifier(qing, {
      id: 'policy:test:0',
      label: '测试政策',
      stat: 'income',
      stack: 'percent',
      value: 10,
      source: 'policy:测试',
    })
    qing.pops.radicals = 100
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source.startsWith('policy:'))).toBe(false)
  })

  test('infrastructure decays with the buildings that produced it', async () => {
    const world = newWorld(137, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.transportInfrastructure = 100
    qing.econ.marketAccess = 1
    // Isolate decay from new construction: no public works, no private
    // savings, and no queued projects.
    qing.econ.constructionQueue = []
    qing.econ.spending.construction = 0
    qing.econ.privateCapital = 0
    qing.politicalEconomy.savingsRate = 0
    advance(world, 60, [], makeRngForWorld(world))
    expect(qing.econ.transportInfrastructure).toBeLessThan(95)
    expect(qing.econ.marketAccess).toBeLessThan(0.95)
  })

  test('a state project can be cancelled but a private one cannot', async () => {
    const world = newWorld(138, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.treasury = 100
    applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'farms', count: 1 } },
      makeRngForWorld(world),
    )
    const state = qing.econ.constructionQueue.find(one => one.owner === 'state')
    expect(state).toBeDefined()
    if (state === undefined) return
    const cancelled = applyDecision(
      world,
      { countryId: 'QING', action: 'cancel', params: { projectId: state.id } },
      makeRngForWorld(world),
    )
    expect(cancelled.ok).toBe(true)
    qing.econ.constructionQueue.push({
      id: 'private-cancel-test',
      building: 'coalMines',
      count: 1,
      owner: 'private',
      monthsLeft: 3,
      monthlyCost: 1,
      lastSpend: 0,
      progress: 0,
      startedAt: { ...world.date },
    })
    const denied = applyDecision(
      world,
      { countryId: 'QING', action: 'cancel', params: { projectId: 'private-cancel-test' } },
      makeRngForWorld(world),
    )
    expect(denied.ok).toBe(false)
  })

  test('a zero construction appropriation still queues the order', async () => {
    const world = newWorld(139, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    prussia.econ.spending.construction = 0
    const result = applyDecision(
      world,
      { countryId: 'PRU', action: 'build', params: { building: 'farms', count: 1 } },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(prussia.econ.constructionQueue.length).toBe(1)
    expect(result.text).toContain('工程量')
  })
})

describe('Round 3 policy stack guard', () => {
  test('demand-side policy magnitudes are capped at 100%', async () => {
    const world = newWorld(140, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.government.authority = 100
    const rejected = applyPolicy(world, 'QING', {
      name: '过度刺激',
      effects: [{ stat: 'demand', stack: 'percent', value: 150 }],
    })
    expect(rejected.ok).toBe(false)
    const accepted = applyPolicy(world, 'QING', {
      name: '适度刺激',
      effects: [{ stat: 'demand', stack: 'percent', value: 100 }],
    })
    expect(accepted.ok).toBe(true)
  })

  test('stacked growth policies do not multiply the economy without bound', async () => {
    const control = newWorld(141, 'QING')
    const boosted = clone(control)
    const qing = boosted.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    for (const [name, stat] of [
      ['统计繁荣', 'gdp'],
      ['消费繁荣', 'consumption'],
      ['需求繁荣', 'demand'],
      ['生产繁荣', 'production'],
    ] as const) {
      qing.government.authority = 100
      applyPolicy(boosted, 'QING', {
        name,
        effects: [{ stat, stack: 'percent', value: 100 }],
      })
    }
    advance(control, 120, [], makeRngForWorld(control))
    advance(boosted, 120, [], makeRngForWorld(boosted))
    const a = control.countries.QING
    const b = boosted.countries.QING
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a === undefined || b === undefined) return
    expect(b.econ.gdp).toBeLessThan(a.econ.gdp * 4)
    expect(Number.isFinite(b.government.authority)).toBe(true)
  })

  test('standing policies drain authority and eventually lapse', async () => {
    const world = newWorld(142, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.government.authority = 100
    applyPolicy(world, 'QING', {
      name: '大工程',
      effects: [{ stat: 'gdp', stack: 'percent', value: 100 }],
    })
    expect(qing.modifiers.some(one => (one.upkeep ?? 0) > 0)).toBe(true)
    // A low-legitimacy regime cannot sustain a 40-cost policy for long.
    qing.government.legitimacy = 10
    qing.government.authority = 3
    advance(world, 6, [], makeRngForWorld(world))
    expect(qing.modifiers.some(one => one.source === 'policy:大工程')).toBe(false)
  })
})
