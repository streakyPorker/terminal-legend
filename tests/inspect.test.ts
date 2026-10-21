import { describe, expect, test } from 'claude-code/testing'
import type { TradeRoute } from '../types'
import { makeRngForWorld } from '../engine/data'
import { forecastWorld, inspectWorld, INSPECT_SECTIONS } from '../engine/inspect'
import { advance, newWorld } from '../engine/sim'

const route = (world: ReturnType<typeof newWorld>): TradeRoute => ({
  id: 'route-test',
  good: 'grain',
  from: 'QING',
  to: 'GBR',
  level: 2,
  owner: 'state',
  openedAt: { ...world.date },
  lastQty: 3,
  lastMargin: 0.4,
})

describe('v3_inspect (plan 0006)', () => {
  test('every section renders a report with the player header', async () => {
    const world = newWorld(9101, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers.push({
      id: 'test-buff',
      label: '纺织繁荣',
      stat: 'fabricOutput',
      stack: 'percent',
      value: 20,
      monthsLeft: 36,
      source: 'test',
    })
    advance(world, 3, [], makeRngForWorld(world))
    world.tradeRoutes.push(route(world))
    for (const section of INSPECT_SECTIONS) {
      const text = inspectWorld(world, section)
      expect(text).toContain('大清')
      expect(text.length).toBeGreaterThan(40)
    }
  })

  test('the structure sections expose their distinguishing content', async () => {
    const world = newWorld(9105, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers.push({
      id: 'm1',
      label: '纺织繁荣',
      stat: 'fabricOutput',
      stack: 'percent',
      value: 20,
      monthsLeft: 6,
      source: 'test',
    })
    world.tradeRoutes.push(route(world))

    const pops = inspectWorld(world, 'pops')
    expect(pops).toContain('阶级结构')
    expect(pops).toContain('识字率')
    expect(pops).toContain('激进')

    const diplomacy = inspectWorld(world, 'diplomacy')
    expect(diplomacy).toContain('威望')
    expect(diplomacy).toContain('关系')
    expect(diplomacy).toContain('盟友')

    const tech = inspectWorld(world, 'tech')
    expect(tech).toContain('月产出')
    expect(tech).toContain('研究「')

    const modifiers = inspectWorld(world, 'modifiers')
    expect(modifiers).toContain('纺织繁荣')
    expect(modifiers).toContain('stat=')
    expect(modifiers).toContain('来源=test')

    const buildings = inspectWorld(world, 'buildings')
    expect(buildings).toContain('农场')
    expect(buildings).toContain('经营：')
    expect(buildings).toContain('工程量')
    expect(buildings).toContain('造价')

    const routes = inspectWorld(world, 'routes')
    expect(routes).toContain('贸易路线')
    expect(routes).toContain('QING→GBR')

    const rankings = inspectWorld(world, 'rankings')
    for (const dimension of ['经济', '人口与社会', '军事', '科技与行政', '外交与威望']) {
      expect(rankings).toContain(dimension)
    }
  })

  test('de-duplication: facts live in exactly one section', async () => {
    const world = newWorld(9106, 'QING')
    world.tradeRoutes.push(route(world))

    const economy = inspectWorld(world, 'economy')
    expect(economy).not.toContain('毛利率')
    expect(economy).not.toContain('开工率')
    expect(economy).toContain('v3_inspect buildings')

    const trade = inspectWorld(world, 'trade')
    expect(trade).not.toContain('运量')
    expect(trade).toContain('v3_inspect routes')

    const routes = inspectWorld(world, 'routes')
    expect(routes).toContain('运量')
  })

  test('log section filters by kind, country and limit', async () => {
    const world = newWorld(9107, 'QING')
    for (let index = 0; index < 12; index += 1) {
      world.log.push({
        date: { ...world.date },
        kind: index % 2 === 0 ? 'war' : 'tech',
        countryId: index % 3 === 0 ? 'GBR' : undefined,
        text: `条目 ${index}`,
      })
    }
    const all = inspectWorld(world, 'log', { limit: 5 })
    expect(all).toContain('编年史')
    const limit = all.split('\n').filter(line => line.startsWith('- ')).length
    expect(limit).toBe(5)

    const wars = inspectWorld(world, 'log', { kind: 'war' })
    expect(wars).toContain('[war]')
    expect(wars).not.toContain('[tech]')

    const gbr = inspectWorld(world, 'log', { country: 'GBR' })
    expect(gbr).toContain('(GBR)')
  })

  test('history reports real monthly rows, not fabricated zeros only', async () => {
    const world = newWorld(9102, 'QING')
    advance(world, 6, [], makeRngForWorld(world))
    const text = inspectWorld(world, 'history')
    const rows = text.split('\n').filter(line => /^\d{4}\.\d{2}/.test(line))
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.some(line => /\s\d/.test(line.slice(8)))).toBe(true)
  })

  test('forecast projects next month income, expense, net and treasury', async () => {
    const world = newWorld(9104, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    const text = forecastWorld(world)
    expect(text).toContain('收入约')
    expect(text).toContain('支出约')
    expect(text).toContain('净额约')
    expect(text).toContain('结算后国库约')
  })

  test('an unknown section names every available one', async () => {
    const world = newWorld(9103, 'QING')
    const text = inspectWorld(world, 'nope')
    for (const section of INSPECT_SECTIONS) {
      expect(text).toContain(section)
    }
  })
})
