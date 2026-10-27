// Type contract for terminal-legend.
// Self-contained by design: the engine loads it as the plugin's `types` entry
// and type-checks every `$.state` key the hooks module names against it.
// World model v11: on top of v10's design, `iron` is raw ore (铁矿石) and a new
// `steel` (钢铁) good carries the worked metal — steel mills smelt ore + coal into
// steel and the heavy consumers (construction, railroads, investment) buy it
// (plan 0011 F1). F2 split the bundled mines into coal/iron/lumber; F3 split the
// bundled `factories` into seven single/few-output industrial buildings (plan
// 0011 F3). v10: taxes come from four real bases (land / per-building profit /
// final consumption / tariff, `Economy.taxes` + `Economy.taxBaseQty`), never
// from GDP (ADR 0023). Every building type carries a declarative production
// recipe (`BUILDING_RECIPES`, engine/data/buildings.ts) that is the single source of truth
// for output AND intermediate input (ADR 0021), and each country stores a
// per-building-type profit snapshot (`Economy.buildingProfits`). Persistent
// bilateral trade routes still sit in front of the spot clearing (ADR 0020);
// bilateral quantities, NX accounting, gold settlement and resource imports
// remain live (plan 0004 T1a/T1b).
// v12 folded railroads/ports/telegraphs into one `infrastructure` building
// (plan 0014 / ADR 0029). v13 (plan 0005 K1) replaces the linear 1–10 tech
// level with the `TechState` 4-era / 16-node tree; a derived `techTier`
// (`1 + era×1.5 + unlocked×0.05`) keeps the old `1 + tier×0.07` multiplier
// formula meaningful.

export type GameDate = { year: number; month: number }

export type GoodId =
  | 'grain'
  | 'wood'
  | 'coal'
  | 'iron'
  | 'steel'
  | 'fabric'
  | 'clothes'
  | 'liquor'
  | 'furniture'
  | 'machinery'
  | 'arms'
  | 'luxury'
  | 'opium'
  | 'services'
  // PT-066: ships are a tradeable good. Shipyards make them, naval bases
  // consume them to grow `military.navy`.
  | 'ships'
  // Plan 0015 S0: three new goods for the tier-2/3 buildings — `chemicals`
  // (chemical works), `electricity` (power plants; not yet tradable-gated here,
  // it joins NON_TRADABLE in S4) and `locomotives` (locomotive works).
  | 'chemicals'
  | 'electricity'
  | 'locomotives'

/** Transport-cost region of a country (plan 0004 §1.2). */
export type Region = 'europe' | 'eastAsia' | 'americas' | 'middleEast'

/** One bilateral flow of a single good between two countries (plan 0004 §1.3). */
export type TradeFlow = {
  good: GoodId
  /** Exporting country id. */
  from: string
  /** Importing country id. */
  to: string
  quantity: number
  /** The exporter's domestic price this month. */
  unitPrice: number
  /** The importer's landed price (export duty + import duty + transport + risk). */
  landedPrice: number
  /** Import duty the importing state collected (border value × tariff). */
  tariffPaid: number
  /** Export duty the exporting state collected (domestic value × tariff). */
  exportDuty: number
  /** quantity × unitPrice, the exporter's domestic book value. */
  value: number
  /**
   * Import duty the exporter's private sector absorbs because the importer has
   * `tariffBargaining` power (see `bargainingAbsorbed`). The importer's bill
   * falls by this amount and so does the exporter's revenue, so the importer's
   * domestic price barely moves while its treasury still collects the posted
   * duty. Zero when the importer has no leverage.
   */
  absorbed?: number
}

/**
 * A persistent bilateral trade route (ADR 0020). Routes are the durable match
 * between one exporter's surplus and one importer's deficit; each month the
 * route pass runs before the residual (spot) market, so a routed pair trades
 * without the spot friction. `world.tradeRoutes` is the single source of truth
 * (mirrors `world.wars` / `world.indemnities`); `Country.trade` stays the
 * derived current-month aggregate.
 */
export type TradeRoute = {
  /** Deterministic id: `route-<good>-<from>-<to>`, unique per pair and good. */
  id: string
  good: GoodId
  /** Exporting country id. */
  from: string
  /** Importing country id. */
  to: string
  /** Route size: capacity = level × ROUTE_UNIT_VOLUME × port/transport factor. */
  level: number
  /** State routes are opened by the player/state; private ones by the market. */
  owner: 'state' | 'private'
  openedAt: GameDate
  /** Quantity carried last month (after the soft and payment cuts). */
  lastQty: number
  /** Importer's unit gain last month: domestic price − route landed price. */
  lastMargin: number
}

/**
 * A trade embargo one country has placed on another (plan 0004 §1.3/§3).
 * `goods: 'all'` blocks every tradable good; an array blocks only those goods.
 */
export type Embargo = {
  /** The embargoed country id. */
  target: string
  goods: GoodId[] | 'all'
  since: GameDate
  /**
   * Remaining countdown in months; decremented once per monthly tick and the
   * embargo is lifted when it reaches zero. Absent means permanent (plan §3).
   */
  months?: number
  reason?: string
}

/**
 * One auditable trade-tension entry (plan 0004 §2.7). Written when an agent
 * submits a `tension` diplomacy move; `world.tradeTensions` keeps the last 24
 * months so the diplomacy UI can show who applied what and why.
 */
