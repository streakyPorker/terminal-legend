import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_RECIPES,
  effectiveCount,
  makeRngForWorld,
  mixedRecipe,
  recipeAt,
  techNode,
} from '../engine/data'
import { applyCheat } from '../engine/cheat'
import {
  advance,
  applyDecision,
  computeEconomy,
  constructionCapacity,
  inspectEconomy,
  newWorld,
} from '../engine/sim'
import {
  completeBuilding,
  completeUpgrade,
  constructionGoldPerPoint,
  constructionTotalCost,
  normalizeConstructionQueue,
  projectWorkload,
  settleConstruction,
} from '../engine/construction'
import { parseWorld } from '../engine/save'
import type {
  BuildingId,
  ConstructionProject,
  Country,
  GoodId,
  TradeFlow,
  WorldState,
} from '../types'

// ============================================================================
// Plan 0015 §S2 — upgrade projects and the steel chain.
//
// `v3_action upgrade` orders a `kind: 'upgrade'` project that MOVES existing
// seats from one tier to a higher one. The S2 acceptance is: the moved seats
// feed the higher-tier recipe; the target tier must be unlocked; the order may
// not oversubscribe (or over-reserve) the source seats; completion fires none of
// the `completeBuilding` side effects; the order survives a save round-trip; and
// the steel chain visibly upgrades end-to-end.
// ============================================================================

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected), `expected ${expected}, got ${actual}`).toBeLessThan(1e-9)
}

const DATE = { year: 1836, month: 1 }

const buildProject = (count: number): ConstructionProject => ({
  id: 'build-1',
  building: 'steelMills',
  count,
  owner: 'state',
  monthsLeft: 1,
  monthlyCost: 0,
  lastSpend: 0,
  progress: 0,
  startedAt: { ...DATE },
})

const upgradeProject = (
  building: BuildingId,
  fromTier: number,
  toTier: number,
  count: number,
): ConstructionProject => ({
  ...buildProject(count),
  id: `upgrade-${building}-${fromTier}-${toTier}`,
  building,
  count,
  kind: 'upgrade',
  fromTier,
  toTier,
})

const orderUpgrade = (
  world: WorldState,
  countryId: string,
  building: string,
  fromTier: number,
  toTier: number,
  count: number,
): { ok: boolean; text: string } =>
  applyDecision(
    world,
    { countryId, action: 'upgrade', params: { building, fromTier, toTier, count } },
    makeRngForWorld(world),
  )

const upgradeProjects = (country: Country): ConstructionProject[] =>
  country.econ.constructionQueue.filter(project => project.kind === 'upgrade')

/**
 * Give a country ample construction points so an ordered project finishes in one
 * month: many workshops plus injected workshop-input imports (wood/grain/iron).
 */
const boostConstruction = (country: Country): void => {
  country.econ.buildings.workshops = 200
  country.econ.buildingTiers.workshops = [200]
  const flow = (good: GoodId): TradeFlow => ({
    good,
    from: 'GBR',
    to: country.id,
    quantity: 1e6,
    unitPrice: 1,
    landedPrice: 1,
    tariffPaid: 0,
    exportDuty: 0,
    value: 0,
  })
  country.trade.imports = [flow('wood'), flow('grain'), flow('iron')]
}

/**
 * In-test stand-in for S3 (which installs `unlockTier` in the node table): raise
 * a building's tier ceiling by appending the effect to an existing node and
 * unlocking it. The S2 default world ships NO `unlockTier`, so without this every
 * II/III upgrade is correctly rejected.
 */
const grantUnlockTier = (
  country: Country,
  building: BuildingId,
  tier: number,
): (() => void) => {
  const node = techNode('industry-3')
  if (node === undefined) throw new Error('missing node industry-3')
  const effect = { kind: 'unlockTier', building, tier } as const
  node.effects.push(effect)
  const added = !country.tech.unlocked.includes('industry-3')
  if (added) country.tech.unlocked.push('industry-3')
  return () => {
    const index = node.effects.indexOf(effect)
    if (index >= 0) node.effects.splice(index, 1)
    if (added) {
      const at = country.tech.unlocked.indexOf('industry-3')
      if (at >= 0) country.tech.unlocked.splice(at, 1)
    }
  }
}

