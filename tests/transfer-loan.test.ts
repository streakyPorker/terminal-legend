import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, applyDecision, newWorld } from '../engine/sim'

/**
 * PT-064: sovereign loans. The player pays the principal now; the borrower
 * repays an equal-installment (annuity) stream through the same monthly
 * schedule machinery as reparations.
 */
function lend(rate: number, months: number, amount: number) {
  const world = newWorld(51, 'QING')
  const qing = world.countries.QING
  const gbr = world.countries.GBR
  if (qing === undefined || gbr === undefined) throw new Error('missing country')
  qing.econ.treasury = 500
  const gbrBefore = gbr.econ.treasury
  const result = applyDecision(
    world,
    {
      countryId: 'QING',
      action: 'diplomacy',
      params: { target: 'GBR', move: 'loan', amount, months, rate },
    },
    makeRngForWorld(world),
  )
  return { world, qing, gbr, gbrBefore, result }
}

describe('sovereign loans (PT-064)', () => {
  test('the principal moves now and a repayment schedule is created', () => {
    const { world, qing, gbr, gbrBefore, result } = lend(5, 120, 200)
    expect(result.ok).toBe(true)
    expect(qing.econ.treasury).toBe(300)
    expect(gbr.econ.treasury).toBe(gbrBefore + 200)
    expect(world.transfers?.length).toBe(1)
    const schedule = world.transfers?.[0]
    expect(schedule?.from).toBe('GBR')
    expect(schedule?.to).toBe('QING')
    expect(schedule?.monthsLeft).toBe(120)
    // Annuity at 5%/yr over 120 months ≈ 2.12 per month.
    expect(schedule?.monthlyAmount).toBeGreaterThan(2.1)
    expect(schedule?.monthlyAmount).toBeLessThan(2.15)
  })

  test('each month books the installment on both sides', () => {
    const { world, qing, gbr } = lend(5, 120, 200)
    const amount = world.transfers?.[0]?.monthlyAmount ?? 0
    advance(world, 1, [], makeRngForWorld(world))
    expect(qing.econ.transfersReceived).toBe(amount)
    expect(gbr.econ.transfersPaid).toBe(amount)
    expect(world.transfers?.[0]?.monthsLeft).toBe(119)
  })

  test('a zero-rate loan splits the principal evenly', () => {
    const { world } = lend(0, 100, 200)
    expect(world.transfers?.[0]?.monthlyAmount).toBe(2)
  })

  test('the schedule retires after its term', () => {
    const { world } = lend(0, 2, 10)
    advance(world, 3, [], makeRngForWorld(world))
    expect(world.transfers?.length ?? 0).toBe(0)
  })

  test('a war blocks new lending', () => {
    const world = newWorld(52, 'QING')
    const qing = world.countries.QING
    if (qing === undefined) throw new Error('missing QING')
    qing.econ.treasury = 500
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'war' } },
      makeRngForWorld(world),
    )
    const result = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'loan', amount: 100, months: 12, rate: 5 },
      },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(false)
    expect(world.transfers?.length ?? 0).toBe(0)
  })
})
