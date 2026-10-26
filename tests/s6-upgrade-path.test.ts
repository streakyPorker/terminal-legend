import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDING_IDS,
  defaultResearchNode,
  makeRngForWorld,
  maxUnlockedTier,
} from '../engine/data'
import { decideForAi } from '../engine/ai'
import { advance, applyDecision, newWorld, randomDecision } from '../engine/sim'
import { upgradeCandidate } from '../engine/investment'
import type { Rng } from '../engine/rng'
import type { BuildingId, Country, TechState, WorldState } from '../types'

// ============================================================================
// Plan 0016 §S6 — the AI and private-investment upgrade ("electrify") path.
//
// Before S6 only the player could retrofit seats; the AI and private investment
// only ever ordered new tier-I builds, so the empires the player does not run
// never reached IV/V. S6 gives both an upgrade path: when the next tier is
// unlocked (`maxUnlockedTier`) and the projected margin improves, order
// `kind:'upgrade'` on existing seats instead of only new builds. Every choice is
// deterministic (no RNG), so the same seed still yields the same world.
// ============================================================================

const SEED = 9100
const TIER_V_TECH = ['general-1880', 'industry-4', 'industry-6', 'industry-7']

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + n, 0)

/** Every seat above tier I across the country — proof a retrofit moved seats. */
const seatsAboveTierI = (country: Country): number =>
  BUILDING_IDS.reduce(
    (total, id) => total + sum((country.econ.buildingTiers[id] ?? []).slice(1)),
    0,
  )

/** A deterministic RNG that only the given `chance` probability accepts. */
const scriptedRng = (pass: number): Rng => ({
  next: () => 0,
  int: () => 0,
  range: (min: number) => min,
  chance: (probability: number) => probability === pass,
  pick: <T>(items: readonly T[]): T => items[0] as T,
})

describe('S6 AI fallback upgrade path (plan 0016 §S6)', () => {
  test('an unlocked higher tier turns the fallback into an upgrade order', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.tech.unlocked.push(...TIER_V_TECH)
    gbr.econ.treasury = 1000
    gbr.econ.constructionQueue = []

    // Only the 0.45 build-branch roll is accepted, so the debt / spending /
    // invest branches are skipped and construction is the chosen action.
    const decision = randomDecision(world, gbr, scriptedRng(0.45))
    expect(decision?.action).toBe('upgrade')
    if (decision === undefined) return

    const building = String(decision.params.building) as BuildingId
    const toTier = Number(decision.params.toTier)
    expect(BUILDING_IDS).toContain(building)
    expect(toTier).toBeLessThanOrEqual(maxUnlockedTier(gbr, building))
    expect(applyDecision(world, decision, makeRngForWorld(world)).ok).toBe(true)
  })

  test('below the mid/late tiers the fallback still builds (no premature retrofit)', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.econ.treasury = 1000
    gbr.econ.constructionQueue = []
    // The seed world unlocks farms II only (a tier-II ceiling), which the S6 AI
    // path deliberately leaves to the private-investment step.
    expect(maxUnlockedTier(gbr, 'textileMills')).toBe(1)
    const decision = randomDecision(world, gbr, scriptedRng(0.45))
    expect(decision?.action).toBe('build')
  })
})

describe('S6 AI allowlist accepts an upgrade order (plan 0016 §S6)', () => {
  test('an LLM-emitted upgrade survives validation and acts on the queue', async () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.tech.unlocked.push('industry-3')
    gbr.econ.buildingTiers.steelMills = [4]
    gbr.econ.buildings.steelMills = 4
    gbr.econ.constructionQueue = []

    const fake = {
      model: {
        complete: async () => ({
          isAnswered: true,
          text: JSON.stringify([
            {
              country: 'GBR',
              action: 'upgrade',
              params: { building: 'steelMills', fromTier: 1, toTier: 2, count: 2 },
              narrative: '伦敦把两座钢铁厂改造升级',
            },
          ]),
        }),
      },
    }
    const report = await decideForAi(fake as never, world, makeRngForWorld(world))
    const decision = report.decisions.find(one => one.countryId === 'GBR')
    expect(decision?.action).toBe('upgrade')
    if (decision === undefined) return
    expect(applyDecision(world, decision, makeRngForWorld(world)).ok).toBe(true)
    expect(
      world.countries.GBR?.econ.constructionQueue.some(project => project.kind === 'upgrade'),
    ).toBe(true)
  })
})

