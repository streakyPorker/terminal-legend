import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { decideForAi } from '../engine/ai'
import { advance, applyDecision, clone, newWorld } from '../engine/sim'
import {
  OPIUM_CRISIS_ID,
  SITUATION_RESULT_IDS,
  type SituationResultId,
  applySituationResult,
  buildArbiterPrompt,
  dueSituations,
  fallbackResult,
  opiumCrisisDue,
  parseResultId,
  recordSituationProposal,
  resolveSituation,
  settleDueSituations,
  tickSituations,
} from '../engine/situations'
import type {
  Country,
  LogEntry,
  SituationRecord,
  SituationStance,
  TradeFlow,
  WorldState,
} from '../types'

const rngFor = (world: WorldState) => makeRngForWorld(world)

const countryOf = (world: WorldState, id: string): Country => {
  const country = world.countries[id]
  expect(country).toBeDefined()
  if (country === undefined) throw new Error(`missing country ${id}`)
  return country
}

const close = (actual: number, expected: number, eps = 1e-6): boolean =>
  Math.abs(actual - expected) <= eps

const opiumFlow = (from: string, to: string, quantity: number): TradeFlow => ({
  good: 'opium',
  from,
  to,
  quantity,
  unitPrice: 2.5,
  landedPrice: 3,
  tariffPaid: 0,
  exportDuty: 0,
  value: quantity * 2.5,
})

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

const situationOf = (world: WorldState): SituationRecord => {
  const record = world.situations[0]
  expect(record).toBeDefined()
  if (record === undefined) throw new Error('no situation')
  return record
}

const warOf = (world: WorldState) => {
  const war = world.wars[0]
  expect(war).toBeDefined()
  if (war === undefined) throw new Error('no war')
  return war
}

const arbiter = (id: string) => async (): Promise<string> => id

describe('T3 trigger (plan §4.1)', () => {
  const withConditions = (): WorldState => {
    const world = newWorld(9100, 'QING')
    world.date = { year: 1839, month: 6 }
    countryOf(world, 'QING').diplo.relations.GBR = -20
    countryOf(world, 'QING').trade.imports = [opiumFlow('GBR', 'QING', 3)]
    return world
  }

  test('fires inside the window when every condition holds', () => {
    const world = withConditions()
    expect(opiumCrisisDue(world)).toBe(true)
    const log: LogEntry[] = []
    tickSituations(world, log)
    expect(world.situations.length).toBe(1)
    const record = situationOf(world)
    expect(record.months).toBe(0)
    expect(record.countries).toEqual(['QING', 'GBR'])
    expect(record.resolved).toBe(false)
    expect(log.some(entry => entry.text.includes('鸦片危机'))).toBe(true)
  })

  test('never fires outside the window', () => {
    const before = withConditions()
    before.date = { year: 1838, month: 12 }
    expect(opiumCrisisDue(before)).toBe(false)

    const after = withConditions()
    after.date = { year: 1843, month: 1 }
    expect(opiumCrisisDue(after)).toBe(false)
  })

  test('never fires twice once a record exists', () => {
    const world = withConditions()
    tickSituations(world, [])
    expect(world.situations.length).toBe(1)
    // Conditions still hold next month, but the id has been recorded.
    world.date = { year: 1839, month: 7 }
    expect(opiumCrisisDue(world)).toBe(false)
    tickSituations(world, [])
    expect(world.situations.length).toBe(1)
  })

  test('never fires while QING and GBR are at war', () => {
    const world = withConditions()
    world.wars.push({
      id: 'war-x',
      name: 'x',
      attackers: ['QING'],
      defenders: ['GBR'],
      started: { ...world.date },
      months: 0,
      warScore: 0,
      battles: 0,
      reason: 'test',
      lastEvent: '',
      goal: 'reparations',
      goalOwner: 'QING',
    })
    expect(opiumCrisisDue(world)).toBe(false)
  })

  test('does not fire without enough opium flowing', () => {
    const world = withConditions()
    countryOf(world, 'QING').trade.imports = []
    expect(opiumCrisisDue(world)).toBe(false)
  })

  test('the monthly tick opens the crisis on the baseline', () => {
    const world = newWorld(9100, 'QING')
    const rng = rngFor(world)
    advance(world, 37, [], rng)
    const record = world.situations.find(one => one.id === OPIUM_CRISIS_ID)
    expect(record).toBeDefined()
    expect(record?.opened.year).toBe(1839)
  })
})

