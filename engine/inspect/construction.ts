import type { Country } from '../../types'
import { CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL } from '../fiscal'
import { BUILDINGS } from '../data'
import { constructionLoad, constructionSchedule, projectWorkload } from '../sim'
import { n } from './shared'

export function constructionSection(country: Country): string[] {
  const load = constructionLoad(country)
  const schedule = constructionSchedule(country)
  const queue = country.econ.constructionQueue
  // 1-based position in the FULL queue (state + private), so it matches the
  // index accepted by `v3_action cancel` / `reorder`.
  const queueIndex = new Map<string, number>()
  queue.forEach((project, i) => queueIndex.set(project.id, i + 1))
  const state = queue.filter(project => (project.owner ?? 'state') !== 'private')
  const privateProjects = queue.filter(project => (project.owner ?? 'state') === 'private')
  const subsidy = Math.max(0, country.econ.spending.construction)
  const lines: string[] = [
    `建造力 ${n(load.capacity)} 点/月 = 营造所 ${n(country.econ.buildings.workshops, 0)} 座的产出 + 建设补贴 ${n(subsidy, 0)} 级 × ${n(CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL)} 点（补贴另花 ${n(subsidy * 0.45)} 金/月）`,
    `私人资本 ${n(country.econ.privateCapital)} 金，按 0.3 金/点可负担约 ${n(Math.max(0, country.econ.privateCapital) / 0.3, 0)} 点租金；能否租到取决于国有闲置点`,
    `队列剩余工程量 ${n(load.requested)}，已分配 ${n(load.allocated)}，闲置 ${n(load.remaining)}；私人自有 ${n(load.privateOwn)}，租用国有 ${n(load.privateRented)}，市场 ${n(load.privateMarket)}（租金 ${n((load.privateRented + load.privateMarket) * 0.3)} 金/月）`,
  ]
  for (const project of state.slice(0, 12)) {
    lines.push(
      `- [#${queueIndex.get(project.id) ?? 0}] 国有 ${BUILDINGS[project.building].name}×${project.count}：剩余 ${n(projectWorkload(project) * (1 - project.progress))}/${n(projectWorkload(project))} 点，进度 ${n(project.progress * 100, 0)}%，本月 ${n(load.byProject[project.id] ?? 0)} 点，预计 ${schedule[project.id]?.turns ?? '—'} 回合  id=${project.id}`,
    )
  }
  for (const project of privateProjects.slice(0, 8)) {
    lines.push(
      `- [#${queueIndex.get(project.id) ?? 0}] 私人 ${BUILDINGS[project.building].name}×${project.count}：进度 ${n(project.progress * 100, 0)}%，自有 ${n(load.privateByProject[project.id]?.own ?? 0)} / 租用 ${n(load.privateByProject[project.id]?.rented ?? 0)} 点  id=${project.id}`,
    )
  }
  if (state.length + privateProjects.length === 0) lines.push('- 队列：空')
  return lines
}
