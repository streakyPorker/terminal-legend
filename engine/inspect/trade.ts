import type { Country, GoodId, WorldState } from '../../types'
import { GOODS } from '../data'
import { n, signed } from './shared'

export function tradeSection(world: WorldState, country: Country): string[] {
  const trade = country.trade
  const lines: string[] = []
  lines.push(
    `出口 ${n(trade.exportValue)} / 进口 ${n(trade.importValue)}，净出口（基准价） ${signed(trade.nx)}；关税 ${n(trade.tariffRevenue)}；进口容量 ${n(trade.capacity)}`,
  )
  const byGood = (flows: typeof trade.imports): { id: GoodId; qty: number; value: number }[] => {
    const map = new Map<GoodId, { id: GoodId; qty: number; value: number }>()
    for (const flow of flows) {
      const row = map.get(flow.good) ?? { id: flow.good, qty: 0, value: 0 }
      row.qty += flow.quantity
      row.value += flow.value
      map.set(flow.good, row)
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }
  const imports = byGood(trade.imports).slice(0, 6)
  const exports = byGood(trade.exports).slice(0, 6)
  lines.push(
    imports.length > 0
      ? `进口（按货值）：${imports.map(row => `${GOODS[row.id].name} ${n(row.qty, 1)}（${n(row.value)} 金）`).join('，')}`
      : '进口：无',
  )
  lines.push(
    exports.length > 0
      ? `出口（按货值）：${exports.map(row => `${GOODS[row.id].name} ${n(row.qty, 1)}（${n(row.value)} 金）`).join('，')}`
      : '出口：无',
  )
  const partners = new Map<string, number>()
  for (const flow of trade.imports) partners.set(flow.from, (partners.get(flow.from) ?? 0) + flow.value)
  for (const flow of trade.exports) partners.set(flow.to, (partners.get(flow.to) ?? 0) + flow.value)
  const top = [...partners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (top.length > 0) {
    lines.push(`主要伙伴：${top.map(([id, value]) => `${id} ${n(value)} 金`).join('，')}`)
  }
  // Route lines moved to `v3_inspect routes` (context economy).
  lines.push('贸易路线明细见 v3_inspect routes。')
  return lines
}
