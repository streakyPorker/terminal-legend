import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_RECIPES, GOODS, makeRngForWorld } from '../engine/data'
import {
  SHRINK_MAX,
  UTIL_IDLE_FLOOR,
  UTIL_SMOOTHING,
  advance,
  computeEconomy,
  inspectEconomy,
  newWorld,
} from '../engine/sim'

describe('utilization feedback (ADR 0022 B3)', () => {
  test('the idling constants are the documented starting values', async () => {
    expect(UTIL_IDLE_FLOOR).toBe(0.5)
    expect(UTIL_SMOOTHING).toBe(0.25)
    expect(SHRINK_MAX).toBe(0.02)
  })

  test('(a) an unprofitable type idles toward the floor and its output falls', async () => {
    const world = newWorld(201, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    // Before B5 the seed factories were themselves unprofitable, so the idle
    // signal was read straight off the seed. B5 made factories profitable, so
    // drive a sustained loss the way the market would (dear inputs, cheap
    // output) and re-pin it each month: `computeEconomy` smooths prices back
    // toward base, so a one-off crash would recover on its own.
    const crashFactory = (): void => {
      for (const good of ['fabric', 'clothes', 'liquor', 'furniture', 'machinery', 'arms', 'luxury', 'steel'] as const) {
        gbr.econ.prices[good] = GOODS[good].basePrice * 0.25
      }
      for (const good of ['grain', 'coal', 'iron', 'wood'] as const) {
        gbr.econ.prices[good] = GOODS[good].basePrice * 4
      }
    }
    crashFactory()
    advance(world, 1, [], makeRngForWorld(world))
    const first = gbr.econ.buildingProfits.factories.utilization
    // A loss-making type leaves full capacity and cannot fall below the floor.
    expect(first).toBeLessThan(1)
    expect(first).toBeGreaterThanOrEqual(UTIL_IDLE_FLOOR)

    for (let index = 0; index < 11; index += 1) {
      crashFactory()
      advance(world, 1, [], makeRngForWorld(world))
    }
    const later = gbr.econ.buildingProfits.factories.utilization
    expect(later).toBeLessThan(first)
    expect(later).toBeGreaterThanOrEqual(UTIL_IDLE_FLOOR)

    // Output carries last month's stored rate: production at the idled rate is
    // below production at full capacity, and fabric comes only from factories.
    const idled = inspectEconomy(gbr).production.fabric
    const saved = gbr.econ.buildingProfits.factories.utilization
    gbr.econ.buildingProfits.factories.utilization = 1
    const full = inspectEconomy(gbr).production.fabric
    gbr.econ.buildingProfits.factories.utilization = saved
    expect(idled).toBeLessThan(full * 0.75)
  })

  test('(b) a type recovers toward full capacity once it is profitable again', async () => {
    const world = newWorld(202, 'GBR')
    const gbr = world.countries.GBR
    expect(gbr).toBeDefined()
    if (gbr === undefined) return

    // Start factories pinned at the idle floor, then make them clearly
    // profitable (dear outputs, cheap inputs) and re-run the settlement.
    gbr.econ.buildingProfits.factories.utilization = UTIL_IDLE_FLOOR
    const pinPrices = (): void => {
      for (const good of ['fabric', 'clothes', 'liquor', 'furniture', 'machinery', 'arms', 'luxury', 'steel'] as const) {
        gbr.econ.prices[good] = GOODS[good].basePrice * 4
      }
      for (const good of ['grain', 'coal', 'iron', 'wood'] as const) {
        gbr.econ.prices[good] = GOODS[good].basePrice * 0.25
      }
    }
    const rates: number[] = []
    for (let index = 0; index < 10; index += 1) {
      pinPrices()
      const snap = computeEconomy(gbr)
      expect(snap.buildingProfits.factories.profitPerBuilding).toBeGreaterThan(0)
      // Adopt the snapshot so the next pass reads the new rate (one-month lag).
      gbr.econ.buildingProfits = snap.buildingProfits
      rates.push(snap.buildingProfits.factories.utilization)
    }
    const last = rates[rates.length - 1] ?? 0
    expect(last).toBeGreaterThan(rates[0] ?? 0)
    expect(last).toBeGreaterThan(0.95)
  })

  test('(c) private investment does not start an unprofitable type', async () => {
    const run = (muteMineOutput: boolean): { coalMines: number; other: number } => {
      const world = newWorld(203, 'QING')
      const qing = world.countries.QING
      if (qing === undefined) throw new Error('missing QING')
      qing.econ.privateCapital = 400
      const savedOutput = { ...BUILDING_RECIPES.coalMines.output }
      const savedInput = { ...BUILDING_RECIPES.coalMines.input }
      try {
        // Muting the coal-mine recipe makes it unprofitable while the legacy
        // shortage signal (`BUILDING_OUTPUT`) still ranks it highest. B5's
        // `valueAdded` wage basis gives a zero-input, near-zero-output mine a
        // near-zero wage, so it would stay trivially profitable; a small input
        // keeps the muted mine genuinely in the red.
        if (muteMineOutput) {
          BUILDING_RECIPES.coalMines.output = { coal: 0.0001 }
          BUILDING_RECIPES.coalMines.input = { coal: 1 }
        }
        let coalMines = 0
        let other = 0
        for (let month = 0; month < 18; month += 1) {
          const before = world.log.length
          advance(world, 1, [], makeRngForWorld(world))
          for (const entry of world.log.slice(before)) {
            if (!entry.text.includes('私人资本投建')) continue
            if (entry.text.includes('煤矿')) coalMines += 1
            else other += 1
          }
        }
        return { coalMines, other }
      } finally {
        BUILDING_RECIPES.coalMines.output = savedOutput
        BUILDING_RECIPES.coalMines.input = savedInput
      }
    }

    // With coal mines unprofitable the gate blocks them even though they still
    // top the shortage ranking; other profitable types are built instead.
    expect(run(true).coalMines).toBe(0)
    // Control: with the normal recipe coal mines are profitable and do get built.
    expect(run(false).coalMines).toBeGreaterThan(0)
  })

  test('(d) a deep loss shrinks the count and never goes negative', async () => {
    const loss = newWorld(204, 'GBR')
    const control = newWorld(204, 'GBR')
    const lossGbr = loss.countries.GBR
    const controlGbr = control.countries.GBR
    expect(lossGbr).toBeDefined()
    expect(controlGbr).toBeDefined()
    if (lossGbr === undefined || controlGbr === undefined) return

    const start = controlGbr.econ.buildings.factories
    // B5's factories carry a smaller material bill than the pre-B5 row, so the
    // crash must be a little deeper for the loss to reach the deep-shrink path.
    const crashFactory = (country: typeof lossGbr): void => {
      for (const good of ['fabric', 'clothes', 'liquor', 'furniture', 'machinery', 'arms', 'luxury', 'steel'] as const) {
        country.econ.prices[good] = GOODS[good].basePrice * 0.2
      }
      for (const good of ['grain', 'coal', 'iron', 'wood'] as const) {
        country.econ.prices[good] = GOODS[good].basePrice * 5
      }
    }
    crashFactory(lossGbr)
    expect(computeEconomy(lossGbr).buildingProfits.factories.profitPerBuilding).toBeLessThan(0)

    advance(loss, 1, [], makeRngForWorld(loss))
    advance(control, 1, [], makeRngForWorld(control))
    // The deep loss scraps more than plain wear and tear would.
    expect(lossGbr.econ.buildings.factories).toBeLessThan(controlGbr.econ.buildings.factories)
    expect(lossGbr.econ.buildings.factories).toBeLessThan(start * 0.99)

    // Even sustained deep losses never drive the count below zero.
    lossGbr.econ.buildings.factories = 0.01
    for (let month = 0; month < 24; month += 1) {
      crashFactory(lossGbr)
      advance(loss, 1, [], makeRngForWorld(loss))
      expect(Number.isFinite(lossGbr.econ.buildings.factories)).toBe(true)
      expect(lossGbr.econ.buildings.factories).toBeGreaterThanOrEqual(0)
    }
  })

  test('(e) 60 and 120-month determinism still holds with utilization feedback', async () => {
    for (const months of [60, 120]) {
      const left = newWorld(205, 'QING')
      const right = newWorld(205, 'QING')
      advance(left, months, [], makeRngForWorld(left))
      advance(right, months, [], makeRngForWorld(right))
      expect(left.countries.QING?.econ).toEqual(right.countries.QING?.econ)
      expect(left.countries.PRU?.econ).toEqual(right.countries.PRU?.econ)
      expect(left.countries.GBR?.econ).toEqual(right.countries.GBR?.econ)
    }
  })
})
