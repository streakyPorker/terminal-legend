import { describe, expect, test } from 'claude-code/testing'
import type { ConstructionProject } from '../types'
import {
  STAT_ROW_RESERVED,
  fitStatCells,
  projectLabel,
  type StatCell,
} from '../view/panels/construction'

/**
 * PT-059: every buildable-building row rendered 月耗 / 造价 / 存 / 量 / 利 at
 * once, so in a narrow pane the Text nodes shrank and truncated mid-word
 * ("月耗…", "造价…"). `fitStatCells` keeps only the columns that fit.
 *
 * Plan 0015 §S6: the roster went read-only (the three order buttons are gone),
 * so the same width now buys more columns — the reservation no longer pays for
 * three 4-cell buttons.
 */
const CELLS: StatCell[] = [
  { key: 'stock', width: 7, text: '存2973' },
  { key: 'volume', width: 6, text: '量45点' },
  { key: 'upkeep', width: 7, text: '月耗1.5点' },
  { key: 'cost', width: 8, text: '造价9.0金' },
  { key: 'profit', width: 7, text: '利+0.06' },
]

/** Cells the row's fixed columns occupy: the 8-cell name and gaps/margins. */
const budget = (width: number): number => Math.max(0, width - STAT_ROW_RESERVED)

describe('buildable row column fitting (PT-059, plan 0015 §S6)', () => {
  test('a wide pane keeps every column', () => {
    expect(fitStatCells(CELLS, 100).map(cell => cell.key)).toEqual([
      'stock',
      'volume',
      'upkeep',
      'cost',
      'profit',
    ])
  })

  test('a narrow pane keeps 月耗 and 造价, dropping the rest', () => {
    const kept = fitStatCells(CELLS, 30).map(cell => cell.key)
    expect(kept).toContain('upkeep')
    expect(kept).toContain('cost')
    expect(kept).not.toContain('profit')
    expect(kept).not.toContain('stock')
  })

  test('the kept columns always fit the read-only row budget', () => {
    for (const width of [30, 40, 50, 60, 70, 80, 100]) {
      const kept = fitStatCells(CELLS, width)
      const used = kept.reduce((sum, cell) => sum + cell.width + 1, 0)
      // A degenerate width may keep nothing; otherwise the row must fit.
      expect(used).toBeLessThanOrEqual(budget(width))
    }
  })

  test('dropping the order buttons buys back columns at a middle width', () => {
    // The old budget (button reservation included) kept 月耗/造价 only at 50;
    // the read-only row fits 存/量 too, which is what the roster is now for.
    const kept = fitStatCells(CELLS, 50).map(cell => cell.key)
    expect(kept).toEqual(['stock', 'volume', 'upkeep', 'cost'])
  })
})

describe('queue row label (plan 0015 §S6)', () => {
  const base: ConstructionProject = {
    id: 'proj-x',
    building: 'steelMills',
    count: 12,
    owner: 'state',
    monthsLeft: 3,
    monthlyCost: 1,
    lastSpend: 0,
    progress: 0,
    startedAt: { year: 1836, month: 1 },
  }

  test('a new-build project reads as name×count', () => {
    expect(projectLabel({ ...base, building: 'farms', count: 2 })).toBe('农场×2')
    expect(projectLabel({ ...base, building: 'farms', count: 2, kind: 'build' })).toBe('农场×2')
  })

  test('an upgrade project reads as name I→II ×count', () => {
    expect(projectLabel({ ...base, kind: 'upgrade', fromTier: 0, toTier: 1 })).toBe(
      '钢铁厂 I→II ×12',
    )
  })
})
