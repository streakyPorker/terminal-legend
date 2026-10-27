import type { Country, GoodId, TaxBaseId } from '../types'
import { CONSUMER_GOODS, infrastructureCount } from './data'
import { applyModifiers } from './modifiers'
import {
  DEBT_PRESSURE_BLOCK,
  DEBT_PRESSURE_COEFFICIENTS,
  DEBT_PRESSURE_FULL,
  DEBT_PRESSURE_START,
  debtPressureLabel,
} from './config/blocks/fiscal'
import { scaleProduct } from './scale'
import { LEGITIMACY_MAX } from './config/balance'
import { ROYAL_EXPENSE_FLOOR, ROYAL_EXPENSE_RATE } from './config/fiscal'
import {
  COLLECTION_BASE,
  COLLECTION_BUREAUCRACY_DIVISOR,
  COLLECTION_LEGITIMACY_DIVISOR,
  COLLECTION_MAX,
  COLLECTION_MIN,
  COMPLIANCE_COEF,
  COMPLIANCE_MAX,
  COMPLIANCE_MIN,
  COMPLIANCE_THRESHOLD,
  CONSTRUCTION_SUBSIDY_COST_PER_LEVEL,
  PORT_INCOME_PER_BUILDING,
  TAX_EFFICIENCY_BASE,
  TAX_EFFICIENCY_LEGITIMACY_DIVISOR,
} from './config/tax'
import {
  ADMIN_BUREAUCRACY_PER_POP,
  ADMIN_EXPENSE_PER_POP,
  ARMY_EXPENSE_PER_UNIT,
  ARMY_SPENDING_SHARE,
  DEBT_LOW_PRESTIGE_BASE,
  DEBT_LOW_PRESTIGE_COEF,
  DEBT_RATE_BASE,
  DEBT_RATE_MAX,
  DEBT_RATE_MIN,
  DEBT_RESTRUCTURE_SPREAD,
  DEBT_UNREST_BASE,
  DEBT_UNREST_SPREAD,
  DEBT_WAR_SPREAD,
  DEBT_WEAK_MANDATE_BASE,
  DEBT_WEAK_MANDATE_COEF,
  EDUCATION_EXPENSE_PER_POP,
  FUND_ACCESS_COEF,
  FUND_LEGITIMACY_COEF,
  FUND_PRESTIGE_COEF,
  FUND_RATE_BASE,
  FUND_RATE_MAX,
  FUND_RATE_MIN,
  FUND_WAR_SPREAD,
  MARKET_LOSS_COEF,
  MARKET_LOSS_BUREAUCRACY_MAX,
  MARKET_LOSS_BUREAUCRACY_MIN,
  MARKET_LOSS_BUREAUCRACY_REFERENCE,
  MARKET_LOSS_BUREAUCRACY_SPAN,
  NAVY_EXPENSE_PER_UNIT,
  NAVY_SPENDING_SHARE,
  UPKEEP_PER_BUILDING,
  WELFARE_EXPENSE_PER_POP_SOL,
} from './config/fiscal'

/** Land-value-per-unit and the construction subsidy dials live in
 *  `config/tax.ts`; re-exported here so the `./fiscal` import surface is
 *  unchanged. */
export {
  LAND_VALUE_PER_UNIT,
  CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL,
  CONSTRUCTION_SUBSIDY_COST_PER_LEVEL,
} from './config/tax'

export { DEBT_PRESSURE_FULL, DEBT_PRESSURE_START }

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
 *
 * The severity factor is block data (C7): `scales_with` reads `debtRatio`
 * through the `fiscal:debt-pressure` curve, and the four penalty coefficients
 * and display bands are declared alongside it.
 */
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
  const ratio = nationalDebt(country) / Math.max(1, country.econ.gdp)
  const severity = scaleProduct(country, DEBT_PRESSURE_BLOCK.scales_with)
  return {
    ratio,
    severity,
    incomePenalty: DEBT_PRESSURE_COEFFICIENTS.income * severity,
    constructionPenalty: DEBT_PRESSURE_COEFFICIENTS.construction * severity,
    legitimacyPenalty: DEBT_PRESSURE_COEFFICIENTS.legitimacy * severity,
    interestSpread: DEBT_PRESSURE_COEFFICIENTS.interest * severity,
    label: debtPressureLabel(ratio),
  }
}

