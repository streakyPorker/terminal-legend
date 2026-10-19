// Type contract for terminal-legend.
// Self-contained by design: the engine loads it as the plugin's `types` entry
// and type-checks every `$.state` key the hooks module names against it.

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
  | 'services'

export type BuildingId =
  | 'farms'
  | 'mines'
  | 'factories'
  | 'railroads'
  | 'ports'
  | 'universities'
  | 'barracks'

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
  /** 0..100 */
  infrastructure: number
  /** 0..1 */
  marketAccess: number
  /** 0..100 */
  unemployment: number
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
  tech: Technology
  military: Military
  diplo: Diplomacy
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

export type AutoState = {
  isOn: boolean
  isPaused: boolean
  /** Load this save again when a session starts in the project. */
  resumeOnStart: boolean
  intervalSeconds: number
  aiModel: string
  lastTickAt: number
}

export type AiState = {
  /** countryId -> tick until which background AI leaves it to the narrator. */
  suspended: Record<string, number>
  /** Ask the model every N ticks; other ticks use the deterministic policy. */
  intervalTicks: number
  lastDecisionTick: number
  lastError?: string
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
  auto: AutoState
  ai: AiState
  createdAt: number
}

export type TabId =
  | 'overview'
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
}

export type GameConfig = {
  aiModel: string
  autoTickSeconds: number
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-legend': {
      world: WorldState
      ui: UiState
    }
  }
}
