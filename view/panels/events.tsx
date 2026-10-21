import type { WorldState } from '../../types'
import { fmtDate } from '../format'
import { Heading, pendingOf, playerOf, type UiKit } from './shared'

export function EventsPanel(props: {
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
