import type { Country, GoodId, LogEntry, WorldState } from '../types'
import {
  BUILDING_IDS,
  GOOD_IDS,
  deriveBureaucracy,
  deriveUnemployment,
  successorFor,
  techCost,
  techName,
} from './data'
import { debtPressure, nationalDebt } from './fiscal'
import { applyModifiers, tickModifiers } from './modifiers'
import { evaluateThresholds, logThresholds } from './thresholds'
import { effectiveSavingsRate, computeEconomy, computePrestige, SHRINK_MAX } from './economy'
import { settleConstruction } from './construction'
import { DEPRECIATION_PER_MONTH, investPrivateCapital } from './investment'
import { appliedPart, clamp, sumParts } from './internal'
import type { TradeSettlement } from './trade'
import type { Rng } from './rng'

function pushHistory(list: number[], value: number): void {
  list.push(Math.round(value * 100) / 100)
  if (list.length > 36) list.shift()
}

export function simulateCountry(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
  incoming?: {
    supply: Record<GoodId, number>
    nx: number
    settlement: TradeSettlement
  },
): void {
  const oldPops = Math.max(1, country.pops.total)
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  const snap = computeEconomy(country, {
    ...(incoming === undefined
      ? {}
      : {
          supply: incoming.supply,
          nx: incoming.nx,
          tariffRevenue: incoming.settlement.tariffRevenue,
        }),
    atWar,
    tick: world.tick,
  })
  // The demand computed above consumed last month's released idle capital.
  country.econ.idlePurchases = 0

  // Market scarcity feeds unrest; effective supply already includes this
  // month's trade, so imports relieve the shortage.
  let scarcity = 0
  for (const id of GOOD_IDS) {
    const demand = snap.demand[id]
    if (demand <= 0) continue
    const shortage = Math.max(0, demand - snap.supply[id])
    scarcity += (shortage / demand) * (id === 'grain' || id === 'clothes' ? 1.6 : 0.5)
  }
  scarcity = clamp(scarcity, 0, 8)

  country.econ.gdp = snap.gdp
  country.econ.gdpComponents = snap.components
  country.econ.income = snap.income
  country.econ.lastIncomeOther = snap.revenue.other
  country.econ.expense = snap.expense
  country.econ.goods = snap.production
  country.econ.laborShare = snap.laborShare
  country.econ.wages = snap.wages
  country.econ.profits = snap.profits
  country.econ.taxBaseQty = snap.taxBaseQty
  country.econ.buildingProfits = snap.buildingProfits
  country.econ.laborDemand = snap.labor.demand
  country.econ.laborForce = snap.labor.force
  country.econ.laborUtilization = snap.labor.utilization
  country.econ.laborRawUtilization = snap.labor.raw
  const rawIncomeTotal = sumParts(snap.revenue)
  const rawExpenseTotal = sumParts(snap.outlay)
  country.econ.lastFundIncome = appliedPart(
    snap.revenue.sovereignIncome,
    rawIncomeTotal,
    snap.income,
  )
  country.econ.lastDebtInterest = appliedPart(
    snap.outlay.debtInterest,
    rawExpenseTotal,
    snap.expense,
  )

  const balance = snap.income - snap.expense
  country.econ.treasury += balance
  // The treasury is signed net assets: a negative balance is national debt
  // and pays interest next month. There is no separate debt stock and no
  // principal-repayment step to reconcile.
  if (country.econ.treasury < -country.econ.gdp * 3) {
    const before = -country.econ.treasury
    country.econ.treasury = -country.econ.gdp * 1.5
    // Halve import capacity and cap new external debt for the next 12 months
    // (plan §2.4).
    country.econ.restructuredUntilTick = Math.max(
      country.econ.restructuredUntilTick,
      world.tick + 12,
    )
    country.pops.radicals = clamp(country.pops.radicals + 8, 0, 100)
    country.government.legitimacy = clamp(country.government.legitimacy - 8, 0, 100)
    country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}债务违约并重组：国债从 ${before.toFixed(0)} 降至 ${(-country.econ.treasury).toFixed(0)}`,
    })
  }

  // Gold settlement (plan §2.4): the private sector's external net accrues to
  // or is drawn from private capital. An unfinanced import bill becomes
  // *private* external debt (negative private capital), never state debt: the
  // treasury only collects tariffs and never pays the private import bill
  // (ADR 0008). A private debt stock is repaid first by later export surpluses.
  country.econ.lastTradeDebt = 0
  if (incoming !== undefined) {
    const settlement = incoming.settlement
    if (settlement.externalNet >= 0) {
      country.econ.privateCapital += settlement.externalNet
    } else {
      // The private sector bears what it can draw plus the private external
      // debt it takes on; `dropped` stays forgiven beyond the restructuring cap.
      country.econ.privateCapital -=
        settlement.drawnFromCapital + settlement.debtIncrease
    }
    country.econ.lastTradeDebt = settlement.debtIncrease
    if (settlement.dropped > 0) {
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}私人外债超过重组上限，${settlement.dropped.toFixed(1)} 金未能融资`,
      })
    }
  }

  // Income distribution: profits fund private savings, and this month's
  // savings may start one private project (plan 0003 §3/§4).
  const savings = snap.profits * effectiveSavingsRate(country)
  country.econ.privateCapital += savings
  investPrivateCapital(world, country, snap, savings, log)

  // The construction queue pays from the appropriation; only the money that
  // actually reached a project counts as government spending.
  const stateConstructionSpent = settleConstruction(world, country, rng, log)
  country.econ.expense = snap.expense + stateConstructionSpent

  // Capital wears out slowly. Without this the private investment loop stops
  // permanently once the capital stock satisfies demand (round-2 P1-1). A type
  // that is deeply in the red (negative profit per building) is additionally
  // scrapped faster, proportionally to the loss, capped by SHRINK_MAX
  // (ADR 0022). Deterministic, no RNG; the count never goes below zero.
  for (const id of BUILDING_IDS) {
    const row = snap.buildingProfits[id]
    const deepLoss = Math.max(0, -row.profitPerBuilding) / (row.revenue + 1)
    const extra = clamp(deepLoss, 0, SHRINK_MAX)
    country.econ.buildings[id] = Math.max(
      0,
      country.econ.buildings[id] * (1 - DEPRECIATION_PER_MONTH - extra),
    )
  }
  // Rails, ports, offices and universities wear out too; their infrastructure
  // bonuses must not outlive the buildings that produced them.
  country.econ.transportInfrastructure *= 1 - DEPRECIATION_PER_MONTH
  country.econ.marketAccess *= 1 - DEPRECIATION_PER_MONTH
  country.econ.administrativeCapacity *= 1 - DEPRECIATION_PER_MONTH

  // Pops: growth, urbanisation, standard of living.
  const growthRate = applyModifiers(
    country,
    'growth',
    0.0012 +
      (country.pops.sol - 40) / 20000 -
      country.pops.radicals / 50000 -
      country.military.exhaustion / 100000,
  )
  country.pops.growth = growthRate
  const newTotal = Math.max(1, oldPops * (1 + growthRate))
  const scale = newTotal / oldPops
  country.pops.total = newTotal
  country.pops.peasants *= scale
  country.pops.workers *= scale
  country.pops.artisans *= scale
  country.pops.clergy *= scale
  country.pops.aristocrats *= scale
  country.pops.capitalists *= scale

  const urbanPull = Math.min(
    country.pops.peasants * 0.0008,
    country.econ.buildings.factories * 0.015 * (1 + country.tech.level * 0.05),
  )
  country.pops.peasants -= urbanPull
  country.pops.workers += urbanPull

  const artisanShift = Math.min(
    country.pops.artisans * 0.0006,
    country.econ.buildings.factories * 0.003,
  )
  country.pops.artisans -= artisanShift
  country.pops.workers += artisanShift

  country.pops.sol = clamp(
    applyModifiers(
      country,
      'sol',
      20 +
        (snap.realGdp / Math.max(1, country.pops.total)) * 250 +
        country.tech.level * 1.2 -
        country.pops.radicals * 0.08 +
        country.econ.spending.welfare * 2,
    ),
    5,
    95,
  )

  const literacyGain =
    (country.econ.spending.education * 0.0008 +
      country.econ.buildings.universities * 0.0002) *
    (1 - country.pops.literacy)
  country.pops.literacy = clamp(
    country.pops.literacy + applyModifiers(country, 'literacy', literacyGain),
    0,
    1,
  )

  // Industry absorbs labour; literacy and unrest move the rate the other way.
  // Low labour utilisation (a vast idle peasantry) adds a modest penalty;
  // full utilisation removes it (plan 0003 §0.1).
  const laborPenalty = (1 - snap.labor.utilization) * 2
  const unemploymentTarget = clamp(
    applyModifiers(country, 'unemployment', deriveUnemployment(country) + laborPenalty),
    0,
    30,
  )
  // Smooth the stock and cap the monthly move so the factory-absorption
  // threshold cannot swing unemployment from 6% to 29% in a year.
  const unemploymentStep = clamp(
    (unemploymentTarget - country.econ.unemployment) * 0.25,
    -1.5,
    1.5,
  )
  country.econ.unemployment = clamp(
    country.econ.unemployment + unemploymentStep,
    0,
    30,
  )

  // The most salient domestic tax (the highest of the three internal bases)
  // replaces the single old rate; consumption and tariffs already bite elsewhere.
  const taxLevel = Math.max(
    country.econ.taxes.land,
    country.econ.taxes.profit,
    country.econ.taxes.consumption,
  )
  const radicalPressure =
    Math.max(0, taxLevel - 5) * 0.08 +
    Math.max(0, country.econ.tariff - 10) * 0.03 +
    Math.max(0, 40 - country.pops.sol) * 0.03 +
    country.military.exhaustion * 0.06 +
    country.econ.unemployment * 0.03 +
    scarcity * 0.12
  const relief =
    0.3 +
    (country.government.legitimacy / 100) * 0.35 +
    country.econ.spending.welfare * 0.2 +
    country.econ.spending.education * 0.08 +
    country.pops.loyalists * 0.015
  // Radicals and loyalists are stocks updated by a monthly flow; modifiers
  // scale the flow, not the stock, so a percent buff cannot compound monthly.
  country.pops.radicals = clamp(
    country.pops.radicals + applyModifiers(country, 'radicals', radicalPressure - relief),
    0,
    100,
  )
  country.pops.loyalists = clamp(
    country.pops.loyalists +
      applyModifiers(
        country,
        'loyalists',
        country.government.legitimacy * 0.01 - radicalPressure * 0.3,
      ),
    0,
    100,
  )

  const govBonus =
    country.government.type === '专制君主制'
      ? -4
      : country.government.type === '君主立宪制'
        ? 8
        : country.government.type === '共和制'
          ? 10
          : country.government.type === '民主制'
            ? 12
            : country.government.type === '寡头制'
              ? -2
              : 0
  const legitimacyTarget = clamp(
    applyModifiers(
      country,
      'legitimacy',
      50 +
        govBonus -
        country.pops.radicals * 0.5 +
        (country.econ.treasury > 0 ? 4 : -6) -
        debtPressure(country).legitimacyPenalty -
        country.military.exhaustion * 0.2 +
        country.econ.spending.welfare * 2,
    ),
    0,
    100,
  )
  country.government.legitimacy +=
    (legitimacyTarget - country.government.legitimacy) * 0.08

  // Authority recovers in proportion to legitimacy; a discredited regime
  // loses it (round-2 P1-6). Standing policies also drain authority; if the
  // regime cannot pay the upkeep, the policy programme starts to lapse.
  let policyUpkeep = country.modifiers.reduce(
    (sum, modifier) => sum + (modifier.upkeep ?? 0),
    0,
  )
  if (policyUpkeep > 0 && country.government.authority < policyUpkeep) {
    const lapsed = country.modifiers.find(modifier => (modifier.upkeep ?? 0) > 0)
    if (lapsed !== undefined) {
      country.modifiers = country.modifiers.filter(
        modifier => modifier.source !== lapsed.source,
      )
      log.push({
        date: { ...world.date },
        kind: 'politics',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}权威枯竭：「${lapsed.label}」等政策中止`,
      })
      policyUpkeep = country.modifiers.reduce(
        (sum, modifier) => sum + (modifier.upkeep ?? 0),
        0,
      )
    }
  }
  const authorityFlow =
    country.government.legitimacy * 0.03 -
    (country.government.legitimacy < 30 ? 1.5 : 0) -
    policyUpkeep
  country.government.authority = clamp(
    country.government.authority + applyModifiers(country, 'authority', authorityFlow),
    0,
    100,
  )

  // Bureaucratic effectiveness and the four constraints it feeds.
  country.bureaucracy = deriveBureaucracy(country, true)

  // Technology.
  // A base research rate keeps a state without universities from standing
  // still for decades (PT-007); universities, literacy, education spending and
  // the tech level itself multiply on top of it.
  const researchBase =
    2 +
    country.pops.literacy * 3 +
    country.bureaucracy.score * 0.06
  country.tech.pointsPerMonth =
    researchBase +
    country.econ.buildings.universities *
      0.9 *
      (0.4 + country.pops.literacy) *
      (1 + country.econ.spending.education * 0.03) *
      (1 + country.tech.level * 0.02)
  country.tech.points += applyModifiers(
    country,
    'techPoints',
    country.tech.pointsPerMonth,
  )
  const nextCost = techCost(country.tech.level + 1)
  if (country.tech.level < 10 && country.tech.points >= nextCost) {
    country.tech.points -= nextCost
    country.tech.level += 1
    const unlocked = techName(country.tech.level)
    country.tech.unlocked.push(unlocked)
    country.tech.researching = techName(country.tech.level + 1)
    log.push({
      date: { ...world.date },
      kind: 'tech',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}解锁了「${unlocked}」`,
    })
  }

  // Military.
  country.military.manpower = clamp(
    country.military.manpower +
      applyModifiers(
        country,
        'manpower',
        country.pops.total * 0.0004 - country.military.army * 0.0006,
      ),
    0,
    country.pops.total * 0.06,
  )
  // Morale is a stock fed by a monthly flow; scale the flow.
  country.military.morale = clamp(
    country.military.morale +
      applyModifiers(country, 'morale', country.econ.spending.army > 1 ? 0.15 : -0.15),
    20,
    100,
  )

  country.diplo.prestige = computePrestige(country)

  // Leaders age; an old one eventually gives way to the next generation.
  country.leader.age += 1 / 12
  if (
    country.leader.age >= 82 ||
    (country.leader.age >= 70 && rng.chance(0.002))
  ) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng)
    country.government.legitimacy = clamp(country.government.legitimacy - 5, 0, 100)
    log.push({
      date: { ...world.date },
      kind: 'leader',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：${oldName}逝世，${country.leader.title}${country.leader.name}继位`,
    })
  }

  // Timed buffs and debuffs age one month.
  for (const label of tickModifiers(country)) {
    log.push({
      date: { ...world.date },
      kind: 'politics',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：「${label}」到期`,
    })
  }

  // State thresholds grant or lift buffs after the month's numbers settle.
  logThresholds(world, country, evaluateThresholds(country), log)

  // State collapse tears up the policy programme; permanent buffs do not
  // survive a revolution.
  if (country.pops.radicals >= 92) {
    const before = country.modifiers.filter(modifier => modifier.source.startsWith('policy:'))
    if (before.length > 0) {
      country.modifiers = country.modifiers.filter(
        modifier => !modifier.source.startsWith('policy:'),
      )
      log.push({
        date: { ...world.date },
        kind: 'politics',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}国家崩解：${before.length} 项政策被废除`,
      })
    }
  }

  pushHistory(country.econ.history.gdp, snap.gdp)
  pushHistory(country.econ.history.treasury, country.econ.treasury)
  pushHistory(country.econ.history.sol, country.pops.sol)
  pushHistory(country.econ.history.legitimacy, country.government.legitimacy)
  pushHistory(country.econ.history.radicals, country.pops.radicals)
  pushHistory(country.econ.history.c, snap.components.c)
  pushHistory(country.econ.history.i, snap.components.i)
  pushHistory(country.econ.history.g, snap.components.g)
  pushHistory(country.econ.history.income, country.econ.income)
  pushHistory(country.econ.history.expense, country.econ.expense)
  pushHistory(country.econ.history.unemployment, country.econ.unemployment)
  pushHistory(country.econ.history.debt, nationalDebt(country))
  pushHistory(country.econ.history.tariff, country.econ.lastTariffRevenue)

  const debt = nationalDebt(country)
  if (
    country.econ.treasury <= 0 &&
    snap.income - country.econ.expense < 0 &&
    debt > country.econ.gdp * 0.5 &&
    rng.chance(0.03)
  ) {
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}财政告急，国债升至 ${debt.toFixed(1)}`,
    })
  }
}
