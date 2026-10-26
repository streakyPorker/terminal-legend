import type { Country, WorldState } from '../../types'
import { GOODS } from '../data'
import { atWar } from '../diplomacy'
import { ROUTE_MAX_LEVEL, TRADABLE_GOODS, embargoed, routeId, routeLandedPrice } from '../trade'
import { SHIPS_PER_ROUTE_LEVEL } from '../config/trade'
import { inspectEconomy } from '../economy'
import { asGood } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionRoute(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const op = String(params.op ?? 'open')
  const goodParam = String(params.good ?? '')
  const good = asGood(goodParam)
  if (good === undefined || !TRADABLE_GOODS.includes(good)) {
    return { ok: false, text: `${tag} 未知或不可贸易商品 ${goodParam}` }
  }
  const partnerId = String(params.partner ?? '')
  const partner = world.countries[partnerId]
  if (partner === undefined) return { ok: false, text: `${tag} 未知伙伴 ${partnerId}` }
  if (partnerId === country.id) return { ok: false, text: `${tag} 不能与本国开通贸易路线` }
  if (atWar(world, country.id, partnerId)) {
    return { ok: false, text: `${tag} 与${partner.name}处于战争状态，无法通商` }
  }
  if (
    embargoed(country.embargoes, partnerId, good) ||
    embargoed(partner.embargoes, country.id, good)
  ) {
    return { ok: false, text: `${tag} 与${partner.name}就该商品存在禁运` }
  }
  // Direction: the endpoint with the larger net surplus exports. A tie goes
  // to the lexicographically smaller id so the pair is symmetric.
  const own = inspectEconomy(country)
  const other = inspectEconomy(partner)
  const ownSurplus = own.production[good] - own.demand[good]
  const partnerSurplus = other.production[good] - other.demand[good]
  const playerExports =
    ownSurplus > partnerSurplus ||
    (ownSurplus === partnerSurplus && country.id < partnerId)
  const fromId = playerExports ? country.id : partnerId
  const toId = playerExports ? partnerId : country.id
  const id = routeId(good, fromId, toId)
  const index = world.tradeRoutes.findIndex(route => route.id === id)
  const existing = index < 0 ? undefined : world.tradeRoutes[index]
  const label = `${GOODS[good].name} ${fromId}→${toId}`
  // PT-067/PT-080: hulls gate how many route levels an exporter can serve.
  // `routePass` scales the actual tonnage, but a manual order must say no
  // outright when the fleet cannot cover it.
  const levelsOf = (id: string): number =>
    world.tradeRoutes
      .filter(one => one.from === id)
      .reduce((sum, one) => sum + one.level, 0)
  const hullsOf = (one: Country): number =>
    (one.military.navy ?? 0) + (one.econ.merchantHulls ?? 0)
  const hullShortfall = (
    exporter: Country,
    levelsAfter: number,
  ): string | undefined => {
    const required = levelsAfter * SHIPS_PER_ROUTE_LEVEL
    const hulls = hullsOf(exporter)
    if (hulls + 1e-9 >= required) return undefined
    return `${exporter.name}船只不足：该航线需要 ${required.toFixed(1)} 艘，现有 ${hulls.toFixed(1)} 艘（海军 ${(exporter.military.navy ?? 0).toFixed(1)} + 商船 ${(exporter.econ.merchantHulls ?? 0).toFixed(1)}）`
  }
  if (op === 'open') {
    if (existing !== undefined) {
      return { ok: false, text: `${tag} 与${partner.name}的${label}航线已存在（等级 ${existing.level}）` }
    }
    // PT-043: a route whose importer's price does not clear the landed price can
    // never trade (it would open dead and decay at once), so refuse it with the
    // reason instead of silently creating a doomed route.
    const exporter = world.countries[fromId]
    const importer = world.countries[toId]
    if (exporter === undefined || importer === undefined) {
      return { ok: false, text: `${tag} 无法确定${label}航线端点` }
    }
    const shortfall = hullShortfall(exporter, levelsOf(fromId) + 1)
    if (shortfall !== undefined) {
      return { ok: false, text: `${tag} ${shortfall}` }
    }
    const landed = routeLandedPrice(exporter, importer, good)
    const price = importer.econ.prices[good]
    if (price - landed <= 0) {
      return {
        ok: false,
        text: `${tag} ${label}航线无利可图：进口方${importer.name}本地价 ${price.toFixed(2)} 不高于到岸价 ${landed.toFixed(2)}，未开通`,
      }
    }
    world.tradeRoutes.push({
      id,
      good,
      from: fromId,
      to: toId,
      level: 1,
      owner: 'state',
      openedAt: { ...world.date },
      lastQty: 0,
      lastMargin: 0,
    })
    world.log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `${tag} 开通${label}航线（等级 1，国有）`,
    })
    return { ok: true, text: `${tag} 开通${label}航线（等级 1，国有）` }
  }
  if (existing === undefined) {
    return { ok: false, text: `${tag} 未找到与${partner.name}的${label}航线` }
  }
  if (op === 'raise') {
    const exporter = world.countries[existing.from]
    if (exporter !== undefined && existing.level < ROUTE_MAX_LEVEL) {
      const shortfall = hullShortfall(exporter, levelsOf(existing.from) + 1)
      if (shortfall !== undefined) {
        return { ok: false, text: `${tag} ${shortfall}` }
      }
    }
    existing.level = Math.min(ROUTE_MAX_LEVEL, existing.level + 1)
    return { ok: true, text: `${tag} 将${label}航线提升到等级 ${existing.level}` }
  }
  if (op === 'lower') {
    existing.level -= 1
    if (existing.level <= 0) {
      world.tradeRoutes.splice(index, 1)
      world.log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `${tag} 关闭了${label}航线`,
      })
    }
    return {
      ok: true,
      text:
        existing.level <= 0
          ? `${tag} 关闭了${label}航线`
          : `${tag} 将${label}航线降低到等级 ${existing.level}`,
    }
  }
  if (op === 'close') {
    world.tradeRoutes.splice(index, 1)
    world.log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `${tag} 关闭了${label}航线`,
    })
    return { ok: true, text: `${tag} 关闭了${label}航线` }
  }
  return { ok: false, text: `${tag} 未知航线操作 ${op}` }
}
