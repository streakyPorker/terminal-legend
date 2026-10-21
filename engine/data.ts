import type {
  Bureaucracy,
  BuildingId,
  BuildingProfit,
  Country,
  EventOption,
  GameEvent,
  GoodId,
  Leader,
  ModifierStat,
  PoliticalEconomy,
  Region,
  ResourceId,
  Resources,
  SecretaryState,
  Spending,
  SpendingCategory,
  TaxBaseId,
  TaxRates,
  TradeState,
  UiState,
  WarGoal,
  WorldState,
} from '../types'
import { makeRng, type Rng } from './rng'
import { applyModifiers } from './modifiers'

export const START_YEAR = 1836
export const START_MONTH = 1

/** Chinese display labels for the four war goals (plan 0004 §5). */
export const WAR_GOAL_NAMES: Record<WarGoal, string> = {
  reparations: '赔款',
  openMarket: '开放市场',
  sphere: '势力范围',
  humiliation: '威望羞辱',
}

export const GOODS: Record<GoodId, { name: string; basePrice: number }> = {
  grain: { name: '粮食', basePrice: 1 },
  wood: { name: '木材', basePrice: 1.2 },
  coal: { name: '煤炭', basePrice: 1.6 },
  iron: { name: '钢铁', basePrice: 2.2 },
  fabric: { name: '布料', basePrice: 2 },
  clothes: { name: '成衣', basePrice: 3 },
  liquor: { name: '酒类', basePrice: 2.6 },
  furniture: { name: '家具', basePrice: 3.2 },
  machinery: { name: '机械', basePrice: 6 },
  arms: { name: '军械', basePrice: 5.5 },
  luxury: { name: '奢侈品', basePrice: 10 },
  opium: { name: '鸦片', basePrice: 2.5 },
  services: { name: '服务', basePrice: 4 },
}

export const GOOD_IDS = Object.keys(GOODS) as GoodId[]

// ============================================================ config: economy ==
// CONFIG SECTION. The engine formula that consumes these lives in
// `engine/economy.ts`; plan 0009 (ADR 0024) will relocate this block to
// `engine/config/economy.ts` without changing its shape. Kept declarative so the
// wage-split rule can be retuned without touching the profit formula.

/**
 * How the national wage bill is split across building types when snapshotting
 * per-building operating profit (ADR 0021, plan 0008). The split is a *fiction*
 * that keeps `Σ buildingProfits.wages === nationalWages` exact while attributing
 * wages per type:
 *
 * - `'labor'`         — by `recipe.labor × count` (the pre-B5 rule).
 * - `'valueAdded'`    — by `max(0, revenue − inputCost)` (gross value added at
 *                       this month's prices); negative value added is clamped to
 *                       zero so a loss-making type never receives negative wages.
 * - `'capitalPlusLabor'` — by `(recipe.labor + capitalProxy) × count`, where the
 *                       capital proxy is a building's construction cost scaled by
 *                       `CAPITAL_LABOR_SCALE` (see below).
 */
export type WageAllocationBasis = 'labor' | 'valueAdded' | 'capitalPlusLabor'

/**
 * Wage-allocation rule for `buildingProfits` (plan 0008 B5). `'labor'`
 * reproduces the pre-B5 baseline exactly; B5 selected `'valueAdded'` because
 * under `'labor'` the industrial core's factories cannot be made profitable
 * without breaking the 20% aggregate ceiling: with `'labor'`, the calibrated
 * recipe leaves GBR at ~4% factory margin at 20.7% aggregate, and any recipe
 * that lifts GBR to 5% pushes the aggregate well past 20%. Charging wages in
 * proportion to value added (wages track productivity) lifts the industrial core
 * and pulls the aggregate to ~16%. `weights` multiplies the chosen basis weight
 * per building type; it is unset in B5.
 */
export const WAGE_ALLOCATION: {
  basis: WageAllocationBasis
  weights?: Partial<Record<BuildingId, number>>
} = { basis: 'valueAdded' }

/**
 * Capital proxy per gold of construction cost used by the `capitalPlusLabor`
 * basis: `capitalProxy(b) = BUILDINGS[b].cost × CAPITAL_LABOR_SCALE`, so a
 * 4-gold factory contributes ~1.0 capital unit, comparable to its 1.0 labour
 * coefficient. Deterministic, no RNG.
 */
export const CAPITAL_LABOR_SCALE = 0.25

/**
 * Region-pair transport cost multipliers (plan 0004 §1.2). Symmetric; the
 * diagonal is 1.0 so domestic-equivalent pairs pay no transport friction.
 */
export const REGION_COST: Record<Region, Record<Region, number>> = {
  europe: { europe: 1.0, eastAsia: 1.25, americas: 1.15, middleEast: 1.08 },
  eastAsia: { europe: 1.25, eastAsia: 1.0, americas: 1.3, middleEast: 1.2 },
  americas: { europe: 1.15, eastAsia: 1.3, americas: 1.0, middleEast: 1.25 },
  middleEast: { europe: 1.08, eastAsia: 1.2, americas: 1.25, middleEast: 1.0 },
}

// ---------------------------------------------------------------- resources

/**
 * Resource endowments are national and static in this slice. Only this table
 * changes when a new resource is added (plan 0003 §5).
 */
export const RESOURCE_IDS = ['farmland', 'timber', 'coal', 'iron'] as const

export const RESOURCE_MAP: Record<
  ResourceId,
  { name: string; goods: Partial<Record<GoodId, number>> }
> = {
  farmland: { name: '农田', goods: { grain: 1 } },
  timber: { name: '林地', goods: { wood: 1, furniture: 0.2 } },
  coal: { name: '煤矿', goods: { coal: 1 } },
  iron: { name: '铁矿', goods: { iron: 1 } },
}

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  farmland: '农田',
  timber: '林地',
  coal: '煤矿',
  iron: '铁矿',
}

// ---------------------------------------------------------------- demand parameters

/**
 * Stone-Geary consumer demand (plan 0003 §2.1). Values are per popFactor
 * (population in 万 / 1000) per month. Elasticity shares sum to 1, so all
 * supernumerary income is spent.
 */
export const CONSUMER_GOODS: GoodId[] = [
  'grain',
  'clothes',
  'furniture',
  'liquor',
  'services',
  'luxury',
]

/**
 * Calibrated: the plan's per-popFactor table was scaled by 0.6 after the
 * 60-month baseline showed the seed economies sitting below a 693-gold
 * subsistence line, which pinned them in a poverty trap. See
 * docs/plans/0003-economic-loop.md §0.2 for the recorded calibration.
 */
export const SUBSISTENCE_SCALE = 0.6

export const SUBSISTENCE: Record<GoodId, number> = {
  grain: 7.0 * SUBSISTENCE_SCALE,
  clothes: 1.2 * SUBSISTENCE_SCALE,
  furniture: 0.3 * SUBSISTENCE_SCALE,
  liquor: 0.6 * SUBSISTENCE_SCALE,
  services: 1.0 * SUBSISTENCE_SCALE,
  luxury: 0.02 * SUBSISTENCE_SCALE,
  wood: 0,
  coal: 0,
  iron: 0,
  fabric: 0,
  machinery: 0,
  arms: 0,
  opium: 0,
}

/**
 * Share of supernumerary income actually spent on consumer goods this month.
 * The rest is household saving/leakage, which keeps the expenditure
 * multiplier from amplifying small investment shocks into runaway growth.
 */
