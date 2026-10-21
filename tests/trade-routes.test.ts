import { describe, expect, test } from 'claude-code/testing'
import { GOOD_IDS, makeRngForWorld } from '../engine/data'
import { parseWorld } from '../engine/save'
import {
  advance,
  applyDecision,
  growRoutes,
  newWorld,
} from '../engine/sim'
import {
  clearTrade,
  RELATION_CUTOFF,
  ROUTE_MAX_LEVEL,
  ROUTE_UNIT_VOLUME,
  routeCapacityFactor,
  routeId,
  type MarketSnapshot,
  type RouteService,
  type TradeBlocker,
} from '../engine/trade'
import type { Country, GoodId, TradeFlow, TradeRoute, WorldState } from '../types'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const zeroRecord = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const market = (
  production: Partial<Record<GoodId, number>>,
  demand: Partial<Record<GoodId, number>>,
): MarketSnapshot => {
  const prod = zeroRecord()
  const dem = zeroRecord()
  for (const [id, value] of Object.entries(production)) prod[id as GoodId] = value as number
  for (const [id, value] of Object.entries(demand)) dem[id as GoodId] = value as number
  return { production: prod, demand: dem }
}

const marketsFor = (
  world: WorldState,
  build: (id: string) => {
    production: Partial<Record<GoodId, number>>
    demand: Partial<Record<GoodId, number>>
  },
): Record<string, MarketSnapshot> => {
  const out: Record<string, MarketSnapshot> = {}
  for (const country of Object.values(world.countries)) {
    const row = build(country.id)
    out[country.id] = market(row.production, row.demand)
  }
  return out
}

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  expect(country).toBeDefined()
  if (country === undefined) throw new Error(`missing country ${id}`)
  return country
}

const makeRoute = (
  world: WorldState,
  good: GoodId,
  from: string,
  to: string,
  level: number,
): TradeRoute => ({
  id: routeId(good, from, to),
  good,
  from,
  to,
  level,
  owner: 'state',
  openedAt: { ...world.date },
  lastQty: 0,
  lastMargin: 0,
})

const routeFlow = (
  route: TradeRoute,
  quantity: number,
  unitPrice: number,
): TradeFlow => ({
  good: route.good,
  from: route.from,
  to: route.to,
  quantity,
  unitPrice,
  landedPrice: unitPrice,
  tariffPaid: 0,
  exportDuty: 0,
  value: quantity * unitPrice,
})

describe('persistent trade routes: world shape (ADR 0020)', () => {
  test('a new world is version 8 and is seeded with standing routes', async () => {
    const world = newWorld(9801, 'QING')
    expect(world.version).toBe(8)
    expect(world.tradeRoutes.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const route of world.tradeRoutes) {
      expect(route.level).toBeGreaterThanOrEqual(1)
      expect(route.from).not.toBe(route.to)
      expect(route.id).toBe(routeId(route.good, route.from, route.to))
      expect(ids.has(route.id)).toBe(false)
      ids.add(route.id)
    }
  })

  test('routes persist across months of simulation', async () => {
    const world = newWorld(9100, 'QING')
    advance(world, 12, [], rngFor(world))
    expect(world.tradeRoutes.length).toBeGreaterThan(0)
    for (const route of world.tradeRoutes) {
      expect(route.level).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(route.lastQty)).toBe(true)
      expect(Number.isFinite(route.lastMargin)).toBe(true)
    }
  })

  test('a corrupt or unknown tradeRoutes field is normalized on load', async () => {
    const world = newWorld(9802, 'QING')
    const raw = JSON.parse(JSON.stringify(world)) as Record<string, unknown>
    delete raw.tradeRoutes
    const parsed = parseWorld(raw)
    expect(parsed).toBeDefined()
    expect(parsed?.tradeRoutes).toEqual([])
  })
})

