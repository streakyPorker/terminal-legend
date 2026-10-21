import { describe, expect, test } from 'claude-code/testing'
import type {
  Country,
  LogEntry,
  SituationRecord,
  WorldState,
} from '../types'
import { newWorld } from '../engine/sim'
import {
  OPIUM_CRISIS_EMBARGO_MONTHS,
  OPIUM_CRISIS_ID,
  OPIUM_CRISIS_TITLE,
  SITUATION_RESULT_IDS,
  SITUATION_RESULT_NAMES,
  applySituationResult,
  type SituationResultId,
} from '../engine/situations'
import { declareWar } from '../engine/diplomacy'
import { addModifier } from '../engine/modifiers'
import { clamp } from '../engine/internal'
import { validateBlockConfig } from '../engine/blocks'
import { findBlock } from '../engine/config/blocks'
import {
  SITUATION_BLOCKS,
  SITUATION_MODIFIER_PACKS,
  compileSituationBlock,
  instantiateSituationBlock,
  situationBlockId,
  situationModifierId,
  type SituationModifierPack,
} from '../engine/config/blocks/situations'

const countryOf = (world: WorldState, id: string): Country => {
  const c = world.countries[id]
  if (c === undefined) throw new Error(`missing ${id}`)
  return c
}

/** An already-open crisis record, without going through the 1839 trigger. */
const openRecord = (world: WorldState): SituationRecord => {
  const record: SituationRecord = {
    id: OPIUM_CRISIS_ID,
    kind: 'opium-crisis',
    opened: { ...world.date },
    countries: ['QING', 'GBR'],
    proposals: [],
    resolved: false,
    months: 1,
  }
  world.situations.push(record)
  return record
}

const modifierTuples = (c: Country): string[] =>
  c.modifiers
    .map(
      m =>
        `${m.id}|${m.source}|${m.stat}|${m.stack}|${m.value}|${m.label}|${m.monthsLeft ?? ''}`,
    )
    .sort()

// ---- Frozen copy of the pre-C4 applySituationResult, used only as an
// equivalence oracle. Do not edit to match new behaviour.
function referenceApplySituationResult(
  world: WorldState,
  situation: SituationRecord,
  resultId: SituationResultId,
  log: LogEntry[],
): void {
  const qing = world.countries.QING
  const gbr = world.countries.GBR
  const relation = (delta: number): void => {
    if (qing === undefined || gbr === undefined) return
    qing.diplo.relations.GBR = clamp((qing.diplo.relations.GBR ?? 0) + delta, -100, 100)
    gbr.diplo.relations.QING = clamp((gbr.diplo.relations.QING ?? 0) + delta, -100, 100)
  }

  switch (resultId) {
    case 'qing-crackdown': {
      if (qing !== undefined) {
        qing.government.legitimacy = clamp(qing.government.legitimacy + 6, 0, 100)
        qing.government.authority = clamp(qing.government.authority + 8, 0, 100)
        qing.diplo.prestige = clamp(qing.diplo.prestige + 8, 0, 240)
        qing.embargoes.push({
          target: 'GBR',
          goods: ['opium'],
          since: { ...world.date },
          months: OPIUM_CRISIS_EMBARGO_MONTHS,
          reason: OPIUM_CRISIS_TITLE,
        })
      }
      if (gbr !== undefined) gbr.diplo.prestige = clamp(gbr.diplo.prestige - 5, 0, 240)
      relation(-15)
      break
    }
    case 'compromise': {
      if (qing !== undefined) {
        const exportRate = qing.econ.exportTariff ?? qing.econ.tariff
        qing.econ.tariff = clamp(qing.econ.tariff - 8, 0, 60)
        qing.econ.exportTariff = clamp(exportRate - 8, 0, 60)
        addModifier(qing, {
          id: `situation:${OPIUM_CRISIS_ID}:compromise:access`,
          label: '通商口岸',
          stat: 'marketAccess',
          stack: 'flat',
          value: 0.1,
          monthsLeft: 24,
          source: `situation:${OPIUM_CRISIS_ID}`,
        })
        qing.government.legitimacy = clamp(qing.government.legitimacy - 4, 0, 100)
        qing.pops.radicals = clamp(qing.pops.radicals + 5, 0, 100)
      }
      if (gbr !== undefined) {
        addModifier(gbr, {
          id: `situation:${OPIUM_CRISIS_ID}:compromise:income`,
          label: '通商红利',
          stat: 'income',
          stack: 'percent',
          value: 5,
          monthsLeft: 24,
          source: `situation:${OPIUM_CRISIS_ID}`,
        })
      }
      relation(10)
      break
    }
    case 'war-open-market':
    case 'war-reparations': {
      const goal = resultId === 'war-open-market' ? 'openMarket' : 'reparations'
      declareWar(world, 'GBR', 'QING', goal, OPIUM_CRISIS_TITLE)
      relation(-40)
      break
    }
  }

  situation.resultId = resultId
  situation.resolved = true
  situation.resolvedAt = { ...world.date }
  for (const proposal of situation.proposals) proposal.narrative = ''
  log.push({
    date: { ...world.date },
    kind: 'diplomacy',
    text: `「${OPIUM_CRISIS_TITLE}」以「${SITUATION_RESULT_NAMES[resultId]}」收场`,
  })
}

