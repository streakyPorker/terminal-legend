// The simulation was split out of this file into cohesive modules. This barrel
// preserves the file's public import surface — every symbol that used to be
// imported from `./sim` (or `../engine/sim`) is still available here — while the
// implementations live in the modules below. See README "文件结构".
//
// Module graph (each layer only imports the layers beneath it, so the whole
// graph is acyclic and there is no runtime initialization cycle):
//
//   internal → economy → construction → investment → country → world
//   internal → diplomacy / events
//   actions → economy, construction, diplomacy, events, situations, trade
//   world   → country, actions, diplomacy, events, situations, trade
//
// `sim.ts` itself is the only module that re-exports across all of them.

export { clamp, clone, advanceDate, dateDistance } from './internal'
export type { Decision } from './internal'

export {
  UTIL_IDLE_FLOOR,
  UTIL_SMOOTHING,
  SHRINK_MAX,
  resourceFactors,
  effectiveSavingsRate,
  inspectEconomy,
  finalConsumptionBase,
  computeEconomy,
} from './economy'
export type { EconomySnapshot } from './economy'

export {
  WORKSHOP_CAPACITY_OUTPUT,
  WORKSHOP_INPUTS,
  CAPACITY_COST,
  PRIVATE_OWN_CAPACITY_SHARE,
  CONSTRUCTION_RENT_PER_POINT,
  MAX_BUILDINGS_PER_SLOT,
  WORKLOAD_MULTIPLIER,
  capacityCost,
  projectWorkload,
  maxSlotCapacity,
  CONSTRUCTION_COST_PER_POINT,
  BUILDING_COST_MULTIPLIER,
  BUILDING_COST_ADDEND,
  constructionGoldPerPoint,
  constructionTotalCost,
  constructionMonthlyCost,
  constructionCapacity,
  constructionSchedule,
  constructionLoad,
  completeBuilding,
  completeUpgrade,
  alreadyReserved,
  projectKind,
  normalizeConstructionQueue,
} from './construction'
export type { ConstructionSchedule, ConstructionLoad } from './construction'

export {
  investmentScore,
  MAX_PRIVATE_PROJECTS,
  PRIVATE_START_INTERVAL,
} from './investment'

export {
  SENSITIVE_GOODS,
  TRADE_WARMTH_MAX,
  SENSITIVE_DRAG,
  TRADE_RELATION_ENVELOPE,
  TRADE_RELATION_FLOOR,
  TRADE_TENSION_RETENTION_MONTHS,
  EMBARGO_MONTHS_MAX,
  atWar,
  declareWar,
  applyTradeRelations,
  strength,
} from './diplomacy'
export {
  seaPowerOf,
  seaControlTier,
  SEA_CONTROL_TIER_NAMES,
  resolveSeaControl,
  updateSeaControl,
  blockadeBlocks,
  declareBlockade,
  liftBlockade,
} from './navy'
export type { ReparationTerms } from './diplomacy'

export { applyEventOption } from './events'

export {
  FREE_TRADE_TARIFF_FLOOR,
  taxMenuText,
  applyDecision,
  applyPolicy,
  randomDecision,
  councilInterrupt,
} from './actions'

export {
  calibrateWorld,
  growRoutes,
  bootstrapRoutes,
  advance,
  newWorld,
} from './world'
export type { AdvanceReport } from './world'
