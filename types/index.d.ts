// Type contract for terminal-legend.
// Self-contained by design: the engine loads it as the plugin's `types` entry
// and type-checks every `$.state` key the hooks module names against it.
// World model v6: bilateral trade quantities and NX accounting are live
// (plan 0004 T1a); gold movement and tariffs follow in T1b.

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
  /** The importer's landed price (unitPrice plus tariff, transport, risk). */
  landedPrice: number
  /** Tariff the importing state collected. // T1b: gold settlement fills this. */
  tariffPaid: number
  /** quantity × unitPrice, the exporter's book value. */
  value: number
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
  /** Tariff revenue this month, in gold. // T1b: gold settlement fills this. */
  tariffRevenue: number
  /** Net exports at base prices; feeds gdpComponents.nx (plan 0004 §2.5). */
  nx: number
  /** Soft import capacity in gold. // T1b: soft capacity fills this. */
  capacity: number
  history: {
    exportValue: number[]
    importValue: number[]
    nx: number[]
    tariffRevenue: number[]
  }
}

export type BuildingId =
  | 'farms'
  | 'mines'
  | 'factories'
  | 'railroads'
  | 'ports'
  | 'universities'
  | 'barracks'
  | 'offices'

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
  /** 0..1, funded share of the current month. */
  progress: number
  startedAt: GameDate
}

export type Economy = {
  gdp: number
  treasury: number
  debt: number
  income: number
  expense: number
  taxRate: number
  tariff: number
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
  /** Current investment confidence, base ± envelope (percentage points). */
  investmentConfidence: number
  /** Expenditure-method GDP components, monthly gold. */
  gdpComponents: GdpComponents
  /** Labour share used this month (0..1). */
  laborShare: number
  /** Wage bill and profit bill this month (gold). */
  wages: number
  profits: number
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
  /** Principal repaid from the treasury last month. */
  lastDebtRepayment: number
  history: {
    gdp: number[]
    treasury: number[]
    sol: number[]
    legitimacy: number[]
    radicals: number[]
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
  /** Active buffs and debuffs; see engine/modifiers.ts. */
  modifiers: Modifier[]
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
  events: GameEvent[]
  log: LogEntry[]
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
