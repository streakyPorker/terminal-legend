import type { Country, GoodId } from '../../types'
import { GOODS, GOOD_IDS, infrastructureStats, infrastructureUpkeep } from '../data'
import { inspectEconomy } from '../sim'
import { effectiveSupplyFor, n, pct, signed } from './shared'

export function economySection(country: Country): string[] {
  const econ = country.econ
  const comp = econ.gdpComponents
  const lines: string[] = []
  // PT-041: read the stored settlement snapshot (includes trade) so the GDP the
  // GM sees matches `v3_status` instead of a domestic-only recomputation.
  lines.push(
    `GDP ${n(econ.gdp)} 金/月 = 消费 ${n(comp.c)} + 投资 ${n(comp.i)} + 政府 ${n(comp.g)} + 净出口 ${signed(comp.nx)}（本月结算快照）`,
  )
  lines.push(`价格（现值 / 基准，↑ 短缺 ↓ 过剩）：`)
  for (const id of GOOD_IDS) {
    const price = econ.prices[id] ?? GOODS[id].basePrice
    const base = GOODS[id].basePrice
    const ratio = base > 0 ? price / base : 1
    const mark = ratio > 1.05 ? '↑' : ratio < 0.95 ? '↓' : '·'
    lines.push(`- ${GOODS[id].name} ${n(price, 2)} / ${n(base, 2)} ${mark} ${n(ratio * 100, 0)}%`)
  }
  const snap = inspectEconomy(country)
  const effective = effectiveSupplyFor(snap.production, country)
  const gaps = GOOD_IDS.map(id => {
    const demand = snap.demand[id] ?? 0
    const supply = effective[id] ?? 0
    return { id, gap: demand - supply }
  })
  const deficits = gaps.filter(row => row.gap > 0.01).sort((a, b) => b.gap - a.gap).slice(0, 5)
  const surpluses = gaps.filter(row => row.gap < -0.01).sort((a, b) => a.gap - b.gap).slice(0, 5)
  if (deficits.length > 0) {
    lines.push(`最大缺口：${deficits.map(row => `${GOODS[row.id].name} ${n(row.gap, 2)}`).join('，')}`)
  }
  if (surpluses.length > 0) {
    lines.push(`最大盈余：${surpluses.map(row => `${GOODS[row.id].name} ${n(-row.gap, 2)}`).join('，')}`)
  }
  lines.push(`工资 ${n(econ.wages)} / 利润 ${n(econ.profits)}，劳动份额 ${pct(econ.laborShare)}`)
  const inf = infrastructureStats(country)
  const upkeep = (
    Object.entries(infrastructureUpkeep(country)) as [GoodId, number][]
  )
    .filter(([, quantity]) => quantity !== 0)
    .map(([good, quantity]) => `${GOODS[good].name} ${n(quantity, 2)}`)
    .join('、')
  lines.push(
    `统一基础设施：供给 ${n(inf.supply)} ÷ 需求 ${n(inf.demand)} = ratio ${n(inf.ratio, 2)}，水平 ${n(inf.level, 0)}/100，产出乘数 ${pct(inf.multiplier)}（≥1 无罚；<1 线性，下限 35%）${upkeep === '' ? '' : `；本月经维护消耗 ${upkeep}`}`,
  )
  // Per-building profit lines moved to `v3_inspect buildings` (context economy).
  lines.push('逐建筑经营利润见 v3_inspect buildings。')
  return lines
}
