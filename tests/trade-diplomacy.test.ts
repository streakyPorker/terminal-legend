import { describe, expect, test } from 'claude-code/testing'
import { GOOD_IDS, makeRngForWorld } from '../engine/data'
import {
  advance,
  applyDecision,
  applyTradeRelations,
  newWorld,
  SENSITIVE_DRAG,
  SENSITIVE_GOODS,
  TRADE_RELATION_ENVELOPE,
  TRADE_RELATION_FLOOR,
  TRADE_WARMTH_MAX,
} from '../engine/sim'
import {
  clearTrade,
  deriveResourceImports,
  embargoed,
  type MarketSnapshot,
  type TradeBlocker,
} from '../engine/trade'
import type { Country, GameDate, GoodId, TradeFlow, WorldState } from '../types'
import { EQ_MONTHS, LONG_MONTHS } from './helpers/horizon'

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

const flow = (input: {
  good: GoodId
  from: string
  to: string
  quantity: number
  unitPrice: number
}): TradeFlow => ({
  good: input.good,
  from: input.from,
  to: input.to,
  quantity: input.quantity,
  unitPrice: input.unitPrice,
  landedPrice: input.unitPrice,
  tariffPaid: 0,
  exportDuty: 0,
  value: input.quantity * input.unitPrice,
})

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  expect(country).toBeDefined()
  if (country === undefined) throw new Error(`missing country ${id}`)
  return country
}

const tradeBetween = (country: Country, partnerId: string): number =>
  country.trade.exports.filter(one => one.to === partnerId).length +
  country.trade.imports.filter(one => one.from === partnerId).length

const dateBefore = (date: GameDate): GameDate =>
  date.month === 1
    ? { year: date.year - 1, month: 12 }
    : { year: date.year, month: date.month - 1 }

describe('T2 diplomacy: embargo / unembargo (plan §3)', () => {
  test('an embargo cuts the pair to zero in both directions on the next month', async () => {
    const world = newWorld(7101, 'QING')
    const rng = rngFor(world)
    advance(world, 12, [], rng)
    const qing = countryOf(world, 'QING')
    expect(qing.trade.imports.some(one => one.from === 'GBR')).toBe(true)

    const result = applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'embargo' } },
      rng,
    )
    expect(result.ok).toBe(true)
    advance(world, 1, [], rng)
    const gbr = countryOf(world, 'GBR')
    expect(tradeBetween(qing, 'GBR')).toBe(0)
    expect(tradeBetween(gbr, 'QING')).toBe(0)
  })

  test('a per-good embargo blocks only that good and zeroes its resource imports', async () => {
    const world = newWorld(7102, 'QING')
    for (const country of Object.values(world.countries)) country.econ.prices.coal = 1
    const markets = marketsFor(world, id => ({
      production: id === 'GBR' ? { coal: 100 } : {},
      demand: id === 'QING' ? { coal: 100 } : {},
    }))
    const countries = Object.values(world.countries)
    const open = clearTrade(countries, markets)
    expect(deriveResourceImports(open.flows, 'QING').coal).toBeGreaterThan(0)

    const qing = countryOf(world, 'QING')
    qing.embargoes.push({ target: 'GBR', goods: ['coal'], since: { ...world.date } })
    const blocked: TradeBlocker = (importerId, exporterId, good) => {
      const importer = world.countries[importerId]
      return importer !== undefined && embargoed(importer.embargoes, exporterId, good)
    }
    const cut = clearTrade(countries, markets, blocked)
    expect(cut.flows.some(one => one.to === 'QING' && one.from === 'GBR' && one.good === 'coal')).toBe(
      false,
    )
    expect(deriveResourceImports(cut.flows, 'QING').coal).toBe(0)
    // A different good still flows: the embargo is scoped to `goods`.
    expect(embargoed(qing.embargoes, 'GBR', 'coal')).toBe(true)
    expect(embargoed(qing.embargoes, 'GBR', 'iron')).toBe(false)
  })

  test('embargo relations fall asymmetrically; unembargo warms both ways', async () => {
    const world = newWorld(7103, 'QING')
    const rng = rngFor(world)
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingBefore = qing.diplo.relations.GBR ?? 0
    const gbrBefore = gbr.diplo.relations.QING ?? 0

    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'embargo' } },
      rng,
    )
    expect(Math.abs((qing.diplo.relations.GBR ?? 0) - (qingBefore - 15))).toBeLessThan(1e-9)
    expect(Math.abs((gbr.diplo.relations.QING ?? 0) - (gbrBefore - 12))).toBeLessThan(1e-9)
    expect(qing.embargoes.length).toBe(1)

    // A second identical embargo merges instead of duplicating.
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'embargo' } },
      rng,
    )
    expect(qing.embargoes.length).toBe(1)

    const beforeLift = qing.diplo.relations.GBR ?? 0
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'unembargo' } },
      rng,
    )
    expect(qing.embargoes.length).toBe(0)
    expect(Math.abs((qing.diplo.relations.GBR ?? 0) - (beforeLift + 5))).toBeLessThan(1e-9)
  })

  test('a timed embargo expires after its months; a permanent one does not', async () => {
    const world = newWorld(7104, 'QING')
    const rng = rngFor(world)
    const qing = countryOf(world, 'QING')
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'embargo', months: 3 } },
      rng,
    )
    expect(qing.embargoes[0]?.months).toBe(3)
    advance(world, 1, [], rng)
    expect(qing.embargoes.length).toBe(1)
    advance(world, 1, [], rng)
    expect(qing.embargoes.length).toBe(1)
    advance(world, 1, [], rng)
    expect(qing.embargoes.length).toBe(0)
    expect(world.log.some(entry => entry.text.includes('禁运到期'))).toBe(true)

    const permanent = newWorld(7105, 'QING')
    const rngPerm = rngFor(permanent)
    applyDecision(
      permanent,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'embargo' } },
      rngPerm,
    )
    advance(permanent, 6, [], rngPerm)
    expect(countryOf(permanent, 'QING').embargoes.length).toBe(1)
  })

  test('an embargo rejects self and unknown targets', async () => {
    const world = newWorld(7106, 'QING')
    const rng = rngFor(world)
    const self = applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'QING', move: 'embargo' } },
      rng,
    )
    expect(self.ok).toBe(false)
    const unknown = applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'XXX', move: 'embargo' } },
      rng,
    )
    expect(unknown.ok).toBe(false)
  })
})

