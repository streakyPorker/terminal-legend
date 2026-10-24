import type { BuildingId, Country } from '../../types'
import { BUILDING_IDS, BUILDINGS, BUILDING_RECIPES, unemploymentBreakdown } from '../data'
import { n, pct, signed } from './shared'

export function laborSection(country: Country): string[] {
  const econ = country.econ
  // PT-047: unemployment and the raw demand/force ratio are two different units
  // (share of the workforce out of work vs. share of the workforce not currently
  // demanded), so they must never be subtracted or summed. Print the actual
  // model — the components that set the target — and state the raw ratio as
  // what it is: a demand share, not "gap points".
  const u = unemploymentBreakdown(country)
  // 0007 E8: labour demand is utilisation-weighted, so an idle/losing sector
  // sheds workers. Rebuild the full-capacity counterfactual to surface the
  // sectoral source of the gap.
  const fullDemand = BUILDING_IDS.reduce(
    (sum, id) => sum + BUILDING_RECIPES[id].labor * (econ.buildings[id] ?? 0),
    0,
  )
  const released = Math.max(0, fullDemand - econ.laborDemand)
  const idle = BUILDING_IDS.map(id => ({
    id,
    utilization: econ.buildingProfits?.[id]?.utilization,
  }))
    .filter(
      (row): row is { id: BuildingId; utilization: number } =>
        typeof row.utilization === 'number' &&
        Number.isFinite(row.utilization) &&
        row.utilization < 1,
    )
    .sort((a, b) => a.utilization - b.utilization)
    .slice(0, 4)
    .map(row => `${BUILDINGS[row.id].name} ${pct(row.utilization)}`)
  const idleText =
    idle.length === 0
      ? '各部门满负荷（无闲置释放）'
      : `闲置 ${idle.join('、')} 等释放劳力约 ${n(released)} 万（满座需求 ${n(fullDemand)} 万）`
  return [
    `失业 ${n(econ.unemployment)}%（平滑存量，每月向目标收敛，步长 ≤ ±1.5 个点）→ 本月目标 ${n(u.rawTarget)}%：基础 ${n(u.base)} + 工业吸纳不足 ${signed(u.industry)} + 劳动力利用率罚项 ${signed(u.laborPenalty)} + 激进 ${signed(u.radicals)} + 识字率 ${signed(u.literacy)}（各项求和后夹在 0–30）`,
    `劳动需求（建筑正式用工，含营造所）${n(econ.laborDemand)} 万 / 劳动力 ${n(econ.laborForce)} 万 = ${pct(econ.laborRawUtilization)}；分子只算农场/矿场/工厂/营造所/基建的雇工，不含自耕农与手工业自雇，**不是就业率**，也不可与上一行相减；它只进入下面的低利用率罚项（夹在 0.5–1）。工资 ${n(econ.wages)}，劳动份额 ${pct(econ.laborShare)}`,
    `部门来源：${idleText}`,
    `就业基础：农田 ${n(econ.buildings.farms, 0)}、煤矿 ${n(econ.buildings.coalMines, 0)}、铁矿 ${n(econ.buildings.ironMines, 0)}、伐木场 ${n(econ.buildings.lumberMills, 0)}、纺织 ${n(econ.buildings.textileMills, 0)}、家具 ${n(econ.buildings.furnitureWorks, 0)}、酿酒 ${n(econ.buildings.distilleries, 0)}、机械 ${n(econ.buildings.machineryWorks, 0)}、钢铁 ${n(econ.buildings.steelMills, 0)}、兵工 ${n(econ.buildings.arsenals, 0)}、奢侈 ${n(econ.buildings.luxuryWorks, 0)}、营造所 ${n(econ.buildings.workshops, 0)}、基础设施 ${n(econ.buildings.infrastructure, 0)}`,
    `说明：失业率是平滑存量，逐月向「基础 + 工业吸纳不足 + 劳动力利用率罚项 + 激进 + 识字率」决定的目标收敛（步长 ≤ ±1.5 个点）；营造所同时计入「工业吸纳」与劳动需求两个口径（PT-048/PT-061）。`,
  ]
}
