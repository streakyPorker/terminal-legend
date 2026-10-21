import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_IDS, GOOD_IDS, makeRngForWorld } from '../engine/data'
import {
  advance,
  clone,
  computeEconomy,
  finalConsumptionBase,
  inspectEconomy,
  newWorld,
} from '../engine/sim'
import {
  collectionEfficiency,
  LAND_VALUE_PER_UNIT,
  taxBaseRevenues,
  taxCompliance,
} from '../engine/fiscal'
import { addModifier } from '../engine/modifiers'
import type { Country } from '../types'

const near = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}

const qingOf = (world: ReturnType<typeof newWorld>): Country => {
  const qing = world.countries.QING
  if (qing === undefined) throw new Error('no QING')
  return qing
}

describe('four tax bases (ADR 0023)', () => {
  test('the land base is the farmland endowment × the land-value constant', async () => {
    const qing = qingOf(newWorld(201, 'QING'))
    const snap = computeEconomy(qing)
    near(snap.taxBaseQty.land, qing.econ.resources.farmland * LAND_VALUE_PER_UNIT)
  })

  test('the profit base is the positive per-building profit summed, kept by type', async () => {
    const qing = qingOf(newWorld(202, 'QING'))
    const snap = computeEconomy(qing)
    let expected = 0
    const contributing: string[] = []
    for (const id of BUILDING_IDS) {
      const profit = Math.max(0, snap.buildingProfits[id].profit)
      expected += profit
      if (profit > 0) contributing.push(id)
    }
    near(snap.taxBaseQty.profit, expected)
    // The per-type contributions are retained for inspection.
    expect(contributing.length).toBeGreaterThan(0)
    expect(snap.buildingProfits.farms.profit).toBeGreaterThan(0)
  })

  test('the consumption base uses final consumption only, never intermediate demand', async () => {
    const qing = qingOf(newWorld(203, 'QING'))
    const base = clone(qing)
    const finalBase = computeEconomy(base).taxBaseQty.consumption
    expect(finalBase).toBeGreaterThan(0)
    // Final consumer spending is a strict subset of valued demand: the
    // intermediate and investment blocks are excluded.
    const totalDemand = GOOD_IDS.reduce(
      (sum, id) => sum + inspectEconomy(base).demand[id] * base.econ.prices[id],
      0,
    )
    expect(finalBase).toBeLessThan(totalDemand)
    // Two identical clones: computeEconomy's own value matches the standalone
    // helper, both reading the same starting prices.
    near(computeEconomy(clone(qing)).taxBaseQty.consumption, finalConsumptionBase(clone(qing)))

    // Inflating an intermediate-only good cannot move the consumption base.
    const industrial = clone(qing)
    addModifier(industrial, {
      id: 'test-coal-demand',
      label: '煤炭需求',
      stat: 'coalDemand',
      stack: 'percent',
      value: 300,
      source: 'test',
    })
    expect(inspectEconomy(industrial).demand.coal).toBeGreaterThan(
      inspectEconomy(base).demand.coal,
    )
    near(computeEconomy(industrial).taxBaseQty.consumption, finalBase)
  })

  test('each internal base revenue is base × rate/100 × collection × compliance', async () => {
    const qing = qingOf(newWorld(204, 'QING'))
    const collection = collectionEfficiency(qing)
    const revenues = taxBaseRevenues(qing, qing.econ.lastTariffRevenue)
    for (const base of ['land', 'profit', 'consumption'] as const) {
      const rate = qing.econ.taxes[base]
      near(
        revenues[base],
        (qing.econ.taxBaseQty[base] * rate) / 100 * collection * taxCompliance(rate),
      )
    }
  })

  test('changing one base rate changes only that base revenue', async () => {
    const qing = qingOf(newWorld(205, 'QING'))
    const before = taxBaseRevenues(qing, qing.econ.lastTariffRevenue)
    const lifted = clone(qing)
    lifted.econ.taxes.profit += 10
    const after = taxBaseRevenues(lifted, lifted.econ.lastTariffRevenue)
    expect(after.profit).toBeGreaterThan(before.profit)
    near(after.land, before.land)
    near(after.consumption, before.consumption)
    near(after.tariff, before.tariff)
  })

  test('the tariff base tracks the existing duty', async () => {
    const qing = qingOf(newWorld(206, 'QING'))
    const duty = 12.5
    near(taxBaseRevenues(qing, duty).tariff, duty)
    near(taxBaseRevenues(qing, duty * 2).tariff, duty * 2)
    // A settled month reports exactly the collected duty.
    const world = newWorld(207, 'QING')
    advance(world, 2, [], makeRngForWorld(world))
    const settled = qingOf(world)
    const ledger = taxBaseRevenues(settled, settled.econ.lastTariffRevenue)
    near(ledger.tariff, settled.econ.lastTariffRevenue)
  })
})