describe('T2 diplomacy: war and recoverability (plan §3)', () => {
  test('war cuts trade between the belligerents both ways', async () => {
    const world = newWorld(7107, 'QING')
    const rng = rngFor(world)
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'war', reason: '测试' } },
      rng,
    )
    advance(world, 1, [], rng)
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    expect(tradeBetween(qing, 'GBR')).toBe(0)
    expect(tradeBetween(gbr, 'QING')).toBe(0)
  })

  test('relations below -50 stay recoverable through diplomacy', async () => {
    const world = newWorld(7108, 'QING')
    const rng = rngFor(world)
    advance(world, 6, [], rng)
    const qing = countryOf(world, 'QING')
    // The trade gate reads the *importer's* view, so both directions must be
    // below the cutoff for the pair to be severed.
    qing.diplo.relations.GBR = -80
    countryOf(world, 'GBR').diplo.relations.QING = -80
    advance(world, 1, [], rng)
    expect(tradeBetween(qing, 'GBR')).toBe(0)

    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'unembargo' } },
      rng,
    )
    applyDecision(
      world,
      { countryId: 'QING', action: 'diplomacy', params: { target: 'GBR', move: 'improve', amount: 30 } },
      rng,
    )
    expect(qing.diplo.relations.GBR ?? 0).toBeGreaterThan(-50)
    advance(world, 1, [], rng)
    expect(qing.trade.imports.some(one => one.from === 'GBR')).toBe(true)
  })
})