describe('T3 proposals are context only (plan §4.2)', () => {
  test('recording a proposal validates stance, participant and narrative', () => {
    const world = newWorld(9001, 'QING')
    expect(recordSituationProposal(world, 'QING', 'war', '备战').ok).toBe(false)

    openRecord(world)
    expect(recordSituationProposal(world, 'QING', 'bogus', 'x').ok).toBe(false)
    expect(recordSituationProposal(world, 'QING', 'war', '   ').ok).toBe(false)
    expect(recordSituationProposal(world, 'RUS', 'war', 'x').ok).toBe(false)

    const long = 'x'.repeat(300)
    expect(recordSituationProposal(world, 'QING', 'crackdown', long).ok).toBe(true)
    const proposal = situationOf(world).proposals[0]
    expect(proposal?.countryId).toBe('QING')
    expect(proposal?.stance).toBe('crackdown')
    expect(proposal?.narrative.length).toBe(160)

    // One proposal per participant: a resubmission replaces it.
    expect(recordSituationProposal(world, 'QING', 'compromise', '改主张').ok).toBe(true)
    expect(situationOf(world).proposals.length).toBe(1)
    expect(situationOf(world).proposals[0]?.stance).toBe('compromise')
  })

  test('a proposal carrying effects changes nothing by itself', () => {
    const world = newWorld(9002, 'QING')
    openRecord(world)
    const qing = countryOf(world, 'QING')
    const before = {
      relations: qing.diplo.relations.GBR ?? 0,
      legitimacy: qing.government.legitimacy,
      prestige: qing.diplo.prestige,
      tariff: qing.econ.tariff,
      wars: world.wars.length,
      embargoes: qing.embargoes.length,
      gbrPrestige: countryOf(world, 'GBR').diplo.prestige,
    }
    const result = applyDecision(
      world,
      {
        countryId: 'QING',
        action: 'situation',
        params: {
          stance: 'war',
          narrative: '宣战',
          legitimacy: 50,
          radicals: 20,
          months: 24,
        },
      },
      rngFor(world),
    )
    expect(result.ok).toBe(true)
    expect(qing.diplo.relations.GBR ?? 0).toBe(before.relations)
    expect(qing.government.legitimacy).toBe(before.legitimacy)
    expect(qing.diplo.prestige).toBe(before.prestige)
    expect(qing.econ.tariff).toBe(before.tariff)
    expect(world.wars.length).toBe(before.wars)
    expect(qing.embargoes.length).toBe(before.embargoes)
    expect(countryOf(world, 'GBR').diplo.prestige).toBe(before.gbrPrestige)
  })

  test('the AI batch carries a situation action with a valid stance', async () => {
    const world = newWorld(9003, 'QING')
    openRecord(world)
    const fake = {
      model: {
        complete: async () => ({
          isAnswered: true,
          text: JSON.stringify([
            { country: 'GBR', action: 'situation', params: { stance: 'compromise', narrative: '谈判' } },
          ]),
        }),
      },
    }
    const report = await decideForAi(fake as never, world, rngFor(world))
    expect(
      report.decisions.some(
        one => one.countryId === 'GBR' && one.action === 'situation' && one.params.stance === 'compromise',
      ),
    ).toBe(true)

    const bad = {
      model: {
        complete: async () => ({
          isAnswered: true,
          text: JSON.stringify([
            { country: 'GBR', action: 'situation', params: { stance: 'nonsense', narrative: 'x' } },
          ]),
        }),
      },
    }
    const badReport = await decideForAi(bad as never, newWorld(9004, 'QING'), rngFor(world))
    expect(
      badReport.decisions.some(one => one.action === 'situation' && one.params.stance === 'nonsense'),
    ).toBe(false)
  })
})

