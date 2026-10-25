import type { TabId } from '../../types'
import { countryTag, fmtDateLong, shortLeader } from '../format'
import { CouncilPanel } from './council'
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
import { playerOf, type PanelProps } from './shared'

const TABS: [TabId, string][] = [
  ['council', '御前'],
  ['overview', '概览'],
  ['rankings', '排名'],
  ['market', '市场'],
  ['economy', '经济'],
  ['pops', '人口'],
  ['diplomacy', '外交'],
  ['military', '军事'],
  ['tech', '科技'],
  ['events', '事件'],
  ['log', '日志'],
]

export function Panel(props: PanelProps): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)

  if (player === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>终末传奇</Text>
        <Text dimColor>还没有进行中的游戏。输入 /v3 new 开始，/v3 load 读取存档。</Text>
      </Box>
    )
  }

  let body: any
  switch (props.tab) {
    case 'council':
      body = (
        <CouncilPanel
          ui={props.ui}
          world={props.world}
          width={props.width}
          council={props.council}
          onEvent={props.onEvent}
          onCouncil={props.onCouncil}
          onControl={props.onControl}
        />
      )
      break
    case 'rankings':
      body = <RankingsPanel ui={props.ui} world={props.world} />
      break
    case 'market':
      body = <MarketPanel ui={props.ui} world={props.world} width={props.width} />
      break
    case 'economy':
      body = <EconomyPanel ui={props.ui} world={props.world} width={props.width} onControl={props.onControl} />
      break
    case 'pops':
      body = <PopsPanel ui={props.ui} world={props.world} />
      break
    case 'diplomacy':
      body = <DiplomacyPanel ui={props.ui} world={props.world} />
      break
    case 'military':
      body = <MilitaryPanel ui={props.ui} world={props.world} />
      break
    case 'tech':
      body = <TechPanel ui={props.ui} world={props.world} width={props.width} />
      break
    case 'events':
      body = <EventsPanel ui={props.ui} world={props.world} onEvent={props.onEvent} />
      break
    case 'log':
      body = <LogPanel ui={props.ui} world={props.world} />
      break
    default:
      body = <Overview ui={props.ui} world={props.world} width={props.width} />
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text weight="bold" color={player.color}>{countryTag(player)}</Text>
        <Text dimColor>
          {fmtDateLong(props.world.date)} · 第 {props.world.tick} 回合 · {props.council.isOpen ? '御前·待议' : '御前·已批'}
        </Text>
      </Box>
      <Text dimColor wrap="wrap">{shortLeader(player)} · {player.leader.persona}</Text>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        {TABS.map(([id, label]) => (
          <Button
            key={`tab:${id}`}
            {...(props.tab === id ? {} : { plain: true as const })}
            label={props.tab === id ? `▸${label}` : label}
            onPress={() => props.onTab(id)}
          />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">{body}</Box>

      <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        <Button key="ctl:approve" label="批准并推进一月" onPress={() => props.onCouncil('approve')} />
        <Button key="ctl:run" label={`托管 ${props.world.secretary.delegation.months} 月`} onPress={() => props.onCouncil('run')} />
        <Button key="ctl:recompose" label="重新拟旨" onPress={() => props.onCouncil('recompose')} />
        <Button key="ctl:save" label="保存" onPress={() => props.onControl('save')} />
      </Box>

      {props.notice !== '' ? <Text color="yellow" wrap="wrap">{props.notice}</Text> : null}
      <Text dimColor wrap="wrap">快捷键：/v3 next 批准推进｜/v3 run N 托管｜/v3 events 事件｜/v3 help</Text>
    </Box>
  )
}
