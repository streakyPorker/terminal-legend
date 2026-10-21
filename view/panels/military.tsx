import type { WorldState } from '../../types'
import { bar, countryTag, fmtNumber, fmtPercent, padEnd } from '../format'
import { Heading, Meter, StatLine, playerOf, type UiKit } from './shared'

export function MilitaryPanel(props: { ui: UiKit; world: WorldState }): any {
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