function expectEquivalent(seed: number, resultId: SituationResultId): void {
  const worldNew = newWorld(seed, 'QING')
  const worldRef = newWorld(seed, 'QING')
  const recordNew = openRecord(worldNew)
  const recordRef = openRecord(worldRef)
  const logNew: LogEntry[] = []
  const logRef: LogEntry[] = []

  applySituationResult(worldNew, recordNew, resultId, logNew)
  referenceApplySituationResult(worldRef, recordRef, resultId, logRef)

  expect(modifierTuples(countryOf(worldNew, 'QING'))).toEqual(
    modifierTuples(countryOf(worldRef, 'QING')),
  )
  expect(modifierTuples(countryOf(worldNew, 'GBR'))).toEqual(
    modifierTuples(countryOf(worldRef, 'GBR')),
  )
  expect(logNew).toEqual(logRef)
  expect(recordNew).toEqual(recordRef)
  expect(worldNew).toEqual(worldRef)
}

describe('situation migration equivalence (C4, ADR 0024)', () => {
  test('qing-crackdown: direct effects, embargo and relations match', () => {
    expectEquivalent(8101, 'qing-crackdown')
  })

  test('compromise: timed market-access and income modifiers, direct effects match', () => {
    expectEquivalent(8102, 'compromise')
  })

  test('war-open-market: the declareWar path and relations match', () => {
    expectEquivalent(8103, 'war-open-market')
  })

  test('war-reparations: the declareWar path and relations match', () => {
    expectEquivalent(8104, 'war-reparations')
  })

  test('every result id is equivalent', () => {
    for (const id of SITUATION_RESULT_IDS) expectEquivalent(8110, id)
  })

  test('the compromise modifiers keep the pre-C4 id/source shape', () => {
    const world = newWorld(8105, 'QING')
    const record = openRecord(world)
    applySituationResult(world, record, 'compromise', [])

    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const access = qing.modifiers.filter(m => m.source.startsWith('situation:'))
    const income = gbr.modifiers.filter(m => m.source.startsWith('situation:'))

    expect(access.map(m => m.id)).toEqual([
      `situation:${OPIUM_CRISIS_ID}:compromise:access`,
    ])
    expect(income.map(m => m.id)).toEqual([
      `situation:${OPIUM_CRISIS_ID}:compromise:income`,
    ])
    for (const m of [...access, ...income]) {
      expect(m.source).toBe(`situation:${OPIUM_CRISIS_ID}`)
    }
    expect(access[0]?.stat).toBe('marketAccess')
    expect(access[0]?.stack).toBe('flat')
    expect(access[0]?.value).toBe(0.1)
    expect(access[0]?.monthsLeft).toBe(24)
    expect(income[0]?.stat).toBe('income')
    expect(income[0]?.stack).toBe('percent')
    expect(income[0]?.value).toBe(5)
    expect(income[0]?.monthsLeft).toBe(24)
  })

  test('applySituationResult stays a pure effect application a save can reproduce', () => {
    const world = newWorld(8106, 'QING')
    const record = openRecord(world)
    const before = countryOf(world, 'QING').embargoes.length
    applySituationResult(world, record, 'qing-crackdown', [])
    expect(countryOf(world, 'QING').embargoes.length).toBe(before + 1)
    expect(record.resultId).toBe('qing-crackdown')
  })
})

describe('situation block registry drift guard (C4)', () => {
  const EXPECTED: SituationModifierPack[] = [
    {
      resultId: 'compromise',
      countryId: 'QING',
      slot: 'access',
      stat: 'marketAccess',
      stack: 'flat',
      value: 0.1,
      label: '通商口岸',
      months: 24,
    },
    {
      resultId: 'compromise',
      countryId: 'GBR',
      slot: 'income',
      stat: 'income',
      stack: 'percent',
      value: 5,
      label: '通商红利',
      months: 24,
    },
  ]

  test('the shipped packs match the plan §4.3 spec exactly', () => {
    expect(SITUATION_MODIFIER_PACKS).toEqual(EXPECTED)
    expect(SITUATION_BLOCKS.map(b => b.id)).toEqual(EXPECTED.map(situationBlockId))
  })

  test('every pack maps to exactly one valid situation block and no extras', () => {
    for (const pack of SITUATION_MODIFIER_PACKS) {
      const block = findBlock(situationBlockId(pack))
      expect(block?.kind).toBe('situation')
      expect(block?.label).toBe(pack.label)
      expect(block?.lifecycle).toBe('once')
      expect(block?.potential_trigger).toEqual([])
      expect(block?.scales_with).toEqual([])
      expect(block?.effects).toEqual([
        {
          stat: pack.stat,
          stack: pack.stack,
          value: pack.value,
          label: pack.label,
          months: pack.months,
        },
      ])
    }
    expect(SITUATION_BLOCKS.length).toBe(SITUATION_MODIFIER_PACKS.length)
    expect(validateBlockConfig(SITUATION_BLOCKS)).toEqual([])
  })

  test('compile / instantiate / modifierId shapes are stable', () => {
    const block = compileSituationBlock(EXPECTED[0] as SituationModifierPack)
    expect(block.id).toBe('situation:compromise:QING:access')
    expect(block.kind).toBe('situation')
    expect(validateBlockConfig([block])).toEqual([])

    const runtime = instantiateSituationBlock(block, OPIUM_CRISIS_ID)
    expect(runtime.id).toBe(`situation:${OPIUM_CRISIS_ID}`)
    expect(runtime.effects).toEqual(block.effects)
    expect(validateBlockConfig([runtime])).toEqual([])

    expect(
      situationModifierId(OPIUM_CRISIS_ID, EXPECTED[0] as SituationModifierPack),
    ).toBe(`situation:${OPIUM_CRISIS_ID}:compromise:access`)
    expect(
      situationModifierId(OPIUM_CRISIS_ID, EXPECTED[1] as SituationModifierPack),
    ).toBe(`situation:${OPIUM_CRISIS_ID}:compromise:income`)
  })
})
