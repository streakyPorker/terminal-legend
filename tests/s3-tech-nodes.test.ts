import { describe, expect, test } from 'claude-code/testing'
import type { BuildingId, Country, TechNodeDef, WorldState } from '../types'
import type { Decision } from '../engine/internal'
import {
  TECH_NODES,
  buildingUnlocked,
  demandShiftPercent,
  lawUnlocked,
  makeRngForWorld,
  maxUnlockedTier,
  techNode,
} from '../engine/data'
import { applyModifiers } from '../engine/modifiers'
import { techNodeCost } from '../engine/config/tech'
import { advance, applyDecision, newWorld } from '../engine/sim'

// ============================================================================
// Plan 0015 §S3 — the 20-node table (appendix A), extended by plan 0016 §S2
// (appendix C.1) to 22 nodes with the two era-4 electrification nodes, and the
// four unlock-class effect kinds. The table is frozen in the plans; this file is
// its integrity check plus the derived-accessor / law-gate / seed-install /
// clampEra acceptance.
// ============================================================================

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const UNLOCK_KINDS = ['unlockTier', 'unlockBuilding', 'unlockLaw', 'demandShift'] as const

const unlockEffectsOf = (node: TechNodeDef): TechNodeDef['effects'][number][] =>
  node.effects.filter(effect => (UNLOCK_KINDS as readonly string[]).includes(effect.kind))

const decideLaw = (
  world: WorldState,
  countryId: string,
  name: string,
): { ok: boolean; text: string } =>
  applyDecision(
    world,
    { countryId, action: 'law', params: { name } } as Decision,
    makeRngForWorld(world),
  )

const APPENDIX_IDS: Record<string, string[]> = {
  general: ['general-1836', 'general-1840', 'general-1850', 'general-1865', 'general-1880'],
  industry: [
    'industry-1',
    'industry-2',
    'industry-3',
    'industry-5',
    'industry-4',
    'industry-6',
    'industry-7',
  ],
  admin: ['admin-1', 'admin-2', 'admin-3', 'admin-5', 'admin-4'],
  military: ['military-1', 'military-2', 'military-3', 'military-5', 'military-4'],
}

describe('S3/S2 22-node table integrity (plan 0015 §S3 / plan 0016 §S2)', () => {
  test('exactly 22 nodes with the appendix ids and era sequence', () => {
    expect(TECH_NODES).toHaveLength(22)
    for (const branch of ['general', 'industry', 'admin', 'military'] as const) {
      const nodes = TECH_NODES.filter(node => node.branch === branch)
      expect(nodes.map(node => node.id), `${branch} ids`).toEqual(APPENDIX_IDS[branch])
      expect(nodes).toHaveLength(APPENDIX_IDS[branch].length)
    }
    const generalEras = TECH_NODES.filter(node => node.branch === 'general').map(node => node.era)
    expect(generalEras).toEqual([1, 1, 2, 3, 4])
  })

  test('ids are unique and every prerequisite names a real node', () => {
    const ids = TECH_NODES.map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set(ids)
    for (const node of TECH_NODES) {
      for (const prereq of node.prerequisites) {
        expect(known.has(prereq), `${node.id} → ${prereq}`).toBe(true)
      }
    }
  })

  test('the prerequisite graph is acyclic', () => {
    const prereqOf = new Map(TECH_NODES.map(node => [node.id, node.prerequisites]))
    const visiting = new Set<string>()
    const done = new Set<string>()
    const visit = (id: string): void => {
      if (done.has(id)) return
      expect(visiting.has(id), `cycle at ${id}`).toBe(false)
      visiting.add(id)
      for (const prereq of prereqOf.get(id) ?? []) visit(prereq)
      visiting.delete(id)
      done.add(id)
    }
    for (const node of TECH_NODES) visit(node.id)
    expect(done.size).toBe(TECH_NODES.length)
  })

  test('every node carries at least one unlock-class effect', () => {
    for (const node of TECH_NODES) {
      expect(unlockEffectsOf(node).length, `${node.id} has no unlock-class effect`).toBeGreaterThan(
        0,
      )
    }
  })

  test('requiresAnyBranch is only on general nodes and uses a modelled branch count', () => {
    for (const node of TECH_NODES) {
      if (node.requiresAnyBranch === undefined) continue
      expect(node.branch).toBe('general')
      expect(node.requiresAnyBranch === 2 || node.requiresAnyBranch === 3).toBe(true)
    }
    expect(techNode('general-1865')?.requiresAnyBranch).toBe(2)
    expect(techNode('general-1880')?.requiresAnyBranch).toBe(3)
  })

  test('coverage: the six laws and the three new buildings each have a source node', () => {
    const laws = new Set<string>()
    const buildings = new Set<string>()
    for (const node of TECH_NODES) {
      for (const effect of node.effects) {
        if (effect.kind === 'unlockLaw') laws.add(effect.law)
        if (effect.kind === 'unlockBuilding') buildings.add(effect.building)
      }
    }
    for (const law of ['教育改革', '福利改革', '自由贸易', '保护关税', '征兵制', '宗教宽容']) {
      expect(laws.has(law), `law ${law}`).toBe(true)
    }
    for (const building of ['chemicalWorks', 'powerPlants', 'locomotiveWorks']) {
      expect(buildings.has(building), `building ${building}`).toBe(true)
    }
  })
})