export const CONSUMPTION_PROPENSITY = 0.75

export const INCOME_ELASTICITY: Record<GoodId, number> = {
  grain: 0.15,
  clothes: 0.18,
  furniture: 0.1,
  liquor: 0.1,
  services: 0.27,
  luxury: 0.2,
  wood: 0,
  coal: 0,
  iron: 0,
  fabric: 0,
  machinery: 0,
  arms: 0,
  opium: 0,
}

/** Government purchases by spending category (plan 0003 §2.3). */
export const GOVERNMENT_DEMAND: Record<SpendingCategory, Partial<Record<GoodId, number>>> = {
  army: { arms: 0.7, machinery: 0.3 },
  navy: { arms: 0.5, machinery: 0.5 },
  bureaucracy: { services: 0.8, furniture: 0.2 },
  education: { services: 0.7, furniture: 0.3 },
  welfare: { grain: 0.6, clothes: 0.4 },
  construction: { wood: 0.4, iron: 0.35, machinery: 0.25 },
}

/** Investment goods required per project-month, per building (plan 0003 §2.2). */
export const INVESTMENT_DEMAND: Record<BuildingId, Partial<Record<GoodId, number>>> = {
  farms: { wood: 0.12, furniture: 0.02 },
  mines: { iron: 0.18, machinery: 0.03 },
  factories: { iron: 0.22, machinery: 0.1, wood: 0.1 },
  railroads: { iron: 0.5, machinery: 0.16, wood: 0.4 },
  ports: { wood: 0.3, iron: 0.1 },
  universities: { furniture: 0.12, wood: 0.05 },
  barracks: { wood: 0.1, furniture: 0.05 },
  offices: { furniture: 0.1, wood: 0.05 },
  workshops: { wood: 0.3, iron: 0.2, furniture: 0.05 },
}

/**
 * Legacy gross-output weights, retained as the private-investment shortage
 * signal (`investmentScore` in sim.ts). It is NOT a production source:
 * production reads `BUILDING_RECIPES` below. From B3 the profitability gate
 * (`buildingProfits.profitPerBuilding > 0`) is binding and this table only
 * allocates investment among already-profitable types (ADR 0022).
 */
export const BUILDING_OUTPUT: Record<BuildingId, Partial<Record<GoodId, number>>> = {
  farms: { grain: 1.05, wood: 0.16 },
  mines: { coal: 0.5, iron: 0.42, wood: 0.06 },
  factories: {
    fabric: 0.6,
    clothes: 0.38,
    liquor: 0.2,
    furniture: 0.22,
    machinery: 0.09,
    arms: 0.07,
    luxury: 0.035,
  },
  railroads: {},
  ports: {},
  universities: {},
  barracks: { arms: 0.05 },
  offices: {},
  workshops: {},
}

// ---------------------------------------------------------------- building recipes

/** A per-building goods basket: good → quantity per building per month. */
export type RecipeIO = Partial<Record<GoodId, number>>

/**
 * Multiplier seams a recipe's output may pass through. The values are the same
 * runtime multipliers `computeProduction` always applied by hand; the recipe
 * only declares which ones a given output good uses, so results are unchanged.
 */
export type RecipeGates = {
  /** Country tech level multiplier (1 + level × 0.07). */
  tech?: boolean
  /** Transport-infrastructure multiplier (0.6 + transport / 160). */
  infrastructure?: boolean
  /** Market-access multiplier (0.55 + marketAccess × 0.9). */
  access?: boolean
  /** Coal/iron endowment factor (0.7..1.3), applied to factories. */
  industrial?: boolean
  /** Resource endowments that scale this output (forward-compat; unused in B1+B2). */
  resource?: ResourceId[]
}

/**
 * The single source of truth for building production and intermediate inputs
 * (ADR 0021, plan 0008 B1). `output` is the per-building monthly basket before
 * gates and per-good modifiers; `input` is the per-building monthly
 * intermediate consumption; `labor` is the per-building labor-demand
 * coefficient (ten-thousands of workers per building).
 */
export type BuildingRecipe = {
  output: RecipeIO
  input: RecipeIO
  labor: number
  /** Multipliers applied to every output good unless `outputGates` overrides. */
  gates?: RecipeGates
  /**
   * Per-output-good gate overrides for byproducts that share none of the
   * building's default gates (e.g. farms' wood, mines' wood, factories' liquor).
   */
  outputGates?: Partial<Record<GoodId, RecipeGates>>
  /** Building-category output modifier seam (farmOutput/mineOutput/factoryOutput). */
  outputModifier?: ModifierStat
}

/**
 * B1 copied these from the literals previously hardcoded in `computeProduction`
 * and the per-building intermediate block in `computeDemand`; B5 (plan 0008 §5)
 * then recalibrated the factories row (details in plan 0008 B5). It cut the
 * material inputs and trimmed the consumer-good output so that a factory's value
 * added covers its allocated wage at the (locally glutted) consumer-good prices
 * — the pre-B5 row was ~87% material cost and ran at a loss. `workshops` output
 * is construction points, special-cased in sim.ts, so its `output` is empty.
 */