describe('S2 upgrade workload and unit price (plan 0015 §S2)', () => {
  test('an upgrade needs 50% of the same-tier new-build workload, at the same unit price', () => {
    for (const count of [1, 4, 12]) {
      const build = buildProject(count)
      const upgrade = upgradeProject('steelMills', 0, 1, count)
      close(projectWorkload(upgrade), 0.5 * projectWorkload(build))
      // The rule value is 50%, inside the ADR's ≤60% cap.
      expect(projectWorkload(upgrade)).toBeLessThanOrEqual(projectWorkload(build) * 0.6)
      close(constructionGoldPerPoint(upgrade), constructionGoldPerPoint(build))
    }
    // 0.2 gold per point, unchanged by the upgrade.
    close(constructionGoldPerPoint(upgradeProject('steelMills', 0, 1, 3)), 0.2)
  })
})

describe('S2 upgrade completion moves seats into the higher-tier recipe (plan 0015 §S2)', () => {
  test('steelMills I→II feeds recipeAt(steelMills, 1) and raises output/profit', () => {
    const world = newWorld(7001, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 0
    qing.econ.treasury = 10000
    boostConstruction(qing)
    qing.econ.buildingTiers.steelMills = [3]
    qing.econ.buildings.steelMills = 3
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      // Force the two lagged multipliers (infra level, utilisation) to a fixed
      // value at BOTH measurements, so the only difference is the tier recipe.
      qing.econ.transportInfrastructure = 100
      qing.econ.buildingProfits.steelMills.utilization = 1
      const steelBefore = inspectEconomy(qing).production.steel

      const ordered = orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3)
      expect(ordered.ok).toBe(true)
      expect(upgradeProjects(qing).length).toBe(1)

      advance(world, 1, [], makeRngForWorld(world))

      // The whole stock moved to tier II and the Σ identity holds.
      expect(qing.econ.buildingTiers.steelMills[0]).toBe(0)
      expect(qing.econ.buildingTiers.steelMills[1]).toBeGreaterThan(0)
      close(sum(qing.econ.buildingTiers.steelMills), qing.econ.buildings.steelMills)

      // The weighted recipe is now exactly tier II.
      const mixed = mixedRecipe(qing, 'steelMills')
      const tierII = recipeAt('steelMills', 1)
      close(mixed.output.steel ?? 0, tierII.output.steel ?? 0)
      close(mixed.labor, tierII.labor)

      qing.econ.transportInfrastructure = 100
      qing.econ.buildingProfits.steelMills.utilization = 1
      expect(inspectEconomy(qing).production.steel).toBeGreaterThan(steelBefore)

      // Per-building profit follows the tier-II recipe, with Σcount capped once.
      qing.econ.buildingProfits.steelMills.utilization = 1
      const snap = computeEconomy(qing)
      const eff = effectiveCount(qing.econ.buildings.steelMills)
      const prices = qing.econ.prices
      let revenue = 0
      for (const [good, value] of Object.entries(tierII.output) as [GoodId, number][]) {
        revenue += value * prices[good] * eff
      }
      let inputCost = 0
      for (const [good, value] of Object.entries(tierII.input) as [GoodId, number][]) {
        inputCost += value * prices[good] * eff
      }
      close(snap.buildingProfits.steelMills.revenue, revenue)
      close(snap.buildingProfits.steelMills.inputCost, inputCost)

      // The finished upgrade left the queue.
      expect(upgradeProjects(qing).length).toBe(0)
    } finally {
      restore()
    }
  })
})

