import type {
  BuildingId,
  BuildingProfit,
  Country,
  GoodId,
  SecretaryState,
  TaxBaseId,
  TaxRates,
  TechState,
  TradeState,
  UiState,
  WorldState,
} from '../../types'
import { makeRng, type Rng } from '../rng'
import { BUILDING_IDS } from './buildings'
import { COUNTRY_SEEDS } from './countries'
import { administrativeCapacityFor, deriveBureaucracy, refreshInfrastructure } from './derivations'
import { GOODS, GOOD_IDS } from './goods'
import { TECH_NODES, clampEra, defaultResearchNode } from './tech'

export const START_YEAR = 1836
export const START_MONTH = 1

/** plan 0015 S0 placeholder; real per-country seeding is S5. */
const NAVAL_QUALITY_SEED = 0.5

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const basePrices = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = GOODS[id].basePrice
  return out
}

/** A country's empty trade record for world creation (plan 0004 §1.3). */
export function emptyTradeState(): TradeState {
  return {
    exports: [],
    imports: [],
    exportValue: 0,
    importValue: 0,
    tariffRevenue: 0,
    nx: 0,
    capacity: 0,
    history: { exportValue: [], importValue: [], nx: [], tariffRevenue: [] },
  }
}

/**
 * Seeds each building class at tier I: one entry per level, so
 * `Σ initialBuildingTiers(buildings)[id] === buildings[id]` holds by
 * construction (plan 0015 S0).
 */
const initialBuildingTiers = (
  buildings: Record<BuildingId, number>,
): Record<BuildingId, number[]> => {
  const out = {} as Record<BuildingId, number[]>
  for (const id of BUILDING_IDS) out[id] = [buildings[id]]
  return out
}

/** A zeroed per-building profit snapshot, before the first monthly settlement. */
export function emptyBuildingProfits(): Record<BuildingId, BuildingProfit> {
  const out = {} as Record<BuildingId, BuildingProfit>
  for (const id of BUILDING_IDS) {
    out[id] = {
      revenue: 0,
      inputCost: 0,
      wages: 0,
      profit: 0,
      utilization: 1,
      profitPerBuilding: 0,
    }
  }
  return out
}

/**
 * Default per-base tax rates for 1836, in percent (ADR 0023). Calibrated so
 * the four-base take is comparable to the old GDP-proportional take (aggregate
 * ≈ 1.0×, no fiscal shock); `tariff` is replaced per country by its seed
 * tariff so the menu mirrors `econ.tariff`.
 */
export const DEFAULT_TAX_RATES: TaxRates = {
  land: 2,
  profit: 2,
  consumption: 3,
  tariff: 5,
}

/** A zeroed tax-base quantity snapshot, before the first monthly settlement. */
export function emptyTaxBaseQty(): Record<TaxBaseId, number> {
  return { land: 0, profit: 0, consumption: 0, tariff: 0 }
}

export function defaultSecretaryState(): SecretaryState {
  return {
    delegation: { internal: false, diplomacy: false, months: 1 },
    lastReport: '',
    lastPlan: '',
    isRunning: false,
    lastRunTick: 0,
    consecutiveOverreach: 0,
  }
}

export function initialUi(): UiState {
  return {
    tab: 'overview',
    isPaneOpen: false,
    notice: '',
    lastReport: '',
    isBusy: false,
    isActive: false,
    council: {
      isOpen: false,
      report: '',
      secretaryReport: '',
      isRunning: false,
    },
  }
}

/**
 * Seeds a country's `TechState` from its legacy linear level (plan 0005 K1).
 * The old 1–10 level maps to an era tier (every 2.5 levels ≈ one era) and the
 * general-line nodes up to that era are pre-unlocked, so a fresh world keeps a
 * tech-gated production multiplier close to the pre-tree one.
 */
export function techStateFromLevel(level: number): TechState {
  const era = clampEra(1 + Math.floor((level - 1) / 2.5))
  const unlocked = TECH_NODES.filter(
    node => node.branch === 'general' && node.era <= era,
  ).map(node => node.id)
  const state: TechState = {
    era,
    nodes: {},
    unlocked,
    researching: '',
    points: 0,
    pointsPerMonth: 0,
  }
  state.researching = defaultResearchNode(state)?.id ?? ''
  return state
}

