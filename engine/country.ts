import type { Country, GoodId, LogEntry, WorldState } from '../types'
import {
  BUILDING_IDS,
  GOOD_IDS,
  isCostCentre,
  applyBuildingDecay,
  deriveBureaucracy,
  deriveUnemployment,
  industrialBuildingCount,
  defaultResearchNode,
  refreshInfrastructure,
  successorFor,
  techNode,
  techNodeName,
  techTier,
} from './data'
import { debtPressure, nationalDebt } from './fiscal'
import {
  flowTechOverflow,
  installTechNodeEffects,
  selectAiResearchNode,
  techDiffusionBonus,
} from './tech'
import { applyModifiers, tickModifiers } from './modifiers'
import { evaluateThresholds, logThresholds } from './thresholds'
import { effectiveSavingsRate, computeEconomy, computePrestige, SHRINK_MAX } from './economy'
import { settleConstruction } from './construction'
import { DEPRECIATION_PER_MONTH, investPrivateCapital } from './investment'
import { appliedPart, clamp, sumParts } from './internal'
import type { TradeSettlement } from './trade'
import type { Rng } from './rng'
import {
  HISTORY_MONTHS,
  LEGITIMACY_MAX,
  LOYALISTS_MAX,
  PRESTIGE_MAX,
  RADICALS_MAX,
} from './config/balance'
import {
  ARTISAN_SHIFT_INDUSTRY,
  ARTISAN_SHIFT_PEASANT,
  AUTHORITY_LEGITIMACY_COEF,
  AUTHORITY_LOW_PENALTY,
  AUTHORITY_LOW_THRESHOLD,
  COLLAPSE_RADICALS,
  FISCAL_ALERT_CHANCE,
  FISCAL_ALERT_DEBT_RATIO,
  GOVERNMENT_LEGITIMACY_BONUS,
  GROWTH_BASE,
  GROWTH_EXHAUSTION_DIVISOR,
  GROWTH_RADICALS_DIVISOR,
  GROWTH_SOL_BASE,
  GROWTH_SOL_DIVISOR,
  LEGITIMACY_BASE,
  LEGITIMACY_EXHAUSTION_COEF,
  LEGITIMACY_PULL,
  LEGITIMACY_RADICALS_COEF,
  LEGITIMACY_SUCCESSION_PENALTY,
  LEGITIMACY_TREASURY_BONUS,
  LEGITIMACY_TREASURY_PENALTY,
  LEGITIMACY_WELFARE_COEF,
  LITERACY_EDUCATION,
  LITERACY_UNIVERSITY,
  LOYALIST_LEGITIMACY_COEF,
  LOYALIST_RADICAL_COEF,
  RADICAL_EXHAUSTION_COEF,
  RADICAL_SCARCITY_COEF,
  RADICAL_SOL_BASE,
  RADICAL_SOL_COEF,
  RADICAL_TAX_BASE,
  RADICAL_TAX_COEF,
  RADICAL_TARIFF_BASE,
  RADICAL_TARIFF_COEF,
  RADICAL_UNEMPLOYMENT_COEF,
  RELIEF_BASE,
  RELIEF_EDUCATION,
  RELIEF_LEGITIMACY,
  RELIEF_LOYALISTS,
  RELIEF_WELFARE,
  SCARCITY_ESSENTIAL_WEIGHT,
  SCARCITY_MAX,
  SCARCITY_OTHER_WEIGHT,
  SOL_BASE,
  SOL_GDP_PER_CAPITA,
  SOL_MAX,
  SOL_MIN,
  SOL_RADICALS,
  SOL_TECH,
  SOL_WELFARE,
  UNEMPLOYMENT_LABOR_PENALTY,
  UNEMPLOYMENT_MAX,
  UNEMPLOYMENT_MAX_STEP,
  UNEMPLOYMENT_MIN,
  UNEMPLOYMENT_SMOOTHING,
  URBAN_INDUSTRY_PULL,
  URBAN_PEASANT_PULL,
  URBAN_TECH_PULL,
} from './config/society'
import {
  LEADER_AGE_PER_MONTH,
  LEADER_DEATH_AGE,
  LEADER_OLD_AGE,
  LEADER_OLD_DEATH_CHANCE,
  MANPOWER_ARMY_DRAW,
  MANPOWER_CAP_RATIO,
  MANPOWER_PER_POP,
  MORALE_ARMY_THRESHOLD,
  MORALE_GAIN,
  MORALE_LOSS,
  MORALE_MAX,
  MORALE_MIN,
  SHIPS_PER_NAVAL_BASE,
} from './config/military'
import {
  RESEARCH_BASE,
  RESEARCH_BUREAUCRACY_COEF,
  RESEARCH_EDUCATION_COEF,
  RESEARCH_LITERACY_COEF,
  RESEARCH_TECH_LEVEL_COEF,
  RESEARCH_UNIVERSITY_LITERACY_BASE,
  RESEARCH_UNIVERSITY_PER_BUILDING,
} from './config/tech'
import {
  RESTRUCTURE_DEBT_RATIO,
  RESTRUCTURE_LEGITIMACY,
  RESTRUCTURE_MONTHS,
  RESTRUCTURE_PRESTIGE,
  RESTRUCTURE_RADICALS,
  RESTRUCTURE_RESET_RATIO,
} from './config/fiscal'

