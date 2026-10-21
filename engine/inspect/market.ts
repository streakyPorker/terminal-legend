import type { Country } from '../../types'
import { GOODS, GOOD_IDS } from '../data'
import { inspectEconomy } from '../sim'
import { n, signed } from './shared'

export function marketSection(country: Country): string[] {
  const snap = inspectEconomy(country)
  const lines: string[] = ['商品市场（价格 / 基准，↑ 短缺 ↓ 过剩）：']
  for (const id of GOOD_IDS) {
    const price = country.econ.prices[id] ?? GOODS[id].basePrice
    const base = GOODS[id].basePrice
    const ratio = base > 0 ? price / base : 1
    const mark = ratio > 1.05 ? '↑' : ratio < 0.95 ? '↓' : '·'
    const production = snap.production[id] ?? 0
    const demand = snap.demand[id] ?? 0
    const balance = demand <= 0 ? 2 : production / demand
    const state = balance >= 1.15 ? '盈余' : balance >= 0.9 ? '平衡' : '短缺'
    lines.push(
      `- ${GOODS[id].name} 价格 ${n(price, 2)} / ${n(base, 2)} ${mark} 产出 ${n(production)} 需求 ${n(demand)} 状态 ${state}`,
    )
  }
  const trade = country.trade
  lines.push(
    `对外贸易：出口 ${n(trade.exportValue)} / 进口 ${n(trade.importValue)}，净出口（基准价） ${signed(trade.nx)}；关税收入 ${n(trade.tariffRevenue)}；进口容量 ${n(trade.capacity)}`,
  )
  const partners = new Map<string, { imports: number; exports: number }>()
  for (const flow of trade.imports) {
    const row = partners.get(flow.from) ?? { imports: 0, exports: 0 }
    row.imports += flow.value
    partners.set(flow.from, row)
  }
  for (const flow of trade.exports) {
    const row = partners.get(flow.to) ?? { imports: 0, exports: 0 }
    row.exports += flow.value
    partners.set(flow.to, row)
  }
  const top = [...partners.entries()]
    .map(([id, row]) => ({
      id,
      imports: row.imports,
      exports: row.exports,
      total: row.imports + row.exports,
    }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 6)
  lines.push(
    top.length > 0
      ? `主要伙伴（按贸易总额）：${top.map(row => `${row.id} 进口 ${n(row.imports)} / 出口 ${n(row.exports)} / 合计 ${n(row.total)} 金`).join('，')}`
      : '主要伙伴：本月暂无贸易往来',
  )
  return lines
}
