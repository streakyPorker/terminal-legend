import type { WorldState } from '../../types'
import { fmtDate, logKindMark, statusLine } from '../format'
import { DiplomacyPanel } from './diplomacy'
import { EconomyPanel } from './economy'
import { EventsPanel } from './events'
import { LogPanel } from './log'
import { MarketPanel } from './market'
import { MilitaryPanel } from './military'
import { Overview } from './overview'
import { PopsPanel } from './pops'
import { RankingsPanel } from './rankings'
import { TechPanel } from './tech'
import { pendingOf, playerOf, type ReportProps, type UiKit } from './shared'

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
