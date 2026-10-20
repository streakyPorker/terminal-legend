import type { Country } from '../types'
import { applyModifiers } from './modifiers'

/**
 * The treasury's monthly cash account, split by source and by category.
 *
 * GDP is output valued at base prices; the treasury only ever sees the tax
 * wedge on that output plus tariffs and port dues. Keeping the two ledgers
 * separate is the point of this module: a big GDP with a thin tax take is a
 * perfectly ordinary state of affairs.
 */

/** Raw monthly revenue by source, before the `income` modifier. */
export type IncomeParts = {
  /** Land/income tax collected off GDP at the current rate. */
  taxes: number
  /** Tariff on this month's imports (plan 0004 §2.4). */
  tariffs: number
  /** Port dues. */
  ports: number
}

/** Raw monthly expense by category, before the `expense` modifier. */
export type ExpenseParts = {
  army: number
  navy: number
  administration: number
  education: number
  welfare: number
  debtInterest: number
  marketLoss: number
  upkeep: number
}

export type FiscalLedger = {
  /** Output this month, for the "GDP ≠ budget" comparison. */
  gdp: number
  income: IncomeParts & { total: number }
  expense: ExpenseParts & {
    /** State construction paid out of the treasury this month. */
    construction: number
    total: number
  }
  /** Principal repaid from the treasury (not an expense; a balance-sheet item). */
  debtRepayment: number
  /** income − expense − debtRepayment. */
  net: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function taxEfficiency(country: Country): number {
  return applyModifiers(
    country,
    'taxEfficiency',
    0.5 + country.government.legitimacy / 200,
  )
}

/** Beyond 25% the tax base erodes (evasion, flight, informal work). */
export function taxCompliance(country: Country): number {
  return country.econ.taxRate <= 25
    ? 1
    : clamp(1 - (country.econ.taxRate - 25) * 0.015, 0.45, 1)
}

export function incomeParts(
  country: Country,
  gdp: number,
  tariffRevenue: number,
): IncomeParts {
  return {
    taxes:
      gdp *
      (country.econ.taxRate / 100) *
      0.45 *
      taxEfficiency(country) *
      taxCompliance(country),
    tariffs: tariffRevenue,
    ports: country.econ.buildings.ports * 0.02,
  }
}

export function expenseParts(country: Country, gdp: number): ExpenseParts {
  const b = country.econ.buildings
  const sp = country.econ.spending
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  return {
    army:
      country.military.army * 0.05 * (1 + country.military.quality) + sp.army * 0.5,
    navy: country.military.navy * 0.04 + sp.navy * 0.5,
    administration: popFactor * 0.12 + sp.bureaucracy * popFactor * 0.02,
    education: sp.education * popFactor * 0.03,
    welfare: sp.welfare * popFactor * 0.03,
    debtInterest: country.econ.debt * 0.004,
    marketLoss:
      gdp *
      (1 - applyModifiers(country, 'marketAccess', country.econ.marketAccess)) *
      0.02,
    upkeep: (b.universities + b.barracks) * 0.01,
  }
}

const total = (parts: Record<string, number>): number =>
  Object.values(parts).reduce((sum, value) => sum + value, 0)

/**
 * Reads the last settled month back out of the stored totals. The raw parts
 * are recomputed with the same helpers `computeEconomy` uses, then scaled so
 * the composition adds up exactly to `econ.income` / `econ.expense` (which
 * already carry the `income` / `expense` modifiers and construction spending).
 */
export function fiscalLedger(country: Country): FiscalLedger {
  const econ = country.econ
  const rawIncome = incomeParts(country, econ.gdp, econ.lastTariffRevenue)
  const rawIncomeTotal = total(rawIncome)
  const incomeFactor = rawIncomeTotal > 0 ? econ.income / rawIncomeTotal : 1

  const rawExpense = expenseParts(country, econ.gdp)
  const rawExpenseTotal = total(rawExpense)
  const construction = Math.max(0, econ.lastStateConstructionSpend)
  const operatingExpense = Math.max(0, econ.expense - construction)
  const expenseFactor = rawExpenseTotal > 0 ? operatingExpense / rawExpenseTotal : 1

  return {
    gdp: econ.gdp,
    income: {
      taxes: rawIncome.taxes * incomeFactor,
      tariffs: rawIncome.tariffs * incomeFactor,
      ports: rawIncome.ports * incomeFactor,
      total: econ.income,
    },
    expense: {
      army: rawExpense.army * expenseFactor,
      navy: rawExpense.navy * expenseFactor,
      administration: rawExpense.administration * expenseFactor,
      education: rawExpense.education * expenseFactor,
      welfare: rawExpense.welfare * expenseFactor,
      debtInterest: rawExpense.debtInterest * expenseFactor,
      marketLoss: rawExpense.marketLoss * expenseFactor,
      upkeep: rawExpense.upkeep * expenseFactor,
      construction,
      total: econ.expense,
    },
    debtRepayment: econ.lastDebtRepayment,
    net: econ.income - econ.expense - econ.lastDebtRepayment,
  }
}
