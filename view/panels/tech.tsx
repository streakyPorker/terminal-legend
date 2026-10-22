import type { ControlPayload, Country, TechNodeDef, WorldState } from '../../types'
import { TECH_NODES, canResearchNode, techNode, techNodeName, techTier } from '../../engine/data'
import { techDiffusionBonus, techSpillRate } from '../../engine/tech'
import { MODIFIER_STAT_NAMES } from '../../engine/modifiers'
import { bar, fmtNumber, fmtPercent, padEnd } from '../format'
import { Heading, StatLine, playerOf, type ControlAction, type UiKit } from './shared'

const BRANCH_LABELS: Record<TechNodeDef['branch'], string> = {
  general: '通用时代线',
  industry: '工业',
  admin: '行政',
  military: '军事',
}

/** A node's effects as one line: permanent modifiers and one-time stocks. */
function effectText(node: TechNodeDef): string {
  const text = node.effects
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
  return text === '' ? '无额外效果' : text
}

function prereqText(node: TechNodeDef): string {
  const parts: string[] = []
  if (node.prerequisites.length > 0) parts.push(node.prerequisites.map(techNodeName).join('＋'))
  if (node.requiresAnyBranch !== undefined) {
    parts.push(`任一分支 ${node.requiresAnyBranch} 项`)
  }
  return parts.length > 0 ? `前置：${parts.join('，')}` : '前置：无'
}

function statusOf(
  player: Country,
  node: TechNodeDef,
): { text: string; color: string | undefined } {
  const tech = player.tech
  if (tech.unlocked.includes(node.id)) return { text: '已解锁', color: 'green' }
  if (tech.researching === node.id) return { text: '进行中', color: 'yellow' }
  if (canResearchNode(tech, node)) return { text: '可研究', color: 'cyan' }
  return { text: '锁定', color: undefined }
}

function NodeCard(props: {
  ui: UiKit
  player: Country
  node: TechNodeDef
  onSelect: (id: string) => void
}): any {
  const { Box, Text, Button } = props.ui
  const { node, player } = props
  const status = statusOf(player, node)
  const progress = player.tech.nodes[node.id] ?? 0
  const canPick = status.text === '可研究'
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {canPick ? (
          <Button plain label={padEnd(node.name, 10)} onPress={() => props.onSelect(node.id)} />
        ) : (
          <Text color={status.color} wrap="truncate">{padEnd(node.name, 10)}</Text>
        )}
        <Text dimColor wrap="truncate">{padEnd(`时代${node.era}`, 5)}</Text>
        <Text dimColor wrap="truncate">{padEnd(`${node.cost}点`, 6)}</Text>
        <Text color={status.color}>{status.text}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1}>
        <Text color="cyan">{bar(progress, 1, 10)}</Text>
        <Text dimColor>{fmtPercent(progress)}</Text>
      </Box>
      <Text dimColor wrap="wrap">{effectText(node)}</Text>
      <Text dimColor wrap="wrap">{prereqText(node)}</Text>
    </Box>
  )
}

/**
 * The tech tree page (plan 0005 §5, K3): era / rate / current research / spill
 * and diffusion up top, then the general era line and the industry / admin /
 * military columns. A narrow terminal degrades the three branches to one
 * column. Picking a researchable node emits an `onControl('research')`; the
 * panel never writes world state directly.
 */
export function TechPanel(props: {
  ui: UiKit
  world: WorldState
  width: number
  onControl: (control: ControlAction, payload?: ControlPayload) => void
}): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const tech = player.tech
  const current = techNode(tech.researching)
  const progress = current === undefined ? 0 : tech.points / current.cost
  const spill = techSpillRate(player)
  const diffusion = techDiffusionBonus(props.world, player)
  const wide = props.width >= 96
  const onSelect = (id: string): void => props.onControl('research', { tech: id })

  const branch = (branchId: TechNodeDef['branch']): any => (
    <Box flexDirection="column" key={`branch:${branchId}`}>
      <Heading ui={props.ui} text={BRANCH_LABELS[branchId]} />
      {TECH_NODES.filter(node => node.branch === branchId).map(node => (
        <NodeCard
          key={node.id}
          ui={props.ui}
          player={player}
          node={node}
          onSelect={onSelect}
        />
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Heading
        ui={props.ui}
        text="科技"
        hint={`时代 ${tech.era}/4 · 已解锁 ${tech.unlocked.length}/${TECH_NODES.length}`}
      />
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>当前研究</Text>
        <Text color="cyan">{bar(progress, 1, 20)}</Text>
        <Text>
          {current === undefined ? '待选' : current.name} {fmtNumber(tech.points)} /{' '}
          {current === undefined ? '—' : fmtNumber(current.cost)}
        </Text>
      </Box>
      <StatLine ui={props.ui} label="月产出" value={`${fmtNumber(tech.pointsPerMonth)} 点`} />
      <StatLine ui={props.ui} label="跨分支溢出" value={fmtPercent(spill)} />
      <StatLine ui={props.ui} label="国际扩散" value={`+${fmtPercent(diffusion)}`} />
      <StatLine ui={props.ui} label="科技层级" value={techTier(tech).toFixed(2)} />

      <Box flexDirection="column" marginTop={1}>{branch('general')}</Box>
      <Box flexDirection={wide ? 'row' : 'column'} columnGap={4} marginTop={1}>
        {branch('industry')}
        {branch('admin')}
        {branch('military')}
      </Box>
    </Box>
  )
}