describe('soft-gate clearing: route pass then residual (ADR 0020)', () => {
  test('the route pass serves a routed pair and shares one flow object', async () => {
    const world = newWorld(9803, 'QING')
    for (const country of Object.values(world.countries)) {
      country.econ.prices.coal = 1
      country.econ.tariff = 0
    }
    countryOf(world, 'FRA').econ.prices.coal = 3
    const markets = marketsFor(world, id => ({
      production: id === 'GBR' || id === 'FRA' ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 300 } : {},
    }))
    const route = makeRoute(world, 'coal', 'GBR', 'QING', 1)
    const capacity =
      route.level * ROUTE_UNIT_VOLUME * routeCapacityFactor(countryOf(world, 'GBR'), countryOf(world, 'QING'))
    const services = new Map<string, RouteService>()
    const balance = clearTrade(Object.values(world.countries), markets, undefined, [route], services)

    const service = services.get(route.id)
    expect(service).toBeDefined()
    expect(Math.abs((service?.capacity ?? -1) - capacity)).toBeLessThan(1e-9)
    expect(Math.abs((service?.matched ?? -1) - capacity)).toBeLessThan(1e-9)
    const flow = balance.flows.find(one => one.from === 'GBR' && one.to === 'QING' && one.good === 'coal')
    expect(flow).toBeDefined()
    // The route's flow is the same object the balance carries (gold conservation).
    expect(balance.flows.includes(service?.flow as TradeFlow)).toBe(true)
    expect(Math.abs((flow?.quantity ?? 0) - capacity)).toBeLessThan(1e-9)
  })

  test('an un-routed pair still trades through the residual spot pass', async () => {
    const world = newWorld(9804, 'QING')
    for (const country of Object.values(world.countries)) {
      country.econ.prices.coal = 1
      country.econ.prices.iron = 1
      country.econ.tariff = 0
    }
    const markets = marketsFor(world, id => ({
      production: id === 'GBR' ? { coal: 100, iron: 100 } : {},
      demand: id === 'QING' ? { coal: 100, iron: 100 } : {},
    }))
    // A route for iron must not stop coal from clearing as residual spot.
    const route = makeRoute(world, 'iron', 'GBR', 'QING', 1)
    const balance = clearTrade(Object.values(world.countries), markets, undefined, [route])
    const coal = balance.flows.filter(one => one.good === 'coal' && one.to === 'QING')
    expect(coal.length).toBeGreaterThan(0)
  })

  test('opening a route raises that pair volume above the spot market', async () => {
    const world = newWorld(9805, 'QING')
    for (const country of Object.values(world.countries)) country.econ.tariff = 0
    const exporters = ['AUS', 'GBR', 'PRU', 'RUS', 'SPA', 'USA']
    for (const id of exporters) countryOf(world, id).econ.prices.coal = 1
    countryOf(world, 'FRA').econ.prices.coal = 5
    const markets = marketsFor(world, id => ({
      production: exporters.includes(id) || id === 'FRA' ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 1000 } : {},
    }))
    const countries = Object.values(world.countries)
    // A dummy route keeps clearing in routed mode (narrow residual) while the
    // six cheap exporters crowd FRA out of the spot candidate list.
    const dummy = makeRoute(world, 'iron', 'GBR', 'QING', 1)
    const baseline = clearTrade(countries, markets, undefined, [dummy])
    const baselineFra = baseline.flows
      .filter(one => one.good === 'coal' && one.to === 'QING' && one.from === 'FRA')
      .reduce((sum, one) => sum + one.quantity, 0)
    expect(baselineFra).toBe(0)

    const with_ = clearTrade(countries, markets, undefined, [
      dummy,
      makeRoute(world, 'coal', 'FRA', 'QING', 1),
    ])
    const routedFra = with_.flows
      .filter(one => one.good === 'coal' && one.to === 'QING' && one.from === 'FRA')
      .reduce((sum, one) => sum + one.quantity, 0)
    expect(routedFra).toBeGreaterThan(0)

    const baselineTotal = baseline.flows
      .filter(one => one.good === 'coal' && one.to === 'QING')
      .reduce((sum, one) => sum + one.quantity, 0)
    const routedTotal = with_.flows
      .filter(one => one.good === 'coal' && one.to === 'QING')
      .reduce((sum, one) => sum + one.quantity, 0)
    expect(routedTotal).toBeGreaterThan(baselineTotal)
  })

  test('a blocked route carries no flow and no service entry', async () => {
    const world = newWorld(9806, 'QING')
    for (const country of Object.values(world.countries)) {
      country.econ.prices.coal = 1
      country.econ.tariff = 0
    }
    const markets = marketsFor(world, id => ({
      production: id === 'GBR' ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 100 } : {},
    }))
    const route = makeRoute(world, 'coal', 'GBR', 'QING', 1)
    const blocked: TradeBlocker = () => true
    const services = new Map<string, RouteService>()
    const balance = clearTrade(
      Object.values(world.countries),
      markets,
      blocked,
      [route],
      services,
    )
    expect(balance.flows.some(one => one.from === 'GBR' && one.to === 'QING')).toBe(false)
    expect(services.size).toBe(0)
  })
})