export function createWorld(seed: number, playerId = 'QING'): WorldState {
  const countries: Record<string, Country> = {}
  for (const seedRow of COUNTRY_SEEDS) {
    const country: Country = {
      id: seedRow.id,
      name: seedRow.name,
      adjective: seedRow.adjective,
      flag: seedRow.flag,
      color: seedRow.color,
      isPlayer: seedRow.id === playerId,
      isMajor: seedRow.isMajor,
      leader: { ...seedRow.leader, memory: [...seedRow.leader.memory] },
      government: {
        type: seedRow.government,
        legitimacy: seedRow.legitimacy,
        authority: seedRow.authority,
      },
      pops: {
        ...seedRow.pops,
        growth: 0.001,
      },
      bureaucracy: {
        score: 0,
        ceiling: 0,
        actionBudget: 1,
        fundEfficiency: 0.5,
        delayChance: 0.35,
        infoDistortion: 0.3,
      },
      politicalEconomy: { ...seedRow.politicalEconomy },
      region: seedRow.region,
      trade: emptyTradeState(),
      opium: { ...seedRow.opium },
      embargoes: [],
      econ: {
        gdp: seedRow.gdp,
        treasury: seedRow.treasury,
        income: 0,
        expense: 0,
        taxes: { ...DEFAULT_TAX_RATES, tariff: seedRow.tariff },
        taxBaseQty: emptyTaxBaseQty(),
        tariff: seedRow.tariff,
        spending: { ...seedRow.spending },
        buildings: { ...seedRow.buildings },
        buildingTiers: initialBuildingTiers(seedRow.buildings),
        goods: zeroGoods(),
        prices: basePrices(),
        transportInfrastructure: 100,
        administrativeCapacity: administrativeCapacityFor(
          seedRow.pops.literacy,
          seedRow.spending.bureaucracy,
        ),
        constructionQueue: [],
        marketAccess: seedRow.marketAccess,
        unemployment: seedRow.unemployment,
        resources: { ...seedRow.resources },
        privateCapital: 0,
        lastPrivateStartTick: -999,
        investmentConfidence: seedRow.politicalEconomy.investmentConfidence,
        gdpComponents: { c: 0, i: 0, g: 0, nx: 0 },
        laborShare: seedRow.politicalEconomy.laborShareBase,
        wages: 0,
        profits: 0,
        buildingProfits: emptyBuildingProfits(),
        idleProfits: 0,
        idlePurchases: 0,
        laborDemand: 0,
        laborForce: 0,
        laborUtilization: 1,
        laborRawUtilization: 0,
        lastConstructionSpend: 0,
        lastStateConstructionSpend: 0,
        lastConstructionRent: 0,
        lastIncomeOther: 0,
        lastConstructionDemand: {},
        lastPrivateConstructionSpend: 0,
        reparationsPaid: 0,
        reparationsReceived: 0,
        transfersPaid: 0,
        transfersReceived: 0,
        lastFundIncome: 0,
        lastDebtInterest: 0,
        lastImportBill: 0,
        lastExportRevenue: 0,
        lastTariffRevenue: 0,
        lastTradeBalance: 0,
        lastTradeDebt: 0,
        resourceImports: { farmland: 0, timber: 0, coal: 0, iron: 0 },
        restructuredUntilTick: 0,
        history: {
          gdp: [seedRow.gdp],
          treasury: [seedRow.treasury],
          sol: [seedRow.pops.sol],
          legitimacy: [seedRow.legitimacy],
          radicals: [seedRow.pops.radicals],
          c: [],
          i: [],
          g: [],
          income: [],
          expense: [],
          unemployment: [],
          debt: [],
          tariff: [],
        },
      },
      tech: techStateFromLevel(seedRow.techLevel),
      military: {
        army: seedRow.army,
        navy: seedRow.navy,
        manpower: seedRow.manpower,
        quality: seedRow.quality,
        navalQuality: NAVAL_QUALITY_SEED,
        morale: seedRow.morale,
        exhaustion: 0,
      },
      diplo: {
        relations: { ...seedRow.relations },
        alliances: [...seedRow.alliances],
        rivals: [...seedRow.rivals],
        sphere: [],
        infamy: 0,
        prestige: seedRow.prestige,
      },
      modifiers: [],
    }
    country.bureaucracy = deriveBureaucracy(country, false)
    refreshInfrastructure(country)
    countries[seedRow.id] = country
  }

  // Every pair has a relation, so lookups stay simple.
  for (const a of Object.values(countries)) {
    for (const b of Object.values(countries)) {
      if (a.id === b.id) continue
      if (a.diplo.relations[b.id] === undefined) a.diplo.relations[b.id] = 0
    }
  }

  return {
    version: 14,
    seed,
    date: { year: START_YEAR, month: START_MONTH },
    tick: 0,
    playerId,
    countries,
    wars: [],
    indemnities: [],
    transfers: [],
    events: [],
    log: [
      {
        date: { year: START_YEAR, month: START_MONTH },
        kind: 'system',
        text: '1836 年 1 月：维也纳体系的余晖仍在，蒸汽与火药正在改写世界。',
      },
    ],
    tradeTensions: [],
    situations: [],
    tradeRoutes: [],
    resumeOnStart: true,
    ai: {
      model: 'haiku',
      suspended: {},
      // Plan 0003 §6: one batch decision per month for every AI country.
      intervalTicks: 1,
      lastDecisionTick: 0,
    },
    secretary: defaultSecretaryState(),
    ironman: false,
    createdAt: 0,
  }
}

export function makeRngForWorld(world: WorldState): Rng {
  return makeRng(world.seed + world.tick * 7919)
}
