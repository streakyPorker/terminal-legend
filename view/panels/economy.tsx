import type { WorldState } from '../../types'
import {
  BUILDINGS,
  BUILDING_IDS,
  RESOURCE_IDS,
  RESOURCE_NAMES,
  SPENDING,
} from '../../engine/data'
import {
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  projectWorkload,
} from '../../engine/sim'
import { fiscalLedger } from '../../engine/fiscal'
import {
  bar,
  fmtGdp,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtPop,
  fmtSigned,
  padEnd,
  sparkline,
} from '../format'
import { Heading, playerOf, type UiKit } from './shared'

export function EconomyPanel(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const econ = player.econ
  const load = constructionLoad(player)
  const schedule = constructionSchedule(player)
  const stateQueue = econ.constructionQueue.filter(
    project => (project.owner ?? 'state') !== 'private',
  )
  const privateQueue = econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
  const atWar = props.world.wars.some(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  const ledger = fiscalLedger(player, { atWar, tick: props.world.tick })
  const components = econ.gdpComponents

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="支出法 GDP" hint={`${fmtNumber(econ.gdp)} 金/月（基期价）`} />
      <Text dimColor>
        消费 {fmtNumber(components.c)} · 投资 {fmtNumber(components.i)} · 政府 {fmtNumber(components.g)} · 净出口 {fmtNumber(components.nx)}
      </Text>
      <Text dimColor>
        工资总额 {fmtNumber(econ.wages)}（劳动份额 {fmtPercent(econ.laborShare)}） · 利润 {fmtNumber(econ.profits)} · 私人资本 {fmtNumber(econ.privateCapital)} · 投资信心 {econ.investmentConfidence >= 0 ? '+' : ''}{Math.round(econ.investmentConfidence)} 点
      </Text>
      <Text dimColor>
        私人闲置利润 {fmtNumber(econ.idleProfits)} · 下月转为奢侈品消费 {fmtNumber(econ.idlePurchases)} · 上月建设实付 国有 {fmtNumber(econ.lastStateConstructionSpend)} / 私人 {fmtNumber(econ.lastPrivateConstructionSpend)}
      </Text>
      <Text dimColor>
        劳动需求 {fmtPop(econ.laborDemand)} · 劳动力 {fmtPop(econ.laborForce)} · 原始利用率 {fmtPercent(econ.laborRawUtilization, 1)}（有效下限 {fmtPercent(econ.laborUtilization)}） · 失业 {econ.unemployment.toFixed(1)}%
      </Text>
      <Text dimColor>
        资源禀赋：{RESOURCE_IDS.map(id => `${RESOURCE_NAMES[id]} ${econ.resources[id]}`).join(' · ')}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="建筑与基础设施" />
        {BUILDING_IDS.map(id => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(BUILDINGS[id].name, 7)}</Text>
            <Text>{padEnd(fmtNumber(econ.buildings[id]), 7)}</Text>
            <Text dimColor wrap="wrap">{BUILDINGS[id].note}</Text>
          </Box>
        ))}
        <Text dimColor>基础设施 {Math.round(econ.transportInfrastructure)}/100 · 行政能力 {Math.round(econ.administrativeCapacity)} · 市场接入 {fmtPercent(econ.marketAccess)} · 失业 {econ.unemployment.toFixed(1)}%</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="国有建造队列"
          hint={
            stateQueue.length === 0
              ? '（空闲）'
              : `${stateQueue.length} 个项目 · 建造力 ${fmtNumber(load.capacity)}/月`
          }
        />
        <Text dimColor>
          建造能力 {fmtNumber(load.capacity)} 点/月 · 队列剩余工程量 {fmtNumber(load.requested)} · 已分配 {fmtNumber(load.allocated)} · 剩余 {fmtNumber(load.remaining)} · 每点造价 {CONSTRUCTION_COST_PER_POINT} 金
          {player.econ.lastConstructionRent > 0 ? ` · 私人租用 +${fmtMoney(player.econ.lastConstructionRent)}` : ''}
        </Text>
        {stateQueue.length === 0 ? (
          <Text dimColor>用「建造」下令；项目按队列顺序消耗建造点。</Text>
        ) : (
          stateQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>
                工程量 {fmtNumber(projectWorkload(project) * (1 - project.progress))}/{fmtNumber(projectWorkload(project))} 点 · 已完成 {Math.round(project.progress * 100)}% · 本月投入 {fmtNumber(load.byProject[project.id] ?? 0)} 点 · 预计 {schedule[project.id]?.turns ?? '—'} 回合 · 总造价 {constructionTotalCost(project).toFixed(1)} 金
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="私人建造"
          hint={
            privateQueue.length === 0
              ? '（无）'
              : `${privateQueue.length} 个项目 · 私人资本 ${fmtNumber(Math.max(0, econ.privateCapital))}`
          }
        />
        <Text dimColor>
          流转建造力：自有 {fmtNumber(load.privateOwn)} 点/月 · 租用国有 {fmtNumber(load.privateRented)} 点/月 · 市场 {fmtNumber(load.privateMarket)} 点/月 · 租金 {fmtMoney((load.privateRented + load.privateMarket) * CONSTRUCTION_RENT_PER_POINT)}
        </Text>
        {privateQueue.length === 0 ? (
          <Text dimColor>私人资本会自行投建，不占用国有建造点。</Text>
        ) : (
          privateQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text color="magenta">{padEnd('私人', 4)}</Text>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>工程量 {fmtNumber(projectWorkload(project) * (1 - project.progress))}/{fmtNumber(projectWorkload(project))} 点 · 进度 {Math.round(project.progress * 100)}% · 自有 {fmtNumber(load.privateByProject[project.id]?.own ?? 0)} · 租用 {fmtNumber(load.privateByProject[project.id]?.rented ?? 0)} 点/月 · 每月造价 {project.monthlyCost.toFixed(1)}金 · 私人出资</Text>
            </Box>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="官僚效能" hint={`行动预算 ${player.bureaucracy.actionBudget} 项/月`} />
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{padEnd('效能', 8)}</Text>
          <Text color="cyan">{padEnd(bar(player.bureaucracy.score, player.bureaucracy.ceiling, 14), 15)}</Text>
          <Text>{Math.round(player.bureaucracy.score)} / {Math.round(player.bureaucracy.ceiling)}</Text>
        </Box>
        <Text dimColor>资金效率 {fmtPercent(player.bureaucracy.fundEfficiency)} · 延迟概率 {fmtPercent(player.bureaucracy.delayChance)} · 信息失真 {fmtPercent(player.bureaucracy.infoDistortion)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="国库收支"
          hint={`本月结算 · 收入 ${fmtMoney(ledger.income.total)} · 支出 ${fmtMoney(ledger.expense.total)} · 净 ${fmtSigned(ledger.net)}`}
        />
        <Text dimColor>财政收入</Text>
        {([
          ['土地税', ledger.income.taxBases.land],
          ['企业税', ledger.income.taxBases.profit],
          ['消费税', ledger.income.taxBases.consumption],
          ['关税', ledger.income.taxBases.tariff],
          ['港口', ledger.income.ports],
          ['基金收益', ledger.income.sovereignIncome],
          ['赔款收入', ledger.income.reparations],
          ['其他（建造力出租）', ledger.income.other],
        ] as const).map(([name, value]) => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(name, 10)}</Text>
            <Text color="green">{padEnd(bar(value, Math.max(1, ledger.income.total), 10), 11)}</Text>
            <Text>{value.toFixed(1)}</Text>
          </Box>
        ))}
        <Text>
          收入合计 <Text color="green">{fmtMoney(ledger.income.total)}</Text>
          <Text dimColor>　税入（四税基） {fmtMoney(ledger.income.taxes)}　GDP 是产出不作税基</Text>
        </Text>

        <Text dimColor>财政支出</Text>
        {([
          ['陆军', ledger.expense.army],
          ['海军', ledger.expense.navy],
          ['行政', ledger.expense.administration],
          ['教育', ledger.expense.education],
          ['福利', ledger.expense.welfare],
          ['债息', ledger.expense.debtInterest],
          ['市场损耗', ledger.expense.marketLoss],
          ['设施维护', ledger.expense.upkeep],
          ['赔款支出', ledger.expense.reparations],
          ['国有建设', ledger.expense.construction],
          ['建设补贴', ledger.expense.constructionSubsidy],
        ] as const).map(([name, value]) => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(name, 10)}</Text>
            <Text color="red">{padEnd(bar(value, Math.max(1, ledger.expense.total), 10), 11)}</Text>
            <Text>{value.toFixed(1)}</Text>
          </Box>
        ))}
        <Text>
          支出合计 <Text color="red">{fmtMoney(ledger.expense.total)}</Text>
          <Text dimColor>　{ledger.debt > 0 ? `国债 ${fmtMoney(ledger.debt)}` : `主权基金 ${fmtMoney(ledger.fund)}`}</Text>
        </Text>
        <Text>
          国库净额 <Text color={ledger.net >= 0 ? 'green' : 'red'}>{fmtSigned(ledger.net)} 金/月</Text>
          <Text dimColor>　国债月息 {fmtPercent(ledger.debtRate, 2)} · 基金月息 {fmtPercent(ledger.fundRate, 2)}</Text>
        </Text>
        <Text dimColor>
          私人部门贸易逆差 {fmtMoney(ledger.tradeGap)}（由私人资本/私人外债 {fmtMoney(ledger.privateDebt)} 承担，不影响国库）；净资产实际变动 {fmtSigned(ledger.net)} 金/月
        </Text>
        <Text dimColor>GDP {fmtGdp(ledger.gdp)} 是产出（基期价），不是国库收支；国库只经手四税基税入、港口、基金收益与赔款。</Text>
        {(props.world.indemnities ?? [])
          .filter(
            schedule =>
              schedule.from === player.id || schedule.to === player.id,
          )
          .map(schedule => {
            const paying = schedule.from === player.id
            const otherId = paying ? schedule.to : schedule.from
            const other = props.world.countries[otherId]?.name ?? otherId
            return (
              <Text key={schedule.id} dimColor>
                赔款{paying ? '支出' : '收入'}：{paying ? '付给' : '收自'}
                {other} 每月 {fmtMoney(schedule.monthlyAmount)}，剩余{' '}
                {schedule.monthsLeft} 月（余 {fmtMoney(schedule.remaining)}）
              </Text>
            )
          })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="支出编制" hint="政策投入（每月上限，不等于本月实付）" />
        {Object.entries(econ.spending).map(([key, value]) => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(SPENDING[key as keyof typeof SPENDING].name, 8)}</Text>
            <Text color="cyan">{padEnd(bar(value, 10, 8), 9)}</Text>
            <Text>{value.toFixed(1)}</Text>
          </Box>
        ))}
        <Text dimColor>GDP {sparkline(econ.history.gdp, 20)}｜国库 {sparkline(econ.history.treasury, 20)}</Text>
        <Text dimColor>生活 {sparkline(econ.history.sol, 20)}｜合法性 {sparkline(econ.history.legitimacy, 20)}｜激进 {sparkline(econ.history.radicals, 20)}</Text>
      </Box>
    </Box>
  )
}
