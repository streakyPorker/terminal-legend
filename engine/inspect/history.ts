import type { Country, WorldState } from '../../types'
import { nationalDebt } from '../fiscal'
import { fmtDate, monthsBefore, n } from './shared'

export function historySection(world: WorldState, country: Country): string[] {
  const history = country.econ.history
  const length = Math.min(
    12,
    history.gdp.length,
    history.unemployment.length,
    history.income.length,
  )
  if (length === 0) return ['（还没有月度历史）']
  const lines: string[] = ['日期　　GDP　消费　投资　政府　失业　收入　支出　关税　国债']
  for (let index = 0; index < length; index += 1) {
    const date = monthsBefore(world.date, length - 1 - index)
    const at = (series: number[] | undefined, fallback: number): number => {
      const value = series?.[series.length - length + index]
      return value ?? fallback
    }
    lines.push(
      `${fmtDate(date)}　${n(at(history.gdp, country.econ.gdp))}　${n(at(history.c, 0))}　${n(at(history.i, 0))}　${n(at(history.g, 0))}　${n(at(history.unemployment, country.econ.unemployment))}%　${n(at(history.income, country.econ.income))}　${n(at(history.expense, country.econ.expense))}　${n(at(history.tariff, country.econ.lastTariffRevenue))}　${n(at(history.debt, nationalDebt(country)))}`,
    )
  }
  return lines
}
