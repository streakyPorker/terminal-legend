import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { decideForAi } from '../engine/ai'
import { fiscalLedger } from '../engine/fiscal'
import { advance, applyDecision, newWorld } from '../engine/sim'
import type { Country, Decision, WorldState } from '../types'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const close = (actual: number, expected: number, eps = 1e-6): boolean =>
  Math.abs(actual - expected) <= eps

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  expect(country).toBeDefined()
  if (country === undefined) throw new Error(`missing country ${id}`)
  return country
}

const declare = (world: WorldState, target: string, goal?: string): void => {
  const result = applyDecision(
    world,
    {
      countryId: 'QING',
      action: 'diplomacy',
      params: { target, move: 'war', reason: '测试', goal },
    },
    rngFor(world),
  )
  expect(result.ok).toBe(true)
}

/** A war is ended through the peace move, which reads the score for the winner. */
const makePeace = (world: WorldState, target: string, warScore: number): void => {
  const war = world.wars[0]
  expect(war).toBeDefined()
  if (war === undefined) throw new Error('no war to end')
  war.warScore = warScore
  const result = applyDecision(
    world,
    { countryId: 'QING', action: 'diplomacy', params: { target, move: 'peace' } },
    rngFor(world),
  )
  expect(result.ok).toBe(true)
}

const fakeModel = (decisions: unknown[]) => ({
  model: {
    complete: async () => ({ isAnswered: true, text: JSON.stringify(decisions) }),
  },
})

describe('T4 war goals: declaration (plan §5)', () => {
  test('a declared goal and its owner are recorded, defaulting to reparations', () => {
    const world = newWorld(9101, 'QING')
    declare(world, 'GBR', 'humiliation')
    expect(world.wars[0]?.goal).toBe('humiliation')
    expect(world.wars[0]?.goalOwner).toBe('QING')

    const fallback = newWorld(9102, 'QING')
    declare(fallback, 'GBR')
    expect(fallback.wars[0]?.goal).toBe('reparations')

    const invalid = newWorld(9103, 'QING')
    declare(invalid, 'GBR', 'bogus')
    expect(invalid.wars[0]?.goal).toBe('reparations')
  })
})

describe('T4 reparations: gold is transferred, not destroyed (plan §5)', () => {
  test('the paid part settles now and the rest becomes an installment schedule', () => {
    const world = newWorld(9110, 'QING')
    declare(world, 'RUS', 'reparations')
    const qing = countryOf(world, 'QING')
    const rus = countryOf(world, 'RUS')
    const wTreasury = qing.econ.treasury
    const lTreasury = rus.econ.treasury
    const wPrestige = qing.diplo.prestige
    const lLegit = rus.government.legitimacy

    const due = rus.econ.gdp * 0.1
    const paid = Math.min(Math.max(0, lTreasury), due)
    expect(paid).toBeGreaterThan(0)

    makePeace(world, 'RUS', 50)
    expect(world.wars.length).toBe(0)
    expect(close(qing.econ.treasury, wTreasury + paid)).toBe(true)
    expect(close(rus.econ.treasury, lTreasury - paid)).toBe(true)
    expect(world.indemnities.length).toBe(1)
    const schedule = world.indemnities[0]
    expect(schedule?.from).toBe('RUS')
    expect(schedule?.to).toBe('QING')
    expect(close(schedule?.remaining ?? 0, due - paid)).toBe(true)
    expect(schedule?.monthlyAmount ?? 0).toBeGreaterThan(0)
    expect(schedule?.monthsLeft ?? 0).toBeGreaterThan(0)
    expect(schedule?.startsAtTick).toBe(world.tick + 1)
    expect(close(qing.diplo.prestige, wPrestige + 10)).toBe(true)
    expect(close(rus.government.legitimacy, lLegit - 5)).toBe(true)
  })

  test('the victor can state the total and the maximum term; the loser plans the split', () => {
    const world = newWorld(9111, 'QING')
    declare(world, 'RUS', 'reparations')
    const rus = countryOf(world, 'RUS')
    const before = rus.econ.treasury
    const war = world.wars[0]
    expect(war).toBeDefined()
    if (war === undefined) return
    war.warScore = 50
    const result = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: {
          target: 'RUS',
          move: 'peace',
          indemnityTotal: 40,
          indemnityMonths: 24,
        },
      },
      rngFor(world),
    )
    expect(result.ok).toBe(true)
    const schedule = world.indemnities[0]
    expect(schedule).toBeDefined()
    if (schedule === undefined) return
    const expectedLump = Math.min(Math.max(0, before), 40)
    expect(close(schedule.remaining, 40 - expectedLump)).toBe(true)
    expect(schedule.monthsLeft).toBeLessThanOrEqual(24)
    expect(schedule.startsAtTick).toBe(world.tick + 1)
    expect(close(rus.econ.treasury, before - expectedLump)).toBe(true)
  })
})