export type TradeTension = {
  date: GameDate
  /** The country that submitted the tension (the one whose relation changes). */
  from: string
  /** The partner country the tension is directed at. */
  partner: string
  good: GoodId
  relationDelta: number
  reason: string
}

/** A country's bilateral trade for the current month plus a running history. */
export type TradeState = {
  /** Flows where this country is the exporter; only the latest month is kept. */
  exports: TradeFlow[]
  /** Flows where this country is the importer; only the latest month is kept. */
  imports: TradeFlow[]
  /** Gold value of this month's exports at unit prices. */
  exportValue: number
  /** Gold value of this month's imports at unit prices. */
  importValue: number
  /** Tariff revenue this month, in gold (plan 0004 §2.4). */
  tariffRevenue: number
  /** Net exports at base prices; feeds gdpComponents.nx (plan 0004 §2.5). */
  nx: number
  /** Soft import capacity in gold: 50 + ports×8 + marketAccess×200 + transport×1 (plan 0004 §2.3). */
  capacity: number
  history: {
    exportValue: number[]
    importValue: number[]
    nx: number[]
    tariffRevenue: number[]
  }
}

/**
 * The four real tax bases (ADR 0023, plan 0008 B4). GDP is a derived output
 * metric and is never a tax base: revenue is computed per base, then summed.
 *  - `land`        farmland endowment × a land-value-per-unit constant.
 *  - `profit`      per-building-type operating profit, summed (only positives).
 *  - `consumption` final consumer-goods spending (Stone-Geary), not intermediate.
 *  - `tariff`      import + export duty value (rates stay `tariff`/`exportTariff`).
 */
export type TaxBaseId = 'land' | 'profit' | 'consumption' | 'tariff'

/** Per-base tax rates, in percent. `tariff` mirrors `econ.tariff` (ADR 0023). */
export type TaxRates = Record<TaxBaseId, number>

export type BuildingId =
  | 'farms'
  | 'coalMines'
  | 'ironMines'
  | 'lumberMills'
  // Plan 0011 F3: the bundled `factories` split into seven single/few-output
  // industrial buildings. Textiles are the one two-output chain (fabric→clothes).
  | 'textileMills'
  | 'furnitureWorks'
  | 'distilleries'
  | 'machineryWorks'
  | 'steelMills'
  | 'arsenals'
  | 'luxuryWorks'
  // Plan 0011 F4: `schools` is primary education (services / literacy);
  // `forts`/`navalYards` are military (small arms / machinery output).
  | 'schools'
  | 'forts'
  | 'navalYards'
  // Plan 0014 / ADR 0029: `railroads` + `ports` + `telegraphs` merged into one
  // `infrastructure` building (canals deleted). It supplies the unified
  // infrastructure pool, market access and the port tariff effect. Which
  // buildings feed the pool is `INFRA_BUILDING_IDS` (currently just this one),
  // kept as a seam so the merge can be re-split as a data-only change.
  | 'infrastructure'
  | 'universities'
  | 'barracks'
  | 'offices'
  | 'workshops'
  // PT-066: naval base — consumes `ships` and turns them into `military.navy`.
  | 'navalBases'
  // Plan 0015 S0: three new buildings (unlocked by tech nodes in a later slice).
  | 'chemicalWorks'
  | 'powerPlants'
  | 'locomotiveWorks'

export type SpendingCategory =
  | 'army'
  | 'navy'
  | 'bureaucracy'
  | 'education'
  | 'welfare'
  | 'construction'

export type Leader = {
  name: string
  title: string
  age: number
  /** One line of character, read by the AI decision prompt and the narrator. */
  persona: string
  traits: string[]
  /** -100 (hostile) .. 100 (warm) */
  mood: number
  agenda: string
  /** Recent exchanges and decisions, newest last, at most 8. */
  memory: string[]
}

export type Government = {
  type: string
  /** 0..100 */
  legitimacy: number
  /** 0..100 */
  authority: number
}

export type Pops = {
  /** Ten-thousands of people. */
  total: number
  peasants: number
  workers: number
  artisans: number
  clergy: number
  aristocrats: number
  capitalists: number
  /** 0..1 */
  literacy: number
  /** 0..100 */
  radicals: number
  /** 0..100 */
  loyalists: number
  /** Monthly rate. */
  growth: number
  /** 0..100 */
  sol: number
}

export type Spending = Record<SpendingCategory, number>

export type ResourceId = 'farmland' | 'timber' | 'coal' | 'iron'

/** National resource endowments, 0..100. Static in this slice (no depletion). */
export type Resources = Record<ResourceId, number>

/** Per-country structural parameters of the political economy. */
export type PoliticalEconomy = {
  /** Baseline labour share of GDP before unemployment adjusts it. */
  laborShareBase: number
  /** Share of profits saved for investment. */
  savingsRate: number
  /** Share of idle profits kept in the private capital pool. */
  idleRetained: number
  /** Baseline investment confidence in percentage points. */
  investmentConfidence: number
}

/** Expenditure-method GDP, monthly, in gold. */
export type GdpComponents = {
  c: number
  i: number
  g: number
  nx: number
}

