import type { Country } from '../../types'
import { techCost, techName } from '../data'
import { n, pct } from './shared'

export function techSection(country: Country): string[] {
  const tech = country.tech
  const nextCost = techCost(tech.level + 1)
  const literacy = country.pops.literacy
  const bureaucracy = country.bureaucracy.score
  const base = 2 + literacy * 3 + bureaucracy * 0.06
  const education = country.econ.spending.education
  const universities = country.econ.buildings.universities
  const universityPart =
    universities *
    0.9 *
    (0.4 + literacy) *
    (1 + education * 0.03) *
    (1 + tech.level * 0.02)
  return [
    `科技等级 ${tech.level}（${techName(tech.level)}）；点数 ${n(tech.points)} / 下一级 ${nextCost > 0 ? n(nextCost) : '—'}；研究「${tech.researching}」`,
    `月产出 ${n(tech.pointsPerMonth)} 点 = 基础 ${n(base)}（2 + 识字 ${pct(literacy)}×3 + 官僚 ${n(bureaucracy)}×0.06）+ 大学 ${n(universityPart)}（大学 ${n(universities, 0)} 座 × 0.9 × (0.4 + 识字) × (1 + 教育支出 ${n(education, 2)}×0.03) × (1 + 等级 ${tech.level}×0.02)）`,
    `已解锁：${tech.unlocked.length > 0 ? tech.unlocked.join('、') : '无'}`,
    '说明：月产出为结算前的基础值；生效中的 techPoints 修正会在结算时另乘（见 v3_inspect modifiers）。',
  ]
}
