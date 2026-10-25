import { describe, expect, test } from 'claude-code/testing'
import type {
  Country,
  ReparationTerms,
  War,
  WarGoal,
  WorldState,
} from '../types'
import { newWorld } from '../engine/sim'
import { applyWarGoal, declareWar } from '../engine/diplomacy'
import { addModifier } from '../engine/modifiers'
import { clamp } from '../engine/internal'
import { validateBlockConfig } from '../engine/blocks'
import { findBlock } from '../engine/config/blocks'
import {
  WAR_BLOCKS,
  WAR_MODIFIER_SPECS,
  compileWarBlock,
  instantiateWarBlock,
  warBlockFor,
  warBlockId,
  warModifierId,
  warSource,
  warSpecsFor,
  type WarModifierSpec,
} from '../engine/config/blocks/war'

const clone = (w: WorldState): WorldState => JSON.parse(JSON.stringify(w)) as WorldState

const countryOf = (w: WorldState, id: string): Country => {
  const c = w.countries[id]
  if (c === undefined) throw new Error(`missing ${id}`)
  return c
}

/** The pre-C6 side arrays for a declared QING → GBR war. */
const sides = (goalOwnerWon: boolean): { winnerIds: string[]; loserIds: string[] } =>
  goalOwnerWon
    ? { winnerIds: ['QING'], loserIds: ['GBR'] }
    : { winnerIds: ['GBR'], loserIds: ['QING'] }

const modifierTuples = (c: Country): string[] =>
  c.modifiers
    .map(
      m =>
        `${m.id}|${m.source}|${m.stat}|${m.stack}|${m.value}|${m.label}|${m.monthsLeft ?? ''}`,
    )
    .sort()

// ---- Frozen copy of the pre-C6 applyWarGoal, used only as an equivalence
// oracle. Do not edit to match new behaviour.
function referenceApplyWarGoal(
  world: WorldState,
  war: War,
  goalOwnerWon: boolean,
  winnerIds: string[],
  loserIds: string[],
  terms?: ReparationTerms,
): void {
  const goalSide = goalOwnerWon ? winnerIds : loserIds
  const otherSide = goalOwnerWon ? loserIds : winnerIds

  if (!goalOwnerWon) {
    for (const id of goalSide) {
      const country = world.countries[id]
      if (country === undefined) continue
      switch (war.goal) {
        case 'reparations':
          country.diplo.prestige = clamp(country.diplo.prestige - 10, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
        case 'openMarket':
          for (const otherId of otherSide) {
            country.diplo.relations[otherId] = clamp(
              (country.diplo.relations[otherId] ?? 0) - 10,
              -100,
              100,
            )
          }
          country.diplo.prestige = clamp(country.diplo.prestige - 5, 0, 240)
          break
        case 'sphere':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 2, 0, 100)
          break
        case 'humiliation':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
      }
    }
    return
  }

  switch (war.goal) {
    case 'reparations': {
      const recipient = world.countries[war.goalOwner]
      if (!Array.isArray(world.indemnities)) world.indemnities = []
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        const rawTotal = terms?.total
        const total = clamp(
          Number.isFinite(rawTotal) ? (rawTotal as number) : loser.econ.gdp * 0.1,
          0,
          loser.econ.gdp * 2,
        )
        const rawMonths = terms?.maxMonths
        const maxMonths = clamp(
          Number.isFinite(rawMonths) ? Math.round(rawMonths as number) : 60,
          1,
          240,
        )
        const lump = clamp(loser.econ.treasury, 0, total)
        loser.econ.treasury -= lump
        loser.government.legitimacy = clamp(loser.government.legitimacy - 5, 0, 100)
        if (recipient !== undefined && lump > 0) recipient.econ.treasury += lump

        const remaining = total - lump
        if (remaining > 0.01) {
          const capacity = Math.max(0.5, loser.econ.income * 0.15)
          const months = Math.min(
            maxMonths,
            Math.max(1, Math.ceil(remaining / capacity)),
          )
          world.indemnities.push({
            id: `indemnity-${war.id}-${id}`,
            from: id,
            to: war.goalOwner,
            monthlyAmount: remaining / months,
            monthsLeft: months,
            remaining,
            startsAtTick: world.tick + 1,
            startedAt: { ...world.date },
          })
        }
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 10, 0, 240)
      }
      break
    }
    case 'openMarket': {
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.econ.tariff = clamp(loser.econ.tariff - 10, 0, 60)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 4, 0, 100)
        addModifier(loser, {
          id: `war:${war.id}:openMarket:access`,
          label: '门户开放',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.15,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        addModifier(winner, {
          id: `war:${war.id}:openMarket:income`,
          label: '通商特权',
          stat: 'income',
          stack: 'percent',
          value: 5,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      break
    }
    case 'sphere': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          if (!winner.diplo.sphere.includes(loserId)) winner.diplo.sphere.push(loserId)
        }
        addModifier(winner, {
          id: `war:${war.id}:sphere:access`,
          label: '势力范围',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.05,
          monthsLeft: 24,
          source: `war:${war.id}`,
        })
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          winner.diplo.relations[loserId] = clamp(
            (winner.diplo.relations[loserId] ?? 0) - 10,
            -100,
            100,
          )
          const loser = world.countries[loserId]
          if (loser === undefined) continue
          loser.diplo.relations[id] = clamp(
            (loser.diplo.relations[id] ?? 0) - 10,
            -100,
            100,
          )
        }
      }
      break
    }
    case 'humiliation': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 15, 0, 240)
      }
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.diplo.prestige = clamp(loser.diplo.prestige - 15, 0, 240)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 8, 0, 100)
      }
      break
    }
  }
}