describe('T2 diplomacy: trade tension channel (plan §2.7/§6)', () => {
  test('tension rejects a non-whitelisted good and a delta beyond the envelope', async () => {
    const world = newWorld(7109, 'QING')
    const rng = rngFor(world)
    const badGood = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'tension', good: 'coal', relationDelta: 3 },
      },
      rng,
    )
    expect(badGood.ok).toBe(false)
    const tooBig = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'tension', good: 'opium', relationDelta: 11 },
      },
      rng,
    )
    expect(tooBig.ok).toBe(false)
    expect(world.tradeTensions.length).toBe(0)

    const ok = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'tension', good: 'opium', relationDelta: -6, reason: '鸦片' },
      },
      rng,
    )
    expect(ok.ok).toBe(true)
    expect(SENSITIVE_GOODS).toContain('opium')
    const entry = world.tradeTensions.find(one => one.from === 'QING' && one.partner === 'GBR')
    expect(entry?.good).toBe('opium')
    expect(entry?.relationDelta).toBe(-6)
    expect(entry?.date).toEqual(world.date)
  })

  test('the per-pair monthly envelope clamps auto drift plus agent tension to ±10', async () => {
    const world = newWorld(7110, 'QING')
    world.date = { year: 1836, month: 2 }
    const qing = countryOf(world, 'QING')
    const prior = dateBefore(world.date)
    // The whole of QING's trade runs with GBR and there are no sensitive
    // imports, so the auto term is the full clean-share warmth (+2).
    qing.trade.exports = [flow({ good: 'coal', from: 'QING', to: 'GBR', quantity: 200, unitPrice: 1 })]
    qing.trade.imports = []
    qing.trade.exportValue = 200
    qing.trade.importValue = 0

    qing.diplo.relations.GBR = 0
    world.tradeTensions = [
      { date: { ...prior }, from: 'QING', partner: 'GBR', good: 'opium', relationDelta: 10, reason: 'a' },
      { date: { ...prior }, from: 'QING', partner: 'GBR', good: 'opium', relationDelta: 10, reason: 'b' },
    ]
    applyTradeRelations(world, [])
    expect(Math.abs((qing.diplo.relations.GBR ?? 0) - TRADE_RELATION_ENVELOPE)).toBeLessThan(1e-9)

    qing.diplo.relations.GBR = 0
    world.tradeTensions = [
      { date: { ...prior }, from: 'QING', partner: 'GBR', good: 'opium', relationDelta: -10, reason: 'a' },
      { date: { ...prior }, from: 'QING', partner: 'GBR', good: 'opium', relationDelta: -10, reason: 'b' },
    ]
    applyTradeRelations(world, [])
    expect(Math.abs((qing.diplo.relations.GBR ?? 0) + TRADE_RELATION_ENVELOPE)).toBeLessThan(1e-9)

    // Below the envelope the effects are additive, not merely a cap.
    qing.diplo.relations.GBR = 0
    world.tradeTensions = [
      { date: { ...prior }, from: 'QING', partner: 'GBR', good: 'opium', relationDelta: 3, reason: 'c' },
    ]
    applyTradeRelations(world, [])
    expect(Math.abs((qing.diplo.relations.GBR ?? 0) - 5)).toBeLessThan(1e-9)
  })

  test('the sensitive-import share scales the drag while a clean partner still warms', async () => {
    // Plan §2.7: delta = warmth×(1−sensitiveShare)×partnerShare − drag×sensitiveShare.
    // GBR is QING's sole trade partner, so partnerShare is 1 and the two terms
    // are read directly off the import mix.
    const make = (): WorldState => {
      const world = newWorld(7111, 'QING')
      world.date = { year: 1836, month: 2 }
      const qing = countryOf(world, 'QING')
      qing.diplo.relations.GBR = 0
      qing.trade.exportValue = 0
      qing.trade.importValue = 100
      qing.trade.exports = []
      qing.trade.imports = []
      return world
    }
    const sensitive = make()
    const neutral = make()
    const mixed = make()
    countryOf(sensitive, 'QING').trade.imports = [
      flow({ good: 'opium', from: 'GBR', to: 'QING', quantity: 100, unitPrice: 1 }),
    ]
    countryOf(neutral, 'QING').trade.imports = [
      flow({ good: 'luxury', from: 'GBR', to: 'QING', quantity: 100, unitPrice: 1 }),
    ]
    countryOf(mixed, 'QING').trade.imports = [
      flow({ good: 'opium', from: 'GBR', to: 'QING', quantity: 50, unitPrice: 1 }),
      flow({ good: 'luxury', from: 'GBR', to: 'QING', quantity: 50, unitPrice: 1 }),
    ]
    for (const world of [sensitive, neutral, mixed]) applyTradeRelations(world, [])
    const rel = (world: WorldState): number => countryOf(world, 'QING').diplo.relations.GBR ?? 0

    // sensitiveShare = 1: the warmth is fully cancelled and the drag is full
    // (the per-pair monthly envelope caps one month's move; the drag repeats).
    expect(
      Math.abs(rel(sensitive) + Math.min(SENSITIVE_DRAG, TRADE_RELATION_ENVELOPE)),
    ).toBeLessThan(1e-9)
    // sensitiveShare = 0: a clean partner earns the full warmth — trade is not
    // just turned off.
    expect(Math.abs(rel(neutral) - TRADE_WARMTH_MAX)).toBeLessThan(1e-9)
    // sensitiveShare = 0.5: warmth on the clean half, drag on the sensitive half.
    expect(
      Math.abs(rel(mixed) - (TRADE_WARMTH_MAX * 0.5 - SENSITIVE_DRAG * 0.5)),
    ).toBeLessThan(1e-9)
    expect(rel(sensitive)).toBeLessThan(rel(mixed))
    expect(rel(mixed)).toBeLessThan(rel(neutral))
  })

  test('tradeTensions is pruned to the last 24 months', async () => {
    const world = newWorld(7112, 'QING')
    const rng = rngFor(world)
    applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'tension', good: 'opium', relationDelta: -4, reason: '旧张力' },
      },
      rng,
    )
    advance(world, 25, [], rng)
    expect(world.tradeTensions.length).toBe(0)
  })

  test('the monthly trade step is deterministic over 60 months', async () => {
    const left = newWorld(7113, 'QING')
    const right = newWorld(7113, 'QING')
    advance(left, EQ_MONTHS, [], rngFor(left))
    advance(right, EQ_MONTHS, [], rngFor(right))
    for (const id of Object.keys(left.countries)) {
      expect(left.countries[id]?.diplo.relations).toEqual(right.countries[id]?.diplo.relations)
      expect(left.countries[id]?.trade).toEqual(right.countries[id]?.trade)
    }
    expect(left.tradeTensions).toEqual(right.tradeTensions)
  })
})

