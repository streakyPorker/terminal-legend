import { describe, expect, test } from 'claude-code/testing'
import { fiscalLedger } from '../engine/fiscal'
import { computeEconomy } from '../engine/economy'
import { newWorld } from '../engine/sim'

/**
 * PT-065: a scheduled transfer is a contractual payment. An `income` modifier
 * (「理财有方 +40%」) must not inflate it — otherwise a 3.23/month loan books
 * as 4.4 and the panel disagrees with the contract.
 */
describe('transfers are not scaled by income modifiers (PT-065)', () => {
  test('income = modifier × domestic parts + transfer at face value', () => {
    const world = newWorld(65, 'QING')
    const qing = world.countries.QING
    if (qing === undefined) throw new Error('missing QING')
    qing.econ.reparationsReceived = 10
    qing.modifiers = [
      {
        id: 'test:income',
        label: '测试收入',
        stat: 'income',
        stack: 'percent',
        value: 50,
        source: 'test',
      },
    ]
    const snap = computeEconomy(qing)
    const withoutTransfer = computeEconomy({ ...qing, econ: { ...qing.econ, reparationsReceived: 0 } })
    const delta = snap.income - withoutTransfer.income
    // Before the fix this delta was the full 1.5× (15). It must now be at
    // least face value and well short of the modifier's full uplift.
    expect(delta).toBeGreaterThanOrEqual(10)
    expect(delta).toBeLessThan(10 * 1.5)
  })

  test('the ledger reports the transfer at its booked amount', () => {
    const world = newWorld(66, 'QING')
    const qing = world.countries.QING
    if (qing === undefined) throw new Error('missing QING')
    qing.econ.reparationsReceived = 3.23
    qing.econ.income = 100
    qing.econ.lastFundIncome = 0
    qing.modifiers = [
      {
        id: 'test:income',
        label: '测试收入',
        stat: 'income',
        stack: 'percent',
        value: 40,
        source: 'test',
      },
    ]
    const ledger = fiscalLedger(qing)
    expect(ledger.income.reparations).toBe(3.23)
  })
})