describe('S2 upgrade tier gate and seat reservation (plan 0015 §S2)', () => {
  test('an upgrade is rejected while the target tier is not unlocked (default world)', () => {
    const world = newWorld(7002, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [4]
    qing.econ.buildings.steelMills = 4

    const rejected = orderUpgrade(world, 'QING', 'steelMills', 1, 2, 2)
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('解锁')
    expect(upgradeProjects(qing).length).toBe(0)
  })

  test('an upgrade exceeding the unreserved seats at fromTier is rejected', () => {
    const world = newWorld(7003, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [3]
    qing.econ.buildings.steelMills = 3
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      const tooMany = orderUpgrade(world, 'QING', 'steelMills', 1, 2, 4)
      expect(tooMany.ok).toBe(false)
      expect(tooMany.text).toContain('座数')
      expect(upgradeProjects(qing).length).toBe(0)

      const exact = orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3)
      expect(exact.ok).toBe(true)
    } finally {
      restore()
    }
  })

  test('a second order cannot over-reserve the same seats', () => {
    const world = newWorld(7004, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [5]
    qing.econ.buildings.steelMills = 5
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3).ok).toBe(true)
      // 3 already reserved → only 2 remain.
      const over = orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3)
      expect(over.ok).toBe(false)
      expect(over.text).toContain('已预约')
      // Exactly the remainder fits, then nothing is left.
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 2).ok).toBe(true)
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 1).ok).toBe(false)
      expect(sum(upgradeProjects(qing).map(p => p.count))).toBe(5)
    } finally {
      restore()
    }
  })

  test('normalizeConstructionQueue never splits an upgrade by the five-seat rule', () => {
    const world = newWorld(7005, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [8]
    qing.econ.buildings.steelMills = 8
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 8).ok).toBe(true)
      normalizeConstructionQueue(qing)
      const upgrades = upgradeProjects(qing)
      expect(upgrades.length).toBe(1)
      expect(upgrades[0]?.count).toBe(8)
    } finally {
      restore()
    }
  })

  test('workshops cannot be upgraded', () => {
    const world = newWorld(7006, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.workshops = [5]
    qing.econ.buildings.workshops = 5
    const rejected = orderUpgrade(world, 'QING', 'workshops', 1, 2, 2)
    expect(rejected.ok).toBe(false)
    expect(rejected.text).toContain('不可升级')
  })
})

describe('S2 upgrade has no completeBuilding side effects (plan 0015 §S2)', () => {
  test('completeUpgrade moves seats without touching access / literacy / admin / infrastructure', () => {
    const world = newWorld(7007, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 0
    boostConstruction(qing)
    qing.econ.buildings.infrastructure = 6
    qing.econ.buildingTiers.infrastructure = [6]
    qing.econ.buildings.schools = 4
    qing.econ.buildingTiers.schools = [4]
    qing.econ.buildings.universities = 3
    qing.econ.buildingTiers.universities = [3]

    const before = {
      access: qing.econ.marketAccess,
      literacy: qing.pops.literacy,
      admin: qing.econ.administrativeCapacity,
      infra: qing.econ.transportInfrastructure,
      bureaucracy: qing.bureaucracy,
      capacity: constructionCapacity(qing),
    }

    expect(completeUpgrade(qing, upgradeProject('infrastructure', 0, 1, 3))).toBeUndefined()
    expect(completeUpgrade(qing, upgradeProject('schools', 0, 1, 2))).toBeUndefined()
    expect(completeUpgrade(qing, upgradeProject('universities', 0, 1, 1))).toBeUndefined()

    // Seats moved...
    expect(qing.econ.buildingTiers.infrastructure).toEqual([3, 3])
    // ...but none of the completion side effects fired.
    expect(qing.econ.marketAccess).toBe(before.access)
    expect(qing.pops.literacy).toBe(before.literacy)
    expect(qing.econ.administrativeCapacity).toBe(before.admin)
    expect(qing.econ.transportInfrastructure).toBe(before.infra)
    expect(qing.bureaucracy).toBe(before.bureaucracy)
    // Upgrades never raise construction capacity (workshops untouched).
    expect(constructionCapacity(qing)).toBe(before.capacity)

    // Control: the new-build path DOES move these, so the assertions above bite.
    qing.econ.buildings.infrastructure = 6
    qing.econ.buildingTiers.infrastructure = [6]
    const accessBefore = qing.econ.marketAccess
    completeBuilding(qing, 'infrastructure', 2)
    expect(qing.econ.marketAccess).toBeGreaterThan(accessBefore)
  })

  test('cheat.finishProjects completes upgrade projects without the build side effects', () => {
    const world = newWorld(7008, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildings.schools = 4
    qing.econ.buildingTiers.schools = [4]
    const literacyBefore = qing.pops.literacy
    qing.econ.constructionQueue = [upgradeProject('schools', 0, 1, 3)]

    const result = applyCheat(world, { action: 'finishProjects', country: 'QING' })
    expect(result.ok).toBe(true)
    expect(qing.pops.literacy, 'schools upgrade must not add literacy').toBe(literacyBefore)
    expect(qing.econ.buildingTiers.schools).toEqual([1, 3])
  })
})

describe('S2 upgrade costs: capacity + gold only, no materials (ADR 0031 §5)', () => {
  test('an upgrade month draws no goods but pays its gold through the construction-spend channel', () => {
    const world = newWorld(7011, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 0
    qing.econ.treasury = 10000
    boostConstruction(qing)
    qing.econ.buildingTiers.steelMills = [3]
    qing.econ.buildings.steelMills = 3
    qing.econ.constructionQueue = []
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3).ok).toBe(true)
      const project = upgradeProjects(qing)[0]
      if (project === undefined) throw new Error('upgrade not queued')
      const expectedGold = constructionTotalCost(project)

      // Settle construction directly so ONLY the upgrade runs (no private
      // investment or events pollute the investment-demand reading).
      const spend = settleConstruction(world, qing, makeRngForWorld(world), [])

      // ADR 0031 §5: an upgrade draws NO materials, so it adds nothing to the
      // intermediate-good investment demand.
      const demand = qing.econ.lastConstructionDemand
      expect(Object.values(demand).every(value => (value ?? 0) === 0)).toBe(true)
      // Its gold (workload × 0.2) still flows through the construction-spend
      // channel — the same one a new build uses, counted as GDP investment I.
      expect(expectedGold).toBeGreaterThan(0)
      close(spend, expectedGold)
      close(qing.econ.lastStateConstructionSpend, expectedGold)
      expect(upgradeProjects(qing).length).toBe(0)
    } finally {
      restore()
    }
  })

  test('a new build still draws its INVESTMENT_DEMAND materials (the contrast)', () => {
    const world = newWorld(7012, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 0
    qing.econ.treasury = 10000
    boostConstruction(qing)
    qing.econ.constructionQueue = []

    const ordered = applyDecision(
      world,
      { countryId: 'QING', action: 'build', params: { building: 'steelMills', count: 2 } },
      makeRngForWorld(world),
    )
    expect(ordered.ok).toBe(true)
    advance(world, 1, [], makeRngForWorld(world))

    const demand = qing.econ.lastConstructionDemand
    expect((demand.steel ?? 0) + (demand.machinery ?? 0)).toBeGreaterThan(0)
  })
})

describe('S2 upgrade save round-trip (plan 0015 §S2)', () => {
  test('an in-flight upgrade project survives parseWorld(JSON round-trip)', () => {
    const world = newWorld(7009, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.buildingTiers.steelMills = [4]
    qing.econ.buildings.steelMills = 4
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 3).ok).toBe(true)
      const live = upgradeProjects(qing)[0]
      if (live === undefined) throw new Error('upgrade not queued')
      live.progress = 0.4

      const parsed = parseWorld(JSON.parse(JSON.stringify(world)))
      expect(parsed).toBeDefined()
      if (parsed === undefined) return
      const reloadedQing = countryOf(parsed, 'QING')
      const reloaded = upgradeProjects(reloadedQing)[0]
      expect(reloaded).toBeDefined()
      expect(reloaded?.kind).toBe('upgrade')
      expect(reloaded?.building).toBe('steelMills')
      expect(reloaded?.fromTier).toBe(0)
      expect(reloaded?.toTier).toBe(1)
      expect(reloaded?.count).toBe(3)
      expect(reloaded?.progress).toBe(0.4)
    } finally {
      restore()
    }
  })
})

