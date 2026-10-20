import type { WorldState } from '../types'
import { BUILDINGS } from './data'
import { fiscalLedger } from './fiscal'
import { MODIFIER_STAT_NAMES, describeModifier } from './modifiers'
import { constructionLoad, projectWorkload } from './sim'

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
  '4. 内政授权时，你可以：调整税率与关税、调整支出、排建造、定研究方向、代玩家处理待决事件、用 v3_policy 提交政策提议（效果条目会变成可叠算的修正）。',
  '5. 外交授权时，你可以：改善关系、结盟、设对手、赠礼、对他国禁运/解除禁运、就敏感商品（鸦片/军械/粮食）提交贸易张力、用 v3_situation 就鸦片危机等局势提交提案（提案只作仲裁上下文）。',
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
  const atWar = world.wars.some(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  const ledger = fiscalLedger(player, { atWar, tick: world.tick })
  const stock =
    ledger.debt > 0
      ? `国债 ${ledger.debt.toFixed(1)} 金`
      : `主权基金 ${ledger.fund.toFixed(1)} 金`
  lines.push(
    `财政：国库净资产 ${player.econ.treasury.toFixed(1)} 金（${ledger.net.toFixed(1)} 金/月），收入 ${ledger.income.total.toFixed(1)} 金/月，支出 ${ledger.expense.total.toFixed(1)} 金/月，${stock}，税率 ${player.econ.taxRate}%，进口关税 ${player.econ.tariff}% / 出口关税 ${player.econ.exportTariff ?? player.econ.tariff}%`,
  )
  lines.push(
    `收支构成：税入 ${ledger.income.taxes.toFixed(1)} + 关税（进+出） ${ledger.income.tariffs.toFixed(1)} + 港口 ${ledger.income.ports.toFixed(1)} + 基金收益 ${ledger.income.sovereignIncome.toFixed(1)} + 赔款收入 ${ledger.income.reparations.toFixed(1)} + 其他（建造力出租） ${ledger.income.other.toFixed(1)}；陆军 ${ledger.expense.army.toFixed(1)} + 海军 ${ledger.expense.navy.toFixed(1)} + 行政 ${ledger.expense.administration.toFixed(1)} + 教育 ${ledger.expense.education.toFixed(1)} + 福利 ${ledger.expense.welfare.toFixed(1)} + 债息 ${ledger.expense.debtInterest.toFixed(1)} + 市场损耗 ${ledger.expense.marketLoss.toFixed(1)} + 设施维护 ${ledger.expense.upkeep.toFixed(1)} + 赔款支出 ${ledger.expense.reparations.toFixed(1)} + 国有建设 ${ledger.expense.construction.toFixed(1)}。GDP ${player.econ.gdp.toFixed(1)} 金/月是产出，不是国库收入。`,
  )
  const schedules = (world.indemnities ?? []).filter(
    schedule => schedule.from === player.id || schedule.to === player.id,
  )
  if (schedules.length > 0) {
    lines.push(
      `赔款日程：${schedules
        .map(schedule => {
          const paying = schedule.from === player.id
          const otherId = paying ? schedule.to : schedule.from
          const other = world.countries[otherId]?.name ?? otherId
          return `${paying ? '付给' : '收自'}${other} 每月 ${schedule.monthlyAmount.toFixed(1)} 金，剩余 ${schedule.monthsLeft} 月（余 ${schedule.remaining.toFixed(1)} 金）`
        })
        .join('；')}`,
    )
  }
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
    `经济循环：GDP ${player.econ.gdp.toFixed(1)} 金/月（消费 ${player.econ.gdpComponents.c.toFixed(1)} / 投资 ${player.econ.gdpComponents.i.toFixed(1)} / 政府 ${player.econ.gdpComponents.g.toFixed(1)}），工资 ${player.econ.wages.toFixed(1)}，利润 ${player.econ.profits.toFixed(1)}，劳动份额 ${pct(player.econ.laborShare)}`,
  )
  lines.push(
    `私人经济：私人资本 ${player.econ.privateCapital.toFixed(1)} 金，投资信心 ${player.econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(player.econ.investmentConfidence)}（基准 ${player.politicalEconomy.investmentConfidence >= 0 ? '+' : ''}${player.politicalEconomy.investmentConfidence}），闲置利润 ${player.econ.idleProfits.toFixed(1)}，劳动需求 ${player.econ.laborDemand.toFixed(1)} 万 / 劳动力 ${player.econ.laborForce.toFixed(1)} 万（原始利用率 ${pct(player.econ.laborRawUtilization)}）`,
  )
  const load = constructionLoad(player)
  lines.push(
    `建造能力：${load.capacity.toFixed(1)} 点/月（队列剩余工程量 ${load.requested.toFixed(1)}，已分配 ${load.allocated.toFixed(1)}，闲置 ${load.remaining.toFixed(1)}）；国有项目按队列顺序取用闲置建造力，私人项目自建 50%，可租用国有闲置点。`,
  )
  lines.push(
    `资源禀赋：农田 ${player.econ.resources.farmland}，林地 ${player.econ.resources.timber}，煤矿 ${player.econ.resources.coal}，铁矿 ${player.econ.resources.iron}`,
  )
  lines.push(
    `国策修正：${
      player.modifiers.length === 0
        ? '无'
        : player.modifiers
            .map(modifier => `${describeModifier(modifier)}（${MODIFIER_STAT_NAMES[modifier.stat]}）`)
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
                `${project.owner === 'private' ? '[私人]' : '[国有]'}${BUILDINGS[project.building].name}×${project.count}（工程量 ${(projectWorkload(project) * (1 - project.progress)).toFixed(1)}/${projectWorkload(project).toFixed(1)} 点，进度 ${pct(project.progress)}）`,
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
  lines.push(`外交：${delegation.diplomacy ? '已授权（可禁运/贸易张力，不含宣战与和约）' : '未授权（只写建议）'}`)
  if (delegation.internal) {
    lines.push(`本月最多执行 ${player.bureaucracy.actionBudget} 项内政行动。`)
  }
  lines.push('按「已执行 / 建议 / 风险」三段作答。')
  return lines.join('\n')
}