/** Sovereign fund: the positive half of net assets. */
export const sovereignFund = (country: Country): number =>
  Math.max(0, country.econ.treasury)

/** Raw monthly revenue by source, before the `income` modifier. */
export type IncomeParts = {
  /** Sum of the four real tax bases (ADR 0023); no longer a GDP share. */
  taxes: number
  /** Infrastructure dues (the old port tariff effect, plan 0014). */
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
 * The land-value-per-unit scale and the construction-subsidy dials are declared
 * in `config/tax.ts` and re-exported above (ADR 0015 / ADR 0023).
 */

/** Tax-base quantities for one month (the "税基量" shown by v3_inspect fiscal). */
export type TaxBaseQuantities = Record<TaxBaseId, number>

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
  /** PT-103: an AI court's discretionary spending, scaled off its treasury. */
  court: number
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
    TAX_EFFICIENCY_BASE + country.government.legitimacy / TAX_EFFICIENCY_LEGITIMACY_DIVISOR,
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
      COLLECTION_BASE +
        country.bureaucracy.score / COLLECTION_BUREAUCRACY_DIVISOR +
        country.government.legitimacy / COLLECTION_LEGITIMACY_DIVISOR,
      COLLECTION_MIN,
      COLLECTION_MAX,
    ) * taxEfficiency(country)
  )
}

/** Beyond 25% a single base erodes (evasion, flight, informal work). */
export function taxCompliance(rate: number): number {
  return rate <= COMPLIANCE_THRESHOLD
    ? 1
    : clamp(1 - (rate - COMPLIANCE_THRESHOLD) * COMPLIANCE_COEF, COMPLIANCE_MIN, COMPLIANCE_MAX)
}

/**
 * Revenue of each of the four tax bases for one month, before the `income`
 * modifier but after collection efficiency, per-base compliance and debt cut
 * (ADR 0023). `quantities` defaults to this month's stored snapshot so callers
 * that only have a settled `Country` (the ledger, the disposable-income loop)
 * read the same numbers the treasury did.
 */
/** PT-073: the consumption-tax rate that applies to one good (override or fallback). */
export const consumptionRateFor = (country: Country, good: GoodId): number =>
  country.econ.consumptionTaxByGood?.[good] ?? country.econ.taxes.consumption

/**
 * PT-073: the tax-inclusive price a consumer pays for one good. The market price
 * is untouched — demand is computed on the pre-tax price, so the tax moves the
 * price level, not the quantity.
 */
export const consumerPrice = (country: Country, good: GoodId): number =>
  country.econ.prices[good] * (1 + consumptionRateFor(country, good) / 100)

/** Per-good line of the consumption-tax breakdown (inspect / ledger). */
export type ConsumptionTaxLine = {
  good: GoodId
  value: number
  rate: number
  amount: number
  custom: boolean
}

export function consumptionTaxLines(country: Country): ConsumptionTaxLine[] {
  const byGood = country.econ.consumptionValueByGood ?? {}
  const debtCut = 1 - debtPressure(country).incomePenalty
  const collection = collectionEfficiency(country)
  return CONSUMER_GOODS.map(good => {
    const value = byGood[good] ?? 0
    const rate = consumptionRateFor(country, good)
    return {
      good,
      value,
      rate,
      amount: value * (rate / 100) * collection * taxCompliance(rate) * debtCut,
      custom: country.econ.consumptionTaxByGood?.[good] !== undefined,
    }
  })
}