describe('S2 end-to-end: unlock → upgrade → steel chain II (plan 0015 §S2)', () => {
  test('an unlocked steelMills upgrade makes the steel-chain recipe II and raises output', () => {
    const world = newWorld(7010, 'QING')
    const qing = countryOf(world, 'QING')
    qing.econ.privateCapital = 0
    qing.econ.treasury = 10000
    boostConstruction(qing)
    qing.econ.buildingTiers.steelMills = [4]
    qing.econ.buildings.steelMills = 4
    const restore = grantUnlockTier(qing, 'steelMills', 2)
    try {
      qing.econ.transportInfrastructure = 100
      qing.econ.buildingProfits.steelMills.utilization = 1
      const steelBefore = inspectEconomy(qing).production.steel

      expect(orderUpgrade(world, 'QING', 'steelMills', 1, 2, 4).ok).toBe(true)
      advance(world, 1, [], makeRngForWorld(world))

      qing.econ.transportInfrastructure = 100
      qing.econ.buildingProfits.steelMills.utilization = 1
      expect(inspectEconomy(qing).production.steel).toBeGreaterThan(steelBefore)
      // Every seat is now II, so the chain's active recipe IS the tier-II one.
      close(
        mixedRecipe(qing, 'steelMills').output.steel ?? 0,
        BUILDING_RECIPES.steelMills.tiers?.[0]?.output.steel ?? 0,
      )
    } finally {
      restore()
    }
  })
})
