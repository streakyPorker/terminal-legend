import type { Country } from '../../types'
import { BUILDING_IDS, BUILDINGS, BUILDING_RECIPES } from '../data'
import { CAPACITY_COST, WORKLOAD_MULTIPLIER } from '../sim'
import { basket, n, pct, signed } from './shared'

export function buildingsSection(country: Country): string[] {
  const lines = ['建筑类型（配方为每座每月；经营利润按本月价，开工率为下月）：']
  for (const id of BUILDING_IDS) {
    const meta = BUILDINGS[id]
    const recipe = BUILDING_RECIPES[id]
    const count = country.econ.buildings[id] ?? 0
    const capacity = CAPACITY_COST[id] ?? 1
    const workload = capacity * WORKLOAD_MULTIPLIER
    const extra: string[] = []
    if (meta.unlock?.techLevel !== undefined) {
      extra.push(`需科技层级 ${meta.unlock.techLevel}`)
    }
    if (meta.infrastructureNeed !== undefined) {
      extra.push(`基础设施需求 ${n(meta.infrastructureNeed)}`)
    }
    lines.push(
      `- ${meta.name}×${n(count, 0)}：产出 ${basket(recipe.output)}；投入 ${basket(recipe.input)}；造价 ${n(meta.cost)} 金/座，工程量 ${n(workload)} 点/座，建造点 ${n(capacity)}/月${extra.length > 0 ? `；${extra.join('，')}` : ''}`,
    )
    const row = country.econ.buildingProfits?.[id]
    if (row !== undefined) {
      const margin = row.revenue > 0 ? row.profit / row.revenue : 0
      const idle = row.utilization < 0.999
      lines.push(
        `  经营：产出 ${n(row.revenue)} − 投入 ${n(row.inputCost)} − 工资 ${n(row.wages)} = 利润 ${signed(row.profit)}（毛利 ${pct(margin)}，${signed(row.profitPerBuilding, 2)} 金/座，开工率 ${pct(row.utilization, 0)}${idle ? '，闲置' : ''}）`,
      )
    }
  }
  lines.push(
    '说明：本版 19 类建筑均开局解锁（`unlock.techLevel` 为 plan 0005 科技树的前瞻门槛，按派生科技层级判定，当前无建筑设阈值，F6 已接入 `build` 校验）；`infrastructureNeed`（F5）已落地并计入统一基础设施需求；plan 0014 把铁路/港口/电报合并为「基础设施」、删除运河。',
  )
  return lines
}
