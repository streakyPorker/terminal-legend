import type { ConstructionProject, Country } from '../../types'
import { CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL } from '../fiscal'
import { BUILDINGS } from '../data'
import { constructionLoad, constructionSchedule, projectKind, projectWorkload } from '../sim'
import { n } from './shared'

const ROMAN_TIERS = ['I', 'II', 'III', 'IV', 'V']
const tierName = (tier: number): string => ROMAN_TIERS[tier - 1] ?? String(tier)

const projectLabel = (project: ConstructionProject): string => {
  const name = BUILDINGS[project.building].name
  if (projectKind(project) === 'upgrade') {
    return `${name} ${tierName((project.fromTier ?? 0) + 1)}→${tierName((project.toTier ?? 0) + 1)}`
  }
  return name
}

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
  const stateSpend = country.econ.lastStateConstructionSpend ?? 0
  const privateSpend = country.econ.lastPrivateConstructionSpend ?? 0
  const lines: string[] = [
    `建造力 ${n(load.capacity)} 点/月 = 营造所 ${n(country.econ.buildings.workshops, 0)} 座的产出 + 建设补贴 ${n(subsidy, 0)} 级 × ${n(CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL)} 点（补贴另花 ${n(subsidy * 0.45)} 金/月）`,
    `上月建设实付：国有 ${n(stateSpend)} 金 + 私人 ${n(privateSpend)} 金 = ${n(stateSpend + privateSpend)} 金（私人项目自有 ${n(load.privateOwn)} 点/月 + 租用 ${n(load.privateRented)} 点）`,
    `私人资本 ${n(country.econ.privateCapital)} 金，按 0.3 金/点可负担约 ${n(Math.max(0, country.econ.privateCapital) / 0.3, 0)} 点租金；能否租到取决于国有闲置点`,
    `队列剩余工程量 ${n(load.requested)}，已分配 ${n(load.allocated)}，闲置 ${n(load.remaining)}；私人自有 ${n(load.privateOwn)}，租用国有 ${n(load.privateRented)}，市场 ${n(load.privateMarket)}（租金 ${n((load.privateRented + load.privateMarket) * 0.3)} 金/月）`,
  ]
  for (const project of state.slice(0, 12)) {
    lines.push(
      `- [#${queueIndex.get(project.id) ?? 0}] 国有 ${projectLabel(project)}×${project.count}：剩余 ${n(projectWorkload(project) * (1 - project.progress))}/${n(projectWorkload(project))} 点，进度 ${n(project.progress * 100, 0)}%，本月 ${n(load.byProject[project.id] ?? 0)} 点，预计 ${schedule[project.id]?.turns ?? '—'} 回合  id=${project.id}`,
    )
  }
  // Private projects cannot be cancelled or reordered, so they carry no
  // actionable index; listing them in their own block keeps the state queue's
  // numbering from looking out of order (PT-049).
  if (state.length > 0) {
    lines.push('（国有队列的 `#N` 是完整队列位置，私人项目也占位；私人项目不可取消/重排）')
  }
  // The listing is capped for context economy; say so, or the visible rows no
  // longer reconcile with the queue-total workload above (PT-081).
  if (state.length > 12) {
    lines.push(`- …另有 ${state.length - 12} 个国有项目未显示（国有队列共 ${state.length} 项）`)
  }
  if (privateProjects.length > 8) {
    lines.push(`- …另有 ${privateProjects.length - 8} 个私人项目未显示`)
  }
  for (const project of privateProjects.slice(0, 8)) {
    lines.push(
      `- 私人 ${projectLabel(project)}×${project.count}：进度 ${n(project.progress * 100, 0)}%，自有 ${n(load.privateByProject[project.id]?.own ?? 0)} / 租用 ${n(load.privateByProject[project.id]?.rented ?? 0)} 点  id=${project.id}`,
    )
  }
  if (state.length + privateProjects.length === 0) lines.push('- 队列：空')
  return lines
}
