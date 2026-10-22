import type { TechNodeDef, WorldState } from '../../types'
import { TECH_NODES, canResearchNode, techNode, techTier } from '../../engine/data'
import { MODIFIER_STAT_NAMES } from '../../engine/modifiers'
import { bar, fmtNumber, fmtPercent, padEnd } from '../format'
import { Heading, StatLine, playerOf, type UiKit } from './shared'

function effectText(node: TechNodeDef): string {
  return node.effects
    .map(effect => {
      if (effect.kind === 'immediate') {
        return Object.entries(effect)
          .filter(([key, value]) => key !== 'kind' && typeof value === 'number')
          .map(([key, value]) => `${key}${(value as number) >= 0 ? '+' : ''}${value}`)
          .join(' ')
      }
      return `${MODIFIER_STAT_NAMES[effect.stat]}${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}`
    })
    .join('，')
}

function nodeState(id: string, player: ReturnType<typeof playerOf>): { text: string; color?: string } {
  if (player === undefined) return { text: '' }
  const tech = player.tech
  if (tech.unlocked.includes(id)) return { text: '已解锁', color: 'green' }
  if (tech.researching === id) return { text: '进行中', color: 'yellow' }
  const node = techNode(id)
  if (node !== undefined && canResearchNode(tech, node)) return { text: '可研究', color: 'cyan' }
  return { text: '锁定' }
}

export function TechPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const tech = player.tech
  const current = techNode(tech.researching)
  const nextCost = current?.cost ?? 0
  const progress = nextCost <= 0 ? 0 : tech.points / nextCost

  const branchRows = (branch: TechNodeDef['branch']): any =>
    TECH_NODES.filter(node => node.branch === branch).map(node => {
      const state = nodeState(node.id, player)
      return (
        <Box flexDirection="row" columnGap={1} key={`node:${node.id}`}>
          <Text color={state.color} wrap="truncate">{padEnd(`时代${node.era}`, 5)}</Text>
          <Text color={state.color} wrap="truncate">{padEnd(node.name, 10)}</Text>
          <Text dimColor wrap="truncate">{padEnd(`${node.cost}点`, 6)}</Text>
          <Text color={state.color} wrap="truncate">{padEnd(state.text, 6)}</Text>
          <Text dimColor wrap="truncate">{effectText(node)}</Text>
        </Box>
      )
    })

  return (
    <Box flexDirection="column">
      <Heading
        ui={props.ui}
        text="科技"
        hint={`时代 ${tech.era}/4 · 已解锁 ${tech.unlocked.length}/${TECH_NODES.length}`}
      />
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>当前研究</Text>
        <Text color="cyan">{padEnd(bar(progress, 1, 20), 21)}</Text>
        <Text>
          {tech.researching === '' ? '待选' : techNode(tech.researching)?.name ?? tech.researching}{' '}
          {fmtNumber(tech.points)} / {nextCost > 0 ? fmtNumber(nextCost) : '—'}
        </Text>
      </Box>
      <StatLine ui={props.ui} label="月产出" value={`${fmtNumber(tech.pointsPerMonth)} 点`} />
      <StatLine ui={props.ui} label="科技层级" value={techTier(tech).toFixed(2)} />
      <StatLine ui={props.ui} label="大学" value={String(player.econ.buildings.universities)} />
      <StatLine ui={props.ui} label="识字率" value={fmtPercent(player.pops.literacy)} />
      <StatLine ui={props.ui} label="教育支出" value={player.econ.spending.education.toFixed(1)} />

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="通用时代线" />
        {branchRows('general')}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="工业" />
        {branchRows('industry')}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="行政" />
        {branchRows('admin')}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="军事" />
        {branchRows('military')}
      </Box>
    </Box>
  )
}
