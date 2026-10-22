import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'
import { MODIFIER_STATS, applyModifiers } from '../engine/modifiers'
import type { LogEntry, SituationRecord, WorldState } from '../types'
import {
  OPIUM_CRISIS_ID,
  SITUATIONS,
  type SituationDefinition,
  situationById,
  submitSituationProposal,
  tickSituations,
  settleDueSituations,
} from '../engine/situations'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const countryOf = (world: WorldState, id: string) => {
  const country = world.countries[id]
  if (country === undefined) throw new Error(`missing ${id}`)
  return country
}

const situationOf = (world: WorldState, id: string): SituationRecord | undefined =>
  world.situations.find(one => one.id === id)

const synthSituation = (overrides: Partial<SituationDefinition> = {}): SituationDefinition => ({
  id: 'synth-test',
  title: '合成局势',
  triggers: [{ conditions: [], predicate: () => true }],
  participants: ['QING'],
  context: () => '合成上下文',
  envelope: { stats: ['income', 'production'], maxEffects: 2, monthsRange: [6, 12] },
  order: 'simultaneous',
  resolve: 'engine',
  stances: ['bold', 'cautious'],
  stanceNames: { bold: '激进', cautious: '谨慎' },
  ...overrides,
})

describe('S1 registry consistency (plan 0002 §1)', () => {
  test('ids are unique and every entry has a valid shape', () => {
    const ids = SITUATIONS.map(definition => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const definition of SITUATIONS) {
      expect(definition.title.length).toBeGreaterThan(0)
      expect(definition.participants.length).toBeGreaterThan(0)
      expect(definition.stances.length).toBeGreaterThan(0)
      expect(definition.envelope.stats.length).toBeGreaterThan(0)
      expect(definition.envelope.maxEffects).toBeGreaterThanOrEqual(1)
      expect(['simultaneous', 'sequential']).toContain(definition.order)
      expect(['engine', 'arbiter-agent']).toContain(definition.resolve)
      const [lo, hi] = definition.envelope.monthsRange
      expect(lo).toBeGreaterThan(0)
      expect(hi).toBeGreaterThanOrEqual(lo)
      for (const stat of definition.envelope.stats) {
        expect(MODIFIER_STATS).toContain(stat)
      }
      for (const clause of definition.triggers) {
        expect(Array.isArray(clause.conditions)).toBe(true)
      }
      for (const participant of Object.keys(definition.defaults ?? {})) {
        expect(definition.participants).toContain(participant)
      }
    }
  })

  test('arbiter-agent definitions declare outcomes', () => {
    for (const definition of SITUATIONS) {
      if (definition.resolve === 'arbiter-agent') {
        expect((definition.outcomes ?? []).length).toBeGreaterThan(0)
      }
    }
  })

  test('the opium crisis is the arbiter-agent entry and keeps its gate', () => {
    const opium = situationById(OPIUM_CRISIS_ID)
    expect(opium).toBeDefined()
    expect(opium?.resolve).toBe('arbiter-agent')
    expect(opium?.participants).toEqual(['QING', 'GBR'])
    expect(opium?.stances).toContain('crackdown')
    expect(opium?.outcomes).toContain('war-reparations')
  })

  test('context(world) returns a non-empty string for a fresh world', () => {
    const world = newWorld(1, 'QING')
    for (const definition of SITUATIONS) {
      const text = definition.context(world)
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    }
  })
})

