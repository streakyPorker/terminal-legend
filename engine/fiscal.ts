import type { Country, TaxBaseId } from '../types'
import { applyModifiers } from './modifiers'

/**
 * The treasury's monthly cash account, split by source and by category.
 *
 * The treasury is a single signed net-assets balance: positive is the
 * sovereign fund, negative is national debt. There is no separate debt stock.
 * GDP is output valued at base prices; the treasury only ever sees the tax
 * wedge on that output, tariffs, port dues and the fund's interest.
 */

export type FiscalContext = {
  atWar: boolean
  tick: number
}

const DEFAULT_CONTEXT: FiscalContext = { atWar: false, tick: 0 }

/** National debt: the negative half of net assets. */
export const nationalDebt = (country: Country): number =>
  Math.max(0, -country.econ.treasury)

/**
 * Debt pressure is a smooth debuff, not a cliff. Below 25% debt/GDP the
 * state borrows at the base rate with no extra penalty; above it, income,
 * construction speed, legitimacy and the borrowing rate deteriorate
 * continuously until the 3× GDP restructuring floor (plan 0007 / ADR 0007).
 */
export const DEBT_PRESSURE_START = 0.25
export const DEBT_PRESSURE_FULL = 2

export type DebtPressure = {
  /** National debt ÷ GDP. */
  ratio: number
  /** 0 at the start threshold, 2 at (and above) twice GDP. */
  severity: number
  /** Fraction of income lost to debt service/crowding out (0..0.20). */
  incomePenalty: number
  /** Fraction of state construction speed lost (0..0.40). */
  constructionPenalty: number
  /** Points removed from the legitimacy target (0..10). */
  legitimacyPenalty: number
  /** Extra monthly interest rate (0..0.008). */
  interestSpread: number
  label: string
}

export function debtPressure(country: Country): DebtPressure {
  const debt = nationalDebt(country)
  const gdp = Math.max(1, country.econ.gdp)
  const ratio = debt / gdp
  const severity = clamp(
    (ratio - DEBT_PRESSURE_START) / (DEBT_PRESSURE_FULL - DEBT_PRESSURE_START),
    0,
    2,
  )
  const label =
    ratio < DEBT_PRESSURE_START
      ? '无'
      : ratio < 0.5
        ? '轻度'
        : ratio < 1
          ? '中度'
          : ratio < DEBT_PRESSURE_FULL
            ? '重度'
            : '危重'
  return {
    ratio,
    severity,
    incomePenalty: 0.1 * severity,
    constructionPenalty: 0.2 * severity,
    legitimacyPenalty: 5 * severity,
    interestSpread: 0.004 * severity,
    label,
  }
}

/** Sovereign fund: the positive half of net assets. */
export const sovereignFund = (country: Country): number =>
  Math.max(0, country.econ.treasury)

/** Raw monthly revenue by source, before the `income` modifier. */
export type IncomeParts = {
  /** Sum of the four real tax bases (ADR 0023); no longer a GDP share. */
  taxes: number
  /** Port dues. */
  ports: number
  /** Interest earned by a positive net-assets balance. */
  sovereignIncome: number
  /** Installment reparations received this month. */
  reparations: number
  /** Other receipts, e.g. renting idle construction points to the private sector. */
  other: number
}

/**
 * The four tax bases (ADR 0023). Revenue is computed per base and then summed;
 * GDP is never an input. The tariff base is collected at the border, so its
 * revenue is the settlement's duty (collection efficiency is 1 by design —
 * `settleTrade` already produced the exact duty) rather than a base × rate.
 */
export const TAX_BASE_IDS: TaxBaseId[] = ['land', 'profit', 'consumption', 'tariff']

export const TAX_BASE_NAMES: Record<TaxBaseId, string> = {
  land: '土地税',
  profit: '企业所得税',
  consumption: '消费税',
  tariff: '关税',
}

