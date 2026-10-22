import type { Elements } from 'claude-code'
import type {
  ControlAction,
  ControlPayload,
  CouncilAction,
  Country,
  CouncilState,
  GameEvent,
  TabId,
  WorldState,
} from '../../types'
import {
  OPIUM_CRISIS_TITLE,
  SITUATION_TIMEOUT_MONTHS,
  resultName,
  stanceSummary,
} from '../../engine/situations'
import { bar, padEnd } from '../format'

export type UiKit = Pick<
  Elements['terminal'],
  'Box' | 'Text' | 'Button' | 'Link' | 'Code' | 'Markdown'
>

// Re-exported (not redefined) so existing importers keep resolving these names.
export type { ControlAction, ControlPayload, CouncilAction }

export type CouncilHandlers = {
  council: CouncilState
  onCouncil: (action: CouncilAction, value?: number) => void
}

export type PanelProps = {
  ui: UiKit
  world: WorldState
  width: number
  tab: TabId
  notice: string
  onTab: (tab: TabId) => void
  onControl: (control: ControlAction, payload?: ControlPayload) => void
  onEvent: (eventId: string, optionId: string) => void
} & CouncilHandlers

export type BandProps = {
  ui: UiKit
  world: WorldState
  width: number
  maxRows: number
  onControl: (control: ControlAction, payload?: ControlPayload) => void
} & CouncilHandlers

export type ReportProps = {
  ui: UiKit
  world: WorldState
  width: number
  args: string
  text: string
  onEvent: (eventId: string, optionId: string) => void
}

export const playerOf = (world: WorldState): Country | undefined => world.countries[world.playerId]

export function Heading(props: { ui: UiKit; text: string; hint?: string }): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text weight="bold">{props.text}</Text>
      {props.hint !== undefined ? <Text dimColor>{props.hint}</Text> : null}
    </Box>
  )
}

export function StatLine(props: {
  ui: UiKit
  label: string
  value: string
  color?: string
  width?: number
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{padEnd(props.label, props.width ?? 8)}</Text>
      <Text color={props.color}>{props.value}</Text>
    </Box>
  )
}

export function Meter(props: {
  ui: UiKit
  label: string
  value: number
  max: number
  color?: string
  width?: number
  suffix?: string
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{padEnd(props.label, 8)}</Text>
      <Text color={props.color}>{bar(props.value, props.max, props.width ?? 12)}</Text>
      <Text>{props.suffix ?? `${Math.round(props.value)}`}</Text>
    </Box>
  )
}

export function TableRow(props: {
  ui: UiKit
  cells: string[]
  widths: number[]
  colors?: (string | undefined)[]
}): any {
  const { Box, Text } = props.ui
  return (
    <Box flexDirection="row">
      {props.cells.map((cell, index) => (
        <Text color={props.colors?.[index]} wrap="truncate">
          {padEnd(cell, props.widths[index] ?? 8)}
        </Text>
      ))}
    </Box>
  )
}

export function pendingOf(world: WorldState): GameEvent[] {
  return world.events.filter(event => event.countryId === world.playerId && !event.isResolved)
}

export type PartnerTotal = { id: string; imports: number; exports: number; total: number }

export function partnerTotals(player: Country): PartnerTotal[] {
  const merged = new Map<string, { imports: number; exports: number }>()
  const add = (id: string, key: 'imports' | 'exports', value: number): void => {
    const entry = merged.get(id) ?? { imports: 0, exports: 0 }
    entry[key] += value
    merged.set(id, entry)
  }
  for (const flow of player.trade.imports) add(flow.from, 'imports', flow.value)
  for (const flow of player.trade.exports) add(flow.to, 'exports', flow.value)
  return Array.from(merged.entries())
    .map(([id, entry]) => ({
      id,
      imports: entry.imports,
      exports: entry.exports,
      total: entry.imports + entry.exports,
    }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * A compact situation card (plan 0004 §4.5): the title, each participant's
 * stance, the countdown while open, or the recorded result once resolved.
 * Reused by the council and diplomacy panels; no new tab or widget.
 */
export function SituationCard(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  if (props.world.situations.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Heading ui={props.ui} text="局势" hint="提案 · 倒计时 · 结果" />
      {props.world.situations.map(situation => {
        const state = situation.resolved
          ? `已解决：${resultName(situation.resultId) || '—'}`
          : situation.months >= SITUATION_TIMEOUT_MONTHS
            ? '待仲裁'
            : `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
        return (
          <Box flexDirection="column" key={`situation:${situation.id}`}>
            <Text wrap="wrap">{`${OPIUM_CRISIS_TITLE} · ${state}`}</Text>
            <Text dimColor wrap="wrap">{stanceSummary(situation)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export function PanePlaceholder(props: { ui: UiKit; text: string }): any {
  const { Box, Text } = props.ui
  return <Box flexDirection="column"><Text dimColor>{props.text}</Text></Box>
}

export function helpText(): string {
  return [
    '终末传奇 · 命令',
    '/v3 new [国家]        开一局新游戏（默认大清）',
    '/v3 status            查看当前状态',
    '/v3 next              批准并推进一月',
    '/v3 run [月数]        后台托管 N 月，遇事件/战争/越权即中断',
    '/v3 stop              停止托管（本月推进结束后停下）',
    '/v3 council           打开御前议事',
    '/v3 rankings          查看列强经济/人口/军事/科技/外交排名',
    '/v3 secretary         让秘书拟旨（报告稍后呈上）',
    '/v3 delegate internal|diplomacy on|off  切换委托',
    '/v3 panel             打开完整面板',
    '　建造面板：x*y 下单（每槽座数 × 槽位数）、取消、插队/重排',
    '/v3 events            查看待决事件',
    '/v3 resolve <事件> <选项>  处理事件',
    '/v3 play <国家>       切换扮演国家',
    '/v3 cheat <天命> ...  天命：treasury/techPoints/building/relations/warScore/date/event/leader',
    '/v3 ironman on|off    铁人模式（仅开局第一个月，禁天命与多存档）',
    '/v3 save [名字]       保存',
    '/v3 load [名字]       读取',
    '/v3 end               结束本局',
    '/v3 help              本帮助',
    '',
    '也可以直接用自然语言：告诉 Claude 你要建工厂、加税、结盟或宣战。',
  ].join('\n')
}
