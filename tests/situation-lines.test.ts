import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { newWorld } from '../engine/sim'
import type { LogEntry, SituationRecord, WorldState } from '../types'
import {
  settleDueSituations,
  situationOutcomeName,
  tickSituations,
  situationById,
} from '../engine/situations'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const situationOf = (world: WorldState, id: string): SituationRecord | undefined =>
  world.situations.find(one => one.id === id)

describe('S2 sample great-power lines (plan 0002 §2)', () => {
  test('the registry ships the GBR and QING lines with default proposals', () => {
    expect(situationById('gbr-free-trade')?.participants).toEqual(['GBR'])
    expect(situationById('qing-self-strengthening')?.participants).toEqual(['QING'])
    expect(situationById('gbr-free-trade')?.resolve).toBe('engine')
    expect(situationById('qing-self-strengthening')?.resolve).toBe('engine')
  })

  test('gbr-free-trade opens at 1850 and installs stackable modifiers', async () => {
    const world = newWorld(7101, 'GBR')
    world.date = { year: 1849, month: 12 }
    tickSituations(world, [])
    expect(situationOf(world, 'gbr-free-trade')).toBeUndefined()

    world.date = { year: 1850, month: 1 }
    tickSituations(world, [])
    const record = situationOf(world, 'gbr-free-trade')
    if (record === undefined) throw new Error('no gbr line')
    expect(record.countries).toEqual(['GBR'])

    const log: LogEntry[] = []
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), log)
    const mods = countryOf(world, 'GBR').modifiers.filter(
      one => one.source === 'situation:gbr-free-trade',
    )
    expect(mods.length).toBe(3)
    expect(mods.find(one => one.stat === 'income')?.value).toBe(4)
    expect(mods.find(one => one.stat === 'marketAccess')?.value).toBe(0.05)
    expect(record.resultId).toBe('free-trade')
    expect(situationOutcomeName('free-trade')).toBe('自由贸易')
    expect(log.some(entry => entry.text.includes('自由贸易转向'))).toBe(true)
  })

  test('qing-self-strengthening opens at 1861 and installs stackable modifiers', async () => {
    const world = newWorld(7102, 'QING')
    world.date = { year: 1860, month: 12 }
    tickSituations(world, [])
    expect(situationOf(world, 'qing-self-strengthening')).toBeUndefined()

    world.date = { year: 1861, month: 1 }
    tickSituations(world, [])
    const record = situationOf(world, 'qing-self-strengthening')
    if (record === undefined) throw new Error('no qing line')
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), [])
    const mods = countryOf(world, 'QING').modifiers.filter(
      one => one.source === 'situation:qing-self-strengthening',
    )
    expect(mods.length).toBe(3)
    expect(mods.find(one => one.stat === 'factoryOutput')?.value).toBe(6)
    expect(mods.find(one => one.stat === 'income')?.value).toBe(-3)
  })

  test('the sample lines do not fire inside the opium window', () => {
    const world = newWorld(7103, 'GBR')
    world.date = { year: 1840, month: 1 }
    tickSituations(world, [])
    expect(situationOf(world, 'gbr-free-trade')).toBeUndefined()
    expect(situationOf(world, 'qing-self-strengthening')).toBeUndefined()
  })
})
