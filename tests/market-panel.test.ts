import { describe, expect, test } from 'claude-code/testing'
import { newWorld, inspectEconomy } from '../engine/sim'
import { marketRows } from '../view/panels/market'

/**
 * PT-057: the market pane judged 短缺/盈余 on domestic output alone, so coal and
 * iron showed 短缺 while the imported cargo was already counted by the price
 * engine (and by `v3_inspect market` after PT-040). The pane now judges on
 * effective supply = output + imports − exports.
 */
describe('market pane basis (PT-057)', () => {
  test('a domestically short good covered by imports reads 平衡', async () => {
    const world = newWorld(31, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const snapshot = inspectEconomy(qing)
    const rows = marketRows(qing, snapshot)
    const before = rows.find(row => row.id === 'coal')
    expect(before).toBeDefined()
    if (before === undefined) return
    // The Qing seed is coal-short on domestic output alone.
    expect(before.state).toBe('短缺')
    const gap = Math.max(0, before.demand - before.supply) + 1
    qing.trade.imports.push({
      good: 'coal',
      from: 'PRU',
      to: 'QING',
      quantity: gap,
      unitPrice: 0,
      landedPrice: 0,
      tariffPaid: 0,
      exportDuty: 0,
      value: 0,
    })
    const after = marketRows(qing, inspectEconomy(qing)).find(row => row.id === 'coal')
    expect(after).toBeDefined()
    if (after === undefined) return
    expect(after.imports).toBe(gap)
    expect(after.supply).toBeGreaterThan(before.supply)
    expect(after.state).not.toBe('短缺')
  })

  test('exports are subtracted from effective supply', async () => {
    const world = newWorld(32, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const before = marketRows(qing, inspectEconomy(qing)).find(row => row.id === 'grain')
    expect(before).toBeDefined()
    if (before === undefined) return
    qing.trade.exports.push({
      good: 'grain',
      from: 'QING',
      to: 'GBR',
      quantity: 10,
      unitPrice: 0,
      landedPrice: 0,
      tariffPaid: 0,
      exportDuty: 0,
      value: 0,
    })
    const after = marketRows(qing, inspectEconomy(qing)).find(row => row.id === 'grain')
    expect(after).toBeDefined()
    if (after === undefined) return
    expect(after.exports).toBe(10)
    expect(after.supply).toBe(before.supply - 10)
  })
})
