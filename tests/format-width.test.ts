import { describe, expect, test } from 'claude-code/testing'
import { clampText, displayWidth, padEnd, padStart } from '../view/format'

/**
 * PT-058: the tables padded by `String.length`, so a Chinese header (商品 = 2
 * code units, 4 terminal cells) and a numeric cell (25.2 = 4 code units, 4
 * cells) came out the same width in the string but 2 cells apart on screen.
 */
describe('display-width padding (PT-058)', () => {
  test('CJK counts as two cells', () => {
    expect(displayWidth('商品')).toBe(4)
    expect(displayWidth('25.2')).toBe(4)
    expect(displayWidth('粮食 1')).toBe(6)
    expect(displayWidth('█░')).toBe(2)
  })

  test('padEnd fills to a cell budget, not a code-unit budget', () => {
    expect(padEnd('商品', 6)).toBe('商品  ')
    expect(padEnd('25.2', 6)).toBe('25.2  ')
    expect(displayWidth(padEnd('商品', 6))).toBe(6)
    expect(displayWidth(padEnd('25.2', 6))).toBe(6)
    expect(padStart('7', 4)).toBe('   7')
  })

  test('clampText never exceeds the cell budget', () => {
    expect(displayWidth(clampText('基础设施', 6))).toBeLessThanOrEqual(6)
    expect(clampText('基础设施', 8)).toBe('基础设施')
    expect(displayWidth(clampText('abcdefgh', 4))).toBeLessThanOrEqual(4)
  })
})
