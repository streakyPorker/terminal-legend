import type { TechBranch, TechNodeDef, TechState } from '../../types'
import { TECH_MAX_ERA, TECH_TIER_BASE, TECH_TIER_ERA_COEF, TECH_TIER_UNLOCKED_COEF, techNodeCost } from '../config/tech'

/**
 * The 4-era / 16-node tech tree (plan 0005 §1): a 4-node general era line plus
 * industry / admin / military branches of 4 nodes each. Each node's cost comes
 * from `TECH_ERA_COSTS` (config/tech.ts) so the whole pace is one dial; effects
 * are stored in K1 and wired by K2.
 */
export const TECH_NODES: TechNodeDef[] = [
  // ---- 通用时代线（4）----
  { id: 'general-1836', era: 1, branch: 'general', name: '传统农业', cost: techNodeCost(1), prerequisites: [], effects: [] },
  {
    id: 'general-1850',
    era: 2,
    branch: 'general',
    name: '蒸汽时代',
    cost: techNodeCost(2),
    prerequisites: ['general-1836'],
    effects: [{ kind: 'modifier', stat: 'techPoints', stack: 'percent', value: 5 }],
    year: 14,
  },
  {
    id: 'general-1865',
    era: 3,
    branch: 'general',
    name: '工业时代',
    cost: techNodeCost(3),
    prerequisites: ['general-1850'],
    requiresAnyBranch: 2,
    effects: [{ kind: 'modifier', stat: 'techPoints', stack: 'percent', value: 10 }],
    year: 29,
  },
  {
    id: 'general-1880',
    era: 4,
    branch: 'general',
    name: '电气时代',
    cost: techNodeCost(4),
    prerequisites: ['general-1865'],
    requiresAnyBranch: 3,
    effects: [{ kind: 'modifier', stat: 'techPoints', stack: 'percent', value: 15 }],
    year: 44,
  },
  // ---- 工业（4）----
  {
    id: 'industry-1',
    era: 1,
    branch: 'industry',
    name: '纺织机械化',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
      { kind: 'modifier', stat: 'fabricOutput', stack: 'percent', value: 10 },
      { kind: 'modifier', stat: 'factoryOutput', stack: 'percent', value: 8 },
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
      { kind: 'modifier', stat: 'mineOutput', stack: 'percent', value: 10 },
      { kind: 'modifier', stat: 'coalOutput', stack: 'percent', value: 8 },
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
      { kind: 'modifier', stat: 'ironOutput', stack: 'percent', value: 12 },
      { kind: 'modifier', stat: 'factoryOutput', stack: 'percent', value: 8 },
    ],
  },
  {
    id: 'industry-4',
    era: 4,
    branch: 'industry',
    name: '电气化',
    cost: techNodeCost(4),
    prerequisites: ['industry-3', 'general-1880'],
    effects: [
      { kind: 'modifier', stat: 'factoryOutput', stack: 'percent', value: 15 },
      { kind: 'modifier', stat: 'machineryOutput', stack: 'percent', value: 10 },
    ],
    unlocks: ['electrification'],
  },
  // ---- 行政（4）----
  {
    id: 'admin-1',
    era: 1,
    branch: 'admin',
    name: '文官制度',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [
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
      { kind: 'modifier', stat: 'literacy', stack: 'percent', value: 5 },
      { kind: 'modifier', stat: 'techPoints', stack: 'percent', value: 5 },
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
      { kind: 'modifier', stat: 'taxEfficiency', stack: 'percent', value: 8 },
      { kind: 'modifier', stat: 'income', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'admin-4',
    era: 4,
    branch: 'admin',
    name: '大众政治',
    cost: techNodeCost(4),
    prerequisites: ['admin-3', 'general-1880'],
    effects: [{ kind: 'immediate', legitimacy: 3, loyalists: 2, radicals: -2 }],
  },
  // ---- 军事（4）----
  {
    id: 'military-1',
    era: 1,
    branch: 'military',
    name: '线膛枪',
    cost: techNodeCost(1),
    prerequisites: ['general-1836'],
    effects: [{ kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 10 }],
  },
  {
    id: 'military-2',
    era: 2,
    branch: 'military',
    name: '铁路动员',
    cost: techNodeCost(2),
    prerequisites: ['military-1', 'general-1850'],
    effects: [
      { kind: 'modifier', stat: 'manpower', stack: 'percent', value: 10 },
      { kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 5 },
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
      { kind: 'modifier', stat: 'armyStrength', stack: 'percent', value: 12 },
      { kind: 'modifier', stat: 'navyStrength', stack: 'percent', value: 5 },
    ],
  },
  {
    id: 'military-4',
    era: 4,
    branch: 'military',
    name: '总参谋部',
    cost: techNodeCost(4),
    prerequisites: ['military-3', 'general-1880'],
    effects: [
      { kind: 'immediate', morale: 5 },
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
