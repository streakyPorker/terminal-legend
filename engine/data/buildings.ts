import type { BuildingId, GoodId, ModifierStat, ResourceId } from '../../types'

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
 * under `'labor'` the industrial core's industry cannot be made profitable
 * without breaking the 20% aggregate ceiling: with `'labor'`, the calibrated
 * recipe leaves GBR at ~4% industrial margin at 20.7% aggregate, and any recipe
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

/** Investment goods required per project-month, per building (plan 0003 §2.2). */
export const INVESTMENT_DEMAND: Record<BuildingId, Partial<Record<GoodId, number>>> = {
  farms: { wood: 0.12, furniture: 0.02 },
  // The three extraction buildings (plan 0011 F2). Steel, not ore, is the worked
  // metal every project buys (plan 0011 F1 moved investment demand off `iron`).
  coalMines: { steel: 0.1, machinery: 0.03, wood: 0.1 },
  ironMines: { steel: 0.05, machinery: 0.03, wood: 0.1 },
  lumberMills: { wood: 0.05, machinery: 0.02 },
  // Plan 0011 F3: the bundled factory split into seven industrial buildings.
  // Every project buys the worked metal (`steel`), never raw ore (plan 0011 F1).
  textileMills: { steel: 0.1, machinery: 0.1, wood: 0.1 },
  furnitureWorks: { wood: 0.2, steel: 0.08, machinery: 0.05 },
  distilleries: { steel: 0.1, machinery: 0.05, wood: 0.1 },
  machineryWorks: { steel: 0.2, machinery: 0.1 },
  steelMills: { steel: 0.15, machinery: 0.1 },
  arsenals: { steel: 0.2, machinery: 0.1 },
  luxuryWorks: { steel: 0.1, machinery: 0.1, fabric: 0.05 },
  railroads: { steel: 0.5, machinery: 0.16, wood: 0.4 },
  ports: { wood: 0.3, steel: 0.1 },
  universities: { furniture: 0.12, wood: 0.05 },
  barracks: { wood: 0.1, furniture: 0.05 },
  offices: { furniture: 0.1, wood: 0.05 },
  workshops: { wood: 0.3, steel: 0.2, furniture: 0.05 },
  // Plan 0011 F4: five new buildings. As after F1, every project buys the
  // worked metal (`steel`), never raw ore — so telegraphs use `steel` even
  // though the plan draft listed `iron`.
  schools: { furniture: 0.1, wood: 0.05 },
  canals: { wood: 0.2, steel: 0.15, machinery: 0.05 },
  telegraphs: { steel: 0.1, wood: 0.15 },
  forts: { steel: 0.15, wood: 0.15 },
  navalYards: { wood: 0.3, steel: 0.2, machinery: 0.1 },
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
  coalMines: { coal: 0.96 },
  ironMines: { iron: 0.96 },
  lumberMills: { wood: 0.96 },
  // F3: legacy shortage weights split off the old factories row (kept in the
  // same proportions so the private-investment ranking signal is unchanged).
  textileMills: { fabric: 0.6, clothes: 0.38 },
  furnitureWorks: { furniture: 0.22 },
  distilleries: { liquor: 0.2 },
  machineryWorks: { machinery: 0.09 },
  steelMills: { steel: 0.09 },
  arsenals: { arms: 0.07 },
  luxuryWorks: { luxury: 0.035 },
  railroads: {},
  ports: {},
  universities: {},
  barracks: { arms: 0.05 },
  offices: {},
  workshops: {},
  // Plan 0011 F4: the new buildings are public/military works. Empty here means
  // private investment never picks them (like universities/offices), so they are
  // only built by the state/AI and cannot perturb the goods calibration baseline.
  schools: {},
  canals: {},
  telegraphs: {},
  forts: {},
  navalYards: {},
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
  /**
   * Retired as a per-recipe gate by plan 0011 F5: infrastructure is now the
   * single unified pool multiplier in `computeProduction`, applied to every
   * building, not a flag a recipe opts into. Field kept for forward compatibility.
   */
  infrastructure?: boolean
  /** Market-access multiplier (0.55 + marketAccess × 0.9). */
  access?: boolean
  /** Coal/iron endowment factor (0.7..1.3), applied to industrial buildings. */
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
   * building's default gates (e.g. farms' wood, distilleries' liquor).
   */
  outputGates?: Partial<Record<GoodId, RecipeGates>>
  /** Building-category output modifier seam (farmOutput/mineOutput/factoryOutput). */
  outputModifier?: ModifierStat
}

