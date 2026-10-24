import { describe, expect, test } from 'claude-code/testing'
import { fitStatCells, type StatCell } from '../view/panels/construction'

/**
 * PT-059: every buildable-building row rendered 月耗 / 造价 / 存 / 量 / 利 at
 * once, so in a narrow pane the Text nodes shrank and truncated mid-word
 * ("月耗…", "造价…"). `fitStatCells` keeps only the columns that fit.
 */
const CELLS: StatCell[] = [
  { key: 'stock', width: 7, text: '存2973' },
  { key: 'volume', width: 6, text: '量45点' },
  { key: 'upkeep', width: 7, text: '月耗1.5点' },
  { key: 'cost', width: 8, text: '造价9.0金' },
  { key: 'profit', width: 7, text: '利+0.06' },
]

describe('buildable row column fitting (PT-059)', () => {
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
    const kept = fitStatCells(CELLS, 50).map(cell => cell.key)
    expect(kept).toContain('upkeep')
    expect(kept).toContain('cost')
    expect(kept).not.toContain('profit')
    expect(kept).not.toContain('stock')
  })

  test('the kept columns always fit the budget', () => {
    for (const width of [30, 40, 50, 60, 70, 80, 100]) {
      const kept = fitStatCells(CELLS, width)
      const used = kept.reduce((sum, cell) => sum + cell.width + 1, 0)
      // A degenerate width may keep nothing; otherwise the row must fit.
      expect(used).toBeLessThanOrEqual(Math.max(0, width - 8 - 12 - 4))
    }
  })
})