describe('S6 private investment upgrades non-player empires (plan 0016 §S6)', () => {
  test('a non-player electrifies within 60 months once IV/V is unlocked', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.tech.unlocked.push(...TIER_V_TECH)
    gbr.econ.privateCapital = 500
    const before = seatsAboveTierI(gbr)

    const rng = makeRngForWorld(world)
    for (let month = 0; month < 60; month += 1) advance(world, 1, [], rng)

    expect(seatsAboveTierI(gbr)).toBeGreaterThan(before)
  })

  test('the retrofit never crosses the ceiling or the stock, and Σ tiers stays synced', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.tech.unlocked.push(...TIER_V_TECH)
    gbr.econ.privateCapital = 500

    const rng = makeRngForWorld(world)
    for (let month = 0; month < 60; month += 1) advance(world, 1, [], rng)

    for (const id of BUILDING_IDS) {
      const tiers = gbr.econ.buildingTiers[id] ?? []
      expect(tiers.length, `${id} tiers length`).toBeLessThanOrEqual(5)
      expect(Math.abs(sum(tiers) - (gbr.econ.buildings[id] ?? 0)), `${id} Σ synced`).toBeLessThan(1e-6)
      for (let tier = 0; tier < tiers.length; tier += 1) {
        if ((tiers[tier] ?? 0) > 0) {
          expect(tier + 1, `${id} occupied tier`).toBeLessThanOrEqual(maxUnlockedTier(gbr, id))
        }
      }
    }
  })

  test('two identical 60-month fixtures stay economically identical', () => {
    const make = (): WorldState => {
      const world = newWorld(SEED, 'QING')
      const gbr = countryOf(world, 'GBR')
      gbr.tech.unlocked.push(...TIER_V_TECH)
      gbr.econ.privateCapital = 500
      return world
    }
    const left = make()
    const right = make()
    advance(left, 60, [], makeRngForWorld(left))
    advance(right, 60, [], makeRngForWorld(right))
    expect(countryOf(left, 'GBR').econ).toEqual(countryOf(right, 'GBR').econ)
  })
})

describe('S6 upgradeCandidate gate (plan 0016 §S6)', () => {
  test('no candidate while the next tier is locked', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    expect(upgradeCandidate(gbr, 'steelMills', 100)).toBeUndefined()
  })

  test('the candidate is capped by the unreserved source-tier seats', () => {
    const world = newWorld(SEED, 'QING')
    const gbr = countryOf(world, 'GBR')
    gbr.tech.unlocked.push('industry-3')
    gbr.econ.buildingTiers.steelMills = [2]
    gbr.econ.buildings.steelMills = 2
    gbr.econ.constructionQueue = []

    // A large `maxCount` is clamped to the two seats that exist.
    expect(upgradeCandidate(gbr, 'steelMills', 100)).toEqual({
      fromTier: 0,
      toTier: 1,
      count: 2,
    })
    // A pending upgrade reserving one of them leaves only one.
    gbr.econ.constructionQueue.push({
      id: 'reserved',
      building: 'steelMills',
      count: 1,
      kind: 'upgrade',
      fromTier: 0,
      toTier: 1,
      owner: 'private',
      monthsLeft: 1,
      monthlyCost: 0,
      lastSpend: 0,
      progress: 0,
      startedAt: { ...world.date },
    })
    expect(upgradeCandidate(gbr, 'steelMills', 100)?.count).toBe(1)
  })
})

describe('S6 research reaches the electrification nodes (plan 0016 §S6)', () => {
  test('defaultResearchNode picks industry-6, then industry-7 after it', () => {
    const state: TechState = {
      era: 4,
      nodes: {},
      unlocked: [
        'general-1836',
        'general-1840',
        'general-1850',
        'general-1865',
        'general-1880',
        'industry-1',
        'industry-2',
        'industry-3',
        'industry-5',
        'industry-4',
      ],
      researching: '',
      points: 0,
      pointsPerMonth: 0,
    }
    expect(defaultResearchNode(state)?.id).toBe('industry-6')
    state.unlocked.push('industry-6')
    expect(defaultResearchNode(state)?.id).toBe('industry-7')
  })
})
