import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { buildAiPrompt, decideForAi } from '../engine/ai'
import { applyDecision, clone, newWorld } from '../engine/sim'
import type { WorldState } from '../types'

/**
 * PT-075: the player can cancel / reorder build projects and open trade routes;
 * the AI could not. `applyDecision` always supported all three — the AI's
 * action allowlist and its parameter validation simply omitted them, so the
 * powers could build but never revise or open a route.
 *
 * These tests drive `decideForAi` with a scripted model answer and check the
 * decisions survive validation and land on the world through `applyDecision`.
 */

const rngFor = (world: WorldState) => makeRngForWorld(world)

const fakeModel = (decisions: unknown[]) => ({
  model: {
    complete: async () => ({
      isAnswered: true,
      text: JSON.stringify(decisions),
    }),
  },
})

const seedQueue = (world: WorldState, id: string): void => {
  const country = world.countries[id]
  if (country === undefined) return
  country.econ.constructionQueue.length = 0
  country.econ.constructionQueue.push(
    {
      id: 'proj-a',
      building: 'steelMills',
      count: 1,
      owner: 'state',
      monthsLeft: 3,
      monthlyCost: 15,
      lastSpend: 0,
      progress: 0.1,
      startedAt: { ...world.date },
    },
    {
      id: 'proj-b',
      building: 'furnitureWorks',
      count: 1,
      owner: 'state',
      monthsLeft: 2,
      monthlyCost: 9,
      lastSpend: 0,
      progress: 0.5,
      startedAt: { ...world.date },
    },
  )
}

describe('AI economic knobs (PT-075)', () => {
  test('the brief lists the queue with the 1-based index cancel/reorder cite', async () => {
    const world = newWorld(9201, 'QING')
    seedQueue(world, 'GBR')
    const prompt = buildAiPrompt(world)
    expect(prompt).toContain('队列:')
    expect(prompt).toContain('#1钢铁厂×1(10%)')
    expect(prompt).toContain('#2家具厂×1(50%)')
  })

  test('cancel and reorder survive validation and act on the real queue', async () => {
    const world = newWorld(9202, 'QING')
    seedQueue(world, 'GBR')
    const fake = fakeModel([
      {
        country: 'GBR',
        action: 'reorder',
        params: { index: 2, position: 'head' },
        narrative: '伦敦把家具厂提到最前',
      },
      {
        country: 'FRA',
        action: 'cancel',
        params: { index: 1 },
        narrative: '巴黎砍掉一座钢铁厂',
      },
    ])
    const report = await decideForAi(fake as never, world, rngFor(world))
    const reorder = report.decisions.find(one => one.countryId === 'GBR')
    const cancel = report.decisions.find(one => one.countryId === 'FRA')
    expect(reorder?.action).toBe('reorder')
    expect(cancel?.action).toBe('cancel')

    // A private project is refused by applyDecision even though validation let
    // the action through; the queue is untouched in that case.
    seedQueue(world, 'FRA')
    const before = world.countries.FRA?.econ.constructionQueue.length ?? 0
    applyDecision(world, cancel!, rngFor(world))
    const queue = world.countries.FRA?.econ.constructionQueue ?? []
    expect(queue.length).toBe(before - 1)
    expect(queue.some(project => project.id === 'proj-a')).toBe(false)
  })

  test('reorder keeps a project object (its progress) across the move', async () => {
    const world = newWorld(9203, 'QING')
    seedQueue(world, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    const moved = gbr.econ.constructionQueue[1]
    applyDecision(
      world,
      { countryId: 'GBR', action: 'reorder', params: { index: 2, position: 'head' } },
      rngFor(world),
    )
    expect(gbr.econ.constructionQueue[0]).toBe(moved)
    expect(gbr.econ.constructionQueue[0].progress).toBe(0.5)
  })

  test('route is accepted for a known good and partner, rejected otherwise', async () => {
    const world = newWorld(9204, 'QING')
    const good = fakeModel([
      {
        country: 'FRA',
        action: 'route',
        params: { op: 'open', good: 'grain', partner: 'SPA' },
        narrative: '巴黎与马德里开通粮道',
      },
      {
        country: 'PRU',
        action: 'route',
        params: { op: 'open', good: 'grain', partner: 'PRU' },
        narrative: '自相矛盾的航线',
      },
      {
        country: 'RUS',
        action: 'route',
        params: { op: 'open', good: 'unobtanium', partner: 'AUS' },
        narrative: '不存在的商品',
      },
    ])
    const report = await decideForAi(good as never, world, rngFor(world))
    const routed = report.decisions.filter(one => one.action === 'route')
    expect(routed.length).toBe(1)
    expect(routed[0].countryId).toBe('FRA')
  })

  test('a private project index cannot be cancelled by the AI', async () => {
    const world = newWorld(9205, 'QING')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return
    gbr.econ.constructionQueue.length = 0
    gbr.econ.constructionQueue.push({
      id: 'priv-1',
      building: 'coalMines',
      count: 5,
      owner: 'private',
      monthsLeft: 3,
      monthlyCost: 10,
      lastSpend: 0,
      progress: 0.4,
      startedAt: { ...world.date },
    })
    const result = applyDecision(
      clone(world),
      { countryId: 'GBR', action: 'cancel', params: { index: 1 } },
      rngFor(world),
    )
    expect(result.ok).toBe(false)
  })
})