export const BUILDING_RECIPES: Record<BuildingId, BuildingRecipe> = {
  farms: {
    output: { grain: 0.3, wood: 0.04, opium: 0.004 },
    input: {},
    labor: 0.3,
    gates: { tech: true, infrastructure: true, access: true },
    outputGates: { wood: {} },
    outputModifier: 'farmOutput',
  },
  mines: {
    output: { coal: 0.5, iron: 0.42, wood: 0.04 },
    input: {},
    labor: 0.6,
    gates: { tech: true },
    outputGates: { wood: {} },
    outputModifier: 'mineOutput',
  },
  factories: {
    output: {
      fabric: 0.6,
      clothes: 0.28,
      liquor: 0.14,
      furniture: 0.16,
      machinery: 0.18,
      arms: 0.07,
      luxury: 0.035,
    },
    input: { grain: 0.5, coal: 0.18, iron: 0.2, fabric: 0.2, wood: 0.1, machinery: 0.18 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputGates: { liquor: { industrial: true } },
    outputModifier: 'factoryOutput',
  },
  railroads: {
    output: {},
    input: { iron: 0.5, wood: 0.4 },
    labor: 0.2,
  },
  ports: {
    output: {},
    input: {},
    labor: 0.4,
  },
  universities: {
    output: { services: 0.2 },
    input: {},
    labor: 0.2,
  },
  barracks: {
    output: { arms: 0.05 },
    input: {},
    labor: 0.3,
  },
  offices: {
    output: { services: 0.8 },
    input: {},
    labor: 0.1,
  },
  workshops: {
    output: {},
    input: { wood: 1, grain: 0.6, iron: 0.3 },
    labor: 0,
  },
}

/**
 * Handicraft ("artisan") monthly output per ten-thousand artisans, per good.
 * These are the national, population-derived terms `computeProduction` always
 * added by hand alongside `BUILDING_RECIPES` (ADR 0021 keeps them out of the
 * per-building recipes because they scale with the artisan pop, not buildings).
 *
 * B5 (plan 0008 §5) leaves these at their original values. Cutting them would
 * make clothes/liquor/furniture genuinely two-sided, but it also strips the
 * agrarian economies of their domestic handicraft, collapses real consumer
 * income downstream and — fatally — starves the QING→GBR opium trade that the
 * opium-crisis gates depend on (plan 0004 §4.1). The gate therefore resolves
 * PT-002 the other allowed way: these goods are documented as intentionally
 * local (artisan self-supply), not globally traded.
 */
export const ARTISAN_OUTPUT: Partial<Record<GoodId, number>> = {
  clothes: 0.035,
  liquor: 0.01,
  furniture: 0.006,
}

/** Artisan service output per ten-thousand artisans (national term). */
export const ARTISAN_SERVICE_OUTPUT = 0.01

export const BUILDINGS: Record<BuildingId, { name: string; cost: number; note: string }> = {
  farms: { name: '农场', cost: 1.5, note: '粮食与原料，吸纳农业人口' },
  mines: { name: '矿场', cost: 2.5, note: '煤炭与钢铁，工业的起点' },
  factories: { name: '工厂', cost: 4, note: '工业品产能，推动城市化' },
  railroads: { name: '铁路', cost: 7, note: '交通基础设施与市场接入' },
  ports: { name: '港口', cost: 3, note: '市场接入与关税收入' },
  universities: { name: '大学', cost: 5, note: '科技点数、识字率与行政能力' },
  barracks: { name: '兵营', cost: 2.5, note: '军械产出' },
  offices: { name: '官署', cost: 3, note: '行政能力与官僚效能上限' },
  workshops: { name: '营造所', cost: 3, note: '消耗木材、粮食与铁，产出建造点' },
}

/** Months a project of each kind takes, before bureaucratic delay. */
export const BUILDING_TIME: Record<BuildingId, number> = {
  farms: 2,
  mines: 3,
  factories: 4,
  railroads: 8,
  ports: 3,
  universities: 5,
  barracks: 2,
  offices: 3,
  workshops: 3,
}

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[]

export function buildOf(id: string): BuildingId | undefined {
  return (BUILDING_IDS as string[]).includes(id) ? (id as BuildingId) : undefined
}

export const SPENDING: Record<SpendingCategory, { name: string; note: string }> = {
  army: { name: '陆军', note: '维持陆军，过低会削弱士气' },
  navy: { name: '海军', note: '维持舰队与海权' },
  bureaucracy: { name: '官僚', note: '行政效率与合法性' },
  education: { name: '教育', note: '识字率与科技速度' },
  welfare: { name: '福利', note: '降低激进、提高生活水平' },
  construction: {
    name: '建设补贴',
    note: '按等级补贴营造局：每级每月 +1.5 建造点，花费 0.45 金（ADR 0015）',
  },
}

export const TECHS = [
  { level: 1, name: '传统农业', cost: 60 },
  { level: 2, name: '农业改良', cost: 140 },
  { level: 3, name: '蒸汽机', cost: 240 },
  { level: 4, name: '铁路时代', cost: 380 },
  { level: 5, name: '机械化生产', cost: 560 },
  { level: 6, name: '钢铁工业', cost: 780 },
  { level: 7, name: '电力应用', cost: 1040 },
  { level: 8, name: '化学工业', cost: 1340 },
  { level: 9, name: '内燃机', cost: 1680 },
  { level: 10, name: '无线电时代', cost: 2060 },
]

export function techCost(level: number): number {
  const row = TECHS.find(tech => tech.level === level)
  return row?.cost ?? 60 + (level - 1) * 120
}

export function techName(level: number): string {
  return TECHS.find(tech => tech.level === level)?.name ?? `未知科技 ${level}`
}

export const GOVERNMENT_TYPES = [
  '专制君主制',
  '君主立宪制',
  '共和制',
  '民主制',
  '寡头制',
  '神权制',
]

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

const buildings = (
  farms: number,
  mines: number,
  factories: number,
  railroads: number,
  ports: number,
  universities: number,
  barracks: number,
  offices: number,
  workshops: number,
): Record<BuildingId, number> => ({
  farms,
  mines,
  factories,
  railroads,
  ports,
  universities,
  barracks,
  offices,
  workshops,
})

const spending = (
  army: number,
  navy: number,
  bureaucracy: number,
  education: number,
  welfare: number,
  construction: number,
): Spending => ({ army, navy, bureaucracy, education, welfare, construction })

const politicalEconomy = (
  laborShareBase: number,
  savingsRate: number,
  idleRetained: number,
  investmentConfidence: number,
): PoliticalEconomy => ({ laborShareBase, savingsRate, idleRetained, investmentConfidence })

const resources = (
  farmland: number,
  timber: number,
  coal: number,
  iron: number,
): Resources => ({ farmland, timber, coal, iron })

type CountrySeed = {
  id: string
  name: string
  adjective: string
  flag: string
  color: string
  isMajor: boolean
  leader: Leader
  government: string
  legitimacy: number
  authority: number
  pops: {
    total: number
    peasants: number
    workers: number
    artisans: number
    clergy: number
    aristocrats: number
    capitalists: number
    literacy: number
    radicals: number
    loyalists: number
    sol: number
  }
  gdp: number
  /** Signed net assets: the seed treasury minus the old seed debt. */
  treasury: number
  tariff: number
  spending: Spending
  buildings: Record<BuildingId, number>
  transportInfrastructure: number
  marketAccess: number
  unemployment: number
  resources: Resources
  region: Region
  opium: { outputFactor: number; demandFactor: number }
  politicalEconomy: PoliticalEconomy
  techLevel: number
  researching: string
  army: number
  navy: number
  manpower: number
  quality: number
  morale: number
  relations: Record<string, number>
  alliances: string[]
  rivals: string[]
  prestige: number
}

const leader = (
  name: string,
  title: string,
  age: number,
  persona: string,
  traits: string[],
  agenda: string,
  mood = 0,
): Leader => ({ name, title, age, persona, traits, agenda, mood, memory: [] })

export const COUNTRY_SEEDS: CountrySeed[] = [
  {
    id: 'QING',
    name: '大清',
    adjective: '大清',
    flag: '清',
    color: 'yellow',
    isMajor: true,
    leader: leader(
      '爱新觉罗·旻宁',
      '道光皇帝',
      54,
      '节俭而优柔的守成之君，对西夷既疑且惧，最怕祖宗基业在自己手里动摇。',
      ['保守', '谨慎', '禁烟'],
      '稳住白银与海防，不让鸦片与洋船掏空国本',
    ),
    government: '专制君主制',
    legitimacy: 58,
    authority: 70,
    pops: {
      total: 40000,
      peasants: 36000,
      workers: 1200,
      artisans: 2200,
      clergy: 300,
      aristocrats: 250,
      capitalists: 50,
      literacy: 0.12,
      radicals: 8,
      loyalists: 55,
      sol: 28,
    },
    gdp: 780,
    treasury: 13,
    tariff: 8,
    spending: spending(6, 0.8, 4, 1, 0.5, 1.5),
    buildings: buildings(3000, 35, 20, 0, 14, 4, 40, 4, 12),
    transportInfrastructure: 25,
    marketAccess: 0.45,
    unemployment: 6,
    resources: resources(85, 60, 65, 40),
    region: 'eastAsia',
    opium: { outputFactor: 0.15, demandFactor: 0.2 },
    politicalEconomy: politicalEconomy(0.62, 0.2, 0.4, -5),
    techLevel: 1,
    researching: '农业改良',
    army: 80,
    navy: 15,
    manpower: 2000,
    quality: 0.42,
    morale: 55,
    relations: { GBR: -15, FRA: -5, RUS: 10, JAP: -5, USA: 0, OTT: 0, PRU: 0, AUS: 0, SPA: 0 },
    alliances: [],
    rivals: ['GBR', 'JAP'],
    prestige: 40,
  },
  {
    id: 'GBR',
    name: '英国',
    adjective: '英国',
    flag: '英',
    color: 'blue',
    isMajor: true,
    leader: leader(
      '维多利亚',
      '女王',
      17,
      '年轻、好奇而自信，笃信进步、贸易与皇家海军；愿意为秩序付出代价，但绝不容许挑战海权。',
      ['扩张', '贸易', '海权'],
      '保护全球贸易航线，遏制任何欧陆霸主',
      5,
    ),
    government: '君主立宪制',
    legitimacy: 66,
    authority: 45,
    pops: {
      total: 2700,
      peasants: 600,
      workers: 1400,
      artisans: 350,
      clergy: 80,
      aristocrats: 50,
      capitalists: 220,
      literacy: 0.62,
      radicals: 12,
      loyalists: 60,
      sol: 62,
    },
    gdp: 640,
    treasury: 12,
    tariff: 5,
    spending: spending(4, 6, 2.5, 1.2, 1.5, 2),
    buildings: buildings(110, 90, 160, 25, 60, 18, 20, 14, 24),
    transportInfrastructure: 85,
    marketAccess: 0.9,
    unemployment: 8,
    resources: resources(45, 25, 100, 95),
    region: 'europe',
    opium: { outputFactor: 8.0, demandFactor: 0.02 },
    politicalEconomy: politicalEconomy(0.52, 0.42, 0.55, 10),
    techLevel: 6,
    researching: '钢铁工业',
    army: 25,
    navy: 120,
    manpower: 300,
    quality: 0.9,
    morale: 80,
    relations: { FRA: -20, RUS: -10, USA: -5, QING: -15, OTT: 10, PRU: 10, AUS: 5, JAP: 0, SPA: 5 },
    alliances: [],
    rivals: ['FRA', 'RUS'],
    prestige: 95,
  },
  {
    id: 'FRA',
    name: '法国',
    adjective: '法国',
    flag: '法',
    color: 'magenta',
    isMajor: true,
    leader: leader(
      '路易-菲利普',
      '法兰西国王',
      63,
      '精于算计的资产阶级国王，追求欧陆均势与商业利益，厌恶冒险但害怕被英国压过。',
      ['务实', '贸易', '均势'],
      '在欧洲大陆保持话语权，向阿尔及利亚与东方扩张',
      2,
    ),
    government: '君主立宪制',
    legitimacy: 52,
    authority: 40,
    pops: {
      total: 3400,
      peasants: 1800,
      workers: 900,
      artisans: 400,
      clergy: 90,
      aristocrats: 60,
      capitalists: 150,
      literacy: 0.5,
      radicals: 20,
      loyalists: 45,
      sol: 52,
    },
    gdp: 470,
    treasury: -2,
    tariff: 12,
    spending: spending(5, 3, 2.5, 1, 1.2, 1.8),
    buildings: buildings(260, 55, 95, 8, 30, 12, 30, 10, 16),
    transportInfrastructure: 60,
    marketAccess: 0.75,
    unemployment: 7,
    resources: resources(70, 55, 55, 60),
    region: 'europe',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.55, 0.35, 0.5, 5),
    techLevel: 5,
    researching: '机械化生产',
    army: 35,
    navy: 45,
    manpower: 500,
    quality: 0.82,
    morale: 75,
    relations: { GBR: -20, PRU: -5, RUS: 5, AUS: -5, QING: -5, OTT: 0, USA: 10, JAP: 0, SPA: 5 },
    alliances: [],
    rivals: ['GBR', 'PRU'],
    prestige: 75,
  },
  {
    id: 'PRU',
    name: '普鲁士',
    adjective: '普鲁士',
    flag: '普',
    color: 'cyan',
    isMajor: true,
    leader: leader(
      '腓特烈·威廉三世',
      '国王',
      66,
      '沉默严厉的军人国王，重视秩序、纪律与陆军，对革命思潮极度警惕。',
      ['军事', '秩序', '保守'],
      '统一德意志诸邦，维持一支令人生畏的陆军',
      0,
    ),
    government: '专制君主制',
    legitimacy: 62,
    authority: 58,
    pops: {
      total: 1400,
      peasants: 850,
      workers: 320,
      artisans: 130,
      clergy: 40,
      aristocrats: 30,
      capitalists: 30,
      literacy: 0.55,
      radicals: 9,
      loyalists: 62,
      sol: 50,
    },
    gdp: 210,
    treasury: 4,
    tariff: 8,
    spending: spending(4.5, 0.5, 1.8, 1.1, 0.8, 1.5),
    buildings: buildings(180, 70, 60, 6, 10, 11, 22, 8, 10),
    transportInfrastructure: 55,
    marketAccess: 0.7,
    unemployment: 5,
    resources: resources(60, 45, 80, 70),
    region: 'europe',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.54, 0.38, 0.55, 8),
    techLevel: 4,
    researching: '铁路时代',
    army: 25,
    navy: 8,
    manpower: 250,
    quality: 0.88,
    morale: 78,
    relations: { AUS: 15, RUS: 10, FRA: -5, GBR: 10, QING: 0, OTT: 0, USA: 0, JAP: 0, SPA: 0 },
    alliances: [],
    rivals: ['FRA', 'AUS'],
    prestige: 50,
  },
  {
    id: 'RUS',
    name: '俄国',
    adjective: '俄国',
    flag: '俄',
    color: 'green',
    isMajor: true,
    leader: leader(
      '尼古拉一世',
      '沙皇',
      40,
      '铁腕专制的宪兵，视革命为瘟疫，渴望黑海出海口与对奥斯曼的胜利。',
      ['专制', '扩张', '陆军'],
      '肢解奥斯曼、控制海峡，充当欧洲宪兵',
      -3,
    ),
    government: '专制君主制',
    legitimacy: 60,
    authority: 80,
    pops: {
      total: 6000,
      peasants: 5200,
      workers: 500,
      artisans: 200,
      clergy: 50,
      aristocrats: 40,
      capitalists: 10,
      literacy: 0.15,
      radicals: 10,
      loyalists: 58,
      sol: 30,
    },
    gdp: 380,
    treasury: 6,
    tariff: 15,
    spending: spending(6, 1.2, 3, 0.3, 0.4, 1),
    buildings: buildings(900, 70, 35, 2, 12, 6, 50, 6, 8),
    transportInfrastructure: 20,
    marketAccess: 0.5,
    unemployment: 4,
    resources: resources(80, 90, 40, 55),
    region: 'europe',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.63, 0.18, 0.35, -8),
    techLevel: 2,
    researching: '蒸汽机',
    army: 90,
    navy: 25,
    manpower: 900,
    quality: 0.62,
    morale: 65,
    relations: { OTT: -30, QING: 10, GBR: -10, AUS: 5, PRU: 10, FRA: 5, USA: 0, JAP: -5, SPA: 0 },
    alliances: [],
    rivals: ['OTT', 'GBR'],
    prestige: 70,
  },
  {
    id: 'AUS',
    name: '奥地利',
    adjective: '奥地利',
    flag: '奥',
    color: 'white',
    isMajor: true,
    leader: leader(
      '斐迪南一世',
      '皇帝',
      43,
      '体弱温和，实权旁落于梅特涅；帝国的多民族结构让任何改革都如履薄冰。',
      ['保守', '均势', '维稳'],
      '镇压民族主义，维持维也纳体系',
      0,
    ),
    government: '专制君主制',
    legitimacy: 54,
    authority: 50,
    pops: {
      total: 3300,
      peasants: 2300,
      workers: 600,
      artisans: 250,
      clergy: 70,
      aristocrats: 50,
      capitalists: 30,
      literacy: 0.35,
      radicals: 18,
      loyalists: 50,
      sol: 42,
    },
    gdp: 270,
    treasury: -5,
    tariff: 10,
    spending: spending(4, 0.6, 2.2, 0.6, 0.7, 1),
    buildings: buildings(420, 60, 45, 4, 5, 8, 30, 7, 10),
    transportInfrastructure: 45,
    marketAccess: 0.65,
    unemployment: 6,
    resources: resources(65, 65, 50, 45),
    region: 'europe',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.6, 0.22, 0.4, -3),
    techLevel: 3,
    researching: '铁路时代',
    army: 40,
    navy: 10,
    manpower: 400,
    quality: 0.68,
    morale: 66,
    relations: { PRU: 15, RUS: 5, FRA: -5, GBR: 5, QING: 0, OTT: 0, USA: 0, JAP: 0, SPA: 0 },
    alliances: [],
    rivals: ['PRU', 'FRA'],
    prestige: 60,
  },
  {
    id: 'USA',
    name: '美国',
    adjective: '美国',
    flag: '美',
    color: 'cyan',
    isMajor: true,
    leader: leader(
      '安德鲁·杰克逊',
      '总统',
      69,
      '民粹、好斗，信奉昭昭天命与平民政治，对银行与英国都缺乏耐心。',
      ['民粹', '扩张', '孤立'],
      '向西部与墨西哥扩张，同时避免卷入欧洲纷争',
      3,
    ),
    government: '民主制',
    legitimacy: 64,
    authority: 35,
    pops: {
      total: 1700,
      peasants: 800,
      workers: 500,
      artisans: 180,
      clergy: 60,
      aristocrats: 40,
      capitalists: 120,
      literacy: 0.45,
      radicals: 8,
      loyalists: 58,
      sol: 55,
    },
    gdp: 330,
    treasury: 14,
    tariff: 20,
    spending: spending(1.5, 1.2, 1.2, 0.8, 0.5, 1.5),
    buildings: buildings(300, 55, 55, 6, 25, 10, 12, 8, 8),
    transportInfrastructure: 50,
    marketAccess: 0.7,
    unemployment: 5,
    resources: resources(90, 85, 75, 70),
    region: 'americas',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.54, 0.4, 0.55, 12),
    techLevel: 3,
    researching: '蒸汽机',
    army: 12,
    navy: 15,
    manpower: 200,
    quality: 0.7,
    morale: 70,
    relations: { GBR: -5, FRA: 10, SPA: -5, QING: 0, RUS: 0, OTT: 0, PRU: 0, AUS: 0, JAP: 0 },
    alliances: [],
    rivals: ['GBR', 'SPA'],
    prestige: 45,
  },
  {
    id: 'JAP',
    name: '日本',
    adjective: '日本',
    flag: '日',
    color: 'red',
    isMajor: false,
    leader: leader(
      '德川家庆',
      '征夷大将军',
      43,
      '深居简出的将军，锁国体制的守夜人；对外的风吹草动都让他不安。',
      ['锁国', '保守', '谨慎'],
      '维持锁国与幕府权威，提防西夷叩关',
      0,
    ),
    government: '寡头制',
    legitimacy: 60,
    authority: 65,
    pops: {
      total: 2700,
      peasants: 2100,
      workers: 300,
      artisans: 200,
      clergy: 60,
      aristocrats: 30,
      capitalists: 10,
      literacy: 0.25,
      radicals: 6,
      loyalists: 60,
      sol: 32,
    },
    gdp: 210,
    treasury: 3,
    tariff: 5,
    spending: spending(2.5, 0.6, 1.5, 0.5, 0.3, 0.8),
    buildings: buildings(380, 22, 12, 0, 10, 4, 15, 4, 3),
    transportInfrastructure: 22,
    marketAccess: 0.4,
    unemployment: 3,
    resources: resources(45, 55, 20, 15),
    region: 'eastAsia',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.6, 0.24, 0.45, 0),
    techLevel: 1,
    researching: '农业改良',
    army: 15,
    navy: 8,
    manpower: 300,
    quality: 0.5,
    morale: 62,
    relations: { QING: -5, RUS: -5, GBR: 0, FRA: 0, USA: 0, OTT: 0, PRU: 0, AUS: 0, SPA: 0 },
    alliances: [],
    rivals: ['QING', 'RUS'],
    prestige: 30,
  },
  {
    id: 'OTT',
    name: '奥斯曼',
    adjective: '奥斯曼',
    flag: '土',
    color: 'green',
    isMajor: false,
    leader: leader(
      '马哈茂德二世',
      '苏丹',
      51,
      '锐意改革的苏丹，废禁卫军、学西法，却在俄国与列强的夹缝中苦苦支撑。',
      ['改革', '防御', '求生'],
      '推进坦志麦特改革，抵御俄国南下',
      1,
    ),
    government: '专制君主制',
    legitimacy: 48,
    authority: 55,
    pops: {
      total: 2500,
      peasants: 1900,
      workers: 300,
      artisans: 180,
      clergy: 70,
      aristocrats: 30,
      capitalists: 20,
      literacy: 0.12,
      radicals: 15,
      loyalists: 40,
      sol: 28,
    },
    gdp: 190,
    treasury: -7,
    tariff: 12,
    spending: spending(3, 0.8, 2, 0.3, 0.3, 0.6),
    buildings: buildings(420, 25, 14, 0, 12, 3, 22, 4, 4),
    transportInfrastructure: 18,
    marketAccess: 0.45,
    unemployment: 8,
    resources: resources(55, 45, 35, 30),
    region: 'middleEast',
    opium: { outputFactor: 0.5, demandFactor: 0.05 },
    politicalEconomy: politicalEconomy(0.62, 0.18, 0.35, -6),
    techLevel: 1,
    researching: '农业改良',
    army: 30,
    navy: 12,
    manpower: 400,
    quality: 0.55,
    morale: 58,
    relations: { RUS: -30, GBR: 10, FRA: 0, AUS: 0, QING: 0, PRU: 0, USA: 0, JAP: 0, SPA: 0 },
    alliances: [],
    rivals: ['RUS', 'AUS'],
    prestige: 35,
  },
  {
    id: 'SPA',
    name: '西班牙',
    adjective: '西班牙',
    flag: '西',
    color: 'yellow',
    isMajor: false,
    leader: leader(
      '玛丽亚·克里斯蒂娜',
      '摄政太后',
      30,
      '为幼主伊莎贝拉二世摄政，宫廷派系林立；殖民地正在从指缝间流失。',
      ['守成', '内斗', '殖民'],
      '保住美洲残存殖民地与王位继承',
      -2,
    ),
    government: '君主立宪制',
    legitimacy: 40,
    authority: 30,
    pops: {
      total: 1300,
      peasants: 700,
      workers: 300,
      artisans: 180,
      clergy: 60,
      aristocrats: 40,
      capitalists: 20,
      literacy: 0.25,
      radicals: 24,
      loyalists: 35,
      sol: 34,
    },
    gdp: 170,
    treasury: -11,
    tariff: 12,
    spending: spending(2, 0.8, 1.5, 0.4, 0.4, 0.6),
    buildings: buildings(220, 30, 20, 2, 14, 6, 14, 4, 4),
    transportInfrastructure: 35,
    marketAccess: 0.55,
    unemployment: 10,
    resources: resources(55, 40, 35, 45),
    region: 'europe',
    opium: { outputFactor: 0.1, demandFactor: 0.03 },
    politicalEconomy: politicalEconomy(0.61, 0.2, 0.4, -4),
    techLevel: 3,
    researching: '蒸汽机',
    army: 18,
    navy: 10,
    manpower: 150,
    quality: 0.6,
    morale: 58,
    relations: { FRA: 5, GBR: 5, USA: -5, QING: 0, RUS: 0, OTT: 0, PRU: 0, AUS: 0, JAP: 0 },
    alliances: [],
    rivals: ['USA', 'GBR'],
    prestige: 30,
  },
]

