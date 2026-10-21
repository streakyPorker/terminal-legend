import type { WorldState } from '../../types'
import { fmtDate, logKindMark } from '../format'
import { Heading, type UiKit } from './shared'

export function LogPanel(props: { ui: UiKit; world: WorldState }): any {
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