/**
 * Per-building-type operating profit snapshot (ADR 0021, plan 0008 B2). Values
 * are this month's gold flows: output valued at this month's prices minus the
 * recipe inputs at those prices minus the wage bill allocated to the type.
 * Informational in B1+B2; B3 uses `utilization` and `profitPerBuilding` to
 * drive idling and private investment.
 */
export type BuildingProfit = {
  /** Σ recipe.output × price × effectiveCount (per month, gold). */
  revenue: number
  /** Σ recipe.input × price × effectiveCount (per month, gold). */
  inputCost: number
  /** Share of the national wage bill allocated by labor × count. */
  wages: number
  /** revenue − inputCost − wages. */
  profit: number
  /** 0..1 operating rate; 1 in B1+B2 (B3 will drive it). */
  utilization: number
  /** profit ÷ max(1, count); the per-building signal for B3. */
  profitPerBuilding: number
}

/** A numeric seam that policies, events and laws may modify. */
export type ModifierStat =
  | 'production'
  | `${GoodId}Output`
  | 'farmOutput'
  | 'mineOutput'
  | 'factoryOutput'
  | 'demand'
  | `${GoodId}Demand`
  | 'gdp'
  | 'income'
  | 'expense'
  | 'taxEfficiency'
  | 'literacy'
  | 'radicals'
  | 'loyalists'
  | 'legitimacy'
  | 'authority'
  | 'sol'
  | 'growth'
  | 'techPoints'
  | 'armyStrength'
  /**
   * Plan 0005 §4: the naval counterpart of `armyStrength`, added as a modifier
   * seam so naval tech can raise fleet quality without a formula special case.
   * Nothing reads it yet (the tech slice stores effects; K2 wires them).
   */
  | 'navyStrength'
  | 'morale'
  | 'manpower'
  | 'prestige'
  | 'unemployment'
  | 'bureaucracy'
  | 'bureaucracyCeiling'
  | 'constructionSpeed'
  /**
   * Gold price of one construction point, read as a multiplier around 1.
   * `constructionSpeed` changes how much work a point buys over time; this seam
   * changes the price of the point itself, so a -50% modifier halves the total
   * gold cost of a project.
   */
  | 'constructionCost'
  /**
   * Tariff bargaining power in [0, 0.9], read as a direct value (default 0).
   * `b` damps the price wedge of the country's posted import/export duties to
   * `1 − b` of their nominal size: the foreign side absorbs more of the tax, so
   * raising a tariff moves prices (and raises duty revenue) less.
   */
  | 'tariffBargaining'
  | 'marketAccess'
  | 'transportInfrastructure'
  | 'administrativeCapacity'
  | 'privateInvestment'
  | 'laborShare'
  | 'consumption'

/**
 * How a modifier stacks. Flat values add; percent values sum into one
 * multiplier; multiply values compound. Order: flat, then percent, then
 * multiply (ADR 0004).
 */
export type ModifierStack = 'flat' | 'percent' | 'multiply'

export type Modifier = {
  /** Unique per country; adding one with an existing id replaces it. */
  id: string
  label: string
  stat: ModifierStat
  stack: ModifierStack
  /** Flat units, or percentage points for `percent` / `multiply`. */
  value: number
  /** Months remaining; absent means permanent until explicitly removed. */
  monthsLeft?: number
  /** Authority drained each month to maintain the effect (policies only). */
  upkeep?: number
  /** Who granted it, e.g. `law:教育改革`, `event:ev-1`, `policy:关税`. */
  source: string
}

/** One effect entry of a policy proposal (ADR 0002/0003). */
export type PolicyEffect = {
  stat: ModifierStat
  stack?: ModifierStack
  value: number
  /** Months; absent means permanent. */
  months?: number
  label?: string
}

/** A policy the model or secretary submits to the engine for validation. */
export type PolicyProposal = {
  name: string
  description?: string
  /** Political capital, default 5; the engine validates the range. */
  authorityCost?: number
  effects: PolicyEffect[]
}

/**
 * The stats a ConfigBlock condition may read (ADR 0024 §6). ADR 0024 says
 * conditions share `ModifierStat` with effects, but real threshold conditions
 * also read raw readings that are NOT modifier seams (`debtRatio`, `industry`,
 * `treasury`, `debt`, `army`, `navy`, `techLevel`). Those are added here rather
 * than lossy-mapped onto a ModifierStat, so no condition is silently dropped.
 * See docs/plans/0009-config-refactor.md §7 (待定) for the follow-up note.
 */
export type ConditionStat =
  | ModifierStat
  | 'treasury'
  | 'debt'
  | 'debtRatio'
  | 'army'
  | 'navy'
  | 'techLevel'
  | 'industry'
  /**
   * C7: the industrial production gate reads the average of the effective
   * coal/iron endowment multipliers, which is not a single ModifierStat seam.
   */
  | 'industrialEndowment'

export type ConditionOp = '>' | '>=' | '<' | '<=' | '==' | '!='

/** One declarative condition; a block's list is AND-connected (ADR 0024 §3). */
export type Condition = {
  stat: ConditionStat
  op: ConditionOp
  value: number
}

