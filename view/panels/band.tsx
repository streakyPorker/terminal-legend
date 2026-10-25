import { techNodeName } from '../../engine/data'
import { fiscalLedger } from '../../engine/fiscal'
import {
  countryTag,
  fmtDateLong,
  fmtGdp,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  fmtPop,
  fmtSigned,
  legitimacyColor,
  logKindMark,
  radicalColor,
  relationColor,
  shortLeader,
  sparkline,
} from '../format'
import { pendingOf, playerOf, type BandProps, type UiKit } from './shared'

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
        <Button key="band:open-council" label="打开议事" onPress={() => props.onControl('council')} />
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
        科技 时代 {player.tech.era} · 已解锁 {player.tech.unlocked.length} 项
      </Text>
      <Text dimColor>
        研究中：{player.tech.researching === '' ? '待选' : techNodeName(player.tech.researching)}
      </Text>
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