describe('T4 reparations: monthly installments', () => {
  test('the installment is the payer expense and the recipient income, and it shrinks the schedule', () => {
    const world = newWorld(9112, 'QING')
    declare(world, 'RUS', 'reparations')
    makePeace(world, 'RUS', 50)
    const schedule = world.indemnities[0]
    expect(schedule).toBeDefined()
    if (schedule === undefined) return
    const monthly = schedule.monthlyAmount
    const remaining = schedule.remaining
    const months = schedule.monthsLeft

    advance(world, 1, [], rngFor(world))
    const qing = countryOf(world, 'QING')
    const rus = countryOf(world, 'RUS')
    expect(close(qing.econ.reparationsReceived, monthly)).toBe(true)
    expect(close(rus.econ.reparationsPaid, monthly)).toBe(true)
    expect(close(qing.econ.reparationsReceived, rus.econ.reparationsPaid)).toBe(true)
    expect(fiscalLedger(qing).income.reparations).toBeGreaterThan(0)
    expect(fiscalLedger(rus).expense.reparations).toBeGreaterThan(0)

    const next = world.indemnities[0]
    expect(next).toBeDefined()
    if (next === undefined) return
    expect(close(next.remaining, Math.max(0, remaining - monthly))).toBe(true)
    expect(next.monthsLeft).toBe(months - 1)
  })
})

describe('T4 openMarket: structural access and a timed income buff (plan §5)', () => {
  test('the loser opens its market, the winner earns a trade bonus', () => {
    const world = newWorld(9120, 'QING')
    declare(world, 'USA', 'openMarket')
    const qing = countryOf(world, 'QING')
    const usa = countryOf(world, 'USA')
    const lTariff = usa.econ.tariff
    const lLegit = usa.government.legitimacy

    makePeace(world, 'USA', 50)

    expect(close(usa.econ.tariff, Math.max(0, lTariff - 10))).toBe(true)
    expect(close(usa.government.legitimacy, lLegit - 4)).toBe(true)
    const access = usa.modifiers.find(one => one.stat === 'marketAccess')
    expect(access?.value).toBe(0.15)
    expect(access?.monthsLeft).toBe(24)
    const income = qing.modifiers.find(one => one.stat === 'income')
    expect(income?.value).toBe(5)
    expect(income?.monthsLeft).toBe(24)
  })
})

describe('T4 sphere: the loser enters the winner sphere (plan §5)', () => {
  test('the defeated state is sphered and both sides cool further', () => {
    const world = newWorld(9130, 'QING')
    declare(world, 'GBR', 'sphere')
    const qing = countryOf(world, 'QING')

    makePeace(world, 'GBR', 50)

    expect(qing.diplo.sphere).toContain('GBR')
    const access = qing.modifiers.find(one => one.stat === 'marketAccess')
    expect(access?.value).toBe(0.05)
    expect(access?.monthsLeft).toBe(24)
    // -15 seed −50 declaration −10 goal −20 belligerent.
    expect(qing.diplo.relations.GBR ?? 0).toBe(-95)
    expect(countryOf(world, 'GBR').diplo.relations.QING ?? 0).toBe(-95)
  })
})

