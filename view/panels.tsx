import type { Elements } from 'claude-code'
import type { Country, CouncilState, GameEvent, TabId, WorldState } from '../types'
import {
  BUILDINGS,
  BUILDING_IDS,
  GOODS,
  GOOD_IDS,
  RESOURCE_IDS,
  RESOURCE_NAMES,
  SPENDING,
  TECHS,
  techCost,
  techName,
} from '../engine/data'
import { inspectEconomy } from '../engine/sim'
import { MODIFIER_STAT_NAMES, describeModifier } from '../engine/modifiers'
import {
  bar,
  clampText,
  countryTag,
  eventSummary,
  fmtDate,
  fmtDateLong,
  fmtGdp,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtPop,
  fmtSigned,
  legitimacyColor,
  logKindMark,
  moodLabel,
  padEnd,
  radicalColor,
  relationColor,
  shortLeader,
  sparkline,
  statusLine,
  trend,
} from './format'

export type UiKit = Pick<
  Elements['terminal'],
  'Box' | 'Text' | 'Button' | 'Link' | 'Code' | 'Markdown'
>

export type ControlAction = 'next' | 'save' | 'council'

export type CouncilAction =
  | 'approve'
  | 'run'
  | 'recompose'
  | 'delegate-internal'
  | 'delegate-diplomacy'
  | 'months'

export type CouncilHandlers = {
  council: CouncilState
  onCouncil: (action: CouncilAction, value?: number) => void
}

export type PanelProps = {
  ui: UiKit
  world: WorldState
  width: number
  tab: TabId
  notice: string
  onTab: (tab: TabId) => void
  onControl: (control: ControlAction) => void
  onEvent: (eventId: string, optionId: string) => void
} & CouncilHandlers

export type BandProps = {
  ui: UiKit
  world: WorldState
  width: number
  maxRows: number
  onControl: (control: ControlAction) => void
} & CouncilHandlers

export type ReportProps = {
  ui: UiKit
  world: WorldState
  width: number
  args: string
  text: string
  onEvent: (eventId: string, optionId: string) => void
}

const TABS: [TabId, string][] = [
  ['council', '御前'],
  ['overview', '概览'],
  ['rankings', '排名'],
  ['economy', '经济'],
  ['pops', '人口'],
  ['diplomacy', '外交'],
  ['military', '军事'],
  ['tech', '科技'],
  ['events', '事件'],
  ['log', '日志'],
]

const playerOf = (world: WorldState): Country | undefined => world.countries[world.playerId]

function Heading(props: { ui: UiKit; text: string; hint?: string }): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text weight="bold">{props.text}</Text>
      {props.hint !== undefined ? <Text dimColor>{props.hint}</Text> : null}
    </Box>
  )
}

function StatLine(props: {
  ui: UiKit
  label: string
  value: string
  color?: string
  width?: number
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{padEnd(props.label, props.width ?? 8)}</Text>
      <Text color={props.color}>{props.value}</Text>
    </Box>
  )
}

function Meter(props: {
  ui: UiKit
  label: string
  value: number
  max: number
  color?: string
  width?: number
  suffix?: string
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{padEnd(props.label, 8)}</Text>
      <Text color={props.color}>{bar(props.value, props.max, props.width ?? 12)}</Text>
      <Text>{props.suffix ?? `${Math.round(props.value)}`}</Text>
    </Box>
  )
}

