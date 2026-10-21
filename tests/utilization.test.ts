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

    advance(world, 1, [], makeRngForWorld(world))
    const first = gbr.econ.buildingProfits.factories.utilization
    // GBR factories are unprofitable, so the rate already left full capacity
    // and cannot fall below the idle floor.
    expect(first).toBeLessThan(1)
    expect(first).toBeGreaterThanOrEqual(UTIL_IDLE_FLOOR)

    advance(world, 11, [], makeRngForWorld(world))
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
      for (const good of ['fabric', 'clothes', 'liquor', 'furniture', 'machinery', 'arms', 'luxury'] as const) {
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
    const run = (muteMineOutput: boolean): { mines: number; other: number } => {
      const world = newWorld(203, 'QING')
      const qing = world.countries.QING
      if (qing === undefined) throw new Error('missing QING')
      qing.econ.privateCapital = 400
      const savedOutput = { ...BUILDING_RECIPES.mines.output }
      try {
        // Muting the mine recipe makes mines unprofitable while the legacy
        // shortage signal (`BUILDING_OUTPUT`) still ranks them highest.
        if (muteMineOutput) {
          BUILDING_RECIPES.mines.output = { coal: 0.0001, iron: 0.0001, wood: 0.0001 }
        }
        let mines = 0
        let other = 0
        for (let month = 0; month < 18; month += 1) {
          const before = world.log.length
          advance(world, 1, [], makeRngForWorld(world))
          for (const entry of world.log.slice(before)) {
            if (!entry.text.includes('私人资本投建')) continue
            if (entry.text.includes('矿场')) mines += 1
            else other += 1
          }
        }
        return { mines, other }
      } finally {
        BUILDING_RECIPES.mines.output = savedOutput
      }
    }

    // With mines unprofitable the gate blocks them even though they still top
    // the shortage ranking; other profitable types are built instead.
    expect(run(true).mines).toBe(0)
    // Control: with the normal recipe mines are profitable and do get built.
    expect(run(false).mines).toBeGreaterThan(0)
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
    const crashFactory = (country: typeof lossGbr): void => {
      for (const good of ['fabric', 'clothes', 'liquor', 'furniture', 'machinery', 'arms', 'luxury'] as const) {
        country.econ.prices[good] = GOODS[good].basePrice * 0.25
      }
      for (const good of ['grain', 'coal', 'iron', 'wood'] as const) {
        country.econ.prices[good] = GOODS[good].basePrice * 4
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