describe('S3 seed install (ADR 0031 §9.1 / review M3)', () => {
  test('a seeded era-3 country (GBR) has its unlocked general-node effects live', () => {
    const world = newWorld(7500, 'QING')
    const gbr = countryOf(world, 'GBR')
    expect(gbr.tech.era).toBeGreaterThanOrEqual(2)
    // general-1850's modifier is installed (not merely recorded in `unlocked`).
    expect(gbr.tech.unlocked).toContain('general-1850')
    expect(gbr.modifiers.some(m => m.source === 'tech:general-1850')).toBe(true)
    expect(Math.abs(applyModifiers(gbr, 'techPoints', 100) - 105)).toBeLessThan(1e-9)
    // general-1865's `unlockTier infrastructure 2` is reflected by the derived ceiling.
    expect(maxUnlockedTier(gbr, 'infrastructure')).toBe(2)
  })

  test('the seed install covers every pre-unlocked general node with a modifier/immediate', () => {
    const world = newWorld(7501, 'QING')
    for (const country of Object.values(world.countries)) {
      for (const nodeId of country.tech.unlocked) {
        const node = techNode(nodeId)
        if (node === undefined) continue
        const modifierCount = node.effects.filter(effect => effect.kind === 'modifier').length
        const installed = country.modifiers.filter(m => m.source === `tech:${nodeId}`).length
        expect(installed, `${country.id} ${nodeId}`).toBe(modifierCount)
      }
    }
  })
})

describe('S3 law gating (v3_action law tech prerequisite)', () => {
  test('a law is rejected while its unlockLaw node is locked and passes once unlocked', () => {
    const world = newWorld(7600, 'QING')
    const qing = countryOf(world, 'QING')
    qing.government.authority = 100

    expect(lawUnlocked(qing, '教育改革')).toBe(false)
    const denied = decideLaw(world, 'QING', '教育改革')
    expect(denied.ok).toBe(false)
    expect(denied.text).toContain('科技前置')
    expect(qing.modifiers.some(m => m.id === 'law:教育改革')).toBe(false)

    qing.tech.unlocked.push('admin-2')
    expect(lawUnlocked(qing, '教育改革')).toBe(true)
    const passed = decideLaw(world, 'QING', '教育改革')
    expect(passed.ok).toBe(true)
    expect(qing.modifiers.some(m => m.id === 'law:教育改革')).toBe(true)
  })

  test('every modelled law is gated and unlocked by no node at world start', () => {
    const world = newWorld(7601, 'QING')
    for (const country of Object.values(world.countries)) {
      for (const law of ['教育改革', '福利改革', '自由贸易', '保护关税', '征兵制', '宗教宽容']) {
        expect(lawUnlocked(country, law), `${country.id} ${law}`).toBe(false)
      }
    }
  })

  test('a law no node gates stays allowed', () => {
    const world = newWorld(7602, 'QING')
    const qing = countryOf(world, 'QING')
    expect(lawUnlocked(qing, '不存在的法案')).toBe(true)
  })
})

