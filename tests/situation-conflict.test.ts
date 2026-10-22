import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { newWorld } from '../engine/sim'
import type { WorldState } from '../types'
import {
  type SituationDefinition,
  pressureShare,
  settleDueSituations,
  submitSituationProposal,
  tickSituations,
} from '../engine/situations'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const conflictSituation = (): SituationDefinition => ({
  id: 'synth-conflict',
  title: '列强对决',
  triggers: [{ conditions: [], predicate: () => true }],
  participants: ['GBR', 'FRA'],
  context: () => '对决',
  envelope: { stats: ['income'], maxEffects: 1, monthsRange: [6, 12] },
  order: 'simultaneous',
  resolve: 'engine',
  stances: ['support', 'oppose'],
  stanceNames: { support: '支持', oppose: '反对' },
})

describe('S3 multi-country simultaneous conflict (plan 0002 §3)', () => {
  const setup = () => {
    const world = newWorld(7201, 'GBR')
    countryOf(world, 'GBR').military.army = 1000
    countryOf(world, 'FRA').military.army = 10
    countryOf(world, 'GBR').modifiers = []
    countryOf(world, 'FRA').modifiers = []
    const definition = conflictSituation()
    tickSituations(world, [], [definition])
    const record = world.situations.find(one => one.id === 'synth-conflict')
    if (record === undefined) throw new Error('no conflict')
    return { world, definition, record }
  }

  test('two countries on opposite sides both land; the stronger presses harder', async () => {
    const { world, definition, record } = setup()
    submitSituationProposal(
      world,
      {
        countryId: 'GBR',
        stance: 'support',
        narrative: '英国施压',
        effects: [{ stat: 'income', stack: 'flat', value: 5 }],
        pressure: [{ stat: 'income', stack: 'flat', value: -4 }],
      },
      'synth-conflict',
      [definition],
    )
    submitSituationProposal(
      world,
      {
        countryId: 'FRA',
        stance: 'oppose',
        narrative: '法国抗拒',
        effects: [{ stat: 'income', stack: 'flat', value: 3 }],
        pressure: [{ stat: 'income', stack: 'flat', value: -4 }],
      },
      'synth-conflict',
      [definition],
    )
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), [], [definition])

    const gbrMods = countryOf(world, 'GBR').modifiers
    const fraMods = countryOf(world, 'FRA').modifiers
    const gbrSelf = gbrMods.find(one => one.id === 'situation:synth-conflict:GBR:self:0')
    const fraSelf = fraMods.find(one => one.id === 'situation:synth-conflict:FRA:self:0')
    const gbrOnFra = fraMods.find(
      one => one.id === 'situation:synth-conflict:GBR:pressure:FRA:0',
    )
    const fraOnGbr = gbrMods.find(
      one => one.id === 'situation:synth-conflict:FRA:pressure:GBR:0',
    )

    expect(gbrSelf?.value).toBe(5)
    expect(fraSelf?.value).toBe(3)
    expect(gbrOnFra?.value).toBeLessThan(0)
    expect(fraOnGbr?.value).toBeLessThan(0)
    // GBR is far stronger, so its pressure lands harder than France's.
    expect(Math.abs(gbrOnFra?.value ?? 0)).toBeGreaterThan(Math.abs(fraOnGbr?.value ?? 0))
    // Highest aggregate leverage wins the recorded outcome.
    expect(record.resultId).toBe('support')
  })

  test('an even leverage match splits the pressure in half', () => {
    expect(pressureShare(50, 50)).toBe(0.5)
    expect(pressureShare(0, 0)).toBe(0.5)
    expect(pressureShare(75, 25)).toBe(0.75)
    expect(pressureShare(25, 75)).toBe(0.25)
  })
})
