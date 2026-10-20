import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, computeEconomy, newWorld } from '../engine/sim'
import {
  debtRate,
  fiscalLedger,
  fundRate,
  nationalDebt,
  sovereignFund,
} from '../engine/fiscal'
import { statusLine } from '../view/format'
import type { Country } from '../types'

const sumParts = (parts: Record<string, number>): number =>
  Object.values(parts).reduce((sum, value) => sum + value, 0)

/** Recompute the stored month after changing net assets or rates. */
const settle = (country: Country): void => {
  const snap = computeEconomy(country)
  country.econ.income = snap.income
  country.econ.expense = snap.expense
  const rawIncome = sumParts(snap.revenue)
  const rawExpense = sumParts(snap.outlay)
  country.econ.lastFundIncome =
    rawIncome > 0 ? (snap.revenue.sovereignIncome * snap.income) / rawIncome : 0
  country.econ.lastDebtInterest =
    rawExpense > 0 ? (snap.outlay.debtInterest * snap.expense) / rawExpense : 0
}

describe('fiscal ledger', () => {
  test('income and expense components add up to the stored monthly totals', async () => {
    const world = newWorld(7, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    const ledger = fiscalLedger(qing)
    const incomeSum =
      ledger.income.taxes +
      ledger.income.tariffs +
      ledger.income.ports +
      ledger.income.sovereignIncome +
      ledger.income.reparations
    const expenseSum =
      ledger.expense.army +
      ledger.expense.navy +
      ledger.expense.administration +
      ledger.expense.education +
      ledger.expense.welfare +
      ledger.expense.debtInterest +
      ledger.expense.marketLoss +
      ledger.expense.upkeep +
      ledger.expense.reparations +
      ledger.expense.construction

    expect(Math.abs(incomeSum - qing.econ.income)).toBeLessThan(1e-9)
    expect(Math.abs(expenseSum - qing.econ.expense)).toBeLessThan(1e-9)
    expect(ledger.income.total).toBe(qing.econ.income)
    expect(ledger.expense.total).toBe(qing.econ.expense)
    expect(ledger.net).toBe(qing.econ.income - qing.econ.expense)
    expect(ledger.tradeGap).toBe(qing.econ.lastTradeDebt)
    expect(ledger.income.sovereignIncome).toBe(qing.econ.lastFundIncome)
    expect(ledger.expense.debtInterest).toBe(qing.econ.lastDebtInterest)
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

  test('a positive balance earns the sovereign-fund rate and pays no debt interest', async () => {
    const world = newWorld(12, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.treasury = 100
    settle(qing)
    const ledger = fiscalLedger(qing)
    expect(sovereignFund(qing)).toBe(100)
    expect(nationalDebt(qing)).toBe(0)
    expect(ledger.fund).toBe(100)
    expect(ledger.debt).toBe(0)
    expect(ledger.income.sovereignIncome).toBeGreaterThan(0)
    expect(ledger.expense.debtInterest).toBe(0)
    expect(ledger.fundRate).toBeGreaterThan(0)
  })

  test('a negative balance is national debt and pays interest as an expense', async () => {
    const world = newWorld(13, 'FRA')
    const fra = world.countries.FRA
    expect(fra).toBeDefined()
    if (fra === undefined) return
    fra.econ.treasury = -100
    settle(fra)
    const ledger = fiscalLedger(fra)
    expect(nationalDebt(fra)).toBe(100)
    expect(sovereignFund(fra)).toBe(0)
    expect(ledger.debt).toBe(100)
    expect(ledger.expense.debtInterest).toBeGreaterThan(0)
    expect(ledger.income.sovereignIncome).toBe(0)
    expect(ledger.debtRate).toBeGreaterThan(0)
  })

  test('war and a weak mandate raise the debt rate; war lowers the fund rate', async () => {
    const world = newWorld(14, 'AUS')
    const aus = world.countries.AUS
    expect(aus).toBeDefined()
    if (aus === undefined) return
    const baseDebt = debtRate(aus, { atWar: false, tick: 0 })
    const baseFund = fundRate(aus, { atWar: false, tick: 0 })
    aus.government.legitimacy = 10
    aus.diplo.prestige = 0
    const weakDebt = debtRate(aus, { atWar: true, tick: 0 })
    const warFund = fundRate(aus, { atWar: true, tick: 0 })
    expect(weakDebt).toBeGreaterThan(baseDebt)
    expect(warFund).toBeLessThan(baseFund)
  })

  test('the expense modifier is applied once, not twice', async () => {
    const world = newWorld(15, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    const base = computeEconomy(gbr).expense
    gbr.modifiers.push({
      id: 'test-expense',
      label: '测试支出修正',
      stat: 'expense',
      stack: 'percent',
      value: 50,
      source: 'test',
    })
    const lifted = computeEconomy(gbr).expense
    expect(lifted / base).toBeGreaterThan(1.45)
    expect(lifted / base).toBeLessThan(1.55)
  })

  test('the status line shows net assets, both sides and the debt/fund split', async () => {
    const world = newWorld(3, 'QING')
    const line = statusLine(world)
    expect(line).toContain('国库')
    expect(line).toContain('收')
    expect(line).toContain('支')
    expect(line).toContain('GDP')
    expect(line.includes('国债') || line.includes('基金')).toBe(true)
  })
})