/**
 * Land-value-per-unit: farmland endowment (0..100) × this constant gives the
 * land tax base in gold. Chosen at 4 so a default 2% land rate yields a land
 * take comparable to the other bases at the 1836 starting point.
 */
export const LAND_VALUE_PER_UNIT = 4

/** Tax-base quantities for one month (the "税基量" shown by v3_inspect fiscal). */
export type TaxBaseQuantities = Record<TaxBaseId, number>

/**
 * State subsidy to the construction bureaus: every spending level adds
 * capacity points and costs gold (ADR 0015). Kept here because it is a fiscal
 * outlay; the capacity side reads the same points constant in `sim.ts`.
 */
export const CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL = 1.5
export const CONSTRUCTION_SUBSIDY_COST_PER_LEVEL = 0.45

/** Raw monthly expense by category, before the `expense` modifier. */
export type ExpenseParts = {
  army: number
  navy: number
  administration: number
  education: number
  welfare: number
  /** Interest paid on a negative net-assets balance. */
  debtInterest: number
  marketLoss: number
  upkeep: number
  /** Installment reparations paid this month. */
  reparations: number
  /** Subsidy to construction bureaus (spending.construction). */
  constructionSubsidy: number
}

export type FiscalLedger = {
  /** Output this month, for the "GDP ≠ budget" comparison. */
  gdp: number
  income: IncomeParts & {
    /** Per-base revenue of the four bases that sum into `taxes` (ADR 0023). */
    taxBases: TaxBaseQuantities
    total: number
  }
  expense: ExpenseParts & {
    /** State construction paid out of the treasury this month. */
    construction: number
    total: number
  }
  /** income − expense. */
  net: number
  /** Private-sector external gap; carried by private capital/debt, not the treasury. */
  tradeGap: number
  /** Private external debt = max(0, −privateCapital). Not national debt. */
  privateDebt: number
  /** Rent received from private builders using idle state construction points. */
  rentalIncome: number
  /** Derived stocks and the rates they earned/paid this month. */
  debt: number
  fund: number
  debtRate: number
  fundRate: number
  /** Smooth debt-pressure debuff (ADR 0007). */
  debtPressure: DebtPressure
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

/**
 * How much of the theoretically assessed tax an administration actually
 * collects (ADR 0023): a bureaucracy/legitimacy floor times the `taxEfficiency`
 * modifier. Tariff is exempt (collected at the border, ADR 0023).
 */
export function collectionEfficiency(country: Country): number {
  return (
    clamp(
      0.35 + country.bureaucracy.score / 200 + country.government.legitimacy / 400,
      0.3,
      1.1,
    ) * taxEfficiency(country)
  )
}

/** Beyond 25% a single base erodes (evasion, flight, informal work). */
export function taxCompliance(rate: number): number {
  return rate <= 25 ? 1 : clamp(1 - (rate - 25) * 0.015, 0.45, 1)
}

/**
 * Revenue of each of the four tax bases for one month, before the `income`
 * modifier but after collection efficiency, per-base compliance and debt cut
 * (ADR 0023). `quantities` defaults to this month's stored snapshot so callers
 * that only have a settled `Country` (the ledger, the disposable-income loop)
 * read the same numbers the treasury did.
 */
export function taxBaseRevenues(
  country: Country,
  tariffRevenue: number,
  context: FiscalContext = DEFAULT_CONTEXT,
  quantities: TaxBaseQuantities = country.econ.taxBaseQty,
): TaxBaseQuantities {
  const debtCut = 1 - debtPressure(country).incomePenalty
  const collection = collectionEfficiency(country)
  const rates = country.econ.taxes
  const internal = (base: TaxBaseId, rate: number): number =>
    quantities[base] * (rate / 100) * collection * taxCompliance(rate) * debtCut
  return {
    land: internal('land', rates.land),
    profit: internal('profit', rates.profit),
    consumption: internal('consumption', rates.consumption),
    // Border duty is already the exact collected amount; no assessment step.
    tariff: tariffRevenue * debtCut,
  }
}

/** The part of the tax bill borne by private households (ADR 0023). */
export function privateTaxBurden(country: Country): number {
  const bases = taxBaseRevenues(country, country.econ.lastTariffRevenue)
  return bases.land + bases.profit + bases.consumption
}

export function incomeParts(
  country: Country,
  tariffRevenue: number,
  context: FiscalContext = DEFAULT_CONTEXT,
  quantities: TaxBaseQuantities = country.econ.taxBaseQty,
): IncomeParts {
  // Debt pressure crowds out the state's non-interest income: part of the
  // tax/tariff/port take is consumed by refinancing and arrears.
  const debtCut = 1 - debtPressure(country).incomePenalty
  const bases = taxBaseRevenues(country, tariffRevenue, context, quantities)
  return {
    taxes: bases.land + bases.profit + bases.consumption + bases.tariff,
    ports: country.econ.buildings.ports * 0.02 * debtCut,
    sovereignIncome: sovereignFund(country) * fundRate(country, context),
    reparations: (country.econ.reparationsReceived ?? 0) * debtCut,
    // Construction-capacity rent is collected this month and booked as income
    // next month, when the ledger settles it into the treasury.
    other: (country.econ.lastConstructionRent ?? 0) * debtCut,
  }
}

/**
 * Monthly rate paid on national debt. War, a weak mandate, low prestige,
 * unrest and a post-default window all make borrowing dearer.
 */
export function debtRate(
  country: Country,
  context: FiscalContext = DEFAULT_CONTEXT,
): number {
  const weakMandate =
    clamp((50 - country.government.legitimacy) / 50, 0, 1) * 0.004
  const lowPrestige = clamp((20 - country.diplo.prestige) / 20, 0, 1) * 0.004
  const unrest = country.pops.radicals >= 50 ? 0.002 : 0
  // Mirrors the trade-capacity window (`tick <= restructuredUntilTick`).
  const restructuring =
    country.econ.restructuredUntilTick > 0 &&
    context.tick <= country.econ.restructuredUntilTick
      ? 0.004
      : 0
  const pressure = debtPressure(country).interestSpread
  return clamp(
    0.004 +
      (context.atWar ? 0.002 : 0) +
      weakMandate +
      lowPrestige +
      unrest +
      restructuring +
      pressure,
    0.002,
    0.02,
  )
}

/**
 * Monthly rate earned by the sovereign fund. A legitimate, prestigious state
 * with open markets earns more; war drags it down.
 */
export function fundRate(
  country: Country,
  context: FiscalContext = DEFAULT_CONTEXT,
): number {
  const legitimacy = (country.government.legitimacy / 100) * 0.002
  const prestige = clamp(country.diplo.prestige / 100, 0, 1) * 0.002
  const access = country.econ.marketAccess * 0.001
  return clamp(
    0.0015 +
      legitimacy +
      prestige +
      access -
      (context.atWar ? 0.0005 : 0),
    0.0002,
    0.006,
  )
}

export function expenseParts(
  country: Country,
  gdp: number,
  context: FiscalContext = DEFAULT_CONTEXT,
): ExpenseParts {
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
    debtInterest: nationalDebt(country) * debtRate(country, context),
    marketLoss:
      gdp *
      (1 - applyModifiers(country, 'marketAccess', country.econ.marketAccess)) *
      0.02,
    upkeep: (b.universities + b.barracks) * 0.01,
    reparations: country.econ.reparationsPaid ?? 0,
    constructionSubsidy:
      Math.max(0, sp.construction) * CONSTRUCTION_SUBSIDY_COST_PER_LEVEL,
  }
}

