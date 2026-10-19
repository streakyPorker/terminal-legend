import type { WorldState } from '../types'
import { BUILDINGS } from './data'

/**
 * System prompt for the secretary subagent. The delegation itself changes
 * month to month, so it rides in the briefing; only the standing rules live
 * here.
 */
export const SECRETARY_PROMPT = [
  '你是终末传奇世界的御前秘书，为玩家扮演的国家起草并执行每月的国策。',
  '你拥有全部游戏工具，但只有简报中明确授权的领域可以动手；军事与战争永远由玩家决定。',
  '',
  '硬性规则：',
  '1. 禁止调用 v3_advance（推进时间只能由玩家批准）。',
  '2. 禁止调用 v3_cheat（天命），禁止修改存档。',
  '3. 禁止宣战（v3_diplomacy move=war）与停战（move=peace），即使已获外交授权。',
  '4. 内政授权时，你可以：调整税率与关税、调整支出、排建造、定研究方向、代玩家处理待决事件。',
  '5. 外交授权时，你可以：改善关系、结盟、设对手、赠礼。',
  '6. 未授权的领域只在报告的「建议」里写，不要调用任何工具。',
  '7. 简报会给你本月的行动预算（可执行的内政行动数）；不要超额。',
  '8. 不知道的数字先调用 v3_status 查询，绝不编造。',
  '',
  '报告格式（中文，简洁，合计不超过 400 字）：',
  '已执行：逐条列出你实际调用工具完成的事；没有就写「无」。',
  '建议：下一步值得考虑、但超出授权或需要玩家决定的事。',
  '风险：财政、民怨、外交或战争的隐患。',
  '不要复述整份简报，不要寒暄。',
].join('\n')

const pct = (value: number): string => `${Math.round(value * 100)}%`

/**
 * The month's briefing handed to the secretary subagent: the numbers it may
 * act on, the pending events, and exactly which domains are delegated.
 */
export function monthlyBriefing(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return '（还没有进行中的游戏）'
  const lines: string[] = []
  const delegation = world.secretary.delegation

  lines.push('## 御前简报')
  lines.push(
    `日期 ${world.date.year} 年 ${world.date.month} 月（第 ${world.tick} 回合）｜玩家国家 ${player.name}（${player.id}）`,
  )
  lines.push(
    `财政：国库 ${player.econ.treasury.toFixed(1)}（${(player.econ.income - player.econ.expense).toFixed(1)}/月），收入 ${player.econ.income.toFixed(1)}，支出 ${player.econ.expense.toFixed(1)}，债务 ${player.econ.debt.toFixed(1)}，税率 ${player.econ.taxRate}%，关税 ${player.econ.tariff}%`,
  )
  lines.push(
    `社会：人口 ${player.pops.total.toFixed(0)} 万，识字率 ${pct(player.pops.literacy)}，生活水平 ${Math.round(player.pops.sol)}，激进 ${Math.round(player.pops.radicals)}，合法性 ${Math.round(player.government.legitimacy)}，权威 ${Math.round(player.government.authority)}，失业 ${player.econ.unemployment.toFixed(1)}%`,
  )
  lines.push(
    `官僚效能：${Math.round(player.bureaucracy.score)}/${Math.round(player.bureaucracy.ceiling)}，行动预算 ${player.bureaucracy.actionBudget} 项/月，资金效率 ${pct(player.bureaucracy.fundEfficiency)}，延迟 ${pct(player.bureaucracy.delayChance)}，信息失真 ${pct(player.bureaucracy.infoDistortion)}`,
  )
  lines.push(
    `基础设施：交通 ${Math.round(player.econ.transportInfrastructure)}，行政能力 ${Math.round(player.econ.administrativeCapacity)}，市场接入 ${pct(player.econ.marketAccess)}`,
  )
  lines.push(
    `国策修正：${
      player.modifiers.length === 0
        ? '无'
        : player.modifiers
            .map(
              modifier =>
                `${modifier.label}(${modifier.stat} ${modifier.value >= 0 ? '+' : ''}${modifier.value}${modifier.stack === 'flat' ? '' : '%'}${
                  modifier.monthsLeft === undefined ? '，长期' : `，${modifier.monthsLeft} 月`
                })`,
            )
            .join('；')
    }`,
  )
  const queue = player.econ.constructionQueue
  lines.push(
    `建造队列：${
      queue.length === 0
        ? '空'
        : queue
            .map(
              project =>
                `${BUILDINGS[project.building].name}×${project.count}（剩余 ${project.monthsLeft} 月，进度 ${pct(project.progress)}）`,
            )
            .join('；')
    }`,
  )
  lines.push(
    `科技：${player.tech.level} 级，研究「${player.tech.researching}」（${player.tech.pointsPerMonth.toFixed(1)} 点/月）`,
  )
  lines.push(
    `军力：陆军 ${player.military.army.toFixed(1)} 万，海军 ${player.military.navy.toFixed(1)}，士气 ${Math.round(player.military.morale)}，战争疲劳 ${Math.round(player.military.exhaustion)}，人力 ${player.military.manpower.toFixed(1)}`,
  )
  const relations = Object.values(world.countries)
    .filter(country => country.id !== player.id)
    .map(country => `[${country.flag}]${country.name}(${country.id}) ${Math.round(player.diplo.relations[country.id] ?? 0)}`)
  lines.push(`外交关系：${relations.join('，')}`)
  const wars = world.wars.filter(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  lines.push(
    `战争：${wars.length === 0 ? '无' : wars.map(war => `${war.name}（分数 ${Math.round(war.warScore)}）`).join('，')}`,
  )

  const pending = world.events.filter(
    event => event.countryId === player.id && !event.isResolved,
  )
  if (pending.length > 0) {
    lines.push('待决事件：')
    for (const event of pending) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.text} 选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }

  lines.push('最近编年史：')
  for (const entry of world.log.slice(-12)) {
    lines.push(`- ${entry.date.year}.${String(entry.date.month).padStart(2, '0')} ${entry.text}`)
  }

  lines.push('')
  lines.push('## 本月授权')
  lines.push(`内政：${delegation.internal ? '已授权' : '未授权（只写建议）'}`)
  lines.push(`外交：${delegation.diplomacy ? '已授权（不含宣战与和约）' : '未授权（只写建议）'}`)
  if (delegation.internal) {
    lines.push(`本月最多执行 ${player.bureaucracy.actionBudget} 项内政行动。`)
  }
  lines.push('按「已执行 / 建议 / 风险」三段作答。')
  return lines.join('\n')
}