describe('T3 result packs (plan §4.3)', () => {
  test('qing-crackdown: prestige, legitimacy, relations and a 24-month embargo', async () => {
    const world = newWorld(9010, 'QING')
    world.date = { year: 1839, month: 6 }
    const record = openRecord(world)
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const wLegit = qing.government.legitimacy
    const wAuth = qing.government.authority
    const wPrestige = qing.diplo.prestige
    const lPrestige = gbr.diplo.prestige
    const qingRel = qing.diplo.relations.GBR ?? 0
    const gbrRel = gbr.diplo.relations.QING ?? 0

    const chosen = await resolveSituation(world, record, arbiter('qing-crackdown'), rngFor(world), [])
    expect(chosen).toBe('qing-crackdown')
    expect(close(qing.government.legitimacy, wLegit + 6)).toBe(true)
    expect(close(qing.government.authority, wAuth + 8)).toBe(true)
    expect(close(qing.diplo.prestige, wPrestige + 8)).toBe(true)
    expect(close(gbr.diplo.prestige, lPrestige - 5)).toBe(true)
    expect(close(qing.diplo.relations.GBR ?? 0, qingRel - 15)).toBe(true)
    expect(close(gbr.diplo.relations.QING ?? 0, gbrRel - 15)).toBe(true)
    const embargo = qing.embargoes.find(one => one.target === 'GBR')
    expect(embargo?.goods).toEqual(['opium'])
    expect(embargo?.months).toBe(24)
    expect(embargo?.since).toEqual(world.date)
  })

  test('compromise: tariff cut, timed market access, radical bump, GBR income buff, relations up', async () => {
    const world = newWorld(9011, 'QING')
    const record = openRecord(world)
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const wTariff = qing.econ.tariff
    const wLegit = qing.government.legitimacy
    const wRadicals = qing.pops.radicals
    const qingRel = qing.diplo.relations.GBR ?? 0
    const gbrRel = gbr.diplo.relations.QING ?? 0

    const chosen = await resolveSituation(world, record, arbiter('compromise'), rngFor(world), [])
    expect(chosen).toBe('compromise')
    expect(close(qing.econ.tariff, wTariff - 8)).toBe(true)
    expect(close(qing.government.legitimacy, wLegit - 4)).toBe(true)
    expect(close(qing.pops.radicals, wRadicals + 5)).toBe(true)
    expect(close(qing.diplo.relations.GBR ?? 0, qingRel + 10)).toBe(true)
    expect(close(gbr.diplo.relations.QING ?? 0, gbrRel + 10)).toBe(true)
    const access = qing.modifiers.find(one => one.stat === 'marketAccess' && one.monthsLeft !== undefined)
    expect(access?.value).toBe(0.1)
    expect(access?.monthsLeft).toBe(24)
    const income = gbr.modifiers.find(one => one.stat === 'income' && one.monthsLeft !== undefined)
    expect(income?.value).toBe(5)
    expect(income?.stack).toBe('percent')
    expect(income?.monthsLeft).toBe(24)
  })

  test('war-open-market: GBR declares war with goal openMarket, relations −40', async () => {
    const world = newWorld(9012, 'QING')
    const record = openRecord(world)
    const qing = countryOf(world, 'QING')
    const gbr = countryOf(world, 'GBR')
    const qingRel = qing.diplo.relations.GBR ?? 0
    const gbrRel = gbr.diplo.relations.QING ?? 0

    const chosen = await resolveSituation(world, record, arbiter('war-open-market'), rngFor(world), [])
    expect(chosen).toBe('war-open-market')
    const war = warOf(world)
    expect(war.goal).toBe('openMarket')
    expect(war.goalOwner).toBe('GBR')
    expect(war.attackers).toEqual(['GBR'])
    expect(war.defenders).toContain('QING')
    expect(close(qing.diplo.relations.GBR ?? 0, qingRel - 40)).toBe(true)
    expect(close(gbr.diplo.relations.QING ?? 0, gbrRel - 40)).toBe(true)
  })

  test('war-reparations: GBR declares war with goal reparations via the T4 path', async () => {
    const world = newWorld(9013, 'QING')
    const record = openRecord(world)
    await resolveSituation(world, record, arbiter('war-reparations'), rngFor(world), [])
    const war = warOf(world)
    expect(war.goal).toBe('reparations')
    expect(war.goalOwner).toBe('GBR')
    expect(war.attackers).toEqual(['GBR'])
    expect(war.defenders).toContain('QING')
  })

  test('resolution closes the record, records the id, and drops narratives', async () => {
    const world = newWorld(9014, 'QING')
    const record = openRecord(world)
    record.proposals.push({ countryId: 'QING', stance: 'crackdown', narrative: '严禁鸦片' })
    await resolveSituation(world, record, arbiter('qing-crackdown'), rngFor(world), [])
    expect(record.resolved).toBe(true)
    expect(record.resultId).toBe('qing-crackdown')
    expect(record.resolvedAt).toEqual(world.date)
    expect(record.proposals[0]?.narrative).toBe('')
  })
})