/** A scale factor read off a stat, then optionally clamped (ADR 0024 §3). */
export type Curve =
  | {
      kind: 'linear'
      slope: number
      offset?: number
      /**
       * C7: subtract before scaling — `(x − preOffset) × slope ÷ divisor + offset`.
       * Present so a curve can reproduce a `(x − a) / b` ratio bit-for-bit; a
       * plain `x × slope` cannot (float rounding differs). Absent = no shift.
       */
      preOffset?: number
      /** C7: divide after scaling — the exact counterpart to `preOffset`. */
      divisor?: number
      min?: number
      max?: number
    }
  | {
      kind: 'steps'
      points: { at: number; value: number }[]
      min?: number
      max?: number
    }

/** One `scales_with` entry; curve outputs multiply together (ADR 0024 §3). */
export type ScaleSpec = { stat: ConditionStat; curve: Curve }

export type BlockKind =
  | 'threshold'
  | 'policy'
  | 'event'
  | 'situation'
  | 'tech'
  | 'war'
  | 'law'
  | 'economy'
  | 'fiscal'

/** One effect of a block; its own trigger is ANDed with the block's (ADR 0024 §3). */
export type EffectSpec = {
  stat: ModifierStat
  stack: ModifierStack
  value: number
  label?: string
  months?: number
  potential_trigger?: Condition[]
}

/**
 * The unified declaration of every multiplier mechanism (ADR 0024 §3). A block
 * fires once per month, installs Modifiers with `source = block.id`, and obeys
 * its lifecycle (`while` / `once` / `duration`).
 */
export type ConfigBlock = {
  /** Namespaced, e.g. `threshold:stability`, `policy:关税`. */
  id: string
  kind: BlockKind
  label: string
  description?: string
  /** AND-connected conditions that gate the block. */
  potential_trigger: Condition[]
  lifecycle: 'while' | 'once' | 'duration'
  /** Required when `lifecycle === 'duration'`. */
  months?: number
  /** Curve outputs multiply together to scale the effects' amplitude. */
  scales_with: ScaleSpec[]
  effects: EffectSpec[]
}

export type Bureaucracy = {
  /** 0..100, smoothed actual effectiveness. */
  score: number
  /** 0..100, ceiling set by offices and the form of government. */
  ceiling: number
  /** Policies the secretary may execute each month (the player is not limited). */
  actionBudget: number
  /** 0.5..1.0 share of appropriated money that reaches the project. */
  fundEfficiency: number
  /** 0..0.35 chance a project slips by one extra month on completion. */
  delayChance: number
  /** 0..0.30 chance a report or event is distorted. */
  infoDistortion: number
}

export type ConstructionProject = {
  id: string
  building: BuildingId
  count: number
  /**
   * S0 placeholder (plan 0015 §S2): `'build'` (default) or `'upgrade'`. A later
   * slice wires the upgrade behaviour; nothing reads it yet.
   */
  kind?: 'build' | 'upgrade'
  /** S0 placeholder: the tier an upgrade project starts from (plan 0015 §S2). */
  fromTier?: number
  /** S0 placeholder: the tier an upgrade project targets (plan 0015 §S2). */
  toTier?: number
  /** State projects draw on the treasury; private ones on private capital. */
  owner: 'state' | 'private'
  monthsLeft: number
  /** Book cost per month, before bureaucratic leakage. */
  monthlyCost: number
  /** Gold actually paid into the project last month (0..monthlyCost). */
  lastSpend: number
  /** Construction points allocated to this project last month. */
  lastCapacity?: number
  /** 0..1, funded share of the current month. */
  progress: number
  startedAt: GameDate
}

