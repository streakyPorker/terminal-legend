import type { WorldState } from '../../types'
import { TECHS, techCost, techName } from '../../engine/data'
import { bar, fmtNumber, fmtPercent, padEnd } from '../format'
import { Heading, StatLine, playerOf, type UiKit } from './shared'

export function TechPanel(props: { ui: UiKit; world: WorldState }): any {
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