describe('route growth and decay (ADR 0020)', () => {
  test('a saturated, profitable route grows one level', async () => {
    const world = newWorld(9807, 'QING')
    const route = makeRoute(world, 'coal', 'GBR', 'QING', 2)
    world.tradeRoutes = [route]
    countryOf(world, 'QING').econ.prices.coal = 100
    countryOf(world, 'GBR').econ.prices.coal = 1
    const capacity =
      route.level * ROUTE_UNIT_VOLUME * routeCapacityFactor(countryOf(world, 'GBR'), countryOf(world, 'QING'))
    const flow = routeFlow(route, capacity, 1)
    const services = new Map<string, RouteService>([
      [route.id, { route, flow, capacity, matched: capacity }],
    ])
    growRoutes(world, services, marketsFor(world, () => ({ production: {}, demand: {} })))
    const grown = world.tradeRoutes.find(one => one.id === route.id)
    expect(grown?.level).toBe(3)
    expect(Math.abs((grown?.lastQty ?? -1) - capacity)).toBeLessThan(1e-9)
    expect(grown?.lastMargin ?? 0).toBeGreaterThan(0)
  })

  test('an idle route decays and a level-1 route is removed', async () => {
    const world = newWorld(9808, 'QING')
    const route = makeRoute(world, 'coal', 'GBR', 'QING', 1)
    world.tradeRoutes = [route]
    countryOf(world, 'QING').econ.prices.coal = 100
    growRoutes(world, new Map(), marketsFor(world, () => ({ production: {}, demand: {} })))
    expect(world.tradeRoutes.some(one => one.id === route.id)).toBe(false)
  })

  test('a route with a hostile importer decays instead of growing', async () => {
    const world = newWorld(9809, 'QING')
    const route = makeRoute(world, 'coal', 'GBR', 'QING', 2)
    world.tradeRoutes = [route]
    countryOf(world, 'QING').diplo.relations.GBR = RELATION_CUTOFF - 10
    countryOf(world, 'QING').econ.prices.coal = 100
    countryOf(world, 'GBR').econ.prices.coal = 1
    const capacity =
      route.level * ROUTE_UNIT_VOLUME * routeCapacityFactor(countryOf(world, 'GBR'), countryOf(world, 'QING'))
    const flow = routeFlow(route, capacity, 1)
    const services = new Map<string, RouteService>([
      [route.id, { route, flow, capacity, matched: capacity }],
    ])
    growRoutes(world, services, marketsFor(world, () => ({ production: {}, demand: {} })))
    const decayed = world.tradeRoutes.find(one => one.id === route.id)
    expect(decayed?.level).toBe(1)
  })

  test('the level never exceeds the cap', async () => {
    const world = newWorld(9810, 'QING')
    const route = makeRoute(world, 'coal', 'GBR', 'QING', ROUTE_MAX_LEVEL)
    world.tradeRoutes = [route]
    countryOf(world, 'QING').econ.prices.coal = 100
    countryOf(world, 'GBR').econ.prices.coal = 1
    const capacity =
      route.level * ROUTE_UNIT_VOLUME * routeCapacityFactor(countryOf(world, 'GBR'), countryOf(world, 'QING'))
    const flow = routeFlow(route, capacity, 1)
    const services = new Map<string, RouteService>([
      [route.id, { route, flow, capacity, matched: capacity }],
    ])
    growRoutes(world, services, marketsFor(world, () => ({ production: {}, demand: {} })))
    expect(world.tradeRoutes.find(one => one.id === route.id)?.level).toBe(ROUTE_MAX_LEVEL)
  })
})