export type Economy = {
  gdp: number
  /**
   * Signed net assets, in gold. Positive is the sovereign fund (earns the
   * fund rate); negative is national debt (pays the debt rate). There is no
   * separate debt stock: debt = max(0, -treasury).
   */
  treasury: number
  income: number
  expense: number
  /** Four-base tax menu, percent (ADR 0023). Replaces the old GDP taxRate. */
  taxes: TaxRates
  /**
   * This month's tax-base quantities (land/profit/consumption/tariff), stored so
   * the ledger can explain each tax and so next month's disposable income can
   * subtract the private burden (ADR 0023).
   */
  taxBaseQty: Record<TaxBaseId, number>
  /**
   * PT-073: per-good consumption-tax overrides, percent. A good without an
   * entry falls back to `taxes.consumption`; an explicitly set 0 exempts it.
   * Optional so older saves need no migration.
   */
  consumptionTaxByGood?: Partial<Record<GoodId, number>>
  /**
   * PT-073: this month's final-consumption value per consumer good, stored so
   * the ledger can tax each good at its own rate and show the breakdown.
   */
  consumptionValueByGood?: Partial<Record<GoodId, number>>
  /** Import duty charged on goods entering the country. */
  tariff: number
  /**
   * Export duty charged on goods leaving the country. Optional: when absent
   * the state applies the same rate to both directions (`tariff`), which is
   * the historical single-rate behaviour. Setting it splits the two.
   */
  exportTariff?: number
  spending: Spending
  buildings: Record<BuildingId, number>
  /**
   * 每级座数分布；恒满足 Σ buildingTiers[id] === buildings[id]（语义见 plan 0015 S1）。
   */
  buildingTiers: Record<BuildingId, number[]>
  goods: Record<GoodId, number>
  prices: Record<GoodId, number>
  /**
   * 0..100 unified infrastructure level (plan 0011 F5). DERIVED, not accumulated:
   * it stores `clamp(100 × supply/demand, 0, 100)` where supply is the
   * `INFRA_BUILDING_IDS` pool (plan 0014: the single `infrastructure` building)
   * and demand is Σ `infrastructureNeed`.
   * Production reads it (one-month lag) for the shortfall debuff; trade reads it
   * for transport cost. The field name is kept from the old "transport" scalar to
   * avoid a save-shape break.
   */
  transportInfrastructure: number
  /** 0..100 administrative conditions; feeds the bureaucracy score. */
  administrativeCapacity: number
  constructionQueue: ConstructionProject[]
  /** 0..1 */
  marketAccess: number
  /** 0..100 */
  unemployment: number
  /** Resource endowments mirrored from the country for fast reads. */
  resources: Resources
  /** Private savings pool available to private construction. */
  privateCapital: number
  /**
   * PT-089: player-only toggle. When true, idle construction points are rented
   * to the private market (0.3 gold/point) BEFORE state projects draw on them;
   * when false/absent, state projects keep first claim. AI countries never set
   * it (the AI action whitelist excludes the `rent` action).
   */
  rentPriority?: boolean
  /**
   * Merchant hulls kept at home (PT-067): hulls the country built but did not
   * commission as navy. Together with `military.navy` they cap how many route
   * levels the country can carry as an exporter. Optional so older saves need
   * no migration; a missing field reads as 0.
   */
  merchantHulls?: number
  /** Tick of the last private project start, for the expansion brake (PT-029). */
  lastPrivateStartTick: number
  /** Current investment confidence, base ± envelope (percentage points). */
  investmentConfidence: number
  /** Expenditure-method GDP components, monthly gold. */
  gdpComponents: GdpComponents
  /** Labour share used this month (0..1). */
  laborShare: number
  /** Wage bill and profit bill this month (gold). */
  wages: number
  profits: number
  /** Per-building-type operating profit snapshot for this month (ADR 0021). */
  buildingProfits: Record<BuildingId, BuildingProfit>
  /** Idle profit flow this month (gold) and gold set for luxury next month. */
  idleProfits: number
  idlePurchases: number
  /**
   * PT-097: standing demand levers per good, written by `v3_cheat demand`.
   * - `demandBase[good]` is the per-population coefficient `x`: the monthly
   *   demand gains `popFactor × x`.
   * - `demandFlat[good]` is the constant `a`: a fixed quantity per month that
   *   does not move with population.
   * - `demandPct[good]` is a percentage multiplier applied to the whole sum.
   * So a country's demand for a good reads `(model + popFactor × x + a) × (1 + pct)`.
   * All three are levels, not accumulators: setting again replaces the old value.
   */
  demandBase?: Partial<Record<GoodId, number>>
  demandFlat?: Partial<Record<GoodId, number>>
  demandPct?: Partial<Record<GoodId, number>>
  /** Labour-market readings for the month. */
  laborDemand: number
  laborForce: number
  /** 0.5..1, the plan's stability floor; used by the unemployment penalty. */
  laborUtilization: number
  /** Uncapped demand/force ratio, for display. */
  laborRawUtilization: number
  /** Construction actually funded last month (state + private), gold. */
  lastConstructionSpend: number
  lastStateConstructionSpend: number
  lastPrivateConstructionSpend: number
  /** Rent paid by private builders for idle state construction points. */
  lastConstructionRent: number
  /**
   * The "other" income actually folded into last month's income total
   * (construction rent, booked with a one-month lag). The ledger reads this
   * instead of recomputing from `lastConstructionRent`, which by then already
   * holds this month's rent and would distort the composition (PT-028).
   */
  lastIncomeOther: number
  /**
   * Investment-goods demand from last month's actual construction spend,
   * by good. Persists after a project completes so one-month slots still
   * appear in the next month's investment block.
   */
  lastConstructionDemand: Partial<Record<GoodId, number>>
  /** Installment reparations paid this month, folded into expense. */
  reparationsPaid: number
  /** Installment reparations received this month, folded into income. */
  reparationsReceived: number
  /** Scheduled transfers paid this month (loans/subsidies), folded into expense. */
  transfersPaid: number
  /** Scheduled transfers received this month, folded into income. */
  transfersReceived: number
  /** Sovereign-fund interest applied in the last settlement (income side). */
  lastFundIncome: number
  /** National-debt interest applied in the last settlement (expense side). */
  lastDebtInterest: number
  /** Gold paid for imports last month, at unit prices (plan 0004 §2.4). */
  lastImportBill: number
  /** Gold earned from exports last month, at unit prices. */
  lastExportRevenue: number
  /** Tariff collected on imports last month; the only treasury trade channel. */
  lastTariffRevenue: number
  /** lastExportRevenue − lastImportBill; feeds next month's income (plan 0004 §2.4). */
  lastTradeBalance: number
  /** Unfinanced trade gap deducted from net assets last month (not an expense). */
  lastTradeDebt: number
  /** Imported coal/iron/timber last month, feeding next month's effective endowment. */
  resourceImports: Record<ResourceId, number>
  /** Tick until which a post-default restructuring halves capacity and caps new debt. */
  restructuredUntilTick: number
  history: {
    gdp: number[]
    treasury: number[]
    sol: number[]
    legitimacy: number[]
    radicals: number[]
    /** GDP components and the monthly fiscal/labour series for `v3_inspect`. */
    c: number[]
    i: number[]
    g: number[]
    income: number[]
    expense: number[]
    unemployment: number[]
    debt: number[]
    tariff: number[]
  }
}