export function defaultSpending(): Spending {
  return spending(2, 1, 1.5, 1, 1, 1)
}

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const GOVERNMENT_BUREAUCRACY_BONUS: Record<string, number> = {
  专制君主制: -5,
  君主立宪制: 8,
  共和制: 10,
  民主制: 12,
  寡头制: -2,
}

const GOVERNMENT_CEILING_BONUS: Record<string, number> = {
  专制君主制: 10,
  君主立宪制: 20,
  共和制: 25,
  民主制: 30,
  寡头制: 12,
  神权制: 15,
}

export function administrativeCapacityFor(
  literacy: number,
  bureaucracySpending: number,
): number {
  return clampValue(20 + literacy * 40 + bureaucracySpending * 2, 0, 100)
}

/**
 * Bureaucratic effectiveness and the four constraints it feeds. With
 * `smooth` the score moves 15% toward its target (monthly); without it the
 * score snaps to the target (new worlds and migration).
 */
export function deriveBureaucracy(country: Country, smooth: boolean): Bureaucracy {
  const type = country.government.type
  const administrativeCapacity = applyModifiers(
    country,
    'administrativeCapacity',
    country.econ.administrativeCapacity,
  )
  const raw =
    0.30 * (country.econ.spending.bureaucracy * 10) +
    0.28 * (country.pops.literacy * 100) +
    0.18 * administrativeCapacity +
    0.14 * (GOVERNMENT_BUREAUCRACY_BONUS[type] ?? 0) +
    0.10 * (100 - country.pops.radicals)
  const ceiling = clampValue(
    applyModifiers(
      country,
      'bureaucracyCeiling',
      20 + country.econ.buildings.offices * 3 + (GOVERNMENT_CEILING_BONUS[type] ?? 0),
    ),
    20,
    100,
  )
  const target = clampValue(applyModifiers(country, 'bureaucracy', raw), 0, ceiling)
  const previous = country.bureaucracy?.score ?? target
  const score = smooth ? previous + (target - previous) * 0.15 : target
  return {
    score,
    ceiling,
    actionBudget: clampValue(1 + Math.floor(score / 25), 1, 5),
    fundEfficiency: clampValue(0.5 + score / 200, 0.5, 1),
    delayChance: clampValue(0.35 - score / 300, 0, 0.35),
    infoDistortion: clampValue(0.30 - score / 350, 0, 0.30),
  }
}

