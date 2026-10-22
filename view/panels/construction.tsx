import type { BuildingId, ControlPayload, WorldState } from '../../types'
import { BUILDINGS, BUILDING_IDS, INFRA_BUILDING_IDS } from '../../engine/data'
import {
  CAPACITY_COST,
  CONSTRUCTION_COST_PER_POINT,
  CONSTRUCTION_RENT_PER_POINT,
  WORKLOAD_MULTIPLIER,
  constructionLoad,
  constructionSchedule,
  constructionTotalCost,
  projectWorkload,
} from '../../engine/sim'
import { bar, fmtMoney, fmtNumber, padEnd } from '../format'
import { Heading, playerOf, type ControlAction, type UiKit } from './shared'

/**
 * The construction panel (plan 0013): the buildable-building roster with `x*y`
 * order buttons, plus the queue where every entry exposes its id and carries
 * cancel / move-up / move-down / move-to-head controls. Shared by the council
 * and economy panels so the build surface is one implementation (resolves
 * PT-037 at the UI level). View-only: it never mutates world state, it only
 * emits `onControl` payloads.
 */
export type ConstructionPanelProps = {
  ui: UiKit
  world: WorldState
  width: number
  onControl: (control: ControlAction, payload?: ControlPayload) => void
}

type BuildingGroup = { label: string; ids: BuildingId[] }

const BUILDING_GROUPS: BuildingGroup[] = [
  { label: '采掘', ids: ['farms', 'coalMines', 'ironMines', 'lumberMills'] },
  { label: '轻工', ids: ['textileMills', 'furnitureWorks', 'distilleries', 'luxuryWorks'] },
  { label: '重工', ids: ['machineryWorks', 'steelMills'] },
  { label: '服务', ids: ['schools', 'universities', 'offices'] },
  { label: '军事', ids: ['arsenals', 'barracks', 'forts', 'navalYards'] },
  { label: '基建', ids: [...INFRA_BUILDING_IDS, 'workshops'] },
]

/** Groups the full roster so a new building type can never drop out of the list. */
function buildingGroups(): BuildingGroup[] {
  const grouped = new Set<BuildingId>(BUILDING_GROUPS.flatMap(group => group.ids))
  const rest = BUILDING_IDS.filter(id => !grouped.has(id))
  return rest.length > 0 ? [...BUILDING_GROUPS, { label: '其他', ids: rest }] : BUILDING_GROUPS
}

