import type { BuildingId, Country, GoodId, TechBranch, TechNodeDef, TechState } from '../../types'
import { BUILDING_IDS, BUILDINGS } from './buildings'
import { TECH_MAX_ERA, TECH_TIER_BASE, TECH_TIER_ERA_COEF, TECH_TIER_UNLOCKED_COEF, techNodeCost } from '../config/tech'

/**
 * The 4-era / 20-node tech tree (plan 0015 §S3, table frozen in appendix A):
 * a 5-node general era line plus industry / admin / military branches of 5
 * nodes each. Each node's cost comes from `TECH_ERA_COSTS` (config/tech.ts) so
 * the whole pace is one dial.
 *
 * Every node carries at least one *unlock-class* effect (`unlockTier` /
 * `unlockBuilding` / `unlockLaw` / `demandShift`); `modifier` / `immediate` are
 * the node's minor parts. Appendix A lists each node's headline effect; where it
 * gives only a modifier, the node re-asserts an unlock its own prerequisite
 * chain already guarantees (e.g. `general-1840` restates `farms 2`, which its
 * prerequisite `general-1836` grants at era 1; `admin-5` restates `保护关税`,
 * which its prerequisite `admin-3` grants). Such a node never grants a tier or
 * law earlier than the node that first introduces it, so the unlock timeline —
 * every country's `maxUnlockedTier` / `lawUnlocked` — is unchanged.
 *
 * `unlockTier` / `unlockBuilding` / `unlockLaw` / `demandShift` are **derived**
 * from `country.tech.unlocked` at read time (see the accessors below and
 * `installTechNodeEffects`), not installed as state — ADR 0031 §9.1 chose
 * derivation over install so seeded and researched nodes behave identically.
 */