/** Unemployment follows factories, literacy and unrest (plan §7.4). */
export function deriveUnemployment(country: Country): number {
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  return clampValue(
    4 +
      (1 - country.econ.buildings.factories / Math.max(1, popFactor * 3)) * 30 +
      country.pops.radicals * 0.15 -
      country.pops.literacy * 10,
    0,
    30,
  )
}

export type LaborStats = {
  /** Ten-thousands of workers the building stock wants. */
  demand: number
  /** Ten-thousands of available workers. */
  force: number
  /** Raw demand/force ratio; can be far below 0.5 in agrarian economies. */
  raw: number
  /** 0.5..1, plan 0003 §0.1's stability floor. */
  utilization: number
}

/**
 * Labour demand from the building stock and the available labour force.
 * Utilisation is clamped at 0.5 so an agrarian economy with a vast peasantry
 * does not read as 95% idle; the floor is the plan's stability bound.
 */
export function deriveLabor(country: Country): LaborStats {
  const b = country.econ.buildings
  const laborOf = (id: BuildingId): number => BUILDING_RECIPES[id].labor
  const demand =
    b.farms * laborOf('farms') +
    b.mines * laborOf('mines') +
    b.factories * laborOf('factories') +
    b.railroads * laborOf('railroads') +
    b.ports * laborOf('ports') +
    b.offices * laborOf('offices') +
    b.universities * laborOf('universities') +
    b.barracks * laborOf('barracks')
  const force = country.pops.peasants * 0.6 + country.pops.workers + country.pops.artisans
  const raw = demand / Math.max(1, force)
  const utilization = clampValue(raw, 0.5, 1)
  return { demand, force, raw, utilization }
}

