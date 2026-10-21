import type { CouncilState, WorldState } from '../../types'
import { BUILDINGS } from '../../engine/data'
import {
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  projectWorkload,
} from '../../engine/sim'
import { MODIFIER_STAT_NAMES, describeModifier } from '../../engine/modifiers'
import { bar, fmtMoney, fmtNumber, fmtPercent, fmtSigned, padEnd } from '../format'
import { EventsPanel } from './events'
import {
  Heading,
  SituationCard,
  playerOf,
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
}): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const delegation = props.world.secretary.delegation
  const bureaucracy = player.bureaucracy
  const load = constructionLoad(player)
  const schedule = constructionSchedule(player)
  const stateQueue = player.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') !== 'private',
  )
  const privateQueue = player.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
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

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="国有建造队列"
          hint={
            stateQueue.length === 0
              ? '（空闲）'
              : `${stateQueue.length} 个项目 · 建造力 ${fmtNumber(load.capacity)}/月`
          }
        />
        <Text dimColor>
          建造能力 {fmtNumber(load.capacity)} 点/月 · 队列剩余工程量 {fmtNumber(load.requested)} · 已分配 {fmtNumber(load.allocated)} · 剩余 {fmtNumber(load.remaining)} · 每点造价 {CONSTRUCTION_COST_PER_POINT} 金
          {player.econ.lastConstructionRent > 0 ? ` · 私人租用 +${fmtMoney(player.econ.lastConstructionRent)}` : ''}
        </Text>
        {stateQueue.length === 0 ? (
          <Text dimColor>没有国有在建项目。</Text>
        ) : (
          stateQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>
                工程量 {fmtNumber(projectWorkload(project) * (1 - project.progress))}/{fmtNumber(projectWorkload(project))} 点 · 已完成 {Math.round(project.progress * 100)}% · 本月投入 {fmtNumber(load.byProject[project.id] ?? 0)} 点 · 预计 {schedule[project.id]?.turns ?? '—'} 回合 · 总造价 {constructionTotalCost(project).toFixed(1)} 金
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="私人建造"
          hint={
            privateQueue.length === 0
              ? '（无）'
              : `${privateQueue.length} 个项目 · 私人资本 ${fmtNumber(Math.max(0, player.econ.privateCapital))}`
          }
        />
        <Text dimColor>
          流转建造力：自有 {fmtNumber(load.privateOwn)} 点/月 · 租用国有 {fmtNumber(load.privateRented)} 点/月 · 市场 {fmtNumber(load.privateMarket)} 点/月 · 租金 {fmtMoney((load.privateRented + load.privateMarket) * CONSTRUCTION_RENT_PER_POINT)}
        </Text>
        {privateQueue.length === 0 ? (
          <Text dimColor>私人资本会自行投建，不占用国有建造点。</Text>
        ) : (
          privateQueue.map(project => (
            <Box flexDirection="row" columnGap={1}>
              <Text color="magenta">{padEnd('私人', 4)}</Text>
              <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
              <Text color="cyan">{padEnd(bar(project.progress, 1, 10), 11)}</Text>
              <Text dimColor>工程量 {fmtNumber(projectWorkload(project) * (1 - project.progress))}/{fmtNumber(projectWorkload(project))} 点 · 进度 {Math.round(project.progress * 100)}% · 自有 {fmtNumber(load.privateByProject[project.id]?.own ?? 0)} · 租用 {fmtNumber(load.privateByProject[project.id]?.rented ?? 0)} 点/月 · 每月造价 {project.monthlyCost.toFixed(1)}金 · 私人出资</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}