/**
 * Reads the last settled month back out of the stored totals. The raw parts
 * are recomputed with the same helpers `computeEconomy` uses, then scaled so
 * the composition adds up exactly to `econ.income` / `econ.expense` (which
 * already carry the `income` / `expense` modifiers and construction spending).
 */
export function fiscalLedger(
  country: Country,
  context: FiscalContext = DEFAULT_CONTEXT,
): FiscalLedger {
  const econ = country.econ
  const rawBases = taxBaseRevenues(country, econ.lastTariffRevenue, context)
  const rawIncome = incomeParts(country, econ.lastTariffRevenue, context)
  // Rent is booked with a one-month lag: `lastConstructionRent` already holds
  // this month's rent by the time the ledger reads it, so use the "other"
  // amount that actually entered last month's income (PT-028).
  const rawOther = Number.isFinite(econ.lastIncomeOther)
    ? econ.lastIncomeOther
    : rawIncome.other
  const rawIncomeNoInterest =
    rawIncome.taxes +
    rawIncome.ports +
    rawIncome.reparations +
    rawOther
  // The settlement stored the interest actually applied on the opening
  // balance; using it here keeps a month that crossed zero from displaying
  // the other side's interest.
  const fundIncome = Number.isFinite(econ.lastFundIncome)
    ? econ.lastFundIncome
    : rawIncome.sovereignIncome
  const incomeNonInterest = Math.max(0, econ.income - fundIncome)
  const incomeFactor =
    rawIncomeNoInterest > 0 ? incomeNonInterest / rawIncomeNoInterest : 1

  const rawExpense = expenseParts(country, econ.gdp, context)
  const rawExpenseNoInterest =
    rawExpense.army +
    rawExpense.navy +
    rawExpense.administration +
    rawExpense.education +
    rawExpense.welfare +
    rawExpense.marketLoss +
    rawExpense.upkeep +
    rawExpense.reparations +
    rawExpense.constructionSubsidy
  const debtInterest = Number.isFinite(econ.lastDebtInterest)
    ? econ.lastDebtInterest
    : rawExpense.debtInterest
  const construction = Math.max(0, econ.lastStateConstructionSpend)
  const expenseNonInterest = Math.max(
    0,
    econ.expense - construction - debtInterest,
  )
  const expenseFactor =
    rawExpenseNoInterest > 0 ? expenseNonInterest / rawExpenseNoInterest : 1

  return {
    gdp: econ.gdp,
    income: {
      taxes: rawIncome.taxes * incomeFactor,
      taxBases: {
        land: rawBases.land * incomeFactor,
        profit: rawBases.profit * incomeFactor,
        consumption: rawBases.consumption * incomeFactor,
        tariff: rawBases.tariff * incomeFactor,
      },
      ports: rawIncome.ports * incomeFactor,
      sovereignIncome: fundIncome,
      reparations: rawIncome.reparations * incomeFactor,
      other: rawOther * incomeFactor,
      total: econ.income,
    },
    expense: {
      army: rawExpense.army * expenseFactor,
      navy: rawExpense.navy * expenseFactor,
      administration: rawExpense.administration * expenseFactor,
      education: rawExpense.education * expenseFactor,
      welfare: rawExpense.welfare * expenseFactor,
      debtInterest,
      marketLoss: rawExpense.marketLoss * expenseFactor,
      upkeep: rawExpense.upkeep * expenseFactor,
      reparations: rawExpense.reparations * expenseFactor,
      constructionSubsidy: rawExpense.constructionSubsidy * expenseFactor,
      construction,
      total: econ.expense,
    },
    net: econ.income - econ.expense,
    tradeGap: econ.lastTradeDebt ?? 0,
    privateDebt: Math.max(0, -econ.privateCapital),
    rentalIncome: Math.max(0, econ.lastConstructionRent ?? 0),
    debt: nationalDebt(country),
    fund: sovereignFund(country),
    debtRate: debtRate(country, context),
    fundRate: fundRate(country, context),
    debtPressure: debtPressure(country),
  }
}