describe('route gold conservation and determinism (ADR 0020)', () => {
  test('the three gold identities hold exactly with routes live', async () => {
    const world = newWorld(9100, 'QING')
    advance(world, 24, [], rngFor(world))
    let globalImports = 0
    let globalExports = 0
    let globalExportDuty = 0
    for (const country of Object.values(world.countries)) {
      for (const flow of country.trade.imports) {
        expect(Math.abs(flow.value - flow.quantity * flow.unitPrice)).toBeLessThan(1e-6)
        expect(
          Math.abs(flow.tariffPaid - (flow.value + flow.exportDuty) * (country.econ.tariff / 100)),
        ).toBeLessThan(1e-6)
        globalImports += flow.value + flow.exportDuty
      }
      for (const flow of country.trade.exports) {
        globalExports += flow.value
        globalExportDuty += flow.exportDuty
      }
    }
    expect(Math.abs(globalImports - (globalExports + globalExportDuty))).toBeLessThan(1e-6)
  })

  test('60 months with routes stay deterministic', async () => {
    const left = newWorld(9100, 'QING')
    const right = newWorld(9100, 'QING')
    advance(left, 60, [], rngFor(left))
    advance(right, 60, [], rngFor(right))
    expect(left.tradeRoutes).toEqual(right.tradeRoutes)
    for (const id of Object.keys(left.countries)) {
      expect(left.countries[id]?.trade).toEqual(right.countries[id]?.trade)
    }
  })
})

describe('player route action (v3_action route)', () => {
  test('open / raise / lower / close adjust the route', async () => {
    const world = newWorld(9811, 'QING')
    const rng = rngFor(world)
    const open = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'coal', partner: 'GBR' } },
      rng,
    )
    expect(open.ok).toBe(true)
    const route = world.tradeRoutes.find(one => one.owner === 'state')
    expect(route).toBeDefined()
    if (route === undefined) return
    expect(route.level).toBe(1)

    const reopen = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'coal', partner: 'GBR' } },
      rng,
    )
    expect(reopen.ok).toBe(false)

    applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'raise', good: route.good, partner: 'GBR' } },
      rng,
    )
    expect(world.tradeRoutes.find(one => one.id === route.id)?.level).toBe(2)

    applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'lower', good: route.good, partner: 'GBR' } },
      rng,
    )
    expect(world.tradeRoutes.find(one => one.id === route.id)?.level).toBe(1)

    const close = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'close', good: route.good, partner: 'GBR' } },
      rng,
    )
    expect(close.ok).toBe(true)
    expect(world.tradeRoutes.some(one => one.id === route.id)).toBe(false)
  })

  test('the action rejects a non-tradable good, self, unknown partner and embargo', async () => {
    const world = newWorld(9812, 'QING')
    const rng = rngFor(world)
    const badGood = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'services', partner: 'GBR' } },
      rng,
    )
    expect(badGood.ok).toBe(false)
    const self = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'coal', partner: 'QING' } },
      rng,
    )
    expect(self.ok).toBe(false)
    const unknown = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'coal', partner: 'XXX' } },
      rng,
    )
    expect(unknown.ok).toBe(false)

    countryOf(world, 'QING').embargoes.push({
      target: 'GBR',
      goods: ['coal'],
      since: { ...world.date },
    })
    const embargoed = applyDecision(
      world,
      { countryId: 'QING', action: 'route', params: { op: 'open', good: 'coal', partner: 'GBR' } },
      rng,
    )
    expect(embargoed.ok).toBe(false)
  })
})