export const TECH_NODES: TechNodeDef[] = [
  // ---- 通用时代线（5）：era 序列 1 / 1 / 2 / 3 / 4 ----
  {
    id: 'general-1836',
    era: 1,
    branch: 'general',
    name: '传统农业',
    cost: techNodeCost(1),
    prerequisites: [],
    effects: [{ kind: 'unlockTier', building: 'farms', tier: 2 }],
  },
  {
    id: 'general-1840',
    era: 1,
    branch: 'general',
    name: '度量衡与驿传',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
      { kind: 'unlockTier', building: 'farms', tier: 2 },
      { kind: 'modifier', stat: 'marketAccess', stack: 'percent', value: 8 },
    ],
  },
  {
    id: 'general-1850',
    era: 2,
    branch: 'general',
    name: '蒸汽时代',
    cost: techNodeCost(2),
    prerequisites: ['general-1840'],
    effects: [
      { kind: 'unlockTier', building: 'farms', tier: 2 },
      { kind: 'modifier', stat: 'techPoints', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'general-1865',
    era: 3,
    branch: 'general',
    name: '工业时代',
    cost: techNodeCost(3),
    prerequisites: ['general-1850'],
    requiresAnyBranch: 2,
    effects: [{ kind: 'unlockTier', building: 'infrastructure', tier: 2 }],
  },
  {
    id: 'general-1880',
    era: 4,
    branch: 'general',
    name: '电气时代',
    cost: techNodeCost(4),
    prerequisites: ['general-1865'],
    requiresAnyBranch: 3,
    effects: [{ kind: 'unlockTier', building: 'infrastructure', tier: 3 }],
  },
  // ---- 工业（5）----
  {
    id: 'industry-1',
    era: 1,
    branch: 'industry',
    name: '纺织机械化',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
      { kind: 'unlockTier', building: 'textileMills', tier: 2 },
      { kind: 'unlockTier', building: 'furnitureWorks', tier: 2 },
      { kind: 'unlockTier', building: 'distilleries', tier: 2 },
      { kind: 'modifier', stat: 'fabricOutput', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'industry-2',
    era: 2,
    branch: 'industry',
    name: '蒸汽动力',
    cost: techNodeCost(2),
    prerequisites: ['industry-1', 'general-1850'],
    effects: [
      { kind: 'unlockTier', building: 'coalMines', tier: 2 },
      { kind: 'unlockTier', building: 'ironMines', tier: 2 },
      { kind: 'unlockTier', building: 'lumberMills', tier: 2 },
      { kind: 'modifier', stat: 'mineOutput', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'industry-3',
    era: 3,
    branch: 'industry',
    name: '钢铁工业',
    cost: techNodeCost(3),
    prerequisites: ['industry-2', 'general-1865'],
    effects: [
      { kind: 'unlockTier', building: 'steelMills', tier: 2 },
      { kind: 'unlockTier', building: 'machineryWorks', tier: 2 },
      { kind: 'unlockTier', building: 'luxuryWorks', tier: 2 },
      { kind: 'modifier', stat: 'factoryOutput', stack: 'percent', value: 8 },
    ],
  },
  {
    id: 'industry-5',
    era: 3,
    branch: 'industry',
    name: '化工合成',
    cost: techNodeCost(3),
    prerequisites: ['industry-3'],
    effects: [
      { kind: 'unlockBuilding', building: 'chemicalWorks' },
      { kind: 'demandShift', good: 'chemicals', percent: 100 },
    ],
  },
  {
    id: 'industry-4',
    era: 4,
    branch: 'industry',
    name: '电气化',
    cost: techNodeCost(4),
    prerequisites: ['industry-5', 'general-1880'],
    effects: [
      { kind: 'unlockTier', building: 'steelMills', tier: 3 },
      { kind: 'unlockTier', building: 'machineryWorks', tier: 3 },
      { kind: 'unlockTier', building: 'textileMills', tier: 3 },
      { kind: 'unlockTier', building: 'furnitureWorks', tier: 3 },
      { kind: 'unlockTier', building: 'distilleries', tier: 3 },
      { kind: 'unlockTier', building: 'luxuryWorks', tier: 3 },
      { kind: 'unlockTier', building: 'coalMines', tier: 3 },
      { kind: 'unlockTier', building: 'ironMines', tier: 3 },
      { kind: 'unlockTier', building: 'lumberMills', tier: 3 },
      { kind: 'unlockBuilding', building: 'powerPlants' },
      { kind: 'unlockBuilding', building: 'locomotiveWorks' },
    ],
  },
  // ---- 行政（5）----
  {
    id: 'admin-1',
    era: 1,
    branch: 'admin',
    name: '文官制度',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
      { kind: 'unlockTier', building: 'farms', tier: 2 },
      { kind: 'modifier', stat: 'bureaucracy', stack: 'flat', value: 5 },
      { kind: 'modifier', stat: 'taxEfficiency', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'admin-2',
    era: 2,
    branch: 'admin',
    name: '公共教育',
    cost: techNodeCost(2),
    prerequisites: ['admin-1', 'general-1850'],
    effects: [
      { kind: 'unlockLaw', law: '教育改革' },
      { kind: 'modifier', stat: 'literacy', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'admin-3',
    era: 3,
    branch: 'admin',
    name: '财政改革',
    cost: techNodeCost(3),
    prerequisites: ['admin-2', 'general-1865'],
    effects: [
      { kind: 'unlockLaw', law: '保护关税' },
      { kind: 'unlockLaw', law: '自由贸易' },
      { kind: 'modifier', stat: 'taxEfficiency', stack: 'percent', value: 8 },
    ],
  },
  {
    id: 'admin-5',
    era: 3,
    branch: 'admin',
    name: '统计与普查',
    cost: techNodeCost(3),
    prerequisites: ['admin-3'],
    effects: [
      { kind: 'unlockLaw', law: '保护关税' },
      { kind: 'modifier', stat: 'bureaucracy', stack: 'flat', value: 5 },
      { kind: 'modifier', stat: 'income', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'admin-4',
    era: 4,
    branch: 'admin',
    name: '大众政治',
    cost: techNodeCost(4),
    prerequisites: ['admin-5', 'general-1880'],
    effects: [
      { kind: 'unlockLaw', law: '福利改革' },
      { kind: 'unlockLaw', law: '宗教宽容' },
      { kind: 'immediate', legitimacy: 3, loyalists: 2, radicals: -2 },
    ],
  },
  // ---- 军事（5）----
  {
    id: 'military-1',
    era: 1,
    branch: 'military',
    name: '线膛枪',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
      { kind: 'unlockTier', building: 'farms', tier: 2 },
      { kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'military-2',
    era: 2,
    branch: 'military',
    name: '铁路动员',
    cost: techNodeCost(2),
    prerequisites: ['military-1', 'general-1850'],
    effects: [
      { kind: 'unlockLaw', law: '征兵制' },
      { kind: 'modifier', stat: 'manpower', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'military-3',
    era: 3,
    branch: 'military',
    name: '后装火炮',
    cost: techNodeCost(3),
    prerequisites: ['military-2', 'general-1865'],
    effects: [
      { kind: 'unlockTier', building: 'arsenals', tier: 2 },
      { kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 12 },
    ],
  },
  {
    id: 'military-5',
    era: 3,
    branch: 'military',
    name: '铁甲舰队',
    cost: techNodeCost(3),
    prerequisites: ['military-3'],
    effects: [
      { kind: 'unlockTier', building: 'navalYards', tier: 2 },
      { kind: 'unlockTier', building: 'navalBases', tier: 2 },
      { kind: 'immediate', navalQuality: 0.1 },
    ],
  },
  {
    id: 'military-4',
    era: 4,
    branch: 'military',
    name: '总参谋部',
    cost: techNodeCost(4),
    prerequisites: ['military-5', 'general-1880'],
    effects: [
      { kind: 'unlockTier', building: 'arsenals', tier: 3 },
      { kind: 'unlockTier', building: 'navalYards', tier: 3 },
      { kind: 'unlockTier', building: 'navalBases', tier: 3 },
      { kind: 'immediate', navalQuality: 0.1, morale: 5 },
      { kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 10 },
    ],
  },
]

const TECH_NODE_BY_ID = new Map<string, TechNodeDef>(TECH_NODES.map(node => [node.id, node]))

export function techNode(id: string): TechNodeDef | undefined {
  return TECH_NODE_BY_ID.get(id)
}

export function techNodeName(id: string): string {
  return TECH_NODE_BY_ID.get(id)?.name ?? `未知科技节点 ${id}`
}

export function techNodesInBranch(branch: TechBranch): TechNodeDef[] {
  return TECH_NODES.filter(node => node.branch === branch)
}

/** The continuous proxy the old `tech.level` formulas now read (plan 0005 §3). */
export function techTier(state: TechState): number {
  return (
    TECH_TIER_BASE +
    state.era * TECH_TIER_ERA_COEF +
    state.unlocked.length * TECH_TIER_UNLOCKED_COEF
  )
}

/**
 * Plan 0015 §S2 / ADR 0031 §4: the highest tier a building may be upgraded to.
 * Pure derivation over the country's unlocked node ids and the node table:
 * every `unlockTier{building, tier}` effect on an unlocked node raises the
 * ceiling. Tier numbering is 1-based (1 = tier I), so the default is 1.
 */
export function maxUnlockedTier(country: Country, building: BuildingId): number {
  let max = 1
  for (const nodeId of country.tech.unlocked) {
    const node = TECH_NODE_BY_ID.get(nodeId)
    if (node === undefined) continue
    for (const effect of node.effects) {
      if (effect.kind === 'unlockTier' && effect.building === building && effect.tier > max) {
        max = effect.tier
      }
    }
  }
  return max
}

/** Buildings some node unlocks via `unlockBuilding` (the rest are ungated). */
const TECH_GATED_BUILDINGS = new Set<BuildingId>(
  TECH_NODES.flatMap(node =>
    node.effects.flatMap(effect => (effect.kind === 'unlockBuilding' ? [effect.building] : [])),
  ),
)

/** Laws some node unlocks via `unlockLaw` (the rest are ungated). */
const TECH_GATED_LAWS = new Set<string>(
  TECH_NODES.flatMap(node =>
    node.effects.flatMap(effect => (effect.kind === 'unlockLaw' ? [effect.law] : [])),
  ),
)

function unlockedNodeGrants(
  country: Country,
  match: (effect: TechNodeDef['effects'][number]) => boolean,
): boolean {
  for (const nodeId of country.tech.unlocked) {
    const node = TECH_NODE_BY_ID.get(nodeId)
    if (node?.effects.some(match) === true) return true
  }
  return false
}

/**
 * Plan 0015 §S3 / ADR 0031 §9.1: whether a building is unlocked, derived from
 * the country's unlocked nodes. A building no node gates (every pre-existing
 * building) is always unlocked; the three new works need their node.
 */
export function buildingUnlocked(country: Country, building: BuildingId): boolean {
  if (!TECH_GATED_BUILDINGS.has(building)) return true
  return unlockedNodeGrants(
    country,
    effect => effect.kind === 'unlockBuilding' && effect.building === building,
  )
}

/** Plan 0015 §S3: whether a law's tech prerequisite (`unlockLaw`) is satisfied. */
export function lawUnlocked(country: Country, law: string): boolean {
  if (!TECH_GATED_LAWS.has(law)) return true
  return unlockedNodeGrants(country, effect => effect.kind === 'unlockLaw' && effect.law === law)
}

/**
 * Plan 0015 §S4 / ADR 0031 §9.2: the single buildability gate every path that
 * can add a building calls — the player's `actionBuild`, the AI build list and
 * validation, and private investment. Combines the legacy forward-compat
 * `unlock.techLevel` field (plan 0011 F6) with the S4 derived
 * `buildingUnlocked` (an `unlockBuilding` node), so both mechanisms are honoured
 * and no caller reads `BUILDINGS[id].unlock` by hand.
 */
export function isBuildingUnlocked(country: Country, building: BuildingId): boolean {
  const unlock = BUILDINGS[building].unlock
  if (unlock?.techLevel !== undefined && techTier(country.tech) < unlock.techLevel) {
    return false
  }
  return buildingUnlocked(country, building)
}

/** Every building the country may currently build (plan 0015 §S4). */
export function buildableBuildingIds(country: Country): BuildingId[] {
  return BUILDING_IDS.filter(building => isBuildingUnlocked(country, building))
}

/**
 * Plan 0015 §S3 / PT-068: the summed `demandShift` percent the country's
 * unlocked nodes apply to a good (0 when none). S4 wires this into the
 * Stone-Geary basket; S3 only provides the mechanism.
 */
export function demandShiftPercent(country: Country, good: GoodId): number {
  let percent = 0
  for (const nodeId of country.tech.unlocked) {
    const node = TECH_NODE_BY_ID.get(nodeId)
    if (node === undefined) continue
    for (const effect of node.effects) {
      if (effect.kind === 'demandShift' && effect.good === good) percent += effect.percent
    }
  }
  return percent
}

/** How many unlocked nodes belong to one branch. */
export function unlockedInBranch(state: TechState, branch: TechBranch): number {
  let count = 0
  for (const id of state.unlocked) {
    if (TECH_NODE_BY_ID.get(id)?.branch === branch) count += 1
  }
  return count
}

/**
 * The era gate. Branch nodes require the era counter to have reached their era;
 * general nodes are gated purely by their prerequisite chain, since completing a
 * general node is what raises the era it names (plan 0005 §1.1).
 */
export function eraGateOk(state: TechState, node: TechNodeDef): boolean {
  if (node.branch === 'general') return true
  return state.era >= node.era
}

/** Prerequisites: every listed node unlocked, plus the any-branch count. */
export function prereqOk(state: TechState, node: TechNodeDef): boolean {
  for (const id of node.prerequisites) {
    if (!state.unlocked.includes(id)) return false
  }
  if (node.requiresAnyBranch !== undefined) {
    const enough = (['industry', 'admin', 'military'] as const).some(
      branch => unlockedInBranch(state, branch) >= (node.requiresAnyBranch as number),
    )
    if (!enough) return false
  }
  return true
}

/** Whether the country may currently choose this node (plan 0005 §2.2). */
export function canResearchNode(state: TechState, node: TechNodeDef): boolean {
  if (state.unlocked.includes(node.id)) return false
  return eraGateOk(state, node) && prereqOk(state, node)
}

/**
 * The first currently-researchable node in table order. K1's deterministic
 * stand-in for the K3 AI choice, also used to seed a fresh country's research.
 */
export function defaultResearchNode(state: TechState): TechNodeDef | undefined {
  return TECH_NODES.find(node => canResearchNode(state, node))
}

/** Clamps an era to the modelled range. */
export function clampEra(era: number): number {
  return Math.min(TECH_MAX_ERA, Math.max(1, era))
}
