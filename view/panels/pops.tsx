import type { WorldState } from '../../types'
import { bar, fmtNumber, fmtPercent, padEnd, radicalColor } from '../format'
import { Heading, Meter, playerOf, type UiKit } from './shared'

export function PopsPanel(props: { ui: UiKit; world: WorldState }): any {
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
