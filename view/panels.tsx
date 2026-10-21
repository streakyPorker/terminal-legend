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
  WAR_GOAL_NAMES,
  techCost,
  techName,
} from '../engine/data'
import {
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  inspectEconomy,
  projectWorkload,
} from '../engine/sim'
import { fiscalLedger, nationalDebt } from '../engine/fiscal'
import { MODIFIER_STAT_NAMES, describeModifier } from '../engine/modifiers'
import {
  OPIUM_CRISIS_TITLE,
  SITUATION_TIMEOUT_MONTHS,
  resultName,
  stanceSummary,
} from '../engine/situations'
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
  ['market', '市场'],
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
  const atWar = props.world.wars.some(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  const ledger = fiscalLedger(player, { atWar, tick: props.world.tick })
  const surplus = ledger.net
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
          <StatLine ui={props.ui} label="国库净资产" value={`${fmtMoney(econ.treasury)} (${fmtSigned(surplus)}金/月)`} color={surplus >= 0 ? 'green' : 'red'} />
          <StatLine ui={props.ui} label="收支" value={`收 ${fmtMoney(ledger.income.total)} · 支 ${fmtMoney(ledger.expense.total)}`} />
          <StatLine ui={props.ui} label={ledger.debt > 0 ? '国债' : '主权基金'} value={`${fmtMoney(ledger.debt > 0 ? ledger.debt : ledger.fund)} · 月息 ${((ledger.debt > 0 ? ledger.debtRate : ledger.fundRate) * 100).toFixed(2)}%`} color={ledger.debt > econ.gdp ? 'red' : ledger.debt > 0 ? 'yellow' : 'green'} />
          <StatLine ui={props.ui} label="GDP" value={`${fmtGdp(econ.gdp)} ${sparkline(econ.history.gdp, 12)} ${trend(econ.history.gdp)}`} />
          <StatLine ui={props.ui} label="GDP构成" value={`${fmtNumber(econ.gdpComponents.c)} 消费 + ${fmtNumber(econ.gdpComponents.i)} 投资 + ${fmtNumber(econ.gdpComponents.g)} 政府（金/月）`} />
          <StatLine ui={props.ui} label="私人资本" value={`${fmtNumber(econ.privateCapital)} 金 · 投资信心 ${econ.investmentConfidence >= 0 ? '+' : ''}${Math.round(econ.investmentConfidence)} 点`} />
          <StatLine ui={props.ui} label="税基税率" value={`土地 ${econ.taxes.land}% · 企业 ${econ.taxes.profit}% · 消费 ${econ.taxes.consumption}%  进口关税 ${econ.tariff}% / 出口关税 ${econ.exportTariff ?? econ.tariff}%`} />
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
            <Text dimColor wrap="wrap">{shortLeader(row.country)} · {moodLabel(row.country.leader.mood)}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="最新动态" />
        {props.world.log.slice(-5).map((entry, index) => (
          <Text key={`log:${index}`} dimColor wrap="wrap">
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
      <Text dimColor>高亮行为你扮演的国家。单位：金（净资产/GDP）、万（人口/陆军）、%（比率）。</Text>

      {table('经济', '按 GDP 排序', by(country => country.econ.gdp), [
        { label: 'GDP(金/月)', width: 12, value: country => fmtNumber(country.econ.gdp) },
        { label: '净资产(金)', width: 10, value: country => fmtNumber(country.econ.treasury) },
        { label: '收入(金/月)', width: 12, value: country => fmtNumber(country.econ.income) },
        { label: '国债(金)', width: 10, value: country => fmtNumber(nationalDebt(country)) },
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

type PartnerTotal = { id: string; imports: number; exports: number; total: number }

function partnerTotals(player: Country): PartnerTotal[] {
  const merged = new Map<string, { imports: number; exports: number }>()
  const add = (id: string, key: 'imports' | 'exports', value: number): void => {
    const entry = merged.get(id) ?? { imports: 0, exports: 0 }
    entry[key] += value
    merged.set(id, entry)
  }
  for (const flow of player.trade.imports) add(flow.from, 'imports', flow.value)
  for (const flow of player.trade.exports) add(flow.to, 'exports', flow.value)
  return Array.from(merged.entries())
    .map(([id, entry]) => ({
      id,
      imports: entry.imports,
      exports: entry.exports,
      total: entry.imports + entry.exports,
    }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function MarketPanel(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const snapshot = inspectEconomy(player)
  const econ = player.econ
  const widths = [7, 7, 8, 8, 7, 11]
  const tradeWidths = [12, 10, 10, 10]
  const partners = partnerTotals(player).slice(0, 6)
  const playerRoutes = props.world.tradeRoutes
    .filter(route => route.from === player.id || route.to === player.id)
    .sort((a, b) => b.lastQty - a.lastQty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 6)
  const opiumImports = player.trade.imports
    .filter(flow => flow.good === 'opium')
    .reduce((sum, flow) => sum + flow.quantity, 0)
  const opiumDemand = snapshot.demand.opium
  const opiumDependency = opiumDemand > 0 ? fmtPercent(opiumImports / opiumDemand) : '—'
  const importedResources = (['coal', 'iron', 'timber'] as const).map(id => ({
    name: RESOURCE_NAMES[id],
    value: econ.resourceImports[id] ?? 0,
  }))
  const resourceImportLine = importedResources.some(row => row.value > 0)
    ? `资源进口 ${importedResources.map(row => `${row.name} ${fmtNumber(row.value)}`).join(' · ')}`
    : '本月无资源进口'

  return (
    <Box flexDirection="column">
      <Box>
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
        <Heading ui={props.ui} text="对外贸易" hint="Top-6 伙伴 · 进口/出口值 · NX · 鸦片依存" />
        <Text dimColor>
          出口 {fmtMoney(player.trade.exportValue)} · 进口 {fmtMoney(player.trade.importValue)} · NX {fmtSigned(player.trade.nx)}金 {sparkline(player.trade.history.nx, 16)}
        </Text>
        {partners.length === 0 ? (
          <Text dimColor>本月暂无贸易往来。</Text>
        ) : (
          <Box flexDirection="column">
            <TableRow ui={props.ui} cells={['伙伴', '进口', '出口', '合计']} widths={tradeWidths} />
            {partners.map(row => {
              const partner = props.world.countries[row.id]
              return (
                <TableRow
                  ui={props.ui}
                  cells={[
                    partner !== undefined ? countryTag(partner) : row.id,
                    fmtNumber(row.imports),
                    fmtNumber(row.exports),
                    fmtNumber(row.total),
                  ]}
                  widths={tradeWidths}
                />
              )
            })}
          </Box>
        )}
        {playerRoutes.length > 0 ? (
          <Box flexDirection="column">
            <Text dimColor>贸易路线（等级 · 上月运量 · 进口方单位利差）</Text>
            {playerRoutes.map(route => (
              <Text dimColor key={route.id}>
                {GOODS[route.good].name} {route.from}→{route.to} · L{route.level} · {fmtNumber(route.lastQty)} · {fmtSigned(route.lastMargin)}金
              </Text>
            ))}
          </Box>
        ) : null}
        <Text dimColor>
          鸦片依存 进口 {fmtNumber(opiumImports)} / 需求 {fmtNumber(opiumDemand)}（{opiumDependency}）
        </Text>
        <Text dimColor>
          关税收入（进+出） {fmtMoney(econ.lastTariffRevenue)} · 贸易容量 {fmtNumber(player.trade.capacity)} · 贸易收支 {fmtSigned(econ.lastTradeBalance)}金
        </Text>
        <Text dimColor>{resourceImportLine}</Text>
      </Box>
    </Box>
  )
}

function EconomyPanel(props: { ui: UiKit; world: WorldState; width: number }): any {
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
        <Text dimColor>交通基础设施 {Math.round(econ.transportInfrastructure)} · 行政能力 {Math.round(econ.administrativeCapacity)} · 市场接入 {fmtPercent(econ.marketAccess)} · 失业 {econ.unemployment.toFixed(1)}%</Text>
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

/**
 * A compact situation card (plan 0004 §4.5): the title, each participant's
 * stance, the countdown while open, or the recorded result once resolved.
 * Reused by the council and diplomacy panels; no new tab or widget.
 */
function SituationCard(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  if (props.world.situations.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Heading ui={props.ui} text="局势" hint="提案 · 倒计时 · 结果" />
      {props.world.situations.map(situation => {
        const state = situation.resolved
          ? `已解决：${resultName(situation.resultId) || '—'}`
          : situation.months >= SITUATION_TIMEOUT_MONTHS
            ? '待仲裁'
            : `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
        return (
          <Box flexDirection="column" key={`situation:${situation.id}`}>
            <Text wrap="wrap">{`${OPIUM_CRISIS_TITLE} · ${state}`}</Text>
            <Text dimColor wrap="wrap">{stanceSummary(situation)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function DiplomacyPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const others = Object.values(props.world.countries)
    .filter(country => country.id !== player.id)
    .map(country => ({ country, value: Math.round(player.diplo.relations[country.id] ?? 0) }))
    .sort((a, b) => b.value - a.value)
  const tradePartners = partnerTotals(player).slice(0, 6)

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
            <Text dimColor wrap="wrap">{shortLeader(row.country)} · {moodLabel(row.country.leader.mood)}</Text>
          </Box>
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="贸易依赖" hint="Top-6 · 双边贸易额 · 伙伴依赖度" />
        {tradePartners.length === 0 ? (
          <Text dimColor>本月暂无贸易往来。</Text>
        ) : (
          tradePartners.map(row => {
            const partner = props.world.countries[row.id]
            const partnerTrade = partner !== undefined ? partner.trade.exportValue + partner.trade.importValue : 0
            const dependency = partnerTrade > 0 ? fmtPercent(row.total / partnerTrade) : '—'
            return (
              <Box flexDirection="row" columnGap={1}>
                <Text wrap="truncate">{padEnd(partner !== undefined ? countryTag(partner) : row.id, 12)}</Text>
                <Text>{padEnd(`往来 ${fmtNumber(row.total)}`, 11)}</Text>
                <Text dimColor>依赖 {padEnd(dependency, 6)}</Text>
              </Box>
            )
          })
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="禁运列表" hint="玩家施加 · 范围 · 剩余" />
        {player.embargoes.length === 0 ? (
          <Text dimColor>无禁运。</Text>
        ) : (
          player.embargoes.map(embargo => {
            const target = props.world.countries[embargo.target]
            const scope =
              embargo.goods === 'all'
                ? '全部商品'
                : embargo.goods.map(good => GOODS[good].name).join('、')
            const duration = embargo.months === undefined ? '永久' : `剩 ${embargo.months} 月`
            return (
              <Box flexDirection="row" columnGap={1}>
                <Text wrap="truncate">{padEnd(target !== undefined ? countryTag(target) : embargo.target, 12)}</Text>
                <Text wrap="truncate">{padEnd(scope, 22)}</Text>
                <Text dimColor>{duration}</Text>
              </Box>
            )
          })
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="贸易张力记录" hint="近 5 条 · 最新在前" />
        {props.world.tradeTensions.length === 0 ? (
          <Text dimColor>暂无贸易张力。</Text>
        ) : (
          props.world.tradeTensions
            .slice(-5)
            .reverse()
            .map(tension => {
              const from = props.world.countries[tension.from]
              const partner = props.world.countries[tension.partner]
              return (
                <Box flexDirection="row" columnGap={1}>
                  <Text wrap="truncate">{padEnd(from !== undefined ? countryTag(from) : tension.from, 10)}</Text>
                  <Text dimColor>→</Text>
                  <Text wrap="truncate">{padEnd(partner !== undefined ? countryTag(partner) : tension.partner, 10)}</Text>
                  <Text wrap="truncate">{padEnd(GOODS[tension.good].name, 6)}</Text>
                  <Text color={relationColor(tension.relationDelta)}>{padEnd(fmtSigned(tension.relationDelta), 6)}</Text>
                  <Text dimColor wrap="wrap">{tension.reason}</Text>
                </Box>
              )
            })
        )}
      </Box>

      <SituationCard ui={props.ui} world={props.world} />

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="领袖与议程" />
        {others.filter(row => row.country.isMajor).map(row => (
          <Text wrap="wrap">{[countryTag(row.country), ` ${row.country.leader.persona}`].join(' · ')}</Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="战争" />
        {props.world.wars.length === 0 ? (
          <Text dimColor>世界暂时和平。</Text>
        ) : (
          props.world.wars.map(war => (
            <Box flexDirection="column">
              <Text color="red" wrap="wrap">{war.name} · 第 {war.months} 月 · 目标{WAR_GOAL_NAMES[war.goal]}</Text>
              <Text dimColor wrap="wrap">{war.attackers.join(',')} vs {war.defenders.join(',')} · {war.lastEvent}</Text>
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
              <Text dimColor wrap="wrap">{war.reason}｜{war.lastEvent}</Text>
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
              <Text dimColor wrap="wrap">陆 {fmtNumber(country.military.army)} 海 {fmtNumber(country.military.navy)} 质 {fmtPercent(country.military.quality)}</Text>
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
              <Text dimColor wrap="wrap">{state} · 需要 {tech.cost} 点</Text>
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
          <Text wrap="wrap">{event.text}</Text>
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
            <Text dimColor wrap="wrap">{fmtDate(event.date)} {event.title} · {event.options.find(option => option.id === event.resolvedOption)?.label ?? ''}</Text>
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
        <Text key={`entry:${index}`} wrap="wrap">
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
  const load = constructionLoad(player)
  const schedule = constructionSchedule(player)
  const stateQueue = player.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') !== 'private',
  )
  const privateQueue = player.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
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
        <Heading
          ui={props.ui}
          text="本月月报"
          hint={reportLines.length > 0 ? '滚轮 / ↑↓ 查看完整' : undefined}
        />
        {reportLines.length === 0 ? (
          <Text dimColor>尚无月报。批准推进一月后生成。</Text>
        ) : (
          reportLines.map((line, index) => (
            <Text key={`council-report:${index}`} wrap="wrap">{line}</Text>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
      </Box>

      <SituationCard ui={props.ui} world={props.world} />

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="秘书报告"
          hint={
            props.council.secretaryReport === ''
              ? '（尚未呈报）'
              : '滚轮 / ↑↓ 查看完整'
          }
        />
        {props.council.secretaryReport === '' ? (
          <Text dimColor>秘书尚未呈报。点「重新拟旨」或在对话里让秘书拟旨。</Text>
        ) : (
          props.council.secretaryReport.split('\n').map((line, index) => (
            <Text key={`secretary:${index}`} wrap="wrap">{line}</Text>
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
            <Text key={`modifier:${modifier.id}`} wrap="wrap">
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
          <Text dimColor>没有国有在建项目。</Text>
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
              : `${privateQueue.length} 个项目 · 私人资本 ${fmtNumber(Math.max(0, player.econ.privateCapital))}`
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
    case 'market':
      body = <MarketPanel ui={props.ui} world={props.world} width={props.width} />
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
      <Text dimColor wrap="wrap">{shortLeader(player)} · {player.leader.persona}</Text>

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

      {props.notice !== '' ? <Text color="yellow" wrap="wrap">{props.notice}</Text> : null}
      <Text dimColor wrap="wrap">快捷键：/v3 next 批准推进｜/v3 run N 托管｜/v3 events 事件｜/v3 help</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- band

export function Band(props: BandProps): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>终末传奇：输入 /v3 new 开始一局。</Text>

  const econ = player.econ
  const atWar = props.world.wars.some(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  const ledger = fiscalLedger(player, { atWar, tick: props.world.tick })
  const surplus = ledger.net
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
        国库净资产 <Text color={surplus >= 0 ? 'green' : 'red'}>{fmtMoney(econ.treasury)}</Text>
        <Text dimColor>（{fmtSigned(surplus)}金/月）</Text>
      </Text>
      <Text>
        收支 <Text color="green">{fmtMoney(ledger.income.total)}</Text>
        <Text dimColor> / </Text>
        <Text color="red">{fmtMoney(ledger.expense.total)}</Text>
      </Text>
      <Text color={ledger.debt > 0 ? 'yellow' : 'green'}>
        {ledger.debt > 0 ? '国债' : '主权基金'} {fmtMoney(ledger.debt > 0 ? ledger.debt : ledger.fund)}
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
      <Text dimColor>最新动态（完整月报：/v3 council 打开御前面板，滚轮 / ↑↓ 查看）</Text>
      {recent.map((entry, index) => (
        <Text key={`report:${index}`} wrap="wrap">
          <Text dimColor>{fmtDate(entry.date)} </Text>
          <Text color={entry.kind === 'war' ? 'red' : entry.kind === 'tech' ? 'cyan' : undefined}>{logKindMark(entry.kind)}</Text>
          <Text> {entry.text}</Text>
        </Text>
      ))}
      {pending.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" weight="bold">待决事件</Text>
          {pending.map(event => (
            <Text wrap="wrap">◆ {event.title}：{event.text}</Text>
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
    case 'market':
      return <MarketPanel ui={props.ui} world={props.world} width={props.width} />
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
          <Text dimColor wrap="wrap">{props.text}</Text>
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