export type TechBranch = 'general' | 'industry' | 'admin' | 'military'

/** A permanent modifier a completed tech node installs (plan 0005 §1/§4). */
export type TechNodeModifier = {
  kind: 'modifier'
  stat: ModifierStat
  stack: ModifierStack
  value: number
  label?: string
}

/** A one-off stock change applied when a node completes (ADR 0004: stocks, not flows). */
export type TechNodeImmediate = {
  kind: 'immediate'
  morale?: number
  loyalists?: number
  radicals?: number
  legitimacy?: number
  prestige?: number
  /** Plan 0015 §S5: one-off fleet-quality bump (0–1). */
  navalQuality?: number
}

export type TechNodeEffect =
  | TechNodeModifier
  | TechNodeImmediate
  | TechNodeUnlockTier
  | TechNodeUnlockBuilding
  | TechNodeUnlockLaw
  | TechNodeDemandShift

/**
 * Plan 0015 / ADR 0031 §3: raise a building type's tier ceiling to `tier`
 * (2 or 3). Stored in S0; installed and consumed in a later slice.
 */
export type TechNodeUnlockTier = {
  kind: 'unlockTier'
  building: BuildingId
  tier: number
}

/** Plan 0015 / ADR 0031 §3: unlock a brand-new building (previously unbuildable). */
export type TechNodeUnlockBuilding = {
  kind: 'unlockBuilding'
  building: BuildingId
}

/** Plan 0015 / ADR 0031 §3: unlock a law (`v3_action law` prerequisite). */
export type TechNodeUnlockLaw = {
  kind: 'unlockLaw'
  law: string
}

/** Plan 0015 / ADR 0031 §3: node-level demand shift for a good (minimal PT-068). */
export type TechNodeDemandShift = {
  kind: 'demandShift'
  good: GoodId
  percent: number
}

/**
 * One node of the 4-era / 20-node tech tree (plan 0015 §S3). `era` is a tier
 * (I–IV), not a calendar year. `effects` carries the node's unlock-class effects
 * plus its modifier / immediate parts; the dead `unlocks` / `year` fields were
 * removed in v14 (ADR 0031 §3).
 */
export type TechNodeDef = {
  id: string
  era: number
  branch: TechBranch
  name: string
  cost: number
  prerequisites: string[]
  effects: TechNodeEffect[]
  /**
   * Extra gate: at least N unlocked nodes in ANY single non-general branch
   * (`general-1865` needs 2, `general-1880` needs 3 — plan 0005 §1.1).
   */
  requiresAnyBranch?: number
}

/**
 * The 4-era / 16-node tech tree replacement for the old linear level (plan
 * 0005 K1). `unlocked` holds node ids; `nodes` holds 0..1 progress per node id;
 * `researching` is the chosen node id (or '' while waiting for a choice). Old
 * saves (`Technology.level`) are rejected by the v13 version bump (ADR 0005).
 */
export type TechState = {
  /** 1..4, the current era tier. */
  era: number
  /** node id -> 0..1 progress. */
  nodes: Record<string, number>
  unlocked: string[]
  /** node id, or '' when waiting for a choice. */
  researching: string
  points: number
  pointsPerMonth: number
}

export type Military = {
  /** Ten-thousands of soldiers. */
  army: number
  navy: number
  manpower: number
  /** 0..1 */
  quality: number
  /**
   * 0..1 fleet quality (plan 0015 §S5 / ADR 0031 §7): seeded per country from
   * its military seeds, then raised only by the navy tech nodes' `immediate`
   * effect. It scales `navy` into `seaPower`; it is independent of `quality`.
   */
  navalQuality: number
  /** 0..100 */
  morale: number
  /** 0..100 */
  exhaustion: number
}

export type Diplomacy = {
  relations: Record<string, number>
  alliances: string[]
  rivals: string[]
  sphere: string[]
  infamy: number
  prestige: number
}

export type Country = {
  id: string
  name: string
  adjective: string
  flag: string
  color: string
  isPlayer: boolean
  isMajor: boolean
  leader: Leader
  government: Government
  pops: Pops
  econ: Economy
  /** Structural parameters of the country's political economy. */
  politicalEconomy: PoliticalEconomy
  tech: TechState
  military: Military
  diplo: Diplomacy
  bureaucracy: Bureaucracy
  /** Transport-cost region used by the trade clearing (plan 0004 §1.2). */
  region: Region
  /** Bilateral trade of the current month plus a running history. */
  trade: TradeState
  /** Per-country opium production and demand factors (plan 0004 §1.1). */
  opium: { outputFactor: number; demandFactor: number }
  /** Active trade embargoes this country has placed on others (plan 0004 §1.3/§3). */
  embargoes: Embargo[]
  /** Active buffs and debuffs; see engine/modifiers.ts. */
  modifiers: Modifier[]
}

/** The four peace aims a war may be declared for (plan 0004 §5). */
export type WarGoal = 'reparations' | 'openMarket' | 'sphere' | 'humiliation'

