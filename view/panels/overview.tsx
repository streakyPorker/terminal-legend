import type { WorldState } from '../../types'
import { GOODS, GOOD_IDS, techName } from '../../engine/data'
import { fiscalLedger } from '../../engine/fiscal'
import {
  bar,
  countryTag,
  fmtDate,
  fmtGdp,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  legitimacyColor,
  logKindMark,
  moodLabel,
  padEnd,
  radicalColor,
  relationColor,
  shortLeader,
  sparkline,
  trend,
} from '../format'
import { Heading, Meter, StatLine, pendingOf, playerOf, type UiKit } from './shared'

export function Overview(props: { ui: UiKit; world: WorldState; width: number }): any {
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
