import { describe, expect, test } from 'claude-code/testing'
import { GOODS, GOOD_IDS, makeRngForWorld } from '../engine/data'
import { advance, clone, computeEconomy, inspectEconomy, newWorld } from '../engine/sim'
import {
  applyCapacity,
  applyPaymentCapacity,
  clearTrade,
  deriveResourceImports,
  effectiveResources,
  importCapacity,
  MAX_MONTHLY_DEFICIT_SHARE,
  paymentCapacity,
  settleTrade,
  TRADABLE_GOODS,
  type MarketSnapshot,
} from '../engine/trade'
import type { Country, GoodId, TradeFlow, WorldState } from '../types'

const zeroRecord = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const market = (
  production: Partial<Record<GoodId, number>>,
  demand: Partial<Record<GoodId, number>>,
): MarketSnapshot => {
  const prod = zeroRecord()
  const dem = zeroRecord()
  for (const [id, value] of Object.entries(production)) prod[id as GoodId] = value as number
  for (const [id, value] of Object.entries(demand)) dem[id as GoodId] = value as number
  return { production: prod, demand: dem }
}

const marketsFor = (
  world: WorldState,
  build: (id: string) => {
    production: Partial<Record<GoodId, number>>
    demand: Partial<Record<GoodId, number>>
  },
): Record<string, MarketSnapshot> => {
  const out: Record<string, MarketSnapshot> = {}
  for (const country of Object.values(world.countries)) {
    const row = build(country.id)
    out[country.id] = market(row.production, row.demand)
  }
  return out
}

const flow = (input: {
  good: GoodId
  from: string
  to: string
  quantity: number
  unitPrice: number
  landedPrice?: number
}): TradeFlow => ({
  good: input.good,
  from: input.from,
  to: input.to,
  quantity: input.quantity,
  unitPrice: input.unitPrice,
  landedPrice: input.landedPrice ?? input.unitPrice,
  tariffPaid: 0,
  value: input.quantity * input.unitPrice,
})

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  expect(country).toBeDefined()
  if (country === undefined) throw new Error(`missing country ${id}`)
  return country
}

