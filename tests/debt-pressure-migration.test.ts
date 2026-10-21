import { describe, expect, test } from 'claude-code/testing'
import type { Country } from '../types'
import { newWorld } from '../engine/sim'
import {
  DEBT_PRESSURE_FULL,
  DEBT_PRESSURE_START,
  debtPressure,
} from '../engine/fiscal'
import {
  DEBT_PRESSURE_BANDS,
  DEBT_PRESSURE_BLOCK,
  DEBT_PRESSURE_COEFFICIENTS,
  debtPressureLabel,
} from '../engine/config/blocks/fiscal'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Frozen pre-C7 `debtPressure`: every constant is the original literal. */
function oracleDebtPressure(country: Country): {
  ratio: number
  severity: number
  incomePenalty: number
  constructionPenalty: number
  legitimacyPenalty: number
  interestSpread: number
  label: string
} {
  const debt = Math.max(0, -country.econ.treasury)
  const gdp = Math.max(1, country.econ.gdp)
  const ratio = debt / gdp
  const severity = clamp((ratio - 0.25) / (2 - 0.25), 0, 2)
  const label =
    ratio < 0.25
      ? '无'
      : ratio < 0.5
        ? '轻度'
        : ratio < 1
          ? '中度'
          : ratio < 2
            ? '重度'
            : '危重'
  return {
    ratio,
    severity,
    incomePenalty: 0.1 * severity,
    constructionPenalty: 0.2 * severity,
    legitimacyPenalty: 5 * severity,
    interestSpread: 0.004 * severity,
    label,
  }
}

const fraOf = (): Country => {
  const world = newWorld(9200, 'FRA')
  const fra = world.countries.FRA
  if (fra === undefined) throw new Error('missing FRA')
  return fra
}

describe('debtPressure migration equivalence (C7, ADR 0024 / ADR 0007)', () => {
  test('every penalty is bit-for-bit the pre-C7 value across debtRatio 0..3×', () => {
    const fra = fraOf()
    fra.econ.gdp = 1000
    const ratios = [
      0, 0.05, 0.1, 0.2, 0.24, 0.25, 0.2500001, 0.3, 0.5, 0.75, 1, 1.5, 2, 2.5, 3,
      3.75, 4, 5,
    ]
    for (const ratio of ratios) {
      fra.econ.treasury = -ratio * fra.econ.gdp
      const now = debtPressure(fra)
      const ref = oracleDebtPressure(fra)
      expect(Object.is(now.ratio, ref.ratio), `ratio ${ratio}`).toBe(true)
      expect(Object.is(now.severity, ref.severity), `severity ${ratio}`).toBe(true)
      expect(Object.is(now.incomePenalty, ref.incomePenalty), `income ${ratio}`).toBe(true)
      expect(
        Object.is(now.constructionPenalty, ref.constructionPenalty),
        `construction ${ratio}`,
      ).toBe(true)
      expect(
        Object.is(now.legitimacyPenalty, ref.legitimacyPenalty),
        `legitimacy ${ratio}`,
      ).toBe(true)
      expect(
        Object.is(now.interestSpread, ref.interestSpread),
        `interest ${ratio}`,
      ).toBe(true)
      expect(now.label).toBe(ref.label)
    }
  })

  test('randomised ratios and a zero-GDP guard stay identical', () => {
    const fra = fraOf()
    fra.econ.gdp = 777
    let x = 123456789
    const next = (): number => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
    for (let i = 0; i < 500; i += 1) {
      fra.econ.treasury = -next() * 4 * fra.econ.gdp
      const now = debtPressure(fra)
      const ref = oracleDebtPressure(fra)
      expect(Object.is(now.severity, ref.severity)).toBe(true)
      expect(Object.is(now.incomePenalty, ref.incomePenalty)).toBe(true)
      expect(Object.is(now.constructionPenalty, ref.constructionPenalty)).toBe(true)
      expect(Object.is(now.legitimacyPenalty, ref.legitimacyPenalty)).toBe(true)
      expect(Object.is(now.interestSpread, ref.interestSpread)).toBe(true)
      expect(now.label).toBe(ref.label)
    }
    // gdp 0 falls back to max(1, gdp) in both the ratio and the block's read.
    fra.econ.gdp = 0
    fra.econ.treasury = -5
    const now = debtPressure(fra)
    const ref = oracleDebtPressure(fra)
    expect(Object.is(now.ratio, ref.ratio)).toBe(true)
    expect(Object.is(now.severity, ref.severity)).toBe(true)
  })

  test('drift guard: block curve, coefficients and bands match the pre-C7 table', () => {
    expect(DEBT_PRESSURE_START).toBe(0.25)
    expect(DEBT_PRESSURE_FULL).toBe(2)
    expect(DEBT_PRESSURE_BLOCK.kind).toBe('fiscal')
    expect(DEBT_PRESSURE_BLOCK.effects).toEqual([])
    expect(DEBT_PRESSURE_BLOCK.scales_with).toEqual([
      {
        stat: 'debtRatio',
        curve: {
          kind: 'linear',
          slope: 1,
          preOffset: 0.25,
          divisor: 1.75,
          min: 0,
          max: 2,
        },
      },
    ])
    expect(DEBT_PRESSURE_COEFFICIENTS).toEqual({
      income: 0.1,
      construction: 0.2,
      legitimacy: 5,
      interest: 0.004,
    })
    expect(DEBT_PRESSURE_BANDS.map(band => band.label)).toEqual([
      '无',
      '轻度',
      '中度',
      '重度',
      '危重',
    ])
    expect(debtPressureLabel(0.1)).toBe('无')
    expect(debtPressureLabel(0.4)).toBe('轻度')
    expect(debtPressureLabel(0.9)).toBe('中度')
    expect(debtPressureLabel(1.9)).toBe('重度')
    expect(debtPressureLabel(2)).toBe('危重')
  })
})