function expectWarEquivalent(
  seed: number,
  goal: WarGoal,
  goalOwnerWon: boolean,
  terms?: ReparationTerms,
): void {
  const worldNew = newWorld(seed, 'QING')
  declareWar(worldNew, 'QING', 'GBR', goal, '测试')
  const worldRef = clone(worldNew)

  const warNew = worldNew.wars[0]
  const warRef = worldRef.wars[0]
  if (warNew === undefined || warRef === undefined) throw new Error('no war declared')

  const { winnerIds, loserIds } = sides(goalOwnerWon)
  applyWarGoal(worldNew, warNew, goalOwnerWon, winnerIds, loserIds, terms)
  referenceApplyWarGoal(worldRef, warRef, goalOwnerWon, winnerIds, loserIds, terms)

  expect(worldNew).toEqual(worldRef)
}

describe('war-goal migration equivalence (C6, ADR 0024)', () => {
  test('openMarket victory: loser access + winner income modifiers and direct effects match', () => {
    expectWarEquivalent(8400, 'openMarket', true)
  })

  test('sphere victory: winner access modifier, sphere assignment and direct effects match', () => {
    expectWarEquivalent(8401, 'sphere', true)
  })

  test('reparations victory: indemnities and direct effects match', () => {
    expectWarEquivalent(8402, 'reparations', true)
  })

  test('reparations victory with explicit terms matches', () => {
    expectWarEquivalent(8403, 'reparations', true, { total: 40, maxMonths: 24 })
  })

  test('humiliation victory: direct effects match', () => {
    expectWarEquivalent(8404, 'humiliation', true)
  })

  test('the defeat column matches for every goal', () => {
    for (const [index, goal] of (
      ['reparations', 'openMarket', 'sphere', 'humiliation'] as WarGoal[]
    ).entries()) {
      expectWarEquivalent(8410 + index, goal, false)
    }
  })

  test('the openMarket modifier tuples keep the pre-C6 id/source shape', () => {
    const worldNew = newWorld(8420, 'QING')
    countryOf(worldNew, 'QING').modifiers = []
    countryOf(worldNew, 'GBR').modifiers = []
    declareWar(worldNew, 'QING', 'GBR', 'openMarket', '测试')
    const war = worldNew.wars[0]
    if (war === undefined) throw new Error('no war')
    applyWarGoal(worldNew, war, true, ['QING'], ['GBR'])

    const gbr = countryOf(worldNew, 'GBR')
    const qing = countryOf(worldNew, 'QING')
    expect(modifierTuples(gbr)).toEqual([
      `war:${war.id}:openMarket:access|war:${war.id}|marketAccess|flat|0.15|门户开放|24`,
    ])
    expect(modifierTuples(qing)).toEqual([
      `war:${war.id}:openMarket:income|war:${war.id}|income|percent|5|通商特权|24`,
    ])
  })

  test('the sphere modifier tuple keeps the pre-C6 id/source shape', () => {
    const worldNew = newWorld(8421, 'QING')
    countryOf(worldNew, 'QING').modifiers = []
    countryOf(worldNew, 'GBR').modifiers = []
    declareWar(worldNew, 'QING', 'GBR', 'sphere', '测试')
    const war = worldNew.wars[0]
    if (war === undefined) throw new Error('no war')
    applyWarGoal(worldNew, war, true, ['QING'], ['GBR'])

    const qing = countryOf(worldNew, 'QING')
    expect(modifierTuples(qing)).toEqual([
      `war:${war.id}:sphere:access|war:${war.id}|marketAccess|flat|0.05|势力范围|24`,
    ])
  })

  test('a second identical application overwrites the same modifier id', () => {
    const worldNew = newWorld(8422, 'QING')
    declareWar(worldNew, 'QING', 'GBR', 'openMarket', '测试')
    const war = worldNew.wars[0]
    if (war === undefined) throw new Error('no war')
    applyWarGoal(worldNew, war, true, ['QING'], ['GBR'])
    applyWarGoal(worldNew, war, true, ['QING'], ['GBR'])
    expect(countryOf(worldNew, 'GBR').modifiers.filter(m => m.source === warSource(war.id))).toHaveLength(1)
    expect(countryOf(worldNew, 'QING').modifiers.filter(m => m.source === warSource(war.id))).toHaveLength(1)
  })
})

