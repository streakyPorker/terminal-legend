// Barrel for the former `engine/data.ts` (plan 0009 §9 D2 / plan 0012 S2).
// `import ... from './data'` and `'../engine/data'` keep resolving here because
// `engine/data.ts` was deleted, so `./data` now resolves to `./data/index.ts`.
//
// The named re-export list below reproduces the public export set of the old
// `engine/data.ts`. It is deliberately explicit rather than `export *` so
// internal-only helpers (e.g. `leader`, `clampValue`, the seed constructors)
// stay private to their modules and cannot leak into the public surface.

// ---------------------------------------------------------------- goods / resources / demand
export {
  WAR_GOAL_NAMES,
  GOODS,
  GOOD_IDS,
  REGION_COST,
  RESOURCE_IDS,
  RESOURCE_MAP,
  RESOURCE_NAMES,
  CONSUMER_GOODS,
  SUBSISTENCE_SCALE,
  SUBSISTENCE,
  CONSUMPTION_PROPENSITY,
  INCOME_ELASTICITY,
  GOVERNMENT_DEMAND,
} from './goods'

// ---------------------------------------------------------------- buildings / recipes / infrastructure tables
export {
  WAGE_ALLOCATION,
  CAPITAL_LABOR_SCALE,
  INVESTMENT_DEMAND,
  BUILDING_OUTPUT,
  BUILDING_RECIPES,
  ARTISAN_OUTPUT,
  ARTISAN_SERVICE_OUTPUT,
  BUILDINGS,
  BUILDING_IDS,
  buildOf,
  INFRA_SUPPLY,
  INFRA_MULT_FLOOR,
  INFRA_UPKEEP,
  INFRA_BUILDING_IDS,
  INDUSTRIAL_BUILDING_IDS,
} from './buildings'
export type {
  WageAllocationBasis,
  RecipeIO,
  RecipeGates,
  BuildingRecipe,
  BuildingUnlock,
  BuildingDef,
} from './buildings'

// ---------------------------------------------------------------- tech
export {
  TECH_NODES,
  techNode,
  techNodeName,
  techNodesInBranch,
  techTier,
  unlockedInBranch,
  eraGateOk,
  prereqOk,
  canResearchNode,
  defaultResearchNode,
  clampEra,
} from './tech'

// ---------------------------------------------------------------- leaders
export { successorFor } from './leaders'

// ---------------------------------------------------------------- countries / seeds
export { SPENDING, GOVERNMENT_TYPES, COUNTRY_SEEDS, defaultSpending } from './countries'

// ---------------------------------------------------------------- events
export { EVENT_TEMPLATES, spawnEvent, otherCountryIds, pickRival } from './events'
export type { EventTemplate } from './events'

// ---------------------------------------------------------------- derivations
export {
  administrativeCapacityFor,
  deriveBureaucracy,
  deriveUnemployment,
  deriveLabor,
  resourceMultiplier,
  effectiveCount,
  infrastructureSupply,
  infrastructureDemand,
  infrastructureStats,
  infrastructureMultiplier,
  refreshInfrastructure,
  infrastructureUpkeep,
  industrialBuildingCount,
  infrastructureCount,
} from './derivations'
export type { LaborStats, InfrastructureStats } from './derivations'

// ---------------------------------------------------------------- world / state constructors
export {
  START_YEAR,
  START_MONTH,
  emptyTradeState,
  emptyBuildingProfits,
  emptyTaxBaseQty,
  DEFAULT_TAX_RATES,
  defaultSecretaryState,
  initialUi,
  createWorld,
  techStateFromLevel,
  makeRngForWorld,
} from './world'
