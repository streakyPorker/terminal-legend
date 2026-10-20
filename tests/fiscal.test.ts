import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'
import { fiscalLedger } from '../engine/fiscal'
import { statusLine } from '../view/format'

describe('fiscal ledger', () => {
  test('income and expense components add up to the stored monthly totals', async () => {
    const world = newWorld(7, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const ledger = fiscalLedger(qing)
    const incomeSum =
      ledger.income.taxes + ledger.income.tariffs + ledger.income.ports
    const expenseSum =
      ledger.expense.army +
      ledger.expense.navy +
      ledger.expense.administration +
      ledger.expense.education +
      ledger.expense.welfare +
      ledger.expense.debtInterest +
      ledger.expense.marketLoss +
      ledger.expense.upkeep +
      ledger.expense.construction

    expect(Math.abs(incomeSum - qing.econ.income)).toBeLessThan(1e-9)
    expect(Math.abs(expenseSum - qing.econ.expense)).toBeLessThan(1e-9)
    expect(ledger.income.total).toBe(qing.econ.income)
    expect(ledger.expense.total).toBe(qing.econ.expense)
    expect(ledger.debtRepayment).toBe(qing.econ.lastDebtRepayment)
    expect(
      Math.abs(
        ledger.net -
          (qing.econ.income - qing.econ.expense - qing.econ.lastDebtRepayment),
      ),
    ).toBeLessThan(1e-9)
  })

  test('the tax take is a share of GDP, not the whole output', async () => {
    const world = newWorld(11, 'FRA')
    const ledger = fiscalLedger(world.countries.FRA)
    expect(ledger.gdp).toBeGreaterThan(0)
    expect(ledger.income.taxes).toBeGreaterThan(0)
    expect(ledger.income.taxes / ledger.gdp).toBeLessThan(0.5)
    // The treasury account and the output account are deliberately different.
    expect(ledger.income.total).not.toBe(ledger.gdp)
  })

  test('the status line now carries both sides of the account', async () => {
    const world = newWorld(3, 'QING')
    const line = statusLine(world)
    expect(line).toContain('国库')
    expect(line).toContain('收')
    expect(line).toContain('支')
    expect(line).toContain('GDP')
  })
})
