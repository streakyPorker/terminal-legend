import type { Country, WorldState } from '../../types'
import { TECH_NODES, techNode, techNodeName, techTier } from '../data'
import { techDiffusionBonus, techSpillRate } from '../tech'
import { n, pct } from './shared'

export function techSection(world: WorldState, country: Country): string[] {
  const tech = country.tech
  const tier = techTier(tech)
  const node = techNode(tech.researching)
  const nextCost = node?.cost ?? 0
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
    (1 + tier * 0.02)
  const diffusion = techDiffusionBonus(world, country)
  const spill = techSpillRate(country)
  return [
    `科技时代 ${tech.era}/4（层级 ${n(tier, 2)}）；已解锁节点 ${tech.unlocked.length}/${TECH_NODES.length}；点数 ${n(tech.points)} / 当前节点 ${nextCost > 0 ? n(nextCost) : '—'}；研究「${tech.researching === '' ? '待选' : techNodeName(tech.researching)}」`,
    `月产出 ${n(tech.pointsPerMonth)} 点 = (基础 ${n(base)}（2 + 识字 ${pct(literacy)}×3 + 官僚 ${n(bureaucracy)}×0.06）+ 大学 ${n(universityPart)}（大学 ${n(universities, 0)} 座 × 0.9 × (0.4 + 识字) × (1 + 教育支出 ${n(education, 2)}×0.03) × (1 + 层级 ${n(tier, 2)}×0.02)）) × (1 + 国际扩散)`,
    `跨分支溢出 ${pct(spill)}（15–25%，随识字/大学/教育上升）；国际扩散 +${pct(diffusion)}（科技差+贸易+关系+同盟，上限 +50%；与先进伙伴战争或禁运时归零）`,
    `已解锁：${tech.unlocked.length > 0 ? tech.unlocked.map(id => techNodeName(id)).join('、') : '无'}`,
    '说明：层级为 1 + 时代×1.5 + 已解锁×0.05 的连续代理，供受科技门控的公式使用；月产出已含国际扩散，生效中的 techPoints 修正会在结算时另乘（见 v3_inspect modifiers）。',
  ]
}
