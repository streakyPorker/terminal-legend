// Type contract for terminal-legend.
// Self-contained by design: the engine loads it as the plugin's `types` entry
// and type-checks every `$.state` key the hooks module names against it.
// World model v10: taxes come from four real bases (land / per-building profit /
// final consumption / tariff, `Economy.taxes` + `Economy.taxBaseQty`), never
// from GDP (ADR 0023). Every building type carries a declarative production
// recipe (`BUILDING_RECIPES`, engine/data.ts) that is the single source of truth
// for output AND intermediate input (ADR 0021), and each country stores a
// per-building-type profit snapshot (`Economy.buildingProfits`). Persistent
// bilateral trade routes still sit in front of the spot clearing (ADR 0020);
// bilateral quantities, NX accounting, gold settlement and resource imports
// remain live (plan 0004 T1a/T1b).

export type GameDate = { year: number; month: number }

export type GoodId =
  | 'grain'
  | 'wood'
  | 'coal'
  | 'iron'
  | 'fabric'
  | 'clothes'
  | 'liquor'
  | 'furniture'
  | 'machinery'
  | 'arms'
  | 'luxury'
  | 'opium'
  | 'services'

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
  | 'mines'
  | 'factories'
  | 'railroads'
  | 'ports'
  | 'universities'
  | 'barracks'
  | 'offices'
  | 'workshops'

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
  | 'morale'
  | 'manpower'
  | 'prestige'
  | 'unemployment'
  | 'bureaucracy'
  | 'bureaucracyCeiling'
  | 'constructionSpeed'
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
 * also read raw readings that are NOT modifier seams (`debtRatio`, `factories`,
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
  | 'factories'
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
  goods: Record<GoodId, number>
  prices: Record<GoodId, number>
  /** 0..100 transport conditions; drives the production multiplier. */
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

export type Technology = {
  level: number
  points: number
  pointsPerMonth: number
  researching: string
  unlocked: string[]
}

export type Military = {
  /** Ten-thousands of soldiers. */
  army: number
  navy: number
  manpower: number
  /** 0..1 */
  quality: number
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
  tech: Technology
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

/** A participant's declared position in a situation (plan 0004 §4.2). */
export type SituationStance = 'crackdown' | 'compromise' | 'war' | 'aid' | 'neutral'

/**
 * One participant's proposal for a situation (plan 0004 §4.2). Proposals are
 * arbitration context only — their effects are never applied; only the chosen
 * result pack (§4.3) lands on the world.
 */
export type SituationProposal = {
  countryId: string
  stance: SituationStance
  narrative: string
}

/**
 * A open diplomatic situation, e.g. the opium crisis (plan 0004 §4.5). A given
 * `id` may be opened at most once; once resolved the record is pruned to a
 * summary (proposal narratives dropped) and kept for reproducibility.
 */
export type SituationRecord = {
  id: string
  kind: 'opium-crisis'
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