/**
 * The five sea-control tiers (plan 0015 §S5 / ADR 0031 §7), read from a side's
 * `seaPower` ratio against its enemy: ≥2.0 完全控制, ≥1.25 优势, 0.8–1.25 均势,
 * ≥0.5 劣势, below 丧失.
 */
export type SeaControlTier = 'complete' | 'advantage' | 'parity' | 'disadvantage' | 'lost'

/**
 * A standing blockade (plan 0015 §S5). `by` holds at least 优势 sea control over
 * `enemy` in the war this record belongs to and severs `enemy`'s trade with
 * third parties. `party` narrows it to one country (a neutral included), `good`
 * to a single good; both absent means every third party and every good.
 */
export type Blockade = {
  /** The blockading country; must hold advantage/complete sea control. */
  by: string
  /** The enemy whose third-party trade is cut. */
  enemy: string
  /** Optional single third country; absent = every third party. */
  party?: string
  /** Optional single good; absent = every good. */
  good?: GoodId
}

/**
 * This month's sea-control reading for one war (plan 0015 §S5), recomputed
 * before the monthly trade clearing so a blockade bites the same month.
 */
export type WarSeaControl = {
  /** `seaPower` per belligerent country id. */
  power: Record<string, number>
  /** Sea-control tier per belligerent country id. */
  tier: Record<string, SeaControlTier>
  /** Active blockades declared by the war's sea-control side. */
  blockades: Blockade[]
}

export type War = {
  id: string
  name: string
  attackers: string[]
  defenders: string[]
  started: GameDate
  months: number
  /** Positive means the attackers are winning. */
  warScore: number
  battles: number
  reason: string
  lastEvent: string
  /** Peace terms key off this, not a generic victory (plan 0004 §5). */
  goal: WarGoal
  /** The declaring country; its side's win/loss decides which column applies. */
  goalOwner: string
  /**
   * This month's sea control (plan 0015 §S5): per-belligerent `seaPower` and
   * tier, plus any blockades the sea-control side has declared. Recomputed each
   * month before the trade clearing; undefined until the first settlement.
   */
  seaControl?: WarSeaControl
}

/**
 * A reparations schedule. The victor sets the total and the maximum term; the
 * loser splits it into an immediate lump sum and this monthly installment
 * schedule. Installments flow through income (recipient) and expense (payer).
 */
export type WarIndemnity = {
  id: string
  from: string
  to: string
  monthlyAmount: number
  monthsLeft: number
  /** Gold still owed after the lump sum and any installments already paid. */
  remaining: number
  /** First tick that charges an installment (the next simulated month). */
  startsAtTick: number
  startedAt: GameDate
}

/**
 * A scheduled gold transfer between two countries — loan installments,
 * subsidies, tribute. Created outside a war (unlike {@link WarIndemnity}),
 * settled the same way: before the monthly simulation, payer expense and
 * receiver income of equal size.
 */
export type Transfer = {
  id: string
  from: string
  to: string
  monthlyAmount: number
  monthsLeft: number
  /** Gold still owed after this month's installment. */
  remaining: number
  /** First tick that charges an installment. */
  startsAtTick: number
  startedAt: GameDate
  /** Player-facing label, e.g. 「对英贷款 · 年息5% · 120期」. */
  label: string
}

/** A participant's declared position in a situation (plan 0004 §4.2). */
export type SituationStance = 'crackdown' | 'compromise' | 'war' | 'aid' | 'neutral'

/**
 * One participant's proposal for a situation (plan 0004 §4.2; generalized by
 * plan 0002). For an `arbiter-agent` situation (the opium crisis) the proposal
 * is arbitration context only — its effects are never applied; only the chosen
 * result pack lands. For an `engine` situation the engine validates `effects`
 * (self) and `pressure` (other participants) with the same rules as a policy
 * and installs them as `situation:`-sourced modifiers.
 */
export type SituationProposal = {
  countryId: string
  /** A stance id validated against the situation definition's `stances`. */
  stance: string
  narrative: string
  /** Country-local effects; validated like a policy before install. */
  effects?: PolicyEffect[]
  /** Effects aimed at the other participants; validated like a policy. */
  pressure?: PolicyEffect[]
}

/**
 * A open diplomatic situation, e.g. the opium crisis (plan 0004 §4.5). A given
 * `id` may be opened at most once; once resolved the record is pruned to a
 * summary (proposal narratives dropped) and kept for reproducibility.
 */
export type SituationRecord = {
  id: string
  /** The situation definition id this record instantiates (plan 0002). */
  kind: string
  opened: GameDate
  /** Participant country ids; `['QING','GBR']` for the opium crisis. */
  countries: string[]
  proposals: SituationProposal[]
  /** Id of the chosen result pack; absent while open. */
  resultId?: string
  resolved: boolean
  resolvedAt?: GameDate
  /** Months the situation has been open, for the countdown. */
  months: number
}

export type EventOption = {
  id: string
  label: string
  result: string
  effects: {
    treasury?: number
    radicals?: number
    legitimacy?: number
    prestige?: number
    army?: number
    popsPercent?: number
    techPoints?: number
    relationTarget?: string
    relationAmount?: number
    /** Replace the country's leader with its next in line. */
    succeed?: boolean
    /** Buffs/debuffs granted by this option (stacking rules in ADR 0004). */
    modifiers?: {
      stat: ModifierStat
      stack?: ModifierStack
      value: number
      /** Months; absent means permanent. */
      months?: number
      label?: string
    }[]
  }
}