/**
 * Static resource multiplier for one good: endowments map through
 * `RESOURCE_MAP`, each point of endowment moves the good ±0.3 and the final
 * multiplier is clamped to 0.7..1.3 (plan 0003 §5).
 */
export function resourceMultiplier(
  endowment: Resources,
  good: GoodId,
): number {
  let factor = 0
  for (const id of RESOURCE_IDS) {
    const weight = RESOURCE_MAP[id].goods[good]
    if (weight === undefined) continue
    factor += weight * ((endowment[id] - 50) / 50) * 0.3
  }
  return clampValue(1 + factor, 0.7, 1.3)
}

/**
 * Effective building count after scale diminishing returns. Capacity grows as
 * count^0.98, so a large stock yields slightly less per building.
 */
export function effectiveCount(count: number): number {
  return count <= 0 ? 0 : count ** 0.98
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
        goods: zeroGoods(),
        prices: basePrices(),
        transportInfrastructure: seedRow.transportInfrastructure,
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
      tech: {
        level: seedRow.techLevel,
        points: 0,
        pointsPerMonth: 0,
        researching: seedRow.researching,
        unlocked: TECHS.filter(tech => tech.level <= seedRow.techLevel).map(tech => tech.name),
      },
      military: {
        army: seedRow.army,
        navy: seedRow.navy,
        manpower: seedRow.manpower,
        quality: seedRow.quality,
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
    version: 10,
    seed,
    date: { year: START_YEAR, month: START_MONTH },
    tick: 0,
    playerId,
    countries,
    wars: [],
    indemnities: [],
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

export function otherCountryIds(world: WorldState, countryId: string): string[] {
  return Object.keys(world.countries).filter(id => id !== countryId)
}

export function pickRival(world: WorldState, country: Country, rng: Rng): string {
  const rivals = country.diplo.rivals.filter(id => world.countries[id])
  if (rivals.length > 0) return rng.pick(rivals)
  const others = otherCountryIds(world, country.id)
  return rng.pick(others)
}

type EventTemplate = {
  kind: string
  title: string
  weight: number
  when?: (country: Country) => boolean
  text: (country: Country) => string
  options: (country: Country) => EventOption[]
}

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    kind: 'harvest',
    title: '丰年',
    weight: 14,
    text: c => `${c.name}各地风调雨顺，粮仓充盈，市集上的粮价应声回落。`,
    options: () => [
      {
        id: 'celebrate',
        label: '开仓平粜，与民同乐',
        result: '粮价稳定，民心稍安。',
        effects: {
          treasury: 2,
          legitimacy: 3,
          radicals: -2,
          modifiers: [
            { stat: 'sol', stack: 'flat', value: 2, months: 6, label: '丰年余庆' },
            { stat: 'growth', stack: 'percent', value: 10, months: 6, label: '丰年余庆' },
          ],
        },
      },
      {
        id: 'store',
        label: '囤积粮食，以备荒年',
        result: '国库多了些底气，百姓却觉得官府小气。',
        effects: {
          treasury: 4,
          legitimacy: -1,
          radicals: 1,
          modifiers: [
            { stat: 'income', stack: 'percent', value: 4, months: 6, label: '囤粮溢价' },
          ],
        },
      },
    ],
  },
  {
    kind: 'famine',
    title: '饥荒',
    weight: 10,
    // A famine needs an actual grain shortage, not merely low living
    // standards: grain priced above its base level (PT-025).
    when: c =>
      c.pops.sol < 45 &&
      (c.econ.prices.grain ?? GOODS.grain.basePrice) >=
        GOODS.grain.basePrice * 1.05,
    text: c => `${c.name}部分产粮区歉收，流民开始向城市聚集。`,
    options: c => [
      {
        id: 'relief',
        label: '开仓赈济',
        result: '灾民得到接济，地方秩序尚能维持。',
        effects: { treasury: -Math.max(2, c.econ.gdp * 0.006), radicals: -4, legitimacy: 2 },
      },
      {
        id: 'ignore',
        label: '责成地方自筹',
        result: '赈灾不力，怨声载道。',
        effects: { popsPercent: -0.4, radicals: 7, legitimacy: -4 },
      },
    ],
  },
  {
    kind: 'boom',
    title: '工业繁荣',
    weight: 12,
    when: c => c.econ.buildings.factories >= 20,
    text: c => `${c.name}的工厂昼夜开工，商人们争相订购机器与煤炭。`,
    options: () => [
      {
        id: 'invest',
        label: '鼓励投资，扩大生产',
        result: '工业资本加速积累。',
        effects: {
          treasury: -2,
          techPoints: 35,
          radicals: -1,
          modifiers: [
            { stat: 'factoryOutput', stack: 'percent', value: 10, months: 12, label: '工业投资' },
            { stat: 'techPoints', stack: 'percent', value: 10, months: 12, label: '工业投资' },
          ],
        },
      },
      {
        id: 'tax',
        label: '加征工商税',
        result: '国库充盈，工厂主怨声载道。',
        effects: { treasury: 5, radicals: 4 },
      },
    ],
  },
  {
    kind: 'slump',
    title: '经济萧条',
    weight: 9,
    when: c => c.econ.marketAccess > 0.4,
    text: c => `${c.name}的市场出现滞销，银行收紧信贷，工场开始裁员。`,
    options: c => [
      {
        id: 'bailout',
        label: '政府出面救市',
        result: '市场暂时稳住，财政背上包袱。',
        effects: {
          treasury: -Math.max(3, c.econ.gdp * 0.01),
          radicals: -3,
          modifiers: [
            { stat: 'income', stack: 'percent', value: 5, months: 6, label: '救市余波' },
            { stat: 'expense', stack: 'percent', value: 5, months: 6, label: '救市余波' },
          ],
        },
      },
      {
        id: 'austerity',
        label: '紧缩开支，任其出清',
        result: '失业上升，街头开始出现骚动。',
        effects: { treasury: 3, radicals: 7, legitimacy: -2 },
      },
    ],
  },
  {
    kind: 'revolution',
    title: '革命浪潮',
    weight: 18,
    when: c => c.pops.radicals >= 25,
    text: c => `${c.name}的城市里出现秘密结社与传单，激进分子要求立宪与普选。`,
    options: c => [
      {
        id: 'repress',
        label: '出动军队镇压',
        result: '街头恢复秩序，但血债被记下了。',
        effects: { army: -1.5, radicals: 5, legitimacy: -3, prestige: 2 },
      },
      {
        id: 'reform',
        label: '宣布有限改革',
        result: '改革派暂时满意，保守派开始不安。',
        effects: { treasury: -Math.max(2, c.econ.gdp * 0.008), radicals: -9, legitimacy: 6 },
      },
    ],
  },
  {
    kind: 'border',
    title: '边疆危机',
    weight: 10,
    text: c => `${c.name}的边境传出摩擦：邻国的巡逻队越过了界河。`,
    options: () => [
      {
        id: 'hard',
        label: '增兵边境，寸土不让',
        result: '国内民族情绪高涨，外交局势紧张。',
        effects: { treasury: -2, prestige: 4, relationTarget: '@rival', relationAmount: -12 },
      },
      {
        id: 'talk',
        label: '派使节谈判',
        result: '危机暂时化解，但被指软弱。',
        effects: { prestige: -2, relationTarget: '@rival', relationAmount: 8 },
      },
    ],
  },
  {
    kind: 'breakthrough',
    title: '技术突破',
    weight: 8,
    when: c => c.tech.level >= 2,
    text: c => `${c.name}的学者与工程师取得进展，一项新技术正走出实验室。`,
    options: () => [
      {
        id: 'fund',
        label: '追加拨款，尽快应用',
        result: '技术加速落地。',
        effects: { treasury: -3, techPoints: 70 },
      },
      {
        id: 'shelve',
        label: '先存档，等待时机',
        result: '知识被保存下来，但进展缓慢。',
        effects: { techPoints: 15 },
      },
    ],
  },
  {
    kind: 'succession',
    title: '领袖病重',
    weight: 6,
    when: c => c.leader.age >= 55,
    text: c => `${c.name}的${c.leader.title}${c.leader.name}身体抱恙，宫廷开始讨论继承问题。`,
    options: () => [
      {
        id: 'pray',
        label: '举行仪式，稳定人心',
        result: '宫廷秩序暂时无虞。',
        effects: { treasury: -1, legitimacy: 3 },
      },
      {
        id: 'prepare',
        label: '迎立新君，完成交接',
        result: '新领袖走上台前，旧时代的阴影仍在。',
        effects: { legitimacy: -2, radicals: 3, prestige: 1, succeed: true },
      },
    ],
  },
  {
    kind: 'colony',
    title: '殖民地动荡',
    weight: 7,
    when: c => c.diplo.prestige >= 40,
    text: c => `${c.name}的海外领地传来叛乱的消息，当地驻军请求增援。`,
    options: () => [
      {
        id: 'send',
        label: '派兵镇压',
        result: '叛乱被扑灭，帝国威严得以维持。',
        effects: { treasury: -3, army: -1, prestige: 5, radicals: 1 },
      },
      {
        id: 'concede',
        label: '给予有限自治',
        result: '殖民地暂时平静，国内强硬派不满。',
        effects: { treasury: 1, prestige: -4, radicals: 2 },
      },
    ],
  },
  {
    kind: 'diplomatic',
    title: '外交照会',
    weight: 9,
    text: c => `${c.name}收到一份措辞强硬的外交照会，对方要求重新划定势力范围。`,
    options: () => [
      {
        id: 'accept',
        label: '接受条件，换取和平',
        result: '风波平息，但威望受损。',
        effects: { prestige: -3, relationTarget: '@rival', relationAmount: 15 },
      },
      {
        id: 'reject',
        label: '严词拒绝',
        result: '国内舆论叫好，两国关系骤然紧张。',
        effects: { prestige: 3, relationTarget: '@rival', relationAmount: -15 },
      },
    ],
  },
]