describe('war block registry drift guard (C6)', () => {
  const EXPECTED: WarModifierSpec[] = [
    {
      goal: 'openMarket',
      side: 'loser',
      slot: 'access',
      stat: 'marketAccess',
      stack: 'flat',
      value: 0.15,
      label: '门户开放',
      months: 24,
    },
    {
      goal: 'openMarket',
      side: 'winner',
      slot: 'income',
      stat: 'income',
      stack: 'percent',
      value: 5,
      label: '通商特权',
      months: 24,
    },
    {
      goal: 'sphere',
      side: 'winner',
      slot: 'access',
      stat: 'marketAccess',
      stack: 'flat',
      value: 0.05,
      label: '势力范围',
      months: 24,
    },
  ]

  test('the shipped specs match the pre-C6 war-goal table exactly', () => {
    expect(WAR_MODIFIER_SPECS).toEqual(EXPECTED)
    expect(WAR_BLOCKS.map(b => b.id)).toEqual(EXPECTED.map(warBlockId))
  })

  test('every spec maps to exactly one valid war block and no extras', () => {
    for (const spec of WAR_MODIFIER_SPECS) {
      const block = findBlock(warBlockId(spec))
      expect(block?.kind).toBe('war')
      expect(block?.label).toBe(spec.label)
      expect(block?.lifecycle).toBe('once')
      expect(block?.potential_trigger).toEqual([])
      expect(block?.scales_with).toEqual([])
      expect(block?.effects).toEqual([
        {
          stat: spec.stat,
          stack: spec.stack,
          value: spec.value,
          label: spec.label,
          months: spec.months,
        },
      ])
      expect(warBlockFor(spec)).toEqual(block)
    }
    expect(WAR_BLOCKS.length).toBe(WAR_MODIFIER_SPECS.length)
    expect(validateBlockConfig(WAR_BLOCKS)).toEqual([])
  })

  test('compile / instantiate / modifierId shapes are stable', () => {
    const block = compileWarBlock(EXPECTED[0] as WarModifierSpec)
    expect(block.id).toBe('war:openMarket:loser:access')
    expect(block.kind).toBe('war')
    expect(validateBlockConfig([block])).toEqual([])

    const runtime = instantiateWarBlock(block, 'war-7')
    expect(runtime.id).toBe('war:war-7')
    expect(runtime.effects).toEqual(block.effects)
    expect(validateBlockConfig([runtime])).toEqual([])

    expect(warModifierId('war-7', EXPECTED[0] as WarModifierSpec)).toBe(
      'war:war-7:openMarket:access',
    )
    expect(warModifierId('war-7', EXPECTED[1] as WarModifierSpec)).toBe(
      'war:war-7:openMarket:income',
    )
    expect(warModifierId('war-7', EXPECTED[2] as WarModifierSpec)).toBe(
      'war:war-7:sphere:access',
    )
    expect(warSource('war-7')).toBe('war:war-7')
    expect(warSpecsFor('openMarket', 'loser')).toEqual([EXPECTED[0]])
    expect(warSpecsFor('openMarket', 'winner')).toEqual([EXPECTED[1]])
    expect(warSpecsFor('sphere', 'winner')).toEqual([EXPECTED[2]])
    expect(warSpecsFor('reparations', 'winner')).toEqual([])
    expect(warSpecsFor('humiliation', 'loser')).toEqual([])
  })
})