describe('T1b gold settlement (plan §2.4)', () => {
  test('per-country and global gold is conserved after clearing', async () => {
    const world = newWorld(7001, 'QING')
    advance(world, 12, [], makeRngForWorld(world))
    let globalImports = 0
    let globalExports = 0
    let globalTariffs = 0
    let flowTariffs = 0
    for (const country of Object.values(world.countries)) {
      const importBill = country.trade.imports.reduce(
        (sum, one) => sum + one.quantity * one.unitPrice,
        0,
      )
      const exportRevenue = country.trade.exports.reduce(
        (sum, one) => sum + one.quantity * one.unitPrice,
        0,
      )
      const tariffRevenue = country.trade.imports.reduce(
        (sum, one) => sum + one.quantity * one.unitPrice * (country.econ.tariff / 100),
        0,
      )
      expect(Math.abs(country.econ.lastImportBill - importBill)).toBeLessThan(1e-6)
      expect(Math.abs(country.econ.lastExportRevenue - exportRevenue)).toBeLessThan(1e-6)
      expect(Math.abs(country.econ.lastTariffRevenue - tariffRevenue)).toBeLessThan(1e-6)
      expect(Math.abs(country.trade.tariffRevenue - tariffRevenue)).toBeLessThan(1e-6)
      expect(
        Math.abs(country.econ.lastTradeBalance - (exportRevenue - importBill)),
      ).toBeLessThan(1e-6)
      for (const one of country.trade.imports) {
        flowTariffs += one.quantity * one.unitPrice * (country.econ.tariff / 100)
      }
      globalImports += importBill
      globalExports += exportRevenue
      globalTariffs += tariffRevenue
    }
    // Σ importBill === Σ exportRevenue, and tariff equals the per-flow formula.
    expect(Math.abs(globalImports - globalExports)).toBeLessThan(1e-6)
    expect(Math.abs(globalTariffs - flowTariffs)).toBeLessThan(1e-6)
  })

  test('the private-sector cash identity holds and transport friction is never gold', async () => {
    const world = newWorld(7002, 'QING')
    const qing = clone(countryOf(world, 'QING'))
    qing.econ.privateCapital = 0
    qing.econ.debt = 0
    qing.econ.tariff = 10
    qing.econ.gdp = 1000
    qing.econ.restructuredUntilTick = 0
    const flows = [
      flow({ good: 'coal', from: 'GBR', to: 'QING', quantity: 10, unitPrice: 5, landedPrice: 8 }),
      flow({ good: 'grain', from: 'QING', to: 'FRA', quantity: 4, unitPrice: 5 }),
    ]
    const settlement = settleTrade(qing, flows, 0)
    expect(Math.abs(settlement.importBill - 50)).toBeLessThan(1e-6)
    expect(Math.abs(settlement.exportRevenue - 20)).toBeLessThan(1e-6)
    expect(Math.abs(settlement.tariffRevenue - 5)).toBeLessThan(1e-6)
    expect(settlement.drawnFromCapital).toBe(0)
    expect(Math.abs(settlement.debtIncrease - 35)).toBeLessThan(1e-6)
    // The landed (8) price is a ranking artefact: no gold account reads it.
    expect(Math.abs(settlement.importBill - 80)).toBeGreaterThan(1)
    const identity =
      settlement.drawnFromCapital +
      settlement.debtIncrease +
      settlement.exportRevenue
    expect(
      Math.abs(identity - (settlement.importBill + settlement.tariffRevenue)),
    ).toBeLessThan(1e-6)
  })

  test('a drained treasury finances the deficit from capital then debt', async () => {
    const world = newWorld(7003, 'QING')
    const qing = clone(countryOf(world, 'QING'))
    qing.econ.privateCapital = 12
    qing.econ.debt = 0
    qing.econ.tariff = 0
    qing.econ.gdp = 5000
    qing.econ.restructuredUntilTick = 0
    const flows = [
      flow({ good: 'opium', from: 'GBR', to: 'QING', quantity: 20, unitPrice: 4 }),
    ]
    const settlement = settleTrade(qing, flows, 0)
    expect(Math.abs(settlement.drawnFromCapital - 12)).toBeLessThan(1e-6)
    expect(Math.abs(settlement.debtIncrease - 68)).toBeLessThan(1e-6)
  })

  test('tariff revenue is the formula and reaches the treasury through income', async () => {
    const world = newWorld(7004, 'QING')
    const qing = countryOf(world, 'QING')
    const base = computeEconomy(clone(qing)).income
    const lifted = computeEconomy(clone(qing), { tariffRevenue: 7.5 }).income
    expect(Math.abs(lifted - base - 7.5)).toBeLessThan(1e-6)
    advance(world, 6, [], makeRngForWorld(world))
    for (const country of Object.values(world.countries)) {
      const formula = country.trade.imports.reduce(
        (sum, one) => sum + one.quantity * one.unitPrice * (country.econ.tariff / 100),
        0,
      )
      expect(Math.abs(country.econ.lastTariffRevenue - formula)).toBeLessThan(1e-6)
      expect(Math.abs(country.trade.tariffRevenue - formula)).toBeLessThan(1e-6)
      expect(Number.isFinite(country.econ.treasury)).toBe(true)
    }
  })
})