describe('T4 humiliation: goal effects replace the generic ones (plan §5)', () => {
  test('the winner gains +15, not +27, and the loser loses -15, not -30', () => {
    const world = newWorld(9140, 'QING')
    declare(world, 'GBR', 'humiliation')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const wPrestige = qing.diplo.prestige
    const lPrestige = gbr.diplo.prestige
    const lLegit = gbr.government.legitimacy

    makePeace(world, 'GBR', 50)

    expect(close(qing.diplo.prestige, wPrestige + 15)).toBe(true)
    expect(close(gbr.diplo.prestige, lPrestige - 15)).toBe(true)
    expect(close(gbr.government.legitimacy, lLegit - 8)).toBe(true)
  })
})

describe('T4 defeat and white peace (plan §5)', () => {
  test('a goal owner that loses takes the defeat column and no gold moves', () => {
    const world = newWorld(9150, 'QING')
    declare(world, 'GBR', 'reparations')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const wPrestige = qing.diplo.prestige
    const wLegit = qing.government.legitimacy
    const wTreasury = qing.econ.treasury
    const lTreasury = gbr.econ.treasury

    makePeace(world, 'GBR', -50)

    expect(close(qing.diplo.prestige, wPrestige - 10)).toBe(true)
    expect(close(qing.government.legitimacy, wLegit - 3)).toBe(true)
    expect(close(qing.econ.treasury, wTreasury)).toBe(true)
    expect(close(gbr.econ.treasury, lTreasury)).toBe(true)
  })

  test('a white peace applies no goal effect but keeps the belligerent decline', () => {
    const world = newWorld(9160, 'QING')
    declare(world, 'GBR', 'humiliation')
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const wPrestige = qing.diplo.prestige
    const wLegit = qing.government.legitimacy
    const lPrestige = gbr.diplo.prestige
    const lLegit = gbr.government.legitimacy

    makePeace(world, 'GBR', 0)

    expect(close(qing.diplo.prestige, wPrestige)).toBe(true)
    expect(close(gbr.diplo.prestige, lPrestige)).toBe(true)
    expect(close(qing.government.legitimacy, wLegit)).toBe(true)
    expect(close(gbr.government.legitimacy, lLegit)).toBe(true)
    // Declaration −50 then the retained −20 belligerent decline.
    expect(close(qing.diplo.relations.GBR ?? 0, -85)).toBe(true)
  })
})

describe('T4 resolveWars integration (plan §5)', () => {
  test('a decisive battlefield score settles the goal without a peace move', () => {
    const world = newWorld(9170, 'QING')
    declare(world, 'GBR', 'sphere')
    const war = world.wars[0]
    expect(war).toBeDefined()
    if (war === undefined) return
    war.warScore = 100
    advance(world, 1, [], rngFor(world))
    expect(world.wars.length).toBe(0)
    expect(countryOf(world, 'QING').diplo.sphere).toContain('GBR')
  })
})

describe('T4 AI validation (plan §5/§6)', () => {
  test('an unknown goal is rejected, a missing goal is accepted', async () => {
    const bad = newWorld(9180, 'QING')
    const badReport = await decideForAi(
      fakeModel([
        { country: 'GBR', action: 'diplomacy', params: { target: 'FRA', move: 'war', goal: 'bogus' } },
      ]) as never,
      bad,
      rngFor(bad),
    )
    const badDec: Decision[] = badReport.decisions
    expect(
      badDec.some(
        one =>
          one.countryId === 'GBR' &&
          one.action === 'diplomacy' &&
          one.params.move === 'war' &&
          one.params.goal === 'bogus',
      ),
    ).toBe(false)

    const good = newWorld(9181, 'QING')
    const goodReport = await decideForAi(
      fakeModel([
        { country: 'GBR', action: 'diplomacy', params: { target: 'FRA', move: 'war' } },
      ]) as never,
      good,
      rngFor(good),
    )
    expect(
      goodReport.decisions.some(
        one => one.countryId === 'GBR' && one.action === 'diplomacy' && one.params.move === 'war',
      ),
    ).toBe(true)
  })
})
