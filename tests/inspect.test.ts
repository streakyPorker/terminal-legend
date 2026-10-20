import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { forecastWorld, inspectWorld } from '../engine/inspect'
import { advance, newWorld } from '../engine/sim'

describe('v3_inspect (plan 0006)', () => {
  test('every section renders a report with the player header', async () => {
    const world = newWorld(9101, 'QING')
    advance(world, 3, [], makeRngForWorld(world))
    for (const section of [
      'economy',
      'fiscal',
      'labor',
      'trade',
      'construction',
      'military',
      'history',
    ]) {
      const text = inspectWorld(world, section)
      expect(text).toContain('大清')
      expect(text.length).toBeGreaterThan(40)
    }
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

  test('an unknown section names the available ones', async () => {
    const world = newWorld(9103, 'QING')
    const text = inspectWorld(world, 'nope')
    expect(text).toContain('economy')
    expect(text).toContain('history')
  })
})