export type GameEvent = {
  id: string
  date: GameDate
  kind: string
  title: string
  text: string
  countryId: string
  options: EventOption[]
  isResolved: boolean
  resolvedOption?: string
  /**
   * PT-085: the salient-topic keys this live event was written from
   * (`economy:grain`, `livelihood:famine`, …). The topic scan cools a key for
   * `LIVE_TOPIC_COOLDOWN_MONTHS` after it fires, so the same crisis does not
   * spawn an event every single month. Template/random events leave it unset.
   */
  topicKeys?: string[]
}

export type LogKind =
  | 'economy'
  | 'diplomacy'
  | 'war'
  | 'tech'
  | 'politics'
  | 'leader'
  | 'event'
  | 'system'

export type LogEntry = {
  date: GameDate
  kind: LogKind
  countryId?: string
  text: string
}

export type AiState = {
  /** Model used for background leader decisions and the secretary. */
  model: string
  /** countryId -> tick until which background AI leaves it to the narrator. */
  suspended: Record<string, number>
  /** Ask the model every N ticks; other ticks use the deterministic policy. */
  intervalTicks: number
  lastDecisionTick: number
  lastError?: string
}

export type Delegation = {
  /** Budget, taxes, construction, research, events. */
  internal: boolean
  /** Improve, ally, rival, gift; never war or peace. */
  diplomacy: boolean
  /** Months covered by this delegation. */
  months: number
}

export type SecretaryState = {
  delegation: Delegation
  lastReport: string
  lastPlan: string
  isRunning: boolean
  lastRunTick: number
  /** Overreaches in the current turn; the fourth is refused (ADR 0001). */
  consecutiveOverreach: number
}

export type CouncilState = {
  isOpen: boolean
  report: string
  secretaryReport: string
  isRunning: boolean
}

export type WorldState = {
  version: number
  seed: number
  date: GameDate
  tick: number
  playerId: string
  countries: Record<string, Country>
  wars: War[]
  /** Active installment reparations (lump sums do not appear here). */
  indemnities: WarIndemnity[]
  /**
   * Scheduled gold transfers outside war — loan installments, subsidies,
   * tribute. Same monthly settlement shape as an indemnity. Optional so a
   * pre-PT-064 save keeps loading (read sites fall back to `[]`).
   */
  transfers?: Transfer[]
  events: GameEvent[]
  log: LogEntry[]
  /** Auditable trade tensions, newest last; only the last 24 months are kept (plan 0004 §2.7). */
  tradeTensions: TradeTension[]
  /** Diplomatic situations; at most one opium crisis may ever exist (plan 0004 §4). */
  situations: SituationRecord[]
  /**
   * Persistent bilateral trade routes (ADR 0020). The single source of truth
   * for durable trade links; `Country.trade` is only the derived current-month
   * aggregate. Sorted reads always tie-break by id, never by insertion order.
   */
  tradeRoutes: TradeRoute[]
  /** Auto-load this world when a session starts in the project. */
  resumeOnStart: boolean
  ai: AiState
  secretary: SecretaryState
  ironman: boolean
  createdAt: number
}

export type TabId =
  | 'council'
  | 'overview'
  | 'rankings'
  | 'market'
  | 'economy'
  | 'pops'
  | 'diplomacy'
  | 'military'
  | 'tech'
  | 'events'
  | 'log'

export type UiState = {
  tab: TabId
  isPaneOpen: boolean
  /** A transient line drawn under the dashboard. */
  notice: string
  lastReport: string
  isBusy: boolean
  /** False after /v3 end, while the save stays on disk. */
  isActive: boolean
  council: CouncilState
}

/** Panel control actions (plan 0013 build panel). `council` opens the council. */
export type ControlAction = 'next' | 'save' | 'council' | 'build' | 'cancel' | 'reorder' | 'research'

/**
 * Payload carried by a panel control action. `build` uses `building`/`perSlot`
 * (x, 1..5)/`slots` (y) to queue `y` slots of `x` buildings each; `cancel` and
 * `reorder` address a project by `projectId` or 1-based `index` (matching
 * `v3_inspect construction`) and move it to `position` (relative to `before`).
 * `research` carries the tech node id in `tech` (plan 0005 K3).
 */
export type ControlPayload = {
  building?: BuildingId
  /** Buildings per slot, 1..5 (the `x` of `x*y`). */
  perSlot?: number
  /** Number of slots to queue (the `y` of `x*y`). */
  slots?: number
  projectId?: string
  /** 1-based position in `econ.constructionQueue`. */
  index?: number
  position?: 'head' | 'tail' | 'before' | 'after'
  before?: string
  /** Tech node id for the `research` control (plan 0005 K3). */
  tech?: string
}

/** Council-panel actions. */
export type CouncilAction =
  | 'approve'
  | 'run'
  | 'recompose'
  | 'delegate-internal'
  | 'delegate-diplomacy'
  | 'months'

/** `v3_control` actions: stop an in-flight delegated run, or save. */
export type ControlCommand = 'stop' | 'save'

export type GameConfig = {
  aiModel: string
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-legend': {
      world: WorldState
      ui: UiState
    }
  }
}
