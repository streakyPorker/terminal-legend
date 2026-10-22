import type { BuildingId, Country } from '../../types'
import { BUILDING_IDS, BUILDINGS, BUILDING_RECIPES } from '../data'
import { n, pct } from './shared'

export function laborSection(country: Country): string[] {
  const econ = country.econ
  const rawGap = Math.max(0, (1 - econ.laborRawUtilization) * 100)
  const structural = Math.max(0, econ.unemployment - rawGap)
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
    `失业 ${n(econ.unemployment)}%：原始需求/劳动力 ${pct(econ.laborRawUtilization)}（对应缺口 ${n(rawGap)} 个点），结构性部分约 ${n(structural)} 个点`,
    `劳动需求 ${n(econ.laborDemand)} 万 / 劳动力 ${n(econ.laborForce)} 万；工资 ${n(econ.wages)}，劳动份额 ${pct(econ.laborShare)}`,
    `部门来源：${idleText}`,
    `就业基础：农田 ${n(econ.buildings.farms, 0)}、煤矿 ${n(econ.buildings.coalMines, 0)}、铁矿 ${n(econ.buildings.ironMines, 0)}、伐木场 ${n(econ.buildings.lumberMills, 0)}、纺织 ${n(econ.buildings.textileMills, 0)}、家具 ${n(econ.buildings.furnitureWorks, 0)}、酿酒 ${n(econ.buildings.distilleries, 0)}、机械 ${n(econ.buildings.machineryWorks, 0)}、钢铁 ${n(econ.buildings.steelMills, 0)}、兵工 ${n(econ.buildings.arsenals, 0)}、奢侈 ${n(econ.buildings.luxuryWorks, 0)}、营造所 ${n(econ.buildings.workshops, 0)}、基础设施 ${n(econ.buildings.infrastructure, 0)}`,
    `说明：失业率是结构性指标，除了当月的需求缺口，还含工业吸纳能力、进口竞争与在职不足；原始利用率只反映前者。`,
  ]
}
