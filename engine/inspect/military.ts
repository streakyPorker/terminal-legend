import type { Country, WorldState } from '../../types'
import { n, pct } from './shared'

export function militarySection(world: WorldState, country: Country): string[] {
  const wars = world.wars.filter(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  return [
    `陆军 ${n(country.military.army)} 万，海军 ${n(country.military.navy)}，士气 ${n(country.military.morale, 0)}，战争疲劳 ${n(country.military.exhaustion, 0)}，人力 ${n(country.military.manpower)}，质量 ${pct(country.military.quality, 0)}`,
    `军费：陆军 ${n(country.econ.spending.army)} 级 / 海军 ${n(country.econ.spending.navy)} 级；另有按兵力计算的基本维持费（见 fiscal），砍到 0 级也不会消失`,
    `战争：${wars.length === 0 ? '无' : wars.map(war => `${war.name}（分数 ${n(war.warScore, 0)}）`).join('，')}`,
  ]
}