export function spawnEvent(
  world: WorldState,
  country: Country,
  rng: Rng,
  forcedKind?: string,
): GameEvent | undefined {
  const candidates = EVENT_TEMPLATES.filter(template => {
    if (forcedKind !== undefined && template.kind !== forcedKind) return false
    if (template.kind === forcedKind) return true
    return template.when === undefined || template.when(country)
  })
  if (candidates.length === 0) return undefined

  const total = candidates.reduce((sum, template) => sum + template.weight, 0)
  let roll = rng.next() * total
  let chosen = candidates[candidates.length - 1] as EventTemplate
  for (const template of candidates) {
    roll -= template.weight
    if (roll <= 0) {
      chosen = template
      break
    }
  }

  const rivalId = pickRival(world, country, rng)
  const options = chosen.options(country).map(option => ({
    ...option,
    effects: {
      ...option.effects,
      ...(option.effects.relationTarget === '@rival'
        ? { relationTarget: rivalId }
        : {}),
    },
  }))

  return {
    id: `ev-${world.tick}-${country.id}-${rng.int(9999)}`,
    date: { ...world.date },
    kind: chosen.kind,
    title: chosen.title,
    text: chosen.text(country),
    countryId: country.id,
    options,
    isResolved: false,
  }
}

const SUCCESSORS: Record<
  string,
  { name: string; age: number; persona: string; traits: string[]; agenda: string }[]