export function ConstructionPanel(props: ConstructionPanelProps): any {
  const { Box, Text, Button } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const econ = player.econ
  const load = constructionLoad(player)
  const schedule = constructionSchedule(player)
  const queue = econ.constructionQueue
  const stateQueue = queue.filter(project => (project.owner ?? 'state') !== 'private')

  return (
    <Box flexDirection="column">
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
          {econ.lastConstructionRent > 0 ? ` · 私人租用 +${fmtMoney(econ.lastConstructionRent)}` : ''}
        </Text>
        <Text dimColor>
          新单默认入队尾，「⇤1×1」插入队首；私人项目可见、不可取消 · 私人流转建造力 自有 {fmtNumber(load.privateOwn)} · 租用国有 {fmtNumber(load.privateRented)} · 市场 {fmtNumber(load.privateMarket)} 点/月 · 租金 {fmtMoney((load.privateRented + load.privateMarket) * CONSTRUCTION_RENT_PER_POINT)}
        </Text>
        {queue.length === 0 ? (
          <Text dimColor>没有在建项目。用下方「可建建筑」下令；项目按队列顺序消耗建造点。</Text>
        ) : (
          queue.map((project, position) => {
            const isPrivate = (project.owner ?? 'state') === 'private'
            const prev = queue[position - 1]
            const next = queue[position + 1]
            const workload = projectWorkload(project)
            return (
              <Box flexDirection="row" columnGap={1} key={`queue:${project.id}`}>
                <Text wrap="truncate">{padEnd(`#${position + 1}`, 4)}</Text>
                {isPrivate ? <Text color="magenta">{padEnd('私人', 4)}</Text> : null}
                <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
                <Text dimColor wrap="truncate">{padEnd(`id:${project.id}`, 14)}</Text>
                <Text color="cyan">{padEnd(bar(project.progress, 1, 8), 9)}</Text>
                <Text dimColor>
                  剩余 {fmtNumber(workload * (1 - project.progress))}/{fmtNumber(workload)} 点 · 进度 {Math.round(project.progress * 100)}% · 本月投入 {fmtNumber(load.byProject[project.id] ?? 0)} 点 · 预计 {schedule[project.id]?.turns ?? '—'} 回合 · 造价 {constructionTotalCost(project).toFixed(1)} 金
                </Text>
                {isPrivate ? null : (
                  <Box flexDirection="row" columnGap={1}>
                    <Button key={`cancel:${project.id}`} label="取消" onPress={() => props.onControl('cancel', { projectId: project.id })} />
                    {prev !== undefined ? (
                      <Button key={`up:${project.id}`} label="↑" onPress={() => props.onControl('reorder', { projectId: project.id, position: 'before', before: prev.id })} />
                    ) : null}
                    {next !== undefined ? (
                      <Button key={`down:${project.id}`} label="↓" onPress={() => props.onControl('reorder', { projectId: project.id, position: 'after', before: next.id })} />
                    ) : null}
                    <Button key={`head:${project.id}`} label="置顶" onPress={() => props.onControl('reorder', { projectId: project.id, position: 'head' })} />
                  </Box>
                )}
              </Box>
            )
          })
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="可建建筑" hint="x*y = 每槽 x 座 × y 槽；点按钮下单" />
        {buildingGroups().map(group => (
          <Box flexDirection="column" key={`group:${group.label}`}>
            <Text dimColor>— {group.label} —</Text>
            {group.ids.map(id => {
              const cap = CAPACITY_COST[id] ?? 1
              const singleWorkload = cap * WORKLOAD_MULTIPLIER
              const singleCost = singleWorkload * CONSTRUCTION_COST_PER_POINT
              const profit = econ.buildingProfits[id]?.profitPerBuilding
              const tech = BUILDINGS[id].unlock?.techLevel
              return (
                <Box flexDirection="row" columnGap={1} key={`build:${id}`}>
                  <Text wrap="truncate">{padEnd(BUILDINGS[id].name, 6)}</Text>
                  <Text wrap="truncate">{padEnd(`存${fmtNumber(econ.buildings[id])}`, 7)}</Text>
                  <Text dimColor wrap="truncate">{padEnd(`量${fmtNumber(singleWorkload)}点`, 8)}</Text>
                  <Text dimColor wrap="truncate">{padEnd(`月耗${cap}点`, 8)}</Text>
                  <Text dimColor wrap="truncate">{padEnd(`造价${singleCost.toFixed(1)}金`, 9)}</Text>
                  <Text color={profit === undefined ? undefined : profit >= 0 ? 'green' : 'red'} wrap="truncate">
                    {padEnd(profit === undefined ? '利—' : `利${profit.toFixed(2)}`, 8)}
                  </Text>
                  <Text dimColor wrap="truncate">{padEnd(tech === undefined ? '' : `技${tech}`, 4)}</Text>
                  <Button key={`o:${id}:1x1`} label="建 1×1" onPress={() => props.onControl('build', { building: id, perSlot: 1, slots: 1 })} />
                  <Button key={`o:${id}:5x1`} label="建 5×1" onPress={() => props.onControl('build', { building: id, perSlot: 5, slots: 1 })} />
                  <Button key={`o:${id}:head`} label="⇤1×1" onPress={() => props.onControl('build', { building: id, perSlot: 1, slots: 1, position: 'head' })} />
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
