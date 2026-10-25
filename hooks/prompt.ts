import type { WorldState } from '../types'
import { BUILDINGS, WAR_GOAL_NAMES } from '../engine/data'
import { describeWorldForNarrator } from '../engine/ai'
import {
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  projectWorkload,
} from '../engine/sim'
import { fiscalLedger } from '../engine/fiscal'
import { situationStatus } from '../engine/situations'
import { countryTag, fmtMoney, fmtNumber, fmtPop, fmtSigned } from '../view/format'
import { pendingOf } from './internal'

export function statusText(world: WorldState): string {
  // Cross-country comparison lives in `v3_inspect rankings` (context economy);
  // status keeps the narrator summary plus the player country's detail.
  const lines = [describeWorldForNarrator(world), '各国对比见 v3_inspect rankings。']
  const player = world.countries[world.playerId]
  if (player !== undefined) {
    const load = constructionLoad(player)
    const schedule = constructionSchedule(player)
    const queue = player.econ.constructionQueue
    const stateQueue = queue.filter(
      project => (project.owner ?? 'state') !== 'private',
    )
    const privateQueue = queue.filter(
      project => (project.owner ?? 'state') === 'private',
    )
    const atWar = world.wars.some(
      war =>
        war.attackers.includes(player.id) || war.defenders.includes(player.id),
    )
    const ledger = fiscalLedger(player, { atWar, tick: world.tick })
    const stock =
      ledger.debt > 0
        ? `国债 ${fmtMoney(ledger.debt)}（月息 ${(ledger.debtRate * 100).toFixed(2)}%）`
        : `主权基金 ${fmtMoney(ledger.fund)}（月息 ${(ledger.fundRate * 100).toFixed(2)}%）`
    const pressure = ledger.debtPressure
    const debtPressureLine =
      pressure.ratio < 0.25
        ? `债务压力：无（债务/GDP ${(pressure.ratio * 100).toFixed(0)}%）`
        : `债务压力：${pressure.label}（债务/GDP ${(pressure.ratio * 100).toFixed(0)}%，收入 −${(pressure.incomePenalty * 100).toFixed(0)}%，建设速度 −${(pressure.constructionPenalty * 100).toFixed(0)}%，合法性目标 −${pressure.legitimacyPenalty.toFixed(1)}，月息 +${(pressure.interestSpread * 100).toFixed(2)}%）`
    const schedules = [...(world.indemnities ?? []), ...(world.transfers ?? [])].filter(
      schedule => schedule.from === player.id || schedule.to === player.id,
    )
    lines.push(
      '',
      `本国官僚：${Math.round(player.bureaucracy.score)}/${Math.round(player.bureaucracy.ceiling)}，行动预算 ${player.bureaucracy.actionBudget} 项/月，资金效率 ${Math.round(player.bureaucracy.fundEfficiency * 100)}%，延迟 ${Math.round(player.bureaucracy.delayChance * 100)}%，失真 ${Math.round(player.bureaucracy.infoDistortion * 100)}%`,
      `基础设施 ${Math.round(player.econ.transportInfrastructure)}/100 · 行政能力 ${Math.round(player.econ.administrativeCapacity)} · 失业 ${player.econ.unemployment.toFixed(1)}%`,
      `GDP构成：消费 ${fmtNumber(player.econ.gdpComponents.c)} / 投资 ${fmtNumber(player.econ.gdpComponents.i)} / 政府 ${fmtNumber(player.econ.gdpComponents.g)} / 净出口 ${fmtSigned(player.econ.gdpComponents.nx)}；工资 ${fmtNumber(player.econ.wages)}（劳动份额 ${Math.round(player.econ.laborShare * 100)}%）/ 利润 ${fmtNumber(player.econ.profits)}`,
      `国库净资产：${fmtMoney(player.econ.treasury)}（${stock}）`,
      debtPressureLine,
      `四税基：土地 ${player.econ.taxes.land}% · 企业 ${player.econ.taxes.profit}% · 消费 ${player.econ.taxes.consumption}% · 关税 进 ${player.econ.tariff}% / 出 ${player.econ.exportTariff ?? player.econ.tariff}%`,
      `财政收入：税入 ${fmtNumber(ledger.income.taxes)}（土 ${fmtNumber(ledger.income.taxBases.land)}／企 ${fmtNumber(ledger.income.taxBases.profit)}／消 ${fmtNumber(ledger.income.taxBases.consumption)}／关 ${fmtNumber(ledger.income.taxBases.tariff)}）+ 基建 ${fmtNumber(ledger.income.ports)} + 基金收益 ${fmtNumber(ledger.income.sovereignIncome)} + 赔款/转移收入 ${fmtNumber(ledger.income.reparations)} + 其他（建造力出租） ${fmtNumber(ledger.income.other)} = ${fmtMoney(ledger.income.total)}/月（四税基，GDP 是产出不作税基）`,
      `财政支出：陆军 ${fmtNumber(ledger.expense.army)} + 海军 ${fmtNumber(ledger.expense.navy)} + 行政 ${fmtNumber(ledger.expense.administration)} + 教育 ${fmtNumber(ledger.expense.education)} + 福利 ${fmtNumber(ledger.expense.welfare)} + 债息 ${fmtNumber(ledger.expense.debtInterest)} + 市场损耗 ${fmtNumber(ledger.expense.marketLoss)} + 设施维护 ${fmtNumber(ledger.expense.upkeep)} + 赔款/转移支出 ${fmtNumber(ledger.expense.reparations)} + 国有建设 ${fmtNumber(ledger.expense.construction)} + 建设补贴 ${fmtNumber(ledger.expense.constructionSubsidy)} = ${fmtMoney(ledger.expense.total)}/月`,
      `国库净额：收入 − 支出 = ${fmtSigned(ledger.net)} 金/月；私人部门贸易逆差 ${fmtMoney(ledger.tradeGap)}（由私人资本/私人外债 ${fmtMoney(ledger.privateDebt)} 承担，不影响国库）；净资产实际变动 ${fmtSigned(ledger.net)} 金/月；GDP 是产出，与国库收支不是同一本账`,
      `赔款日程：${
        schedules.length === 0
          ? '无'
          : schedules
              .map(schedule => {
                const paying = schedule.from === player.id
                const otherId = paying ? schedule.to : schedule.from
                const other = world.countries[otherId]?.name ?? otherId
                return `${paying ? '付给' : '收自'}${other} 每月 ${fmtNumber(schedule.monthlyAmount)} 金，剩余 ${schedule.monthsLeft} 月（余 ${fmtNumber(schedule.remaining)} 金）`
              })
              .join('；')
      }`,
      `私人资本 ${fmtNumber(Math.max(0, player.econ.privateCapital))} · 私人外债 ${fmtMoney(ledger.privateDebt)} · 投资信心 ${player.econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(player.econ.investmentConfidence)} · 闲置利润 ${fmtNumber(player.econ.idleProfits)} · 劳动原始利用率 ${(player.econ.laborRawUtilization * 100).toFixed(1)}%（需求 ${fmtPop(player.econ.laborDemand)} / 劳动力 ${fmtPop(player.econ.laborForce)}）`,
      `资源禀赋：农田 ${player.econ.resources.farmland} · 林地 ${player.econ.resources.timber} · 煤矿 ${player.econ.resources.coal} · 铁矿 ${player.econ.resources.iron}`,
      `建造能力 ${fmtNumber(load.capacity)} 点/月（队列剩余工程量 ${fmtNumber(load.requested)}，已分配 ${fmtNumber(load.allocated)}，闲置 ${fmtNumber(load.remaining)}；每点工程量造价 ${CONSTRUCTION_COST_PER_POINT} 金）`,
      `国有建造队列：${
        stateQueue.length === 0
          ? '空'
          : stateQueue
              .map(
                project =>
                  `${BUILDINGS[project.building].name}×${project.count}（工程量 ${fmtNumber(projectWorkload(project) * (1 - project.progress))}/${fmtNumber(projectWorkload(project))} 点，已完成 ${Math.round(project.progress * 100)}%，本月投入 ${fmtNumber(load.byProject[project.id] ?? 0)} 点，预计 ${schedule[project.id]?.turns ?? '—'} 回合，总造价 ${fmtNumber(constructionTotalCost(project))} 金）`,
              )
              .join('；')
      }`,
      `私人建造流转：自有 ${fmtNumber(load.privateOwn)} 点/月 + 国有流转 ${fmtNumber(load.privateRented + load.privateMarket)} 点/月（项目租用 ${fmtNumber(load.privateRented)}，市场 ${fmtNumber(load.privateMarket)}，租金 ${fmtMoney((load.privateRented + load.privateMarket) * CONSTRUCTION_RENT_PER_POINT)}）；${
        privateQueue.length === 0
          ? '无在建项目'
          : privateQueue
              .map(
                project =>
                  `${BUILDINGS[project.building].name}×${project.count}（工程量 ${fmtNumber(projectWorkload(project) * (1 - project.progress))}/${fmtNumber(projectWorkload(project))} 点，进度 ${Math.round(project.progress * 100)}%，自有 ${fmtNumber(load.privateByProject[project.id]?.own ?? 0)}，租用 ${fmtNumber(load.privateByProject[project.id]?.rented ?? 0)} 点/月）`,
              )
              .join('；')
      }`,
      `秘书委托：内政${world.secretary.delegation.internal ? '开' : '关'}，外交${world.secretary.delegation.diplomacy ? '开' : '关'}${world.secretary.lastReport === '' ? '' : `｜上次报告：${world.secretary.lastReport.slice(0, 200)}`}`,
    )
  }
  const pending = pendingOf(world)
  if (pending.length > 0) {
    lines.push('', '待决事件：')
    for (const event of pending) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.text} 选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }
  const wars = world.wars
  if (wars.length > 0) {
    lines.push('', '战争：')
    for (const war of wars) {
      lines.push(
        `- ${war.name}（目标：${WAR_GOAL_NAMES[war.goal]}）：${war.attackers.join(',')} vs ${war.defenders.join(',')}，分数 ${Math.round(war.warScore)}，${war.lastEvent}`,
      )
    }
  }
  const situation = situationStatus(world)
  if (situation !== '') lines.push('', situation)
  return lines.join('\n')
}