function TableRow(props: {
  ui: UiKit
  cells: string[]
  widths: number[]
  colors?: (string | undefined)[]
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row">
      {props.cells.map((cell, index) => (
        <Text color={props.colors?.[index]} wrap="truncate">
          {padEnd(cell, props.widths[index] ?? 8)}
        </Text>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- overview

function Overview(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const econ = player.econ
  const surplus = econ.income - econ.expense - econ.lastDebtRepayment
  const sideBySide = props.width >= 74
  const majors = Object.values(props.world.countries)
    .filter(country => country.isMajor && !country.isPlayer)
    .map(country => ({
      country,
      value: Math.round(player.diplo.relations[country.id] ?? 0),
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <Box flexDirection="column">
      <Box flexDirection={sideBySide ? 'row' : 'column'} columnGap={4}>
        <Box flexDirection="column">
          <Heading ui={props.ui} text="经济" />
          <StatLine ui={props.ui} label="国库" value={`${fmtMoney(econ.treasury)} (${fmtSigned(surplus)}金/月)`} color={surplus >= 0 ? 'green' : 'red'} />
          <StatLine ui={props.ui} label="GDP" value={`${fmtGdp(econ.gdp)} ${sparkline(econ.history.gdp, 12)} ${trend(econ.history.gdp)}`} />
          <StatLine ui={props.ui} label="GDP构成" value={`${fmtNumber(econ.gdpComponents.c)} 消费 + ${fmtNumber(econ.gdpComponents.i)} 投资 + ${fmtNumber(econ.gdpComponents.g)} 政府（金/月）`} />
          <StatLine ui={props.ui} label="私人资本" value={`${fmtNumber(econ.privateCapital)} 金 · 投资信心 ${econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(econ.investmentConfidence)} 点`} />
          <StatLine ui={props.ui} label="债务" value={fmtMoney(econ.debt)} color={econ.debt > econ.gdp ? 'red' : undefined} />
          <StatLine ui={props.ui} label="税率" value={`${econ.taxRate}%  关税 ${econ.tariff}%`} />
          <StatLine ui={props.ui} label="物价" value={GOOD_IDS.slice(0, 5).map(id => `${GOODS[id].name}${econ.prices[id].toFixed(1)}`).join(' ')} />
          <Meter ui={props.ui} label="生活水平" value={player.pops.sol} max={100} color="cyan" />
          <Meter ui={props.ui} label="合法性" value={player.government.legitimacy} max={100} color={legitimacyColor(player.government.legitimacy)} />
          <Meter ui={props.ui} label="激进" value={player.pops.radicals} max={100} color={radicalColor(player.pops.radicals)} />
        </Box>

        <Box flexDirection="column">
          <Heading ui={props.ui} text="社会与军力" />
          <StatLine ui={props.ui} label="人口" value={`${fmtNumber(player.pops.total)} 万`} />
          <StatLine ui={props.ui} label="识字率" value={fmtPercent(player.pops.literacy)} />
          <StatLine ui={props.ui} label="陆军" value={`${fmtNumber(player.military.army)} 万  士气 ${Math.round(player.military.morale)}`} />
          <StatLine ui={props.ui} label="海军" value={`${fmtNumber(player.military.navy)} 艘  人力 ${fmtNumber(player.military.manpower)}`} />
          <StatLine ui={props.ui} label="科技" value={`${player.tech.level} · ${techName(player.tech.level)}`} />
          <StatLine ui={props.ui} label="研究" value={`${player.tech.researching} (${fmtNumber(player.tech.pointsPerMonth)}/月)`} />
          <StatLine ui={props.ui} label="威望" value={String(Math.round(player.diplo.prestige))} />
          <StatLine ui={props.ui} label="战争" value={props.world.wars.length === 0 ? '无' : props.world.wars.map(war => war.name).join('，')} color={props.world.wars.length > 0 ? 'red' : undefined} />
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="列强关系" hint="（对玩家）" />
        {majors.map(row => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(countryTag(row.country), 12)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(bar(row.value + 100, 200, 10), 11)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(`${row.value >= 0 ? '+' : ''}${row.value}`, 5)}</Text>
            <Text dimColor wrap="truncate">{shortLeader(row.country)} · {moodLabel(row.country.leader.mood)}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="最新动态" />
        {props.world.log.slice(-5).map((entry, index) => (
          <Text key={`log:${index}`} dimColor wrap="truncate">
            {fmtDate(entry.date)} {logKindMark(entry.kind)} {entry.text}
          </Text>
        ))}
      </Box>

      {pendingOf(props.world).length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" weight="bold">
            待决事件：{pendingOf(props.world).map(event => event.title).join('、')}（/v3 events 查看）
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

function pendingOf(world: WorldState): GameEvent[] {
  return world.events.filter(event => event.countryId === world.playerId && !event.isResolved)
}

// ---------------------------------------------------------------- rankings

type RankColumn = {
  label: string
  width: number
  value: (country: Country) => string
}

function RankingsPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  const all = Object.values(props.world.countries)
  const majors = all.filter(country => country.isMajor)
  const countries = majors.length >= 3 ? majors : all
  const by = (key: (country: Country) => number): Country[] =>
    [...countries].sort((a, b) => key(b) - key(a))
  const playerColor = player?.color ?? 'cyan'

  const table = (
    title: string,
    hint: string,
    rows: Country[],
    columns: RankColumn[],
  ): any => {
    const widths = [14, ...columns.map(column => column.width)]
    return (
      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text={title} hint={hint} />
        <TableRow
          ui={props.ui}
          cells={['国家', ...columns.map(column => column.label)]}
          widths={widths}
        />
        {rows.map(country => (
          <TableRow
            ui={props.ui}
            cells={[
              countryTag(country),
              ...columns.map(column => column.value(country)),
            ]}
            widths={widths}
            colors={[country.isPlayer ? playerColor : undefined]}
          />
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="列强排名" hint={`${countries.length} 国 · 各维度从高到低`} />
      <Text dimColor>高亮行为你扮演的国家。单位：金（国库/GDP）、万（人口/陆军）、%（比率）。</Text>

      {table('经济', '按 GDP 排序', by(country => country.econ.gdp), [
        { label: 'GDP(金/月)', width: 12, value: country => fmtNumber(country.econ.gdp) },
        { label: '国库(金)', width: 10, value: country => fmtNumber(country.econ.treasury) },
        { label: '收入(金/月)', width: 12, value: country => fmtNumber(country.econ.income) },
        { label: '债务(金)', width: 10, value: country => fmtNumber(country.econ.debt) },
      ])}

      {table('人口与社会', '按人口排序', by(country => country.pops.total), [
        { label: '人口', width: 10, value: country => fmtPop(country.pops.total) },
        { label: '识字率', width: 8, value: country => fmtPercent(country.pops.literacy) },
        { label: '生活水平', width: 8, value: country => String(Math.round(country.pops.sol)) },
        { label: '失业', width: 8, value: country => `${country.econ.unemployment.toFixed(1)}%` },
        { label: '激进', width: 6, value: country => String(Math.round(country.pops.radicals)) },
      ])}

      {table('军事', '按陆军战力排序', by(country => country.military.army * country.military.quality), [
        { label: '陆军(万)', width: 10, value: country => fmtNumber(country.military.army) },
        { label: '海军', width: 8, value: country => fmtNumber(country.military.navy) },
        { label: '士气', width: 6, value: country => String(Math.round(country.military.morale)) },
        { label: '陆军战力', width: 10, value: country => fmtNumber(country.military.army * country.military.quality) },
      ])}

      {table('科技与行政', '按科技等级排序', by(country => country.tech.level), [
        { label: '科技', width: 7, value: country => `${country.tech.level} 级` },
        { label: '官僚效能', width: 10, value: country => `${Math.round(country.bureaucracy.score)}/${Math.round(country.bureaucracy.ceiling)}` },
        { label: '合法性', width: 7, value: country => String(Math.round(country.government.legitimacy)) },
        { label: '权威', width: 6, value: country => String(Math.round(country.government.authority)) },
      ])}

      {table('外交与威望', '按威望排序', by(country => country.diplo.prestige), [
        { label: '威望', width: 6, value: country => String(Math.round(country.diplo.prestige)) },
        { label: '恶名', width: 6, value: country => String(Math.round(country.diplo.infamy)) },
        { label: '盟友', width: 6, value: country => String(country.diplo.alliances.length) },
        { label: '对手', width: 6, value: country => String(country.diplo.rivals.length) },
        { label: '战争', width: 6, value: country => String(props.world.wars.filter(war => war.attackers.includes(country.id) || war.defenders.includes(country.id)).length) },
      ])}
    </Box>
  )
}

// ---------------------------------------------------------------- economy

function EconomyPanel(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const snapshot = inspectEconomy(player)
  const econ = player.econ
  const components = econ.gdpComponents
  const widths = [7, 7, 8, 8, 7, 11]

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

      <Box marginTop={1}>
        <Heading ui={props.ui} text="商品市场" hint="价格 · 产出 · 需求 · 资源乘数 · 供需" />
      </Box>
      <TableRow ui={props.ui} cells={['商品', '价格', '产出', '需求', '乘数', '状态']} widths={widths} />
      {GOOD_IDS.map(id => {
        const production = snapshot.production[id]
        const demand = snapshot.demand[id]
        const ratio = demand <= 0 ? 2 : production / demand
        const state = ratio >= 1.15 ? '盈余' : ratio >= 0.9 ? '平衡' : '短缺'
        const color = state === '短缺' ? 'red' : state === '盈余' ? 'green' : 'yellow'
        return (
          <TableRow
            ui={props.ui}
            cells={[
              GOODS[id].name,
              econ.prices[id].toFixed(1),
              fmtNumber(production),
              fmtNumber(demand),
              snapshot.resources[id].toFixed(2),
              `${state} ${bar(Math.min(ratio, 1.5), 1.5, 6)}`,
            ]}
            widths={widths}
            colors={[undefined, undefined, undefined, undefined, undefined, color]}
          />
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="建筑与基础设施" />
        {BUILDING_IDS.map(id => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(BUILDINGS[id].name, 7)}</Text>
            <Text>{padEnd(fmtNumber(econ.buildings[id]), 7)}</Text>
            <Text dimColor wrap="truncate">{BUILDINGS[id].note}</Text>
          </Box>
        ))}
        <Text dimColor>交通基础设施 {Math.round(econ.transportInfrastructure)} · 行政能力 {Math.round(econ.administrativeCapacity)} · 市场接入 {fmtPercent(econ.marketAccess)} · 失业 {econ.unemployment.toFixed(1)}%</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="建造队列" hint={econ.constructionQueue.length === 0 ? '（空闲）' : `${econ.constructionQueue.length} 个项目 · 队列不可取消`} />
        {econ.constructionQueue.length === 0 ? (
          <Text dimColor>用「建造」下令，项目按工期与建设预算逐月推进。</Text>
        ) : (
          econ.constructionQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text color={project.owner === 'private' ? 'magenta' : undefined}>
                {padEnd(project.owner === 'private' ? '私人' : '国有', 4)}
              </Text>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>
                剩余 {project.monthsLeft} 月 · 每月 {project.monthlyCost.toFixed(1)}金
                {project.owner === 'private' ? ' · 私人出资' : ''}
              </Text>
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
        <Heading ui={props.ui} text="财政" hint={`收入 ${fmtMoney(econ.income)}/月 · 支出 ${fmtMoney(econ.expense)}/月 · 债务 ${fmtMoney(econ.debt)}`} />
        {Object.entries(econ.spending).map(([key, value]) => (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(SPENDING[key as keyof typeof SPENDING].name, 6)}</Text>
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

// ---------------------------------------------------------------- pops

function PopsPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const pops = player.pops
  const strata: [string, number][] = [
    ['农民', pops.peasants],
    ['工人', pops.workers],
    ['手工业者', pops.artisans],
    ['教士', pops.clergy],
    ['贵族', pops.aristocrats],
    ['资本家', pops.capitalists],
  ]

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="人口结构" hint={`总人口 ${fmtNumber(pops.total)} 万`} />
      {strata.map(([name, value]) => (
        <Box flexDirection="row" columnGap={1}>
          <Text wrap="truncate">{padEnd(name, 8)}</Text>
          <Text color="cyan">{padEnd(bar(value, pops.total, 14), 15)}</Text>
          <Text wrap="truncate">{padEnd(fmtNumber(value), 8)}</Text>
          <Text dimColor>{(value / Math.max(1, pops.total) * 100).toFixed(1)}%</Text>
        </Box>
      ))}
      <Box flexDirection="column" marginTop={1}>
        <Meter ui={props.ui} label="生活水平" value={pops.sol} max={100} color="cyan" width={16} />
        <Meter ui={props.ui} label="识字率" value={pops.literacy * 100} max={100} color="yellow" width={16} suffix={fmtPercent(pops.literacy)} />
        <Meter ui={props.ui} label="激进" value={pops.radicals} max={100} color={radicalColor(pops.radicals)} width={16} />
        <Meter ui={props.ui} label="忠诚" value={pops.loyalists} max={100} color="green" width={16} />
        <Text dimColor>月人口增长 {(pops.growth * 100).toFixed(2)}% · 失业 {player.econ.unemployment}% · 识字提升靠教育与大学</Text>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- diplomacy

function DiplomacyPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const others = Object.values(props.world.countries)
    .filter(country => country.id !== player.id)
    .map(country => ({ country, value: Math.round(player.diplo.relations[country.id] ?? 0) }))
    .sort((a, b) => b.value - a.value)

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="外交关系" hint={`威望 ${Math.round(player.diplo.prestige)} · 恶名 ${Math.round(player.diplo.infamy)}`} />
      {others.map(row => {
        const war = props.world.wars.find(
          one =>
            (one.attackers.includes(player.id) && one.defenders.includes(row.country.id)) ||
            (one.defenders.includes(player.id) && one.attackers.includes(row.country.id)),
        )
        const marks = [
          war !== undefined ? '战' : '',
          player.diplo.alliances.includes(row.country.id) ? '盟' : '',
          player.diplo.rivals.includes(row.country.id) ? '敌' : '',
        ].filter(mark => mark !== '').join('')
        return (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(countryTag(row.country), 12)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(bar(row.value + 100, 200, 10), 11)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(`${row.value >= 0 ? '+' : ''}${row.value}`, 5)}</Text>
            <Text color={marks === '战' ? 'red' : 'yellow'}>{padEnd(marks, 3)}</Text>
            <Text dimColor wrap="truncate">{shortLeader(row.country)} · {moodLabel(row.country.leader.mood)}</Text>
          </Box>
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="领袖与议程" />
        {others.filter(row => row.country.isMajor).map(row => (
          <Text wrap="truncate">{[countryTag(row.country), ` ${row.country.leader.persona}`].join(' · ')}</Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="战争" />
        {props.world.wars.length === 0 ? (
          <Text dimColor>世界暂时和平。</Text>
        ) : (
          props.world.wars.map(war => (
            <Box flexDirection="column">
              <Text color="red" wrap="truncate">{war.name} · 第 {war.months} 月</Text>
              <Text dimColor wrap="truncate">{war.attackers.join(',')} vs {war.defenders.join(',')} · {war.lastEvent}</Text>
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>战争分数</Text>
                <Text color={war.warScore >= 0 ? 'red' : 'cyan'}>{padEnd(bar(war.warScore + 100, 200, 16), 17)}</Text>
                <Text>{Math.round(war.warScore)}</Text>
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- military

function MilitaryPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const military = player.military
  const wars = props.world.wars.filter(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="武装力量" />
      <StatLine ui={props.ui} label="陆军" value={`${fmtNumber(military.army)} 万 · 质量 ${fmtPercent(military.quality)}`} />
      <Meter ui={props.ui} label="士气" value={military.morale} max={100} color="green" width={18} />
      <Meter ui={props.ui} label="战争疲劳" value={military.exhaustion} max={100} color="red" width={18} />
      <StatLine ui={props.ui} label="海军" value={`${fmtNumber(military.navy)} 艘`} />
      <StatLine ui={props.ui} label="人力池" value={fmtNumber(military.manpower)} />
      <StatLine ui={props.ui} label="军费" value={`${fmtNumber(player.econ.spending.army)} / 月`} />
      <Text dimColor>征兵与军费可通过 /v3 action conscript 或 /v3 action spending 调整。</Text>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="战事" />
        {wars.length === 0 ? (
          <Text dimColor>当前没有战争。</Text>
        ) : (
          wars.map(war => (
            <Box flexDirection="column">
              <Text color="red">{war.name} · 分数 {Math.round(war.warScore)} · {war.battles} 次交锋</Text>
              <Text dimColor wrap="truncate">{war.reason}｜{war.lastEvent}</Text>
            </Box>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="列强军力对比" />
        {Object.values(props.world.countries)
          .filter(country => country.isMajor)
          .sort((a, b) => b.military.army * b.military.quality - a.military.army * a.military.quality)
          .map(country => (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate">{padEnd(countryTag(country), 12)}</Text>
              <Text color={country.isPlayer ? 'cyan' : undefined}>{padEnd(bar(country.military.army * country.military.quality, 130, 12), 13)}</Text>
              <Text dimColor wrap="truncate">陆 {fmtNumber(country.military.army)} 海 {fmtNumber(country.military.navy)} 质 {fmtPercent(country.military.quality)}</Text>
            </Box>
          ))}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- tech

function TechPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const nextCost = techCost(player.tech.level + 1)
  const progress = nextCost <= 0 ? 1 : player.tech.points / nextCost

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="科技" hint={`${player.tech.level} · ${techName(player.tech.level)}`} />
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>下一级</Text>
        <Text color="cyan">{padEnd(bar(progress, 1, 20), 21)}</Text>
        <Text>{fmtNumber(player.tech.points)} / {fmtNumber(nextCost)}</Text>
      </Box>
      <StatLine ui={props.ui} label="研究" value={player.tech.researching} />
      <StatLine ui={props.ui} label="月产出" value={`${fmtNumber(player.tech.pointsPerMonth)} 点`} />
      <StatLine ui={props.ui} label="大学" value={String(player.econ.buildings.universities)} />
      <StatLine ui={props.ui} label="识字率" value={fmtPercent(player.pops.literacy)} />
      <StatLine ui={props.ui} label="教育支出" value={player.econ.spending.education.toFixed(1)} />

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="科技路线" />
        {TECHS.map(tech => {
          const state = tech.level <= player.tech.level ? '已解锁' : tech.level === player.tech.level + 1 ? '下一项' : '未解锁'
          const color = tech.level <= player.tech.level ? 'green' : tech.level === player.tech.level + 1 ? 'yellow' : undefined
          return (
            <Box flexDirection="row" columnGap={1}>
              <Text color={color}>{padEnd(`${tech.level}`, 3)}</Text>
              <Text color={color}>{padEnd(tech.name, 10)}</Text>
              <Text dimColor wrap="truncate">{state} · 需要 {tech.cost} 点</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- events

function EventsPanel(props: {
  ui: UiKit
  world: WorldState
  onEvent: (eventId: string, optionId: string) => void
}): any {
  const { Box, Text, Button } = props.ui
  const pending = pendingOf(props.world)
  const player = playerOf(props.world)
  const resolved = props.world.events
    .filter(event => event.countryId === props.world.playerId && event.isResolved)
    .slice(-5)

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="待决事件" hint={pending.length === 0 ? '（无）' : `（${pending.length}）`} />
      {pending.length === 0 ? <Text dimColor>风平浪静。用 /v3 next 推进时间等待新事件。</Text> : null}
      {pending.map(event => (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" weight="bold">{event.title}</Text>
          <Text wrap="truncate">{event.text}</Text>
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {event.options.map(option => (
              <Button
                key={`ev:${event.id}:${option.id}`}
                label={option.label}
                onPress={() => props.onEvent(event.id, option.id)}
              />
            ))}
          </Box>
        </Box>
      ))}

      {player !== undefined && resolved.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Heading ui={props.ui} text="最近处理" />
          {resolved.map(event => (
            <Text dimColor wrap="truncate">{fmtDate(event.date)} {event.title} · {event.options.find(option => option.id === event.resolvedOption)?.label ?? ''}</Text>
          ))}
        </Box>
      ) : null}
      <Text dimColor>也可以用自然语言让 Claude 抉择，例如「开仓赈济」。</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- log

function LogPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="编年史" hint={`${props.world.log.length} 条记录`} />
      {props.world.log.slice(-22).map((entry, index) => (
        <Text key={`entry:${index}`} wrap="truncate">
          <Text dimColor>{fmtDate(entry.date)} </Text>
          <Text color={entry.kind === 'war' ? 'red' : entry.kind === 'tech' ? 'cyan' : undefined}>
            {logKindMark(entry.kind)}
          </Text>
          <Text> {entry.text}</Text>
        </Text>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- council

function CouncilPanel(props: {
  ui: UiKit
  world: WorldState
  width: number
  council: CouncilState
  onEvent: (eventId: string, optionId: string) => void
  onCouncil: (action: CouncilAction, value?: number) => void
}): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const delegation = props.world.secretary.delegation
  const bureaucracy = player.bureaucracy
  const reportLines = props.council.report.split('\n').filter(line => line !== '')
  const months = [1, 3, 6, 12]

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Heading ui={props.ui} text="御前会议" />
        <Text color={props.council.isOpen ? 'yellow' : 'green'} weight="bold">
          {props.council.isOpen ? '· 待议' : '· 已批'}
        </Text>
        {props.world.secretary.isRunning ? (
          <Text dimColor>秘书拟旨中…</Text>
        ) : props.council.isRunning ? (
          <Text dimColor>托管推进中…</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="本月月报" />
        {reportLines.length === 0 ? (
          <Text dimColor>尚无月报。批准推进一月后生成。</Text>
        ) : (
          reportLines.map((line, index) => (
            <Text key={`council-report:${index}`} wrap="truncate">{line}</Text>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="秘书报告" hint={props.world.secretary.lastRunTick === 0 ? '（尚未呈报）' : undefined} />
        {props.council.secretaryReport === '' ? (
          <Text dimColor>秘书尚未呈报。点「重新拟旨」或在对话里让秘书拟旨。</Text>
        ) : (
          props.council.secretaryReport.split('\n').map((line, index) => (
            <Text key={`secretary:${index}`} wrap="truncate">{line}</Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="官僚效能" hint={`行动预算 ${bureaucracy.actionBudget} 项/月`} />
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{padEnd('效能', 8)}</Text>
          <Text color="cyan">{padEnd(bar(bureaucracy.score, bureaucracy.ceiling, 14), 15)}</Text>
          <Text>{Math.round(bureaucracy.score)} / {Math.round(bureaucracy.ceiling)}</Text>
        </Box>
        <Text dimColor>
          资金效率 {fmtPercent(bureaucracy.fundEfficiency)} · 延迟 {fmtPercent(bureaucracy.delayChance)} · 失真 {fmtPercent(bureaucracy.infoDistortion)}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="国策修正" hint={player.modifiers.length === 0 ? '（无）' : `${player.modifiers.length} 项`} />
        {player.modifiers.length === 0 ? (
          <Text dimColor>没有生效中的增益或减益。</Text>
        ) : (
          player.modifiers.slice(-12).map(modifier => (
            <Text key={`modifier:${modifier.id}`} wrap="truncate">
              {describeModifier(modifier)} <Text dimColor>· {MODIFIER_STAT_NAMES[modifier.stat]} · {modifier.source}</Text>
            </Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="委托" hint={`托管 ${delegation.months} 月`} />
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Button
            key="council:internal"
            label={`内政委托：${delegation.internal ? '开' : '关'}`}
            onPress={() => props.onCouncil('delegate-internal')}
          />
          <Button
            key="council:diplomacy"
            label={`外交委托：${delegation.diplomacy ? '开' : '关'}`}
            onPress={() => props.onCouncil('delegate-diplomacy')}
          />
        </Box>
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Text dimColor>托管月数</Text>
          {months.map(one => (
            <Button
              key={`council:months:${one}`}
              label={one === delegation.months ? `▸${one} 月` : `${one} 月`}
              onPress={() => props.onCouncil('months', one)}
            />
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        <Button key="council:approve" label="批准并推进一月" onPress={() => props.onCouncil('approve')} />
        <Button key="council:run" label={`托管 ${delegation.months} 月`} onPress={() => props.onCouncil('run')} />
        <Button key="council:recompose" label="重新拟旨" onPress={() => props.onCouncil('recompose')} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="建造队列" hint={player.econ.constructionQueue.length === 0 ? '（空闲）' : '队列不可取消'} />
        {player.econ.constructionQueue.length === 0 ? (
          <Text dimColor>没有在建项目。</Text>
        ) : (
          player.econ.constructionQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text color={project.owner === 'private' ? 'magenta' : undefined}>
                {padEnd(project.owner === 'private' ? '私人' : '国有', 4)}
              </Text>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>
                剩余 {project.monthsLeft} 月 · 每月 {project.monthlyCost.toFixed(1)}金 ·{' '}
                {project.owner === 'private'
                  ? '私人出资'
                  : `资金效率 ${fmtPercent(bureaucracy.fundEfficiency)}`}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- panel

export function Panel(props: PanelProps): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)

  if (player === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>终末传奇</Text>
        <Text dimColor>还没有进行中的游戏。输入 /v3 new 开始，/v3 load 读取存档。</Text>
      </Box>
    )
  }

  let body: any
  switch (props.tab) {
    case 'council':
      body = (
        <CouncilPanel
          ui={props.ui}
          world={props.world}
          width={props.width}
          council={props.council}
          onEvent={props.onEvent}
          onCouncil={props.onCouncil}
        />
      )
      break
    case 'rankings':
      body = <RankingsPanel ui={props.ui} world={props.world} />
      break
    case 'economy':
      body = <EconomyPanel ui={props.ui} world={props.world} width={props.width} />
      break
    case 'pops':
      body = <PopsPanel ui={props.ui} world={props.world} />
      break
    case 'diplomacy':
      body = <DiplomacyPanel ui={props.ui} world={props.world} />
      break
    case 'military':
      body = <MilitaryPanel ui={props.ui} world={props.world} />
      break
    case 'tech':
      body = <TechPanel ui={props.ui} world={props.world} />
      break
    case 'events':
      body = <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
      break
    case 'log':
      body = <LogPanel ui={props.ui} world={props.world} />
      break
    default:
      body = <Overview ui={props.ui} world={props.world} width={props.width} />
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text weight="bold" color={player.color}>{countryTag(player)}</Text>
        <Text dimColor>
          {fmtDateLong(props.world.date)} · 第 {props.world.tick} 回合 · {props.council.isOpen ? '御前·待议' : '御前·已批'}
        </Text>
      </Box>
      <Text dimColor wrap="truncate">{shortLeader(player)} · {player.leader.persona}</Text>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        {TABS.map(([id, label]) => (
          <Button
            key={`tab:${id}`}
            {...(props.tab === id ? {} : { plain: true as const })}
            label={props.tab === id ? `▸${label}` : label}
            onPress={() => props.onTab(id)}
          />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">{body}</Box>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        <Button key="ctl:approve" label="批准并推进一月" onPress={() => props.onCouncil('approve')} />
        <Button key="ctl:run" label={`托管 ${props.world.secretary.delegation.months} 月`} onPress={() => props.onCouncil('run')} />
        <Button key="ctl:recompose" label="重新拟旨" onPress={() => props.onCouncil('recompose')} />
        <Button key="ctl:save" label="保存" onPress={() => props.onControl('save')} />
      </Box>

      {props.notice !== '' ? <Text color="yellow" wrap="truncate">{props.notice}</Text> : null}
      <Text dimColor wrap="truncate">快捷键：/v3 next 批准推进｜/v3 run N 托管｜/v3 events 事件｜/v3 help</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- band

export function Band(props: BandProps): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>终末传奇：输入 /v3 new 开始一局。</Text>

  const econ = player.econ
  const surplus = econ.income - econ.expense - econ.lastDebtRepayment
  const pending = pendingOf(props.world)
  const delegation = props.world.secretary.delegation
  const majors = Object.values(props.world.countries)
    .filter(country => country.isMajor && !country.isPlayer)
    .map(country => ({ country, value: Math.round(player.diplo.relations[country.id] ?? 0) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
  const latest = props.world.log[props.world.log.length - 1]

  const rows: any[] = []
  if (props.council.isOpen) {
    rows.push(
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color="yellow" weight="bold">御前会议 · 待议</Text>
        <Button key="band:approve" label="批准并推进" onPress={() => props.onCouncil('approve')} />
        <Button key="band:run" label={`托管 ${delegation.months} 月`} onPress={() => props.onCouncil('run')} />
        <Button key="band:council" label="打开议事" onPress={() => props.onControl('council')} />
      </Box>,
    )
  }
  rows.push(
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text color={player.color} weight="bold">{countryTag(player)}</Text>
      <Text dimColor>{shortLeader(player)}</Text>
      <Text dimColor>{fmtDateLong(props.world.date)}</Text>
      <Text>第 {props.world.tick} 回合</Text>
      <Text color={props.council.isOpen ? 'yellow' : 'cyan'}>
        {props.council.isOpen ? '御前·待议' : '御前·已批'}
      </Text>
    </Box>,
  )
  rows.push(
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text>
        国库 <Text color={surplus >= 0 ? 'green' : 'red'}>{fmtMoney(econ.treasury)}</Text>
        <Text dimColor>（{fmtSigned(surplus)}金/月）</Text>
      </Text>
      <Text>
        国内生产总值 <Text>{fmtGdp(econ.gdp)}</Text>
        <Text color="cyan"> 近月 {sparkline(econ.history.gdp, 8)}</Text>
      </Text>
      <Text>
        合法性 <Text color={legitimacyColor(player.government.legitimacy)}>{Math.round(player.government.legitimacy)}</Text>
      </Text>
      <Text>
        激进 <Text color={radicalColor(player.pops.radicals)}>{Math.round(player.pops.radicals)}</Text>
      </Text>
      <Text>生活水平 {Math.round(player.pops.sol)}</Text>
    </Box>,
  )
  rows.push(
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text>人口 {fmtPop(player.pops.total)}</Text>
      <Text>识字率 {fmtPercent(player.pops.literacy)}</Text>
      <Text>陆军 {fmtPop(player.military.army)}</Text>
      <Text>海军 {fmtNumber(player.military.navy)} 艘</Text>
      <Text>
        科技 {player.tech.level} 级
        <Text dimColor>（{techName(player.tech.level)}）</Text>
      </Text>
      <Text dimColor>研究中：{player.tech.researching}</Text>
    </Box>,
  )
  rows.push(
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text dimColor>列强关系</Text>
      {majors.map(row => (
        <Text color={relationColor(row.value)}>
          [{row.country.flag}] {row.country.name} {row.value >= 0 ? '+' : ''}{row.value}
        </Text>
      ))}
      {props.world.wars.length > 0
        ? <Text color="red">战争 ×{props.world.wars.length}</Text>
        : <Text dimColor>天下太平</Text>}
    </Box>,
  )
  if (pending.length > 0) {
    rows.push(
      <Text color="yellow" wrap="truncate">◆ 待决：{pending.map(event => event.title).join('、')} — /v3 events</Text>,
    )
  } else if (latest !== undefined) {
    rows.push(
      <Text dimColor wrap="truncate">{logKindMark(latest.kind)} {latest.text}</Text>,
    )
  }
  rows.push(
    <Box flexDirection="row" columnGap={1}>
      <Button key="band:next" label="推进一月" onPress={() => props.onControl('next')} />
      <Button key="band:council" label="御前" onPress={() => props.onControl('council')} />
      <Button key="band:save" label="保存" onPress={() => props.onControl('save')} />
      <Text dimColor>/v3 panel 打开详情</Text>
    </Box>,
  )

  const room = Math.max(1, props.maxRows)
  return <Box flexDirection="column">{rows.slice(0, room)}</Box>
}

// ---------------------------------------------------------------- command output

function TurnReport(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const recent = props.world.log.slice(-10)
  const pending = pendingOf(props.world)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text weight="bold">回合报告</Text>
        <Text dimColor>{statusLine(props.world)}</Text>
      </Box>
      <Text dimColor wrap="truncate">最新动态</Text>
      {recent.map((entry, index) => (
        <Text key={`report:${index}`} wrap="truncate">
          <Text dimColor>{fmtDate(entry.date)} </Text>
          <Text color={entry.kind === 'war' ? 'red' : entry.kind === 'tech' ? 'cyan' : undefined}>{logKindMark(entry.kind)}</Text>
          <Text> {entry.text}</Text>
        </Text>
      ))}
      {pending.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" weight="bold">待决事件</Text>
          {pending.map(event => (
            <Text wrap="truncate">◆ {event.title}：{event.text}</Text>
          ))}
          <Text dimColor>输入 /v3 events 选择，或直接告诉 Claude 你的决定。</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Overview ui={props.ui} world={props.world} width={props.width} />
      </Box>
    </Box>
  )
}

export function Report(props: ReportProps): any {
  const { Box, Text } = props.ui
  const first = props.args.trim().split(/\s+/)[0] ?? ''
  const player = playerOf(props.world)

  if (player === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>终末传奇</Text>
        <Text dimColor>{props.text}</Text>
      </Box>
    )
  }

  switch (first) {
    case 'next':
    case 'advance':
      return <TurnReport ui={props.ui} world={props.world} width={props.width} />
    case 'events':
      return <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
    case 'rankings':
    case 'rank':
      return <RankingsPanel ui={props.ui} world={props.world} />
    case 'economy':
      return <EconomyPanel ui={props.ui} world={props.world} width={props.width} />
    case 'pops':
      return <PopsPanel ui={props.ui} world={props.world} />
    case 'diplomacy':
      return <DiplomacyPanel ui={props.ui} world={props.world} />
    case 'military':
      return <MilitaryPanel ui={props.ui} world={props.world} />
    case 'tech':
      return <TechPanel ui={props.ui} world={props.world} />
    case 'log':
      return <LogPanel ui={props.ui} world={props.world} />
    default:
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate">{props.text}</Text>
          <Box marginTop={1}>
            <Overview ui={props.ui} world={props.world} width={props.width} />
          </Box>
        </Box>
      )
  }
}

export function PanePlaceholder(props: { ui: UiKit; text: string }): any {
  const { Box, Text } = props.ui
  return <Box flexDirection="column"><Text dimColor>{props.text}</Text></Box>
}

export function helpText(): string {
  return [
    '终末传奇 · 命令',
    '/v3 new [国家]        开一局新游戏（默认大清）',
    '/v3 status            查看当前状态',
    '/v3 next              批准并推进一月',
    '/v3 run [月数]        后台托管 N 月，遇事件/战争/越权即中断',
    '/v3 council           打开御前议事',
    '/v3 rankings          查看列强经济/人口/军事/科技/外交排名',
    '/v3 secretary         让秘书拟旨（报告稍后呈上）',
    '/v3 delegate internal|diplomacy on|off  切换委托',
    '/v3 panel             打开完整面板',
    '/v3 events            查看待决事件',
    '/v3 resolve <事件> <选项>  处理事件',
    '/v3 play <国家>       切换扮演国家',
    '/v3 cheat <天命> ...  天命：treasury/techPoints/building/relations/warScore/date/event/leader',
    '/v3 ironman on|off    铁人模式（仅开局第一个月，禁天命与多存档）',
    '/v3 save [名字]       保存',
    '/v3 load [名字]       读取',
    '/v3 end               结束本局',
    '/v3 help              本帮助',
    '',
    '也可以直接用自然语言：告诉 Claude 你要建工厂、加税、结盟或宣战。',
  ].join('\n')
}

export { eventSummary, clampText }