function pushHistory(list: number[], value: number): void {
  list.push(Math.round(value * 100) / 100)
  if (list.length > HISTORY_MONTHS) list.shift()
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
    scarcity +=
      (shortage / demand) * (id === 'grain' || id === 'clothes' ? SCARCITY_ESSENTIAL_WEIGHT : SCARCITY_OTHER_WEIGHT)
  }
  scarcity = clamp(scarcity, 0, SCARCITY_MAX)

  country.econ.gdp = snap.gdp
  country.econ.gdpComponents = snap.components
  country.econ.income = snap.income
  country.econ.lastIncomeOther = snap.revenue.other
  country.econ.expense = snap.expense
  // PT-066: naval bases commission hulls. Only the share of their ship demand
  // that was actually delivered (domestic output + imports) becomes tonnage,
  // so a base with no hulls adds nothing.
  const navalBases = country.econ.buildings.navalBases ?? 0
  if (navalBases > 0) {
    const shipDemand = snap.demand.ships ?? 0
    const shipSupply = snap.supply.ships ?? 0
    const deliveredRatio = shipDemand > 0 ? Math.min(1, shipSupply / shipDemand) : 0
    country.military.navy += navalBases * SHIPS_PER_NAVAL_BASE * deliveredRatio
  }
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
  if (country.econ.treasury < -country.econ.gdp * RESTRUCTURE_DEBT_RATIO) {
    const before = -country.econ.treasury
    country.econ.treasury = -country.econ.gdp * RESTRUCTURE_RESET_RATIO
    // Halve import capacity and cap new external debt for the next 12 months
    // (plan §2.4).
    country.econ.restructuredUntilTick = Math.max(
      country.econ.restructuredUntilTick,
      world.tick + RESTRUCTURE_MONTHS,
    )
    country.pops.radicals = clamp(country.pops.radicals + RESTRUCTURE_RADICALS, 0, RADICALS_MAX)
    country.government.legitimacy = clamp(
      country.government.legitimacy - RESTRUCTURE_LEGITIMACY,
      0,
      LEGITIMACY_MAX,
    )
    country.diplo.prestige = clamp(country.diplo.prestige - RESTRUCTURE_PRESTIGE, 0, PRESTIGE_MAX)
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
    // Cost centres (infrastructure and workshops) earn no goods revenue by
    // design, so a zero-output recipe input would otherwise read as a deep loss
    // and scrape them at SHRINK_MAX. They wear out at the base rate only.
    const deepLoss = isCostCentre(id)
      ? 0
      : Math.max(0, -row.profitPerBuilding) / (row.revenue + 1)
    const extra = clamp(deepLoss, 0, SHRINK_MAX)
    applyBuildingDecay(country, id, 1 - DEPRECIATION_PER_MONTH - extra)
  }
  // Rails, ports, offices and universities wear out too; their infrastructure
  // bonuses must not outlive the buildings that produced them. The unified
  // infrastructure level is derived from the (now decayed) building counts, so
  // it is simply refreshed rather than decayed independently (plan 0011 F5).
  country.econ.marketAccess *= 1 - DEPRECIATION_PER_MONTH
  country.econ.administrativeCapacity *= 1 - DEPRECIATION_PER_MONTH
  refreshInfrastructure(country)

  // Pops: growth, urbanisation, standard of living.
  const growthRate = applyModifiers(
    country,
    'growth',
    GROWTH_BASE +
      (country.pops.sol - GROWTH_SOL_BASE) / GROWTH_SOL_DIVISOR -
      country.pops.radicals / GROWTH_RADICALS_DIVISOR -
      country.military.exhaustion / GROWTH_EXHAUSTION_DIVISOR,
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

  const industry = industrialBuildingCount(country)
  const urbanPull = Math.min(
    country.pops.peasants * URBAN_PEASANT_PULL,
    industry * URBAN_INDUSTRY_PULL * (1 + techTier(country.tech) * URBAN_TECH_PULL),
  )
  country.pops.peasants -= urbanPull
  country.pops.workers += urbanPull

  const artisanShift = Math.min(
    country.pops.artisans * ARTISAN_SHIFT_PEASANT,
    industry * ARTISAN_SHIFT_INDUSTRY,
  )
  country.pops.artisans -= artisanShift
  country.pops.workers += artisanShift

  country.pops.sol = clamp(
    applyModifiers(
      country,
      'sol',
      SOL_BASE +
        (snap.realGdp / Math.max(1, country.pops.total)) * SOL_GDP_PER_CAPITA +
        techTier(country.tech) * SOL_TECH -
        country.pops.radicals * SOL_RADICALS +
        country.econ.spending.welfare * SOL_WELFARE,
    ),
    SOL_MIN,
    SOL_MAX,
  )

  const literacyGain =
    (country.econ.spending.education * LITERACY_EDUCATION +
      country.econ.buildings.universities * LITERACY_UNIVERSITY) *
    (1 - country.pops.literacy)
  country.pops.literacy = clamp(
    country.pops.literacy + applyModifiers(country, 'literacy', literacyGain),
    0,
    1,
  )

  // Industry absorbs labour; literacy and unrest move the rate the other way.
  // Low labour utilisation (a vast idle peasantry) adds a modest penalty;
  // full utilisation removes it (plan 0003 §0.1).
  const laborPenalty = (1 - snap.labor.utilization) * UNEMPLOYMENT_LABOR_PENALTY
  const unemploymentTarget = clamp(
    applyModifiers(country, 'unemployment', deriveUnemployment(country) + laborPenalty),
    UNEMPLOYMENT_MIN,
    UNEMPLOYMENT_MAX,
  )
  // Smooth the stock and cap the monthly move so the factory-absorption
  // threshold cannot swing unemployment from 6% to 29% in a year.
  const unemploymentStep = clamp(
    (unemploymentTarget - country.econ.unemployment) * UNEMPLOYMENT_SMOOTHING,
    -UNEMPLOYMENT_MAX_STEP,
    UNEMPLOYMENT_MAX_STEP,
  )
  country.econ.unemployment = clamp(
    country.econ.unemployment + unemploymentStep,
    UNEMPLOYMENT_MIN,
    UNEMPLOYMENT_MAX,
  )

  // The most salient domestic tax (the highest of the three internal bases)
  // replaces the single old rate; consumption and tariffs already bite elsewhere.
  const taxLevel = Math.max(
    country.econ.taxes.land,
    country.econ.taxes.profit,
    country.econ.taxes.consumption,
  )
  const radicalPressure =
    Math.max(0, taxLevel - RADICAL_TAX_BASE) * RADICAL_TAX_COEF +
    Math.max(0, country.econ.tariff - RADICAL_TARIFF_BASE) * RADICAL_TARIFF_COEF +
    Math.max(0, RADICAL_SOL_BASE - country.pops.sol) * RADICAL_SOL_COEF +
    country.military.exhaustion * RADICAL_EXHAUSTION_COEF +
    country.econ.unemployment * RADICAL_UNEMPLOYMENT_COEF +
    scarcity * RADICAL_SCARCITY_COEF
  const relief =
    RELIEF_BASE +
    (country.government.legitimacy / 100) * RELIEF_LEGITIMACY +
    country.econ.spending.welfare * RELIEF_WELFARE +
    country.econ.spending.education * RELIEF_EDUCATION +
    country.pops.loyalists * RELIEF_LOYALISTS
  // Radicals and loyalists are stocks updated by a monthly flow; modifiers
  // scale the flow, not the stock, so a percent buff cannot compound monthly.
  country.pops.radicals = clamp(
    country.pops.radicals + applyModifiers(country, 'radicals', radicalPressure - relief),
    0,
    RADICALS_MAX,
  )
  country.pops.loyalists = clamp(
    country.pops.loyalists +
      applyModifiers(
        country,
        'loyalists',
        country.government.legitimacy * LOYALIST_LEGITIMACY_COEF -
          radicalPressure * LOYALIST_RADICAL_COEF,
      ),
    0,
    LOYALISTS_MAX,
  )

  const govBonus = GOVERNMENT_LEGITIMACY_BONUS[country.government.type] ?? 0
  const legitimacyTarget = clamp(
    applyModifiers(
      country,
      'legitimacy',
      LEGITIMACY_BASE +
        govBonus -
        country.pops.radicals * LEGITIMACY_RADICALS_COEF +
        (country.econ.treasury > 0 ? LEGITIMACY_TREASURY_BONUS : LEGITIMACY_TREASURY_PENALTY) -
        debtPressure(country).legitimacyPenalty -
        country.military.exhaustion * LEGITIMACY_EXHAUSTION_COEF +
        country.econ.spending.welfare * LEGITIMACY_WELFARE_COEF,
    ),
    0,
    LEGITIMACY_MAX,
  )
  country.government.legitimacy +=
    (legitimacyTarget - country.government.legitimacy) * LEGITIMACY_PULL

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
    country.government.legitimacy * AUTHORITY_LEGITIMACY_COEF -
    (country.government.legitimacy < AUTHORITY_LOW_THRESHOLD ? AUTHORITY_LOW_PENALTY : 0) -
    policyUpkeep
  country.government.authority = clamp(
    country.government.authority + applyModifiers(country, 'authority', authorityFlow),
    0,
    LEGITIMACY_MAX,
  )

  // Bureaucratic effectiveness and the four constraints it feeds.
  country.bureaucracy = deriveBureaucracy(country, true)

  // Technology.
  // A base research rate keeps a state without universities from standing
  // still for decades (PT-007); universities, literacy, education spending and
  // the tech level itself multiply on top of it.
  const researchBase =
    RESEARCH_BASE +
    country.pops.literacy * RESEARCH_LITERACY_COEF +
    country.bureaucracy.score * RESEARCH_BUREAUCRACY_COEF
  const baseRate =
    researchBase +
    country.econ.buildings.universities *
      RESEARCH_UNIVERSITY_PER_BUILDING *
      (RESEARCH_UNIVERSITY_LITERACY_BASE + country.pops.literacy) *
      (1 + country.econ.spending.education * RESEARCH_EDUCATION_COEF) *
      (1 + techTier(country.tech) * RESEARCH_TECH_LEVEL_COEF)
  // Plan 0005 K2 §2.4: a lagging country's research speed gains up to +50% from
  // international diffusion (tech gap + trade + relations + alliance; zeroed by
  // war or embargo). It scales the flow only — never free points or unlocks.
  country.tech.pointsPerMonth =
    baseRate * (1 + techDiffusionBonus(world, country))
  const monthlyResearch = applyModifiers(
    country,
    'techPoints',
    country.tech.pointsPerMonth,
  )
  country.tech.points += monthlyResearch
  // Plan 0005 K1/K2: points flow into the chosen node; completing it appends to
  // `unlocked`, installs its effects and raises the era for a general-line node.
  // An empty or stale choice falls back to the player's default pick or, for an
  // AI country, the deterministic situation-weighted choice (K3).
  let node = techNode(country.tech.researching)
  if (node === undefined || country.tech.unlocked.includes(node.id)) {
    node = country.isPlayer
      ? defaultResearchNode(country.tech)
      : selectAiResearchNode(world, country)
    country.tech.researching = node?.id ?? ''
  }
  if (node !== undefined) {
    // Keep any progress this node already accrued from a previous overflow.
    country.tech.nodes[node.id] = Math.max(
      country.tech.nodes[node.id] ?? 0,
      Math.min(1, country.tech.points / node.cost),
    )
    if (country.tech.points >= node.cost) {
      country.tech.points -= node.cost
      country.tech.nodes[node.id] = 1
      country.tech.unlocked.push(node.id)
      installTechNodeEffects(country, node)
      if (node.branch === 'general' && node.era > country.tech.era) {
        country.tech.era = node.era
      }
      country.tech.researching = ''
      log.push({
        date: { ...world.date },
        kind: 'tech',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}解锁了「${techNodeName(node.id)}」`,
      })
    }
    // Plan 0005 K2 §2.3: 15–25% of the flow adds extra progress to the other
    // branches' current-era nodes; the main node above still took it all.
    for (const completed of flowTechOverflow(country, node, monthlyResearch)) {
      log.push({
        date: { ...world.date },
        kind: 'tech',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}解锁了「${techNodeName(completed.id)}」（跨分支溢出）`,
      })
    }
  }

  // Military.
  country.military.manpower = clamp(
    country.military.manpower +
      applyModifiers(
        country,
        'manpower',
        country.pops.total * MANPOWER_PER_POP - country.military.army * MANPOWER_ARMY_DRAW,
      ),
    0,
    country.pops.total * MANPOWER_CAP_RATIO,
  )
  // Morale is a stock fed by a monthly flow; scale the flow.
  country.military.morale = clamp(
    country.military.morale +
      applyModifiers(
        country,
        'morale',
        country.econ.spending.army > MORALE_ARMY_THRESHOLD ? MORALE_GAIN : MORALE_LOSS,
      ),
    MORALE_MIN,
    MORALE_MAX,
  )

  country.diplo.prestige = computePrestige(country)

  // Leaders age; an old one eventually gives way to the next generation.
  country.leader.age += LEADER_AGE_PER_MONTH
  if (
    country.leader.age >= LEADER_DEATH_AGE ||
    (country.leader.age >= LEADER_OLD_AGE && rng.chance(LEADER_OLD_DEATH_CHANCE))
  ) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng)
    country.government.legitimacy = clamp(
      country.government.legitimacy - LEGITIMACY_SUCCESSION_PENALTY,
      0,
      LEGITIMACY_MAX,
    )
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
  if (country.pops.radicals >= COLLAPSE_RADICALS) {
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
    debt > country.econ.gdp * FISCAL_ALERT_DEBT_RATIO &&
    rng.chance(FISCAL_ALERT_CHANCE)
  ) {
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}财政告急，国债升至 ${debt.toFixed(1)}`,
    })
  }
}