describe('T3 timeout and deterministic fallback (plan §4.4)', () => {
  const withProposals = (
    qing: SituationStance | undefined,
    gbr: SituationStance | undefined,
  ): { world: WorldState; record: SituationRecord } => {
    const world = newWorld(9020, 'QING')
    const record = openRecord(world)
    if (qing !== undefined) record.proposals.push({ countryId: 'QING', stance: qing, narrative: 'q' })
    if (gbr !== undefined) record.proposals.push({ countryId: 'GBR', stance: gbr, narrative: 'g' })
    return { world, record }
  }

  test('not due before three months and while incomplete', () => {
    const { world, record } = withProposals('crackdown', undefined)
    record.months = 2
    expect(dueSituations(world).length).toBe(0)
    record.months = 3
    expect(dueSituations(world).length).toBe(1)
  })

  test('settleDueSituations settles at the timeout with the deterministic fallback, reproducibly', async () => {
    const first = withProposals('crackdown', 'neutral')
    first.record.months = 3
    const firstLog: LogEntry[] = []
    await settleDueSituations(first.world, async () => 'garbage-not-an-id', rngFor(first.world), firstLog)
    expect(first.record.resultId).toBe('qing-crackdown')
    expect(first.record.resolved).toBe(true)
    expect(firstLog.length).toBe(1)

    const second = withProposals('crackdown', 'neutral')
    second.record.months = 3
    await settleDueSituations(second.world, async () => 'garbage-not-an-id', rngFor(second.world), [])
    expect(second.record.resultId).toBe(first.record.resultId)
  })

  test('fallbackResult follows the plan priority order', () => {
    const strengthOf = (ids: string[]): number => (ids.includes('GBR') ? 50 : 100)
    const make = (qing: SituationStance, gbr: SituationStance): SituationRecord => ({
      id: OPIUM_CRISIS_ID,
      kind: 'opium-crisis',
      opened: { year: 1839, month: 1 },
      countries: ['QING', 'GBR'],
      proposals: [
        { countryId: 'QING', stance: qing, narrative: '' },
        { countryId: 'GBR', stance: gbr, narrative: '' },
      ],
      resolved: false,
      months: 3,
    })
    expect(fallbackResult(make('compromise', 'war'), strengthOf)).toBe('compromise')
    expect(fallbackResult(make('crackdown', 'neutral'), strengthOf)).toBe('qing-crackdown')
    expect(fallbackResult(make('neutral', 'war'), strengthOf)).toBe('war-reparations')
    expect(
      fallbackResult(make('neutral', 'war'), ids => (ids.includes('GBR') ? 200 : 100)),
    ).toBe('war-open-market')
    expect(fallbackResult(make('neutral', 'neutral'), strengthOf)).toBe('compromise')
  })

  test('a failed arbitration falls back deterministically', async () => {
    const { world, record } = withProposals('compromise', undefined)
    const chosen = await resolveSituation(world, record, async () => '', rngFor(world), [])
    expect(chosen).toBe('compromise')
  })

  test('parseResultId accepts only a single result id', () => {
    expect(parseResultId('qing-crackdown')).toBe('qing-crackdown')
    expect(parseResultId('  compromise\n')).toBe('compromise')
    expect(parseResultId('I choose war-reparations.')).toBe('war-reparations')
    expect(parseResultId('completely unrelated')).toBeUndefined()
    expect(parseResultId('war-open-market and war-reparations')).toBeUndefined()
  })

  test('every result id is selectable through the injected arbiter', async () => {
    for (const id of SITUATION_RESULT_IDS) {
      const world = newWorld(9030, 'QING')
      const record = openRecord(world)
      const chosen: SituationResultId = await resolveSituation(
        world,
        record,
        async () => id,
        rngFor(world),
        [],
      )
      expect(chosen).toBe(id)
      expect(record.resultId).toBe(id)
    }
  })

  test('the arbitration prompt carries context and lists the four ids', () => {
    const world = newWorld(9040, 'QING')
    const record = openRecord(world)
    record.proposals.push({ countryId: 'QING', stance: 'crackdown', narrative: '严禁' })
    const prompt = buildArbiterPrompt(world, record)
    expect(prompt).toContain('1836')
    expect(prompt).toContain('严禁')
    expect(prompt).toContain('中英关系')
    for (const id of SITUATION_RESULT_IDS) expect(prompt).toContain(id)
  })
})

describe('T3 determinism (plan §8.4)', () => {
  test('the same situations settle to the same ids from the same seed', async () => {
    const left = newWorld(9050, 'QING')
    const right = clone(left)
    openRecord(left)
    openRecord(right)
    left.situations[0]!.months = 3
    right.situations[0]!.months = 3
    const l = await settleDueSituations(left, async () => '', rngFor(left), [])
    const r = await settleDueSituations(right, async () => '', rngFor(right), [])
    expect(l).toEqual(r)
    expect(left.situations[0]?.resultId).toBe(right.situations[0]?.resultId)
  })

  test('applySituationResult is a pure effect application a save can reproduce', () => {
    const world = newWorld(9051, 'QING')
    const record = openRecord(world)
    const before = countryOf(world, 'QING').embargoes.length
    applySituationResult(world, record, 'qing-crackdown', [])
    expect(countryOf(world, 'QING').embargoes.length).toBe(before + 1)
    expect(record.resultId).toBe('qing-crackdown')
  })
})