/** PT-073: consumption revenue from the per-good final-consumption breakdown. */
function consumptionTaxFromBreakdown(
  country: Country,
  byGood: Partial<Record<GoodId, number>>,
  collection: number,
  debtCut: number,
): number {
  let total = 0
  for (const good of CONSUMER_GOODS) {
    const value = byGood[good]
    if (value === undefined || value <= 0) continue
    const rate = consumptionRateFor(country, good)
    total += value * (rate / 100) * collection * taxCompliance(rate) * debtCut
  }
  return total
}

export function taxBaseRevenues(
  country: Country,
  tariffRevenue: number,
  context: FiscalContext = DEFAULT_CONTEXT,
  quantities: TaxBaseQuantities = country.econ.taxBaseQty,
  consumptionByGood: Partial<Record<GoodId, number>> | undefined =
    country.econ.consumptionValueByGood,
): TaxBaseQuantities {
  const debtCut = 1 - debtPressure(country).incomePenalty
  const collection = collectionEfficiency(country)
  const rates = country.econ.taxes
  const internal = (base: TaxBaseId, rate: number): number =>
    quantities[base] * (rate / 100) * collection * taxCompliance(rate) * debtCut
  const consumption =
    consumptionByGood === undefined || Object.keys(consumptionByGood).length === 0
      ? internal('consumption', rates.consumption)
      : consumptionTaxFromBreakdown(country, consumptionByGood, collection, debtCut)
  return {
    land: internal('land', rates.land),
    profit: internal('profit', rates.profit),
    consumption,
    // Border duty is already the exact collected amount; no assessment step.
    tariff: tariffRevenue * debtCut,
  }
}

/**
 * The part of the tax bill that reduces *consumption demand* (ADR 0023).
 * PT-073: the consumption tax is deliberately excluded — it is a price wedge
 * paid out of private savings, so it must not shrink the household basket.
 */
export function privateTaxBurden(country: Country): number {
  const bases = taxBaseRevenues(country, country.econ.lastTariffRevenue)
  return bases.land + bases.profit
}