/**
 * B1 copied these from the literals previously hardcoded in `computeProduction`
 * and the per-building intermediate block in `computeDemand`; B5 (plan 0008 §5)
 * then recalibrated the industrial row (details in plan 0008 B5). It cut the
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
    gates: { tech: true, access: true },
    outputGates: { wood: {} },
    outputModifier: 'farmOutput',
  },
  coalMines: {
    output: { coal: 0.96 },
    input: {},
    labor: 0.6,
    gates: { tech: true },
    outputModifier: 'mineOutput',
  },
  ironMines: {
    output: { iron: 0.96 },
    input: {},
    labor: 0.6,
    gates: { tech: true },
    outputModifier: 'mineOutput',
  },
  lumberMills: {
    output: { wood: 0.96 },
    input: {},
    labor: 0.4,
    gates: { tech: true },
    outputModifier: 'mineOutput',
  },
  // Plan 0011 F3: the bundled `factories` row is split into seven single/few-
  // output industrial buildings. Outputs are `old_factory_output / valueShare`
  // so the national supply of every industrial good is conserved across the
  // split (the same conservation move F2 made for the mines); inputs reproduce
  // the old factory's per-factory consumption basket — grain to textiles/
  // distilleries, the ore to the smelters, the fabric to furniture/luxury, and
  // coal/wood/machinery (industrial working capital) to every type — so the
  // aggregate input bill, and with it the old ~16% margin band, is preserved.
  // The per-building gates are the old
  // `{tech, industrial}` pair, with the old liquor-only-industrial override kept
  // on `distilleries`. All seven share the `factoryOutput` seam.
  textileMills: {
    output: { fabric: 1.45, clothes: 0.68 },
    input: { grain: 1.0, coal: 0.18, wood: 0.1, machinery: 0.18 },
    labor: 0.9,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  furnitureWorks: {
    output: { furniture: 1.54 },
    input: { wood: 0.06, coal: 0.1, fabric: 0.7, steel: 0.18, machinery: 0.1 },
    labor: 0.7,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  distilleries: {
    output: { liquor: 1.9 },
    input: { grain: 1.35, coal: 0.2, wood: 0.11, machinery: 0.19 },
    labor: 0.6,
    gates: { tech: true, industrial: true },
    // The old bundled factory gated liquor by `industrial` alone (plan 0011 F3).
    outputGates: { liquor: { industrial: true } },
    outputModifier: 'factoryOutput',
  },
  machineryWorks: {
    output: { machinery: 0.8 },
    input: { steel: 0.55, coal: 0.2, wood: 0.1, machinery: 0.18 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  steelMills: {
    output: { steel: 4.0 },
    // Ore (raw `iron`) + coal are smelted into steel: the only consumer of ore.
    input: { iron: 3.2, coal: 1.0, machinery: 0.1 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  arsenals: {
    output: { arms: 1.0 },
    input: { steel: 0.36, machinery: 0.18, coal: 0.12, iron: 0.18 },
    labor: 0.9,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  luxuryWorks: {
    output: { luxury: 0.48 },
    input: { fabric: 1.5, coal: 0.26, wood: 0.14, machinery: 0.24 },
    labor: 0.8,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
  },
  // Plan 0011 F4. `schools` is the one new service producer (primary education);
  // `canals`/`telegraphs` are no-output infrastructure cost centres (their
  // transport side effect lands in `completeBuilding`; the unified infra supply
  // is F5); `forts`/`navalYards` produce a small military good (arms / machinery).
  schools: {
    output: { services: 0.1 },
    input: {},
    labor: 0.15,
    gates: { access: true },
  },
  canals: {
    output: {},
    input: { wood: 0.05 },
    labor: 0.3,
  },
  telegraphs: {
    output: {},
    input: { wood: 0.02, iron: 0.02 },
    labor: 0.2,
  },
  forts: {
    output: { arms: 0.08 },
    input: { steel: 0.02, wood: 0.03 },
    labor: 0.3,
    gates: { tech: true, industrial: true },
  },
  navalYards: {
    output: { machinery: 0.14 },
    input: { steel: 0.08, wood: 0.08 },
    labor: 0.8,
    gates: { tech: true, industrial: true },
  },
  railroads: {
    output: {},
    input: { steel: 0.5, wood: 0.4 },
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

/**
 * Forward-compatible building unlock contract (plan 0011 F6, ADR 0026 §5).
 * A building is gated behind `unlock.techLevel` when that field is set: the
 * `build` action then requires `country.tech.level >= unlock.techLevel`.
 * `unlock` absent, or `techLevel` absent, means always buildable. No building
 * sets a threshold yet — the real tech tree is plan 0005, so today every
 * building stays bit-for-bit buildable.
 */
export type BuildingUnlock = { techLevel?: number }