describe('S3 derived unlock accessors (ADR 0031 §9.1)', () => {
  test('buildingUnlocked follows the new buildings\' unlockBuilding nodes', () => {
    const world = newWorld(7700, 'QING')
    const qing = countryOf(world, 'QING')
    expect(buildingUnlocked(qing, 'chemicalWorks')).toBe(false)
    expect(buildingUnlocked(qing, 'powerPlants')).toBe(false)
    qing.tech.unlocked.push('industry-5')
    expect(buildingUnlocked(qing, 'chemicalWorks')).toBe(true)
    expect(buildingUnlocked(qing, 'powerPlants')).toBe(false)
    // a building with no unlockBuilding effect is always unlocked
    expect(buildingUnlocked(qing, 'steelMills')).toBe(true)
  })

  test('demandShiftPercent reflects industry-5\'s +100% chemicals shift only', () => {
    const world = newWorld(7701, 'QING')
    const qing = countryOf(world, 'QING')
    expect(demandShiftPercent(qing, 'chemicals')).toBe(0)
    qing.tech.unlocked.push('industry-5')
    expect(demandShiftPercent(qing, 'chemicals')).toBe(100)
    expect(demandShiftPercent(qing, 'electricity')).toBe(0)
    expect(demandShiftPercent(qing, 'grain')).toBe(0)
  })

  test('maxUnlockedTier follows each node\'s unlockTier ceiling', () => {
    const world = newWorld(7702, 'QING')
    const qing = countryOf(world, 'QING')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(1)
    qing.tech.unlocked.push('industry-3')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(2)
    qing.tech.unlocked.push('industry-4')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(3)
  })
})

describe('S2 electrification nodes (plan 0016 §S2 / appendix C.1)', () => {
  const COVERED: BuildingId[] = [
    'coalMines',
    'ironMines',
    'lumberMills',
    'textileMills',
    'furnitureWorks',
    'distilleries',
    'machineryWorks',
    'steelMills',
    'arsenals',
    'luxuryWorks',
    'infrastructure',
    'navalYards',
    'navalBases',
    'farms',
    'workshops',
    'chemicalWorks',
    'powerPlants',
    'locomotiveWorks',
  ]

  test('industry-6/7 are era-4 industry nodes with the appendix prerequisites and cost', () => {
    for (const [id, prereq] of [
      ['industry-6', 'industry-4'],
      ['industry-7', 'industry-6'],
    ] as const) {
      const node = techNode(id)
      expect(node, id).toBeDefined()
      if (node === undefined) continue
      expect(node.era).toBe(4)
      expect(node.branch).toBe('industry')
      expect(node.cost).toBe(techNodeCost(4))
      expect(node.prerequisites).toEqual([prereq])
    }
  })

  test('industry-6/7 each grant unlockTier IV/V across all 18 covered buildings', () => {
    const tierOf = (node: TechNodeDef, building: BuildingId): number | undefined =>
      node.effects.find(
        effect => effect.kind === 'unlockTier' && effect.building === building,
      )?.tier
    const six = techNode('industry-6')
    const seven = techNode('industry-7')
    if (six === undefined || seven === undefined) throw new Error('missing industry-6/7')
    for (const building of COVERED) {
      expect(tierOf(six, building), `industry-6 ${building}`).toBe(4)
      expect(tierOf(seven, building), `industry-7 ${building}`).toBe(5)
    }
  })

  test('maxUnlockedTier for steelMills walks 1→2→3→4→5 as industry-3/4/6/7 unlock', () => {
    const world = newWorld(7703, 'QING')
    const qing = countryOf(world, 'QING')
    qing.tech.unlocked = ['general-1836']
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(1)
    qing.tech.unlocked.push('industry-3')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(2)
    qing.tech.unlocked.push('industry-4')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(3)
    qing.tech.unlocked.push('industry-6')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(4)
    qing.tech.unlocked.push('industry-7')
    expect(maxUnlockedTier(qing, 'steelMills')).toBe(5)
  })

  test('industry-6 alone raises every covered building to IV; industry-7 to V', () => {
    const world = newWorld(7705, 'QING')
    const qing = countryOf(world, 'QING')
    qing.tech.unlocked = ['industry-6']
    for (const building of COVERED) {
      expect(maxUnlockedTier(qing, building), `${building} IV`).toBe(4)
    }
    qing.tech.unlocked.push('industry-7')
    for (const building of COVERED) {
      expect(maxUnlockedTier(qing, building), `${building} V`).toBe(5)
    }
  })

  test('a default world never silently unlocks IV/V', () => {
    const world = newWorld(7704, 'QING')
    for (const country of Object.values(world.countries)) {
      for (const building of COVERED) {
        const tier = maxUnlockedTier(country, building)
        expect(tier, `${country.id} ${building}`).toBeLessThanOrEqual(3)
      }
    }
    // The only default ceiling above I comes from the pre-existing general line
    // (`general-1836` grants `farms 2`); S2 adds no early unlock.
    const qing = countryOf(world, 'QING')
    expect(maxUnlockedTier(qing, 'farms')).toBe(2)
    for (const building of COVERED) {
      if (building !== 'farms') expect(maxUnlockedTier(qing, building), building).toBe(1)
    }
  })
})