describe('T1b soft import capacity (plan §2.3)', () => {
  test('the capacity formula matches ports, access and transport', async () => {
    const world = newWorld(7005, 'QING')
    const qing = countryOf(world, 'QING')
    const expected =
      50 +
      qing.econ.buildings.ports * 8 +
      qing.econ.marketAccess * 200 +
      qing.econ.transportInfrastructure * 1
    expect(Math.abs(importCapacity(qing, 1) - expected)).toBeLessThan(1e-9)
  })

  test('a binding capacity scales every import flow by the same factor', async () => {
    const world = newWorld(7006, 'QING')
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const markets = marketsFor(world, id => ({
      production: id === 'QING' ? {} : { coal: 100 },
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const countries = Object.values(world.countries)
    const balance = clearTrade(countries, markets)
    const before = balance.flows
      .filter(one => one.to === 'QING' && one.good === 'coal')
      .reduce((sum, one) => sum + one.quantity * one.unitPrice, 0)
    const capacity = importCapacity(countryOf(world, 'QING'), 1)
    expect(before).toBeGreaterThan(capacity)

    const capacities = applyCapacity(countries, balance, 1)
    const cut = balance.flows.filter(one => one.to === 'QING' && one.good === 'coal')
    const after = cut.reduce((sum, one) => sum + one.quantity * one.unitPrice, 0)
    expect(after).toBeLessThanOrEqual(capacity + 1e-6)
    expect(Math.abs(after - capacity)).toBeLessThan(1e-6)
    const factor = capacity / before
    for (const one of cut) expect(Math.abs(one.quantity - 100 * factor)).toBeLessThan(1e-6)
    // An exporter's mirrored flow shrinks identically: the flow object is shared.
    for (const one of cut) {
      const exportedQty = balance.exportQty[one.from]?.coal ?? 0
      expect(Math.abs(exportedQty - one.quantity)).toBeLessThan(1e-6)
    }
    expect(Math.abs((capacities.QING ?? 0) - capacity)).toBeLessThan(1e-6)
    // Capacity is stored on every country, binding or not.
    expect(Object.values(capacities).every(value => value > 0)).toBe(true)
  })

  test('post-default restructuring halves capacity and caps new external debt', async () => {
    const world = newWorld(7007, 'QING')
    const qing = clone(countryOf(world, 'QING'))
    qing.econ.restructuredUntilTick = 10
    const base = importCapacity(qing, 11)
    expect(Math.abs(importCapacity(qing, 5) - base * 0.5)).toBeLessThan(1e-9)
    expect(Math.abs(importCapacity(qing, 10) - base * 0.5)).toBeLessThan(1e-9)

    qing.econ.privateCapital = 0
    qing.econ.debt = 0
    qing.econ.tariff = 0
    qing.econ.gdp = 1000
    const flows = [
      flow({ good: 'opium', from: 'GBR', to: 'QING', quantity: 100, unitPrice: 10 }),
    ]
    const settlement = settleTrade(qing, flows, 5)
    expect(Math.abs(settlement.debtIncrease - 200)).toBeLessThan(1e-6)
    expect(Math.abs(settlement.dropped - 800)).toBeLessThan(1e-6)
    const withDropped =
      settlement.drawnFromCapital +
      settlement.debtIncrease +
      settlement.dropped +
      settlement.exportRevenue
    expect(
      Math.abs(withDropped - (settlement.importBill + settlement.tariffRevenue)),
    ).toBeLessThan(1e-6)
  })

  test('a debt restructuring records the post-default window', async () => {
    const world = newWorld(7008, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.debt = qing.econ.gdp * 10
    qing.econ.treasury = 0
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.econ.restructuredUntilTick).toBe(world.tick + 12)
    const base = importCapacity(qing, qing.econ.restructuredUntilTick + 1)
    expect(Math.abs(importCapacity(qing, world.tick) - base * 0.5)).toBeLessThan(1e-9)
  })
})

describe('T1b payment capacity (plan §10)', () => {
  test('the payment-capacity formula sums export revenue, private capital and a GDP share', async () => {
    const world = newWorld(7013, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 40
    qing.econ.gdp = 1000
    const expected = 15 + 40 + 1000 * MAX_MONTHLY_DEFICIT_SHARE
    expect(Math.abs(paymentCapacity(qing, 15) - expected)).toBeLessThan(1e-9)
    // A negative private pool cannot subtract from capacity.
    qing.econ.privateCapital = -5
    expect(Math.abs(paymentCapacity(qing, 0) - 1000 * MAX_MONTHLY_DEFICIT_SHARE)).toBeLessThan(
      1e-9,
    )
  })

  test('a binding payment cut scales every import flow by the same factor', async () => {
    const world = newWorld(7014, 'QING')
    const qing = countryOf(world, 'QING')
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const markets = marketsFor(world, id => ({
      production: id === 'QING' ? {} : { coal: 100 },
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const countries = Object.values(world.countries)
    const balance = clearTrade(countries, markets)
    const before = balance.flows
      .filter(one => one.to === 'QING' && one.good === 'coal')
      .reduce((sum, one) => sum + one.quantity * one.unitPrice, 0)
    // QING exports nothing here, so its capacity is its private pool alone.
    qing.econ.privateCapital = 10
    qing.econ.gdp = 0
    expect(before).toBeGreaterThan(10)

    const capacities = applyPaymentCapacity(countries, balance)
    const cut = balance.flows.filter(one => one.to === 'QING' && one.good === 'coal')
    const after = cut.reduce((sum, one) => sum + one.quantity * one.unitPrice, 0)
    expect(Math.abs(after - 10)).toBeLessThan(1e-6)
    const factor = 10 / before
    for (const one of cut) {
      expect(Math.abs(one.quantity - 100 * factor)).toBeLessThan(1e-6)
      // The shared flow keeps the exporter's mirror identical.
      expect(Math.abs((balance.exportQty[one.from]?.coal ?? 0) - one.quantity)).toBeLessThan(1e-6)
      // Re-derivation keeps value and tariff self-consistent after scaling.
      expect(Math.abs(one.value - one.quantity * one.unitPrice)).toBeLessThan(1e-6)
    }
    expect(Math.abs((capacities.QING ?? 0) - 10)).toBeLessThan(1e-6)
    expect(Object.values(capacities).every(value => value >= 0)).toBe(true)
  })

  test('gold conservation is exact after the soft and the payment cut', async () => {
    const world = newWorld(7015, 'QING')
    const qing = countryOf(world, 'QING')
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const markets = marketsFor(world, id => ({
      production: id === 'QING' ? {} : { coal: 100 },
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const countries = Object.values(world.countries)
    const balance = clearTrade(countries, markets)
    qing.econ.privateCapital = 10
    qing.econ.gdp = 0
    qing.econ.restructuredUntilTick = 0
    // Both limiters run in sequence and stay independent: soft capacity first,
    // then the payment cut.
    applyCapacity(countries, balance, 1)
    const paymentCaps = applyPaymentCapacity(countries, balance)
    let globalImports = 0
    let globalExports = 0
    for (const country of countries) {
      const settlement = settleTrade(country, balance.flows, 1)
      if (settlement.externalNet <= 0) {
        const identity =
          settlement.drawnFromCapital +
          settlement.debtIncrease +
          settlement.dropped +
          settlement.exportRevenue
        expect(
          Math.abs(identity - (settlement.importBill + settlement.tariffRevenue)),
        ).toBeLessThan(1e-6)
      } else {
        // A surplus country's external net is income, not a payment.
        expect(
          Math.abs(
            settlement.exportRevenue -
              (settlement.importBill + settlement.tariffRevenue) -
              settlement.externalNet,
          ),
        ).toBeLessThan(1e-6)
      }
      expect(settlement.importBill).toBeLessThanOrEqual((paymentCaps[country.id] ?? 0) + 1e-6)
      globalImports += settlement.importBill
      globalExports += settlement.exportRevenue
    }
    expect(Math.abs(globalImports - globalExports)).toBeLessThan(1e-6)
    for (const one of balance.flows) {
      expect(Math.abs(one.value - one.quantity * one.unitPrice)).toBeLessThan(1e-6)
    }
  })

  test('84 months with the payment cut keep QING external debt bounded', async () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    let peak = qing.econ.debt
    let debtAt60 = qing.econ.debt
    for (let month = 1; month <= 84; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      peak = Math.max(peak, qing.econ.debt)
      if (month === 60) debtAt60 = qing.econ.debt
    }
    // Without the cut the same seed climbed past 1200 and kept rising
    // (measured baseline); with it the curve peaks mid-century and falls back.
    expect(peak).toBeLessThan(1000)
    expect(qing.econ.debt).toBeLessThan(500)
    expect(qing.econ.debt).toBeLessThanOrEqual(debtAt60)
  })

  test('the calibrated opium gates hold every month of the 1839-1842 window', async () => {
    const world = newWorld(9100, 'QING')
    const qing = countryOf(world, 'QING')
    let months = 0
    for (let month = 1; month <= 84; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      if (month < 37) continue
      const imports = qing.trade.imports
        .filter(one => one.good === 'opium')
        .reduce((sum, one) => sum + one.quantity, 0)
      const fromGbr = qing.trade.imports
        .filter(one => one.good === 'opium' && one.from === 'GBR')
        .reduce((sum, one) => sum + one.quantity, 0)
      const production = inspectEconomy(qing).production.opium
      const share = fromGbr / (imports + production)
      // Plan §4.1: ≥2 units/month and ≥20% of consumption from Britain.
      expect(imports).toBeGreaterThanOrEqual(2)
      expect(share).toBeGreaterThanOrEqual(0.2)
      months += 1
    }
    expect(months).toBe(48)
  })
})

describe('T1b resource imports (plan §2.6)', () => {
  test('imports raise the effective endowment but never the base array', async () => {
    const world = newWorld(7009, 'QING')
    const qing = clone(countryOf(world, 'QING'))
    qing.econ.resources.coal = 40
    qing.econ.goods.coal = 100
    qing.econ.resourceImports = { farmland: 0, timber: 0, coal: 100, iron: 0 }
    const effective = effectiveResources(qing)
    expect(Math.abs(effective.coal - 50)).toBeLessThan(1e-6)
    expect(qing.econ.resources.coal).toBe(40)

    const withImports = computeEconomy(clone(qing)).production.coal
    const without = clone(qing)
    without.econ.resourceImports = { farmland: 0, timber: 0, coal: 0, iron: 0 }
    const baseline = computeEconomy(without).production.coal
    expect(withImports).toBeGreaterThan(baseline)
  })

  test('logging maps goods to resources and leaves farmland at zero', async () => {
    const flows = [
      flow({ good: 'coal', from: 'GBR', to: 'QING', quantity: 3, unitPrice: 1 }),
      flow({ good: 'iron', from: 'GBR', to: 'QING', quantity: 2, unitPrice: 1 }),
      flow({ good: 'wood', from: 'GBR', to: 'QING', quantity: 5, unitPrice: 1 }),
      flow({ good: 'grain', from: 'GBR', to: 'QING', quantity: 9, unitPrice: 1 }),
      flow({ good: 'coal', from: 'FRA', to: 'PRU', quantity: 4, unitPrice: 1 }),
    ]
    const imports = deriveResourceImports(flows, 'QING')
    expect(imports.coal).toBe(3)
    expect(imports.iron).toBe(2)
    expect(imports.timber).toBe(5)
    expect(imports.farmland).toBe(0)
  })

  test('60 months of imports never write back into econ.resources', async () => {
    const world = newWorld(7010, 'QING')
    const initial = clone(
      Object.fromEntries(
        Object.entries(world.countries).map(([id, country]) => [
          id,
          country.econ.resources,
        ]),
      ),
    )
    let sawImports = false
    for (let month = 0; month < 60; month += 1) {
      advance(world, 1, [], makeRngForWorld(world))
      for (const country of Object.values(world.countries)) {
        const sum =
          country.econ.resourceImports.coal +
          country.econ.resourceImports.iron +
          country.econ.resourceImports.timber
        if (sum > 0) sawImports = true
      }
    }
    expect(sawImports).toBe(true)
    for (const [id, resources] of Object.entries(initial)) {
      expect(world.countries[id]?.econ.resources).toEqual(resources)
    }
  })
})

describe('T1b baseline and determinism', () => {
  test('60 months stay finite and deterministic', async () => {
    const left = newWorld(7011, 'QING')
    const right = newWorld(7011, 'QING')
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    for (const id of Object.keys(left.countries)) {
      const a = left.countries[id]
      const b = right.countries[id]
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      if (a === undefined || b === undefined) continue
      expect(a.trade).toEqual(b.trade)
      expect(a.econ.resourceImports).toEqual(b.econ.resourceImports)
      for (const value of [
        a.econ.lastImportBill,
        a.econ.lastExportRevenue,
        a.econ.lastTariffRevenue,
        a.econ.lastTradeBalance,
        a.trade.capacity,
        a.econ.debt,
        a.econ.privateCapital,
      ]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(a.trade.capacity).toBeGreaterThan(0)
    }
  })

  test('the tradable set and base prices still anchor the gold accounts', async () => {
    const world = newWorld(7012, 'QING')
    advance(world, 6, [], makeRngForWorld(world))
    expect(TRADABLE_GOODS).not.toContain('services')
    for (const country of Object.values(world.countries)) {
      for (const one of country.trade.imports) {
        expect(Number.isFinite(one.tariffPaid)).toBe(true)
        expect(Math.abs(one.tariffPaid - one.quantity * one.unitPrice * (country.econ.tariff / 100))).toBeLessThan(1e-6)
        expect(Math.abs(one.value - one.quantity * one.unitPrice)).toBeLessThan(1e-6)
      }
      // NX is a base-price book value, not a gold account.
      const base = country.trade.imports.reduce(
        (sum, one) => sum + one.quantity * GOODS[one.good].basePrice,
        0,
      )
      expect(Number.isFinite(base)).toBe(true)
    }
  })
})