describe('S1 synthetic situation resolves into modifiers (plan 0002 §2)', () => {
  const setup = () => {
    const world = newWorld(7001, 'QING')
    countryOf(world, 'QING').modifiers = []
    const definition = synthSituation()
    tickSituations(world, [], [definition])
    const record = situationOf(world, 'synth-test')
    if (record === undefined) throw new Error('no synth situation')
    return { world, definition, record }
  }

  test('a mock agent proposal installs the proposed modifiers', async () => {
    const { world, definition, record } = setup()
    const submitted = submitSituationProposal(
      world,
      {
        countryId: 'QING',
        stance: 'bold',
        narrative: '推行激进改革',
        effects: [{ stat: 'income', stack: 'percent', value: 5, months: 12, label: '改革' }],
      },
      'synth-test',
      [definition],
    )
    expect(submitted.ok).toBe(true)
    record.months = 3
    const settled = await settleDueSituations(world, async () => '', rngFor(world), [], [definition])
    expect(settled).toEqual(['bold'])
    expect(record.resolved).toBe(true)
    expect(record.resultId).toBe('bold')

    const modifier = countryOf(world, 'QING').modifiers.find(
      one => one.source === 'situation:synth-test',
    )
    expect(modifier?.stat).toBe('income')
    expect(modifier?.value).toBe(5)
    expect(modifier?.monthsLeft).toBe(12)
    expect(modifier?.id).toBe('situation:synth-test:QING:self:0')
    expect(Math.abs(applyModifiers(countryOf(world, 'QING'), 'income', 100) - 105)).toBeLessThan(
      1e-6,
    )
  })

  test('an out-of-envelope effect is rejected and no modifier lands', async () => {
    const { world, definition, record } = setup()
    const submitted = submitSituationProposal(
      world,
      {
        countryId: 'QING',
        stance: 'bold',
        narrative: '越界尝试',
        effects: [{ stat: 'income', stack: 'percent', value: 900 }],
      },
      'synth-test',
      [definition],
    )
    expect(submitted.ok).toBe(true)
    expect(submitted.text).toContain('兜底')
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), [], [definition])
    expect(
      countryOf(world, 'QING').modifiers.some(one => one.source === 'situation:synth-test'),
    ).toBe(false)
  })

  test('an unknown stat and an illegal stance are rejected like applyPolicy', () => {
    const { world, definition } = setup()
    const badEffect = submitSituationProposal(
      world,
      {
        countryId: 'QING',
        stance: 'bold',
        narrative: 'x',
        effects: [{ stat: 'nonsense' as never, stack: 'flat', value: 1 }],
      },
      'synth-test',
      [definition],
    )
    expect(badEffect.text).toContain('兜底')
    const badStance = submitSituationProposal(
      world,
      { countryId: 'QING', stance: 'nonexistent', narrative: 'x' },
      'synth-test',
      [definition],
    )
    expect(badStance.ok).toBe(false)
    const notParticipant = submitSituationProposal(
      world,
      { countryId: 'GBR', stance: 'bold', narrative: 'x' },
      'synth-test',
      [definition],
    )
    expect(notParticipant.ok).toBe(false)
  })

  test('the outcome is the stance holding the most leverage', async () => {
    const { world, definition, record } = setup()
    submitSituationProposal(
      world,
      { countryId: 'QING', stance: 'cautious', narrative: '稳' },
      'synth-test',
      [definition],
    )
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), [], [definition])
    expect(record.resultId).toBe('cautious')
  })
})

describe('S1 the opium crisis is preserved (plan 0002 invariance)', () => {
  test('still triggers, resolves to a valid pack and logs the same text', async () => {
    const world = newWorld(7303, 'QING')
    world.date = { year: 1839, month: 6 }
    countryOf(world, 'QING').diplo.relations.GBR = -20
    countryOf(world, 'QING').trade.imports = [
      {
        good: 'opium',
        from: 'GBR',
        to: 'QING',
        quantity: 3,
        unitPrice: 2.5,
        landedPrice: 3,
        tariffPaid: 0,
        exportDuty: 0,
        value: 7.5,
      },
    ]
    const log: LogEntry[] = []
    tickSituations(world, log)
    const record = situationOf(world, OPIUM_CRISIS_ID)
    if (record === undefined) throw new Error('no opium')
    record.months = 3
    const settled = await settleDueSituations(world, async () => '', rngFor(world), log)
    expect(settled).toEqual(['compromise'])
    expect(log.some(entry => entry.text.includes('鸦片危机'))).toBe(true)
  })

  test('the 60/120-month denominators stay deterministic with the registry active', () => {
    for (const months of [60, 120]) {
      const left = newWorld(7401, 'QING')
      const right = newWorld(7401, 'QING')
      advance(left, months, [], makeRngForWorld(left))
      advance(right, months, [], makeRngForWorld(right))
      expect(left.situations).toEqual(right.situations)
    }
  })
})
