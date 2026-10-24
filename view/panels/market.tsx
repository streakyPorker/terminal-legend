import type { Country, GoodId, WorldState } from '../../types'
import { GOODS, GOOD_IDS, RESOURCE_NAMES } from '../../engine/data'
import { effectiveSupplyFor, tradeFlows } from '../../engine/inspect/shared'
import { inspectEconomy } from '../../engine/sim'
import { countryTag, fmtMoney, fmtNumber, fmtPercent, fmtSigned, sparkline } from '../format'
import { Heading, TableRow, partnerTotals, playerOf, type UiKit } from './shared'

export type MarketRow = {
  id: GoodId
  production: number
  imports: number
  exports: number
  /** 产出 + 进口 − 出口 — the same basis the price engine prices on. */
  supply: number
  demand: number
  ratio: number
  state: '盈余' | '平衡' | '短缺'
}

/**
 * One row per good, judged on **effective supply**, not domestic output alone.
 * PT-057: the pane used `production / demand`, so coal and iron read 短缺 while
 * the imported cargo was already in port. Exported so a test can pin the
 * basis without mounting the pane.
 */
export function marketRows(
  player: Country,
  snapshot: ReturnType<typeof inspectEconomy>,
): MarketRow[] {
  const flows = tradeFlows(player)
  const effective = effectiveSupplyFor(snapshot.production, player)
  return GOOD_IDS.map(id => {
    const production = snapshot.production[id]
    const demand = snapshot.demand[id]
    const imports = flows.imports[id]
    const exports = flows.exports[id]
    const supply = effective[id]
    const ratio = demand <= 0 ? 2 : supply / demand
    const state: MarketRow['state'] = ratio >= 1.15 ? '盈余' : ratio >= 0.9 ? '平衡' : '短缺'
    return { id, production, imports, exports, supply, demand, ratio, state }
  })
}

export function MarketPanel(props: { ui: UiKit; world: WorldState; width: number }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const snapshot = inspectEconomy(player)
  const econ = player.econ
  const rows = marketRows(player, snapshot)
  const widths = [6, 5, 7, 6, 6, 7, 6, 4, 7, 6]
  const tradeWidths = [12, 10, 10, 10]
  const partners = partnerTotals(player).slice(0, 6)
  const playerRoutes = props.world.tradeRoutes
    .filter(route => route.from === player.id || route.to === player.id)
    .sort((a, b) => b.lastQty - a.lastQty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 6)
  const opiumImports = player.trade.imports
    .filter(flow => flow.good === 'opium')
    .reduce((sum, flow) => sum + flow.quantity, 0)
  const opiumDemand = snapshot.demand.opium
  const opiumDependency = opiumDemand > 0 ? fmtPercent(opiumImports / opiumDemand) : '—'
  const importedResources = (['coal', 'iron', 'timber'] as const).map(id => ({
    name: RESOURCE_NAMES[id],
    value: econ.resourceImports[id] ?? 0,
  }))
  const resourceImportLine = importedResources.some(row => row.value > 0)
    ? `资源进口 ${importedResources.map(row => `${row.name} ${fmtNumber(row.value)}`).join(' · ')}`
    : '本月无资源进口'

  return (
    <Box flexDirection="column">
      <Box>
        <Heading
          ui={props.ui}
          text="商品市场"
          hint="总量 = 产出 + 进口 − 出口；满足 = 总量 ÷ 需求；状态按满足判定"
        />
      </Box>
      <TableRow
        ui={props.ui}
        cells={['商品', '价格', '产出', '进口', '出口', '总量', '需求', '乘数', '满足', '状态']}
        widths={widths}
      />
      {rows.map(row => {
        const color = row.state === '短缺' ? 'red' : row.state === '盈余' ? 'green' : 'yellow'
        return (
          <TableRow
            ui={props.ui}
            cells={[
              GOODS[row.id].name,
              econ.prices[row.id].toFixed(1),
              fmtNumber(row.production),
              fmtNumber(row.imports),
              fmtNumber(row.exports),
              fmtNumber(row.supply),
              fmtNumber(row.demand),
              snapshot.resources[row.id].toFixed(2),
              `${Math.round(row.ratio * 100)}%`,
              row.state,
            ]}
            widths={widths}
            colors={[
              undefined, undefined, undefined, undefined, undefined,
              undefined, undefined, undefined, color, color,
            ]}
          />
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="对外贸易" hint="Top-6 伙伴 · 进口/出口值 · NX · 鸦片依存" />
        <Text dimColor>
          出口 {fmtMoney(player.trade.exportValue)} · 进口 {fmtMoney(player.trade.importValue)} · NX {fmtSigned(player.trade.nx)}金 {sparkline(player.trade.history.nx, 16)}
        </Text>
        {partners.length === 0 ? (
          <Text dimColor>本月暂无贸易往来。</Text>
        ) : (
          <Box flexDirection="column">
            <TableRow ui={props.ui} cells={['伙伴', '进口', '出口', '合计']} widths={tradeWidths} />
            {partners.map(row => {
              const partner = props.world.countries[row.id]
              return (
                <TableRow
                  ui={props.ui}
                  cells={[
                    partner !== undefined ? countryTag(partner) : row.id,
                    fmtNumber(row.imports),
                    fmtNumber(row.exports),
                    fmtNumber(row.total),
                  ]}
                  widths={tradeWidths}
                />
              )
            })}
          </Box>
        )}
        {playerRoutes.length > 0 ? (
          <Box flexDirection="column">
            <Text dimColor>贸易路线（等级 · 上月运量 · 进口方单位利差）</Text>
            {playerRoutes.map(route => (
              <Text dimColor key={route.id}>
                {GOODS[route.good].name} {route.from}→{route.to} · L{route.level} · {fmtNumber(route.lastQty)} · {fmtSigned(route.lastMargin)}金
              </Text>
            ))}
          </Box>
        ) : null}
        <Text dimColor>
          鸦片依存 进口 {fmtNumber(opiumImports)} / 需求 {fmtNumber(opiumDemand)}（{opiumDependency}）
        </Text>
        <Text dimColor>
          关税收入（进+出） {fmtMoney(econ.lastTariffRevenue)} · 贸易容量 {fmtNumber(player.trade.capacity)} · 贸易收支 {fmtSigned(econ.lastTradeBalance)}金
        </Text>
        <Text dimColor>{resourceImportLine}</Text>
      </Box>
    </Box>
  )
}
