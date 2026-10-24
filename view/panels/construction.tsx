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

/** One compact stat cell in a buildable-building row. */
export type StatCell = { key: string; width: number; text: string; color?: string }

/**
 * Drops stat cells until the row fits `width` terminal cells (PT-059).
 *
 * Rendering every column into a narrow pane made the Text nodes shrink and
 * truncate mid-word ("月耗…", "造价…"). The row now keeps only what fits,
 * sacrificing the least useful columns first: 利 → 存 → 量 → then 造价 and
 * 月耗 last, because those two are what a player compares before ordering.
 */
export function fitStatCells(cells: StatCell[], width: number): StatCell[] {
  const priority = ['upkeep', 'cost', 'volume', 'stock', 'profit']
  // name column + the three order buttons + their gaps/margins. Generous on
  // purpose: under-reserving is what truncated the numbers in the first place.
  let available = Math.max(0, width - 8 - 12 - 4)
  const keep = new Set<string>()
  for (const key of priority) {
    const cell = cells.find(entry => entry.key === key)
    if (cell === undefined) continue
    // +1 for the columnGap that follows the cell.
    if (available >= cell.width + 1) {
      keep.add(key)
      available -= cell.width + 1
    }
  }
  return cells.filter(cell => keep.has(cell.key))
}

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
  const privateQueue = queue.filter(project => (project.owner ?? 'state') === 'private')

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
        {stateQueue.length === 0 ? (
          <Text dimColor>没有在建的国有项目。用下方「可建建筑」下令；项目按队列顺序消耗建造点。</Text>
        ) : (
          stateQueue.map((project, position) => {
            const prev = stateQueue[position - 1]
            const next = stateQueue[position + 1]
            const workload = projectWorkload(project)
            return (
              <Box flexDirection="row" columnGap={1} key={`queue:${project.id}`}>
                <Text wrap="truncate">{padEnd(`#${position + 1}`, 4)}</Text>
                <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
                <Text dimColor wrap="truncate">{padEnd(`id:${project.id}`, 14)}</Text>
                <Text color="cyan">{padEnd(bar(project.progress, 1, 8), 9)}</Text>
                <Text dimColor>
                  剩余 {fmtNumber(workload * (1 - project.progress))}/{fmtNumber(workload)} 点 · 进度 {Math.round(project.progress * 100)}% · 本月投入 {fmtNumber(load.byProject[project.id] ?? 0)} 点 · 预计 {schedule[project.id]?.turns ?? '—'} 回合 · 造价 {constructionTotalCost(project).toFixed(1)} 金
                </Text>
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
              </Box>
            )
          })
        )}
        <Box flexDirection="column" marginTop={1}>
          <Heading
            ui={props.ui}
            text="私人建造队列"
            hint={
              privateQueue.length === 0
                ? '（无）'
                : `${privateQueue.length} 个项目 · 自有 ${fmtNumber(load.privateOwn)} 点/月 · 租用国有 ${fmtNumber(load.privateRented)} 点/月 · 不可取消`
            }
          />
          {privateQueue.length === 0 ? null : (
            privateQueue.map(project => {
              const workload = projectWorkload(project)
              const byProject = load.privateByProject[project.id]
              return (
                <Box flexDirection="row" columnGap={1} key={`private:${project.id}`}>
                  <Text color="magenta">{padEnd('私人', 4)}</Text>
                  <Text wrap="truncate">{padEnd(`${BUILDINGS[project.building].name}×${project.count}`, 10)}</Text>
                  <Text dimColor wrap="truncate">{padEnd(`id:${project.id}`, 14)}</Text>
                  <Text color="cyan">{padEnd(bar(project.progress, 1, 8), 9)}</Text>
                  <Text dimColor>
                    剩余 {fmtNumber(workload * (1 - project.progress))}/{fmtNumber(workload)} 点 · 进度 {Math.round(project.progress * 100)}% · 本月自有 {fmtNumber(byProject?.own ?? 0)} / 租用 {fmtNumber(byProject?.rented ?? 0)} 点 · 预计 {schedule[project.id]?.turns ?? '—'} 回合
                  </Text>
                </Box>
              )
            })
          )}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading
          ui={props.ui}
          text="可建建筑"
          hint="x*y = 每槽 x 座 × y 槽；⇤ = 插入队首"
        />
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
                <Box flexDirection="row" columnGap={1} flexWrap="wrap" key={`build:${id}`}>
                  <Text wrap="truncate">{padEnd(BUILDINGS[id].name, 8)}</Text>
                  {fitStatCells(
                    [
                      { key: 'stock', width: 8, text: `存${fmtNumber(econ.buildings[id])}` },
                      { key: 'volume', width: 8, text: `量${fmtNumber(singleWorkload)}点` },
                      { key: 'upkeep', width: 9, text: `月耗${cap}点` },
                      { key: 'cost', width: 10, text: `造价${singleCost.toFixed(1)}金` },
                      {
                        key: 'profit',
                        width: 8,
                        text: profit === undefined ? '利—' : `利${profit.toFixed(2)}`,
                        ...(profit === undefined ? {} : { color: profit >= 0 ? 'green' : 'red' }),
                      },
                    ],
                    props.width,
                  ).map(cell => (
                    <Text
                      key={`stat:${id}:${cell.key}`}
                      dimColor={cell.color === undefined}
                      {...(cell.color === undefined ? {} : { color: cell.color })}
                      wrap="truncate"
                    >
                      {padEnd(cell.text, cell.width)}
                    </Text>
                  ))}
                  {tech === undefined ? null : (
                    <Text dimColor wrap="truncate">{padEnd(`层${tech}`, 3)}</Text>
                  )}
                  <Button key={`o:${id}:1x1`} label="1×1" onPress={() => props.onControl('build', { building: id, perSlot: 1, slots: 1 })} />
                  <Button key={`o:${id}:5x1`} label="5×1" onPress={() => props.onControl('build', { building: id, perSlot: 5, slots: 1 })} />
                  <Button key={`o:${id}:head`} label="⇤" onPress={() => props.onControl('build', { building: id, perSlot: 1, slots: 1, position: 'head' })} />
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