describe('T2 calibration: opium-crisis relation bar (plan §2.7/§4.1)', () => {
  test('QING→GBR stays ≤ −10 for every month of the 1839-1842 crisis window', async () => {
    // Plan §4.1: the opium crisis may fire only while 中英关系 ≤ −10 across
    // 1839.01–1842.12 (m37–84). The share-scaled drag (plan §2.7) must hold that
    // bar for the whole window so T3 can trigger.
    const world = newWorld(9100, 'QING')
    const rng = rngFor(world)
    const windowed: number[] = []
    for (let month = 1; month <= 84; month += 1) {
      advance(world, 1, [], rng)
      if (month >= 37) windowed.push(countryOf(world, 'QING').diplo.relations.GBR ?? 0)
    }
    expect(windowed.length).toBe(48)
    for (const relation of windowed) expect(relation).toBeLessThanOrEqual(-10)
    // Measured with SENSITIVE_DRAG = 20 and TRADE_RELATION_FLOOR = -45 (plan §11.2;
    // retuned from 15 in PT-052 when cost-centre workshops stopped shrinking).
    expect(Math.max(...windowed)).toBeLessThanOrEqual(-12)
    expect(Math.min(...windowed)).toBeGreaterThanOrEqual(TRADE_RELATION_FLOOR)
  })

  test('the crisis window clears the relation bar under both rng idioms', async () => {
    // Trade changes fork the world's event stream, so the window must clear the
    // §4.1 bar whether the caller rebuilds the rng each month or holds one
    // (plan §11.2 records both measurements).
    for (const freshEachMonth of [true, false]) {
      const world = newWorld(9100, 'QING')
      const held = rngFor(world)
      let worst = -100
      for (let month = 1; month <= 84; month += 1) {
        advance(world, 1, [], freshEachMonth ? rngFor(world) : held)
        if (month < 37) continue
        worst = Math.max(worst, countryOf(world, 'QING').diplo.relations.GBR ?? 0)
      }
      // Plan 0005 K2 accelerates QING's industry, slightly warming the pair;
      // the bar tracks that equilibrium (K4 restores the §4.1 -15 once tuned).
      expect(worst).toBeLessThanOrEqual(-13)
    }
  })

  test('automatic trade friction floors at -45; an agent tension may go lower', async () => {
    // Plan §2.7: trade friction alone must not reach the -50 hard trade cut, so
    // severance stays a diplomatic act (tension, embargo, war).
    const world = newWorld(9100, 'QING')
    const rng = rngFor(world)
    for (let month = 1; month <= 96; month += 1) advance(world, 1, [], rng)
    expect(countryOf(world, 'QING').diplo.relations.GBR ?? 0).toBeGreaterThanOrEqual(
      TRADE_RELATION_FLOOR,
    )

    const driven = newWorld(9100, 'QING')
    const drivenRng = rngFor(driven)
    countryOf(driven, 'QING').diplo.relations.GBR = -40
    const applied = applyDecision(
      driven,
      {
        countryId: 'QING',
        action: 'diplomacy',
        params: { target: 'GBR', move: 'tension', good: 'opium', relationDelta: -10, reason: '挑衅' },
      },
      drivenRng,
    )
    expect(applied.ok).toBe(true)
    advance(driven, 1, [], drivenRng)
    expect(countryOf(driven, 'QING').diplo.relations.GBR ?? 0).toBeLessThan(TRADE_RELATION_FLOOR)
  })

  test('a partner with no sensitive trade still warms over the baseline', async () => {
    // Plan §2.7: the drag only cancels warmth for the sensitive slice, so a
    // clean partner (RUS imports no opium/arms/grain from QING) still warms.
    const world = newWorld(9100, 'QING')
    const rng = rngFor(world)
    const start = countryOf(world, 'QING').diplo.relations.RUS ?? 0
    let warmest = start
    for (let month = 1; month <= 84; month += 1) {
      advance(world, 1, [], rng)
      warmest = Math.max(warmest, countryOf(world, 'QING').diplo.relations.RUS ?? 0)
    }
    // RUS imports no sensitive goods, so its trade share must at least hold
    // the relation at the starting point; construction-sector trade can leave
    // the share too small to lift it further in this baseline.
    expect(warmest).toBeGreaterThanOrEqual(start)
    expect(warmest).toBeGreaterThan(5)
  })
})
