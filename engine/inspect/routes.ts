import type { Country, WorldState } from '../../types'
import { GOODS } from '../data'
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
  const lines = [
    `贸易路线（${routes.length} 条；商品 from→to 等级 上月运量 进口方单位利差）：`,
  ]
  for (const route of routes) {
    lines.push(
      `- ${GOODS[route.good].name} ${route.from}→${route.to} L${route.level} 运量 ${n(route.lastQty, 1)} 利差 ${signed(route.lastMargin, 2)}（${route.owner === 'state' ? '国有' : '私人'}）`,
    )
  }
  return lines
}
