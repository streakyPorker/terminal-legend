import type { CouncilState, WorldState } from '../../types'
import { MODIFIER_STAT_NAMES, describeModifier } from '../../engine/modifiers'
import { bar, fmtPercent, padEnd } from '../format'
import { ConstructionPanel } from './construction'
import { EventsPanel } from './events'
import {
  Heading,
  SituationCard,
  playerOf,
  type ControlAction,
  type ControlPayload,
  type CouncilAction,
  type UiKit,
} from './shared'

export function CouncilPanel(props: {
  ui: UiKit
  world: WorldState
  width: number
  council: CouncilState
  onEvent: (eventId: string, optionId: string) => void
  onCouncil: (action: CouncilAction, value?: number) => void
  onControl: (control: ControlAction, payload?: ControlPayload) => void
}): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const delegation = props.world.secretary.delegation
  const bureaucracy = player.bureaucracy
  const reportLines = props.council.report.split('\n').filter(line => line !== '')
  const months = [1, 3, 6, 12]

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Heading ui={props.ui} text="御前会议" />
        <Text color={props.council.isOpen ? 'yellow' : 'green'} weight="bold">
          {props.council.isOpen ? '· 待议' : '· 已批'}
        </Text>
        {props.world.secretary.isRunning ? (
          <Text dimColor>秘书拟旨中…</Text>
        ) : props.council.isRunning ? (
          <Text dimColor>托管推进中…</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="本月月报"
          hint={reportLines.length > 0 ? '滚轮 / ↑↓ 查看完整' : undefined}
        />
        {reportLines.length === 0 ? (
          <Text dimColor>尚无月报。批准推进一月后生成。</Text>
        ) : (
          reportLines.map((line, index) => (
            <Text key={`council-report:${index}`} wrap="wrap">{line}</Text>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
      </Box>

      <SituationCard ui={props.ui} world={props.world} />

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="秘书报告"
          hint={
            props.council.secretaryReport === ''
              ? '（尚未呈报）'
              : '滚轮 / ↑↓ 查看完整'
          }
        />
        {props.council.secretaryReport === '' ? (
          <Text dimColor>秘书尚未呈报。点「重新拟旨」或在对话里让秘书拟旨。</Text>
        ) : (
          props.council.secretaryReport.split('\n').map((line, index) => (
            <Text key={`secretary:${index}`} wrap="wrap">{line}</Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="官僚效能" hint={`行动预算 ${bureaucracy.actionBudget} 项/月`} />
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{padEnd('效能', 8)}</Text>
          <Text color="cyan">{padEnd(bar(bureaucracy.score, bureaucracy.ceiling, 14), 15)}</Text>
          <Text>{Math.round(bureaucracy.score)} / {Math.round(bureaucracy.ceiling)}</Text>
        </Box>
        <Text dimColor>
          资金效率 {fmtPercent(bureaucracy.fundEfficiency)} · 延迟 {fmtPercent(bureaucracy.delayChance)} · 失真 {fmtPercent(bureaucracy.infoDistortion)}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="国策修正" hint={player.modifiers.length === 0 ? '（无）' : `${player.modifiers.length} 项`} />
        {player.modifiers.length === 0 ? (
          <Text dimColor>没有生效中的增益或减益。</Text>
        ) : (
          player.modifiers.slice(-12).map(modifier => (
            <Text key={`modifier:${modifier.id}`} wrap="wrap">
              {describeModifier(modifier)} <Text dimColor>· {MODIFIER_STAT_NAMES[modifier.stat]} · {modifier.source}</Text>
            </Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="委托" hint={`托管 ${delegation.months} 月`} />
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Button
            key="council:internal"
            label={`内政委托：${delegation.internal ? '开' : '关'}`}
            onPress={() => props.onCouncil('delegate-internal')}
          />
          <Button
            key="council:diplomacy"
            label={`外交委托：${delegation.diplomacy ? '开' : '关'}`}
            onPress={() => props.onCouncil('delegate-diplomacy')}
          />
        </Box>
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Text dimColor>托管月数</Text>
          {months.map(one => (
            <Button
              key={`council:months:${one}`}
              label={one === delegation.months ? `▸${one} 月` : `${one} 月`}
              onPress={() => props.onCouncil('months', one)}
            />
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        <Button key="council:approve" label="批准并推进一月" onPress={() => props.onCouncil('approve')} />
        <Button key="council:run" label={`托管 ${delegation.months} 月`} onPress={() => props.onCouncil('run')} />
        <Button key="council:recompose" label="重新拟旨" onPress={() => props.onCouncil('recompose')} />
      </Box>

      <ConstructionPanel ui={props.ui} world={props.world} width={props.width} onControl={props.onControl} />
    </Box>
  )
}