describe('S3 unlock timeline invariance (review blocker)', () => {
  test('a node never grants a tier/law earlier than the node that first introduces it', () => {
    const world = newWorld(7900, 'QING')
    const qing = countryOf(world, 'QING')
    qing.tech.unlocked = ['general-1836']
    expect(maxUnlockedTier(qing, 'infrastructure')).toBe(1)
    expect(maxUnlockedTier(qing, 'arsenals')).toBe(1)
    expect(lawUnlocked(qing, '教育改革')).toBe(false)
    expect(lawUnlocked(qing, '福利改革')).toBe(false)

    qing.tech.unlocked.push('admin-2')
    expect(lawUnlocked(qing, '教育改革')).toBe(true)
    expect(lawUnlocked(qing, '福利改革')).toBe(false)

    qing.tech.unlocked.push('admin-4')
    expect(lawUnlocked(qing, '福利改革')).toBe(true)
  })

  test('the first node to grant each contested unlock is the appendix-A one', () => {
    const firstFor = (predicate: (effect: TechNodeDef['effects'][number]) => boolean): string =>
      TECH_NODES.find(node => node.effects.some(predicate))?.id ?? ''
    expect(
      firstFor(e => e.kind === 'unlockTier' && e.building === 'infrastructure' && e.tier === 2),
    ).toBe('general-1865')
    expect(
      firstFor(e => e.kind === 'unlockTier' && e.building === 'arsenals' && e.tier === 2),
    ).toBe('military-3')
    expect(firstFor(e => e.kind === 'unlockLaw' && e.law === '教育改革')).toBe('admin-2')
    expect(firstFor(e => e.kind === 'unlockLaw' && e.law === '福利改革')).toBe('admin-4')
  })
})

describe('S3 general-line completion clamps the era (ADR 0031 §9.4)', () => {
  test('completing the era-4 general node lands on era 4, never beyond', () => {
    const world = newWorld(7800, 'QING')
    const qing = countryOf(world, 'QING')
    qing.tech.unlocked = ['general-1836', 'general-1840', 'general-1850', 'general-1865']
    qing.tech.researching = 'general-1880'
    const node = techNode('general-1880')
    if (node === undefined) throw new Error('missing general-1880')
    qing.tech.points = node.cost

    advance(world, 1, [], makeRngForWorld(world))

    expect(qing.tech.unlocked).toContain('general-1880')
    expect(qing.tech.era).toBe(4)
    expect(qing.tech.era).toBeLessThanOrEqual(4)
  })

  test('no node declares an era above the modelled maximum of 4', () => {
    for (const node of TECH_NODES) expect(node.era).toBeLessThanOrEqual(4)
  })
})
