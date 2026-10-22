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
    // Default rankings stay at the five dimensions; extra parameters are on demand.
    expect(rankings).not.toContain('建造力')
    const extended = inspectWorld(world, 'rankings', {
      metrics: ['construction', 'privateCapital', 'infrastructure', 'loyalty', 'quality', 'manpower', 'techPoints'],
    })
    for (const column of ['建造力', '私人资本', '基建', '忠诚', '质量', '人力', '科技点']) {
      expect(extended).toContain(column)
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

  test('market lines expose trade flows and judge status on effective supply (PT-040)', async () => {
    const world = newWorld(9110, 'QING')
    advance(world, 6, [], makeRngForWorld(world))
    const text = inspectWorld(world, 'market')
    expect(text).toContain('有效供给 = 国内产出 + 进口 − 出口')
    const lines = text.split('\n').filter(line => line.startsWith('- '))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toContain('进口')
      expect(line).toContain('出口')
      expect(line).toContain('有效供给')
      expect(line).toContain('状态')
    }
    const imported = lines
      .map(line => ({
        line,
        imports: Number(/进口 ([\d.]+)/.exec(line)?.[1] ?? 0),
        exports: Number(/出口 ([\d.]+)/.exec(line)?.[1] ?? 0),
      }))
      .filter(row => row.imports - row.exports >= 1)
      .sort((a, b) => b.imports - a.imports)[0]
    expect(imported).toBeDefined()
    if (imported === undefined) return
    const production = Number(/产出 ([\d.]+)/.exec(imported.line)![1])
    const effective = Number(/有效供给 ([\d.]+)/.exec(imported.line)![1])
    expect(imported.imports).toBeGreaterThan(imported.exports)
    expect(effective).toBeGreaterThan(production)
  })

  test('economy GDP line reads the stored settlement snapshot (PT-041)', async () => {
    const world = newWorld(9111, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const text = inspectWorld(world, 'economy')
    const gdpLine = text.split('\n').find(line => line.startsWith('GDP '))
    expect(gdpLine).toBeDefined()
    if (gdpLine === undefined) return
    expect(gdpLine).toContain('净出口')
    const numbers = [...gdpLine.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map(match => Number(match[0]))
    const [gdp, c, i, g, nx] = numbers
    expect(numbers.length).toBe(5)
    // The line is printed at 1-decimal precision; allow for that rounding.
    expect(Math.abs(c + i + g + nx - gdp)).toBeLessThan(0.5)
    // The stored snapshot satisfies the identity exactly.
    const comp = qing.econ.gdpComponents
    expect(Math.abs(comp.c + comp.i + comp.g + comp.nx - qing.econ.gdp)).toBeLessThan(1e-6)
    // The headline equals the stored GDP (to display precision).
    expect(gdp).toBe(Number(qing.econ.gdp.toFixed(1)))
  })

  test('fiscal four-tax-base line makes collection efficiency explicit (PT-042)', async () => {
    const world = newWorld(9112, 'QING')
    advance(world, 1, [], makeRngForWorld(world))
    const text = inspectWorld(world, 'fiscal')
    const taxLine = text.split('\n').find(line => line.startsWith('四税基'))
    expect(taxLine).toBeDefined()
    if (taxLine === undefined) return
    expect(taxLine).toContain('征收效率')
    for (const base of ['土地税', '企业所得税', '消费税', '关税']) {
      expect(taxLine).toContain(base)
    }
  })
})