> = {
  QING: [
    {
      name: '爱新觉罗·奕詝',
      age: 25,
      persona: '敏感而多思的年轻皇帝，在改革与守旧之间摇摆，急于证明自己。',
      traits: ['谨慎', '改革'],
      agenda: '整饬吏治、应对西夷叩关',
    },
    {
      name: '爱新觉罗·载淳',
      age: 18,
      persona: '在宫廷斗争中长大的幼主，对权臣既依赖又戒备。',
      traits: ['保守', '猜忌'],
      agenda: '稳住宫廷与地方督抚',
    },
  ],
  GBR: [
    {
      name: '阿尔伯特·爱德华',
      age: 28,
      persona: '善于社交、热衷外交的继承人，相信帝国的秩序靠舰队与条约维系。',
      traits: ['外交', '海权'],
      agenda: '维系欧洲均势与全球航线',
    },
    {
      name: '乔治·弗雷德里克',
      age: 32,
      persona: '沉稳的海军派王储，对工业与劳工问题同样敏感。',
      traits: ['稳健', '海权'],
      agenda: '扩大海军优势，安抚工业城市',
    },
  ],
  FRA: [
    {
      name: '路易-拿破仑·波拿巴',
      age: 30,
      persona: '野心勃勃的波拿巴继承者，梦想恢复帝国的荣光。',
      traits: ['扩张', '民粹'],
      agenda: '打破维也纳体系，争取欧陆霸权',
    },
    {
      name: '弗朗索瓦·基佐',
      age: 45,
      persona: '冷静的资产阶级政治家，相信秩序、财产与渐进改革。',
      traits: ['务实', '保守'],
      agenda: '稳定财政与议会秩序',
    },
  ],
  PRU: [
    {
      name: '腓特烈·威廉四世',
      age: 35,
      persona: '浪漫而矛盾的国王，既想改革又畏惧革命。',
      traits: ['保守', '犹豫'],
      agenda: '在专制与立宪之间寻找平衡',
    },
    {
      name: '威廉一世',
      age: 40,
      persona: '铁一般的军人国王，坚信普鲁士的命运系于陆军。',
      traits: ['军事', '秩序'],
      agenda: '扩军、统一德意志',
    },
  ],
  RUS: [
    {
      name: '亚历山大二世',
      age: 25,
      persona: '受过良好教育的改革者，试图在专制框架内完成现代化。',
      traits: ['改革', '务实'],
      agenda: '废除农奴制、推进工业化',
    },
    {
      name: '亚历山大三世',
      age: 28,
      persona: '强硬的反动派，认为一切改革都会动摇帝国。',
      traits: ['专制', '保守'],
      agenda: '镇压异见、强化中央集权',
    },
  ],
  AUS: [
    {
      name: '弗朗茨·约瑟夫一世',
      age: 20,
      persona: '勤勉而固执的年轻皇帝，背负着多民族帝国的沉重包袱。',
      traits: ['保守', '维稳'],
      agenda: '维持帝国完整与维也纳体系',
    },
    {
      name: '卡尔大公',
      age: 35,
      persona: '有军事才能的皇族，主张以武力压制民族主义。',
      traits: ['军事', '保守'],
      agenda: '强化陆军、镇压分离主义',
    },
  ],
  USA: [
    {
      name: '马丁·范布伦',
      age: 45,
      persona: '精明的政党操盘手，优先考虑联邦稳定与商业利益。',
      traits: ['务实', '贸易'],
      agenda: '维持联邦、避免卷入欧洲战争',
    },
    {
      name: '约翰·泰勒',
      age: 40,
      persona: '坚定的州权派，对扩张与奴隶制问题态度强硬。',
      traits: ['扩张', '民粹'],
      agenda: '向西部与南方扩张',
    },
  ],
  JAP: [
    {
      name: '德川家定',
      age: 30,
      persona: '体弱而内向的将军，幕府内部派系开始公开角力。',
      traits: ['保守', '犹豫'],
      agenda: '维持锁国与幕府权威',
    },
    {
      name: '德川家茂',
      age: 22,
      persona: '年轻的将军，面对黑船与倒幕浪潮不得不做出选择。',
      traits: ['谨慎', '改革'],
      agenda: '在开国与攘夷之间周旋',
    },
  ],
  OTT: [
    {
      name: '阿卜杜勒-迈吉德一世',
      age: 22,
      persona: '受过西式教育的苏丹，决心把坦志麦特改革推进到底。',
      traits: ['改革', '求生'],
      agenda: '现代化军队与行政、抵御俄国',
    },
    {
      name: '阿卜杜勒-阿齐兹',
      age: 30,
      persona: '性格刚愎的苏丹，试图用海军与外交挽回帝国颓势。',
      traits: ['强硬', '防御'],
      agenda: '重建舰队、守住海峡',
    },
  ],
  SPA: [
    {
      name: '伊莎贝拉二世',
      age: 18,
      persona: '在宫廷阴谋中长大的女王，性格任性而缺乏安全感。',
      traits: ['内斗', '守成'],
      agenda: '保住王位与殖民地',
    },
    {
      name: '卡洛斯王子',
      age: 35,
      persona: '以正统王位继承者自居的强硬派，得到保守派与教会的支持。',
      traits: ['保守', '强硬'],
      agenda: '推翻自由派政府、恢复旧秩序',
    },
  ],
}

export function successorFor(country: Country, rng: Rng): Leader {
  const pool = SUCCESSORS[country.id] ?? []
  const picked = pool.length > 0 ? rng.pick(pool) : undefined
  return {
    name: picked?.name ?? `${country.adjective}新君`,
    title: country.leader.title,
    age: picked?.age ?? 30 + rng.int(25),
    persona: picked?.persona ?? '一位在动荡中继位的新领袖，尚未证明自己。',
    traits: picked?.traits ?? ['谨慎', '未知'],
    mood: rng.range(-10, 10),
    agenda: picked?.agenda ?? '巩固权力，应对继承危机',
    memory: [`继位于${country.leader.name}之后`],
  }
}

export function makeRngForWorld(world: WorldState): Rng {
  return makeRng(world.seed + world.tick * 7919)
}