export function narratorPrompt(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return ''
  const pending = pendingOf(world)
  const lines = [
    '## 终末传奇：进行中的大战略游戏',
    `你是这个 19 世纪世界的叙事者，同时也是各国领袖的扮演者。玩家扮演 ${countryTag(player)}。`,
    '硬性规则：',
    '1. 所有数值以工具返回为准；需要世界状态时调用 v3_status，绝不要编造数字。',
    '2. 玩家用自然语言下达命令时，先判断意图，再调用对应工具：v3_action（内政/建造/税收/征兵/法案）、v3_policy（提出政策并施加 buff/debuff）、v3_diplomacy（外交/宣战/停战/禁运/封锁；封锁需 `move=blockade`，可给 `party` 指定第三方）、v3_event（处理事件）、v3_advance（批准推进一月；months>1 视为托管）、v3_control（stop/save：手动停止托管/保存）。',
    '3. 玩家与某国领袖交谈时，用该领袖的第一人称口吻回应，体现其人格、特质与议程；随后调用 v3_leader 记录这次交流（可带上 mood / relation 调整）。',
    '4. 时间按月推进：每月停在御前会议，只有玩家批准或托管后才推进；绝不要自行推进。',
    '5. 月度秘书是独立子代理（玩家用 /v3 secretary 召见）。你可以解读它的报告，但不要假装自己执行了它的计划。',
    '6. 回复使用中文，简洁但有画面感；重大转折可以引用编年史。',
    '7. 建造时除非玩家明确要求批量，一律**逐座下令**（每次 count=1，需要几座就连下几次）。逐座完工即投产、建造力滚动上升，整体利用率更高；打包成一单会让所有座数等到最后才一起落地。',
    '',
    describeWorldForNarrator(world),
  ]
  if (pending.length > 0) {
    lines.push('', '待决事件：')
    for (const event of pending) {
      lines.push(
        `- [${event.id}] ${event.title}：${event.text} 选项：${event.options.map(option => `${option.id}=${option.label}`).join(' / ')}`,
      )
    }
  }
  return lines.join('\n')
}

export function statusHint(): string {
  return '终末传奇：还没有进行中的游戏。\n/v3 new [国家] 开一局（默认 QING 大清）\n/v3 load 读取存档\n/v3 help 查看全部命令'
}
