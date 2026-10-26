import type { Country, WorldState } from '../../types'
import { GOODS } from '../data'
import { SHIPS_PER_ROUTE_LEVEL } from '../config/trade'
import { isLandTradePair } from '../trade'
import { n, signed } from './shared'

export function routesSection(world: WorldState, country: Country): string[] {
  const routes = world.tradeRoutes
    .filter(route => route.from === country.id || route.to === country.id)
    .sort(
      (a, b) =>
        b.lastQty - a.lastQty ||
        (a.good < b.good ? -1 : a.good > b.good ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  if (routes.length === 0) return ['贸易路线：无']
  const ownRoutes = world.tradeRoutes.filter(route => route.from === country.id)
  const exportLevels = ownRoutes
    .filter(route => !isLandTradePair(route.from, route.to))
    .reduce((sum, route) => sum + route.level, 0)
  const landLevels = ownRoutes
    .filter(route => isLandTradePair(route.from, route.to))
    .reduce((sum, route) => sum + route.level, 0)
  const requiredHulls = exportLevels * SHIPS_PER_ROUTE_LEVEL
  const navy = country.military.navy ?? 0
  const merchant = country.econ.merchantHulls ?? 0
  const hulls = navy + merchant
  const lines = [
    `船队：海军 ${n(navy, 1)} + 商船 ${n(merchant, 1)} = ${n(hulls, 1)} 艘；海运出口 ${exportLevels} 级（需 ${n(requiredHulls, 1)} 艘）${
      landLevels > 0 ? `；陆路 ${landLevels} 级不计船` : ''
    }${
      hulls + 1e-9 < requiredHulls ? ' ⚠ 船只不足，所有海运出口航线按比例削减运量' : ''
    }`,
    `贸易路线（${routes.length} 条；商品 from→to 等级 上月运量 进口方单位利差；出口方船队决定运力）：`,
  ]
  for (const route of routes) {
    lines.push(
      `- ${GOODS[route.good].name} ${route.from}→${route.to} L${route.level} 运量 ${n(route.lastQty, 1)} 利差 ${signed(route.lastMargin, 2)}（${route.owner === 'state' ? '国有' : '私人'}）`,
    )
  }
  return lines
}