export type BuildingDef = {
  name: string
  cost: number
  note: string
  /** Forward-compat tech gate (plan 0005); absent = always buildable (F6). */
  unlock?: BuildingUnlock
  infrastructureNeed: number
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  // Plan 0011 F5: `infrastructureNeed` is the per-building monthly draw on the
  // unified national infrastructure pool (ADR 0026 §3). Heavy industry draws the
  // most, light industry less, and subsistence agriculture draws none (a single
  // QING seed carries ~3000 farms, so even a small per-farm need would swamp the
  // national pool — the plan's draft 0.4 produced a 0.016 ratio). All values are
  // the F5 calibration; F7 re-tunes.
  // Plan 0011 F6: `unlock` is the forward-compat tech gate; all 22 buildings
  // leave it absent (always buildable) so this slice stays behaviour-preserving.
  farms: { name: '农场', cost: 1.5, note: '粮食与原料，吸纳农业人口', infrastructureNeed: 0 },
  coalMines: { name: '煤矿', cost: 2.5, note: '煤炭，工业与钢铁的燃料', infrastructureNeed: 0.15 },
  ironMines: { name: '铁矿', cost: 2.5, note: '铁矿石，钢铁厂的原料', infrastructureNeed: 0.15 },
  lumberMills: { name: '伐木场', cost: 2, note: '木材，建造与家具的原料', infrastructureNeed: 0.12 },
  textileMills: { name: '纺织厂', cost: 4, note: '布料与成衣，轻工业的起点', infrastructureNeed: 0.18 },
  furnitureWorks: { name: '家具厂', cost: 3.5, note: '家具，木材与钢铁的下游', infrastructureNeed: 0.15 },
  distilleries: { name: '酿酒厂', cost: 3.5, note: '酒类，粮食的下游消费', infrastructureNeed: 0.12 },
  machineryWorks: { name: '机械厂', cost: 5, note: '机械，钢铁与煤的下游', infrastructureNeed: 0.18 },
  steelMills: { name: '钢铁厂', cost: 5, note: '钢铁，铁矿石与煤的冶炼', infrastructureNeed: 0.22 },
  arsenals: { name: '兵工厂', cost: 4.5, note: '军械，钢铁与机械的军工', infrastructureNeed: 0.15 },
  luxuryWorks: { name: '奢侈品厂', cost: 5, note: '奢侈品，布料与煤的高端制造', infrastructureNeed: 0.09 },
  schools: { name: '学校', cost: 2, note: '初等教育，产出服务并在建成时提升识字率', infrastructureNeed: 0.03 },
  canals: { name: '运河', cost: 6, note: '内河航运，供给统一基础设施与市场接入', infrastructureNeed: 0.05 },
  telegraphs: { name: '电报', cost: 4, note: '电报通信，供给统一基础设施与市场接入', infrastructureNeed: 0.06 },
  forts: { name: '要塞', cost: 4, note: '国防工事，产少量军械', infrastructureNeed: 0.05 },
  navalYards: { name: '船坞', cost: 5, note: '造舰产能，产少量机械', infrastructureNeed: 0.15 },
  railroads: { name: '铁路', cost: 7, note: '统一基础设施的主要供给与市场接入', infrastructureNeed: 0.08 },
  ports: { name: '港口', cost: 3, note: '统一基础设施供给、市场接入与关税收入', infrastructureNeed: 0.12 },
  universities: { name: '大学', cost: 5, note: '科技点数、识字率与行政能力', infrastructureNeed: 0.05 },
  barracks: { name: '兵营', cost: 2.5, note: '军械产出', infrastructureNeed: 0.09 },
  offices: { name: '官署', cost: 3, note: '行政能力与官僚效能上限', infrastructureNeed: 0.08 },
  workshops: { name: '营造所', cost: 3, note: '消耗木材、粮食与铁，产出建造点', infrastructureNeed: 0.12 },
}

/** Months a project of each kind takes, before bureaucratic delay. */
export const BUILDING_TIME: Record<BuildingId, number> = {
  farms: 2,
  coalMines: 3,
  ironMines: 3,
  lumberMills: 2,
  textileMills: 4,
  furnitureWorks: 3,
  distilleries: 3,
  machineryWorks: 5,
  steelMills: 5,
  arsenals: 4,
  luxuryWorks: 4,
  schools: 3,
  canals: 6,
  telegraphs: 2,
  forts: 4,
  navalYards: 5,
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

// ---------------------------------------------------------------- infrastructure
// Plan 0011 F5 / ADR 0026: ONE national infrastructure pool. The old
// accumulated `transportInfrastructure` scalar becomes a DERIVED reading of this
// model — the same field now stores the unified level `clamp(100 × supply/demand,
// 0, 100)`, recomputed from building counts. The derived readers live in
// `./derivations.ts`; these are the declarative coefficients they read.

/** Infrastructure each provider building adds per month (plan §4.1). */
export const INFRA_SUPPLY: Partial<Record<BuildingId, number>> = {
  railroads: 2.5,
  ports: 1.1,
  canals: 1.6,
  telegraphs: 0.7,
}

/** Shortfall-multiplier floor: a linear debuff cannot bite harder than this. */
export const INFRA_MULT_FLOOR = 0.35

/** Infrastructure running costs: throughput scales with supply, admin with level. */
export const INFRA_UPKEEP: {
  throughput: Partial<Record<GoodId, number>>
  admin: Partial<Record<GoodId, number>>
} = {
  throughput: { wood: 0.01, coal: 0.015, services: 0.02 },
  admin: { services: 0.01 },
}

/**
 * The seven industrial types the bundled `factories` split into (plan 0011 F3).
 * They share the seed-split share, the `industry` config condition stat, and
 * every proxy that used to read `buildings.factories` (urbanisation, artisan
 * shift, unemployment, the `boom` event).
 */
export const INDUSTRIAL_BUILDING_IDS: BuildingId[] = [
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
]