export function incomeParts(
  country: Country,
  tariffRevenue: number,
  context: FiscalContext = DEFAULT_CONTEXT,
  quantities: TaxBaseQuantities = country.econ.taxBaseQty,
  consumptionByGood: Partial<Record<GoodId, number>> | undefined =
    country.econ.consumptionValueByGood,
): IncomeParts {
  // Debt pressure crowds out the state's non-interest income: part of the
  // tax/tariff/port take is consumed by refinancing and arrears.
  const debtCut = 1 - debtPressure(country).incomePenalty
  const bases = taxBaseRevenues(
    country,
    tariffRevenue,
    context,
    quantities,
    consumptionByGood,
  )
  return {
    taxes: bases.land + bases.profit + bases.consumption + bases.tariff,
    ports: infrastructureCount(country) * PORT_INCOME_PER_BUILDING * debtCut,
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
    clamp((DEBT_WEAK_MANDATE_BASE - country.government.legitimacy) / DEBT_WEAK_MANDATE_BASE, 0, 1) *
    DEBT_WEAK_MANDATE_COEF
  const lowPrestige =
    clamp((DEBT_LOW_PRESTIGE_BASE - country.diplo.prestige) / DEBT_LOW_PRESTIGE_BASE, 0, 1) *
    DEBT_LOW_PRESTIGE_COEF
  const unrest = country.pops.radicals >= DEBT_UNREST_BASE ? DEBT_UNREST_SPREAD : 0
  // Mirrors the trade-capacity window (`tick <= restructuredUntilTick`).
  const restructuring =
    country.econ.restructuredUntilTick > 0 &&
    context.tick <= country.econ.restructuredUntilTick
      ? DEBT_RESTRUCTURE_SPREAD
      : 0
  const pressure = debtPressure(country).interestSpread
  return clamp(
    DEBT_RATE_BASE +
      (context.atWar ? DEBT_WAR_SPREAD : 0) +
      weakMandate +
      lowPrestige +
      unrest +
      restructuring +
      pressure,
    DEBT_RATE_MIN,
    DEBT_RATE_MAX,
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
  const legitimacy = (country.government.legitimacy / LEGITIMACY_MAX) * FUND_LEGITIMACY_COEF
  const prestige = clamp(country.diplo.prestige / LEGITIMACY_MAX, 0, 1) * FUND_PRESTIGE_COEF
  const access = country.econ.marketAccess * FUND_ACCESS_COEF
  return clamp(
    FUND_RATE_BASE +
      legitimacy +
      prestige +
      access -
      (context.atWar ? FUND_WAR_SPREAD : 0),
    FUND_RATE_MIN,
    FUND_RATE_MAX,
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
      country.military.army * ARMY_EXPENSE_PER_UNIT * (1 + country.military.quality) +
      sp.army * ARMY_SPENDING_SHARE,
    navy: country.military.navy * NAVY_EXPENSE_PER_UNIT + sp.navy * NAVY_SPENDING_SHARE,
    administration:
      popFactor * ADMIN_EXPENSE_PER_POP + sp.bureaucracy * popFactor * ADMIN_BUREAUCRACY_PER_POP,
    education: sp.education * popFactor * EDUCATION_EXPENSE_PER_POP,
    welfare: sp.welfare * popFactor * Math.max(1, country.pops.sol) * WELFARE_EXPENSE_PER_POP_SOL,
    debtInterest: nationalDebt(country) * debtRate(country, context),
    marketLoss:
      gdp *
      (1 - applyModifiers(country, 'marketAccess', country.econ.marketAccess)) *
      MARKET_LOSS_COEF *
      // PT-102: bad bureaucracy leaks more of the goods and silver in transit.
      clamp(
        1 +
          (MARKET_LOSS_BUREAUCRACY_REFERENCE - (country.bureaucracy?.score ?? 0)) /
            MARKET_LOSS_BUREAUCRACY_SPAN,
        MARKET_LOSS_BUREAUCRACY_MIN,
        MARKET_LOSS_BUREAUCRACY_MAX,
      ),
    upkeep: (b.universities + b.barracks) * UPKEEP_PER_BUILDING,
    reparations: country.econ.reparationsPaid ?? 0,
    constructionSubsidy:
      Math.max(0, sp.construction) * CONSTRUCTION_SUBSIDY_COST_PER_LEVEL,
    // PT-103: only AI powers burn a share of their treasury on court life —
    // the player's savings stay theirs.
    court: country.isPlayer
      ? 0
      : Math.max(0, country.econ.treasury - ROYAL_EXPENSE_FLOOR) * ROYAL_EXPENSE_RATE,
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
  // PT-065: transfers are booked at contract value and never scaled by the
  // `income` modifier, so they stay out of the factor's base and are reported
  // as booked.
  const rawIncomeNoInterest = rawIncome.taxes + rawIncome.ports + rawOther
  const transferIncome = rawIncome.reparations
  // The settlement stored the interest actually applied on the opening
  // balance; using it here keeps a month that crossed zero from displaying
  // the other side's interest.
  const fundIncome = Number.isFinite(econ.lastFundIncome)
    ? econ.lastFundIncome
    : rawIncome.sovereignIncome
  const incomeNonInterest = Math.max(0, econ.income - fundIncome - transferIncome)
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
    rawExpense.constructionSubsidy
  const debtInterest = Number.isFinite(econ.lastDebtInterest)
    ? econ.lastDebtInterest
    : rawExpense.debtInterest
  const construction = Math.max(0, econ.lastStateConstructionSpend)
  const expenseNonInterest = Math.max(
    0,
    econ.expense - construction - debtInterest - rawExpense.reparations,
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
      reparations: transferIncome,
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
      reparations: rawExpense.reparations,
      constructionSubsidy: rawExpense.constructionSubsidy * expenseFactor,
      court: rawExpense.court * expenseFactor,
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
