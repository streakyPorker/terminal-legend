import { describe, expect, test } from 'claude-code/testing'
import { EVENT_TEMPLATES, GOODS } from '../engine/data'
import { applyEventOption, newWorld } from '../engine/sim'
import {
  KIND_DIRECTIONS,
  buildLiveEventPrompt,
  parseLiveEventResponse,
  salientTopics,
} from '../engine/liveEvents'
import type { Country } from '../types'

const GRAIN_BASE = GOODS.grain.basePrice

/** Clears every dimension's signal so only the crafted one stands. */
function neutralise(world: WorldState, country: Country): void {
  country.pops.sol = 60
  country.pops.literacy = 0.5
  country.pops.radicals = 0
  country.government.legitimacy = 50
  country.econ.treasury = 0
  country.econ.prices.grain = GRAIN_BASE
  country.econ.unemployment = 6
  country.econ.history.gdp = [100, 100]
  country.diplo.infamy = 0
  world.wars = []
}

function warOn(world: WorldState, countryId: string): void {
  world.wars.push({
    id: 'war-test',
    name: '测试战争',
    attackers: ['GBR'],
    defenders: [countryId],
    started: { ...world.date },
    months: 0,
    warScore: 0,
    battles: 0,
    reason: '测试',
    lastEvent: '开战',
    goal: 'reparations',
    goalOwner: 'GBR',
  })
}

// ---------------------------------------------------------------- engine

describe('live events: engine helpers (plan 0010 E1)', () => {
  test('salientTopics picks the crafted dimension for each extreme state', async () => {
    const world = newWorld(1, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return

    neutralise(world, qing)
    qing.pops.radicals = 90
    const politics = salientTopics(world, qing)
    expect(politics[0]?.dimension).toBe('politics')
    expect(politics.length).toBeLessThanOrEqual(2)

    neutralise(world, qing)
    warOn(world, qing.id)
    const diplomacy = salientTopics(world, qing)
    expect(diplomacy[0]?.dimension).toBe('diplomacy')

    neutralise(world, qing)
    qing.econ.prices.grain = GRAIN_BASE * 2
    const economy = salientTopics(world, qing)
    expect(economy[0]?.dimension).toBe('economy')
    expect(economy[0]?.key).toBe('economy:grain')

    neutralise(world, qing)
    qing.pops.sol = 30
    qing.econ.prices.grain = GRAIN_BASE * 1.2
    const livelihood = salientTopics(world, qing)
    expect(livelihood[0]?.dimension).toBe('livelihood')
    expect(livelihood[0]?.key).toBe('livelihood:famine')
  })

  test('a stable world yields no topic', async () => {
    const world = newWorld(2, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    neutralise(world, qing)
    expect(salientTopics(world, qing)).toEqual([])
  })

  test('the 10 EVENT_TEMPLATES are a direction catalogue with 1:1 coverage', async () => {
    for (const template of EVENT_TEMPLATES) {
      expect(KIND_DIRECTIONS[template.kind]).toBeDefined()
    }
    expect(Object.keys(KIND_DIRECTIONS).length).toBe(EVENT_TEMPLATES.length)
  })

  test('buildLiveEventPrompt carries the state facts, topics and three voices', async () => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    neutralise(world, qing)
    qing.pops.sol = 20
    const topics = salientTopics(world, qing)
    expect(topics.length).toBeGreaterThan(0)
    const prompt = buildLiveEventPrompt(world, qing, topics)
    expect(prompt).toContain('大清')
    expect(prompt).toContain('1836')
    expect(prompt).toContain('激进')
    expect(prompt).toContain('生活水平')
    expect(prompt).toContain('民生')
    expect(prompt).toContain('史官')
    expect(prompt).toContain('市井')
    expect(prompt).toContain('列国舆论')
    expect(prompt).toContain('JSON 数组')
  })

  test('parseLiveEventResponse accepts a valid reply and keeps valid envelopes', async () => {
    const reply = JSON.stringify([
      {
        kind: 'economy',
        title: '谷贱伤农',
        text: '粮价暴跌，农户入不敷出。',
        options: [
          {
            id: 'buy',
            label: '官仓收购',
            result: '粮价暂稳。',
            effects: {
              treasury: -3,
              radicals: -2,
              modifiers: [
                { stat: 'income', stack: 'percent', value: 5, months: 6, label: '平粜' },
              ],
            },
          },
        ],
      },
    ])
    const events = parseLiveEventResponse(reply, { countryIds: ['QING', 'GBR'] })
    expect(events.length).toBe(1)
    expect(events[0]?.kind).toBe('live:economy')
    expect(events[0]?.options[0]?.effects.treasury).toBe(-3)
    expect(events[0]?.options[0]?.effects.modifiers?.[0]?.stat).toBe('income')
  })

  test('a parsed candidate applies its effects through applyEventOption', async () => {
    const world = newWorld(9, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const candidates = parseLiveEventResponse(
      JSON.stringify([
        {
          title: '米价腾贵',
          text: '米价上涨。',
          options: [
            {
              id: 'relief',
              label: '开仓平粜',
              result: '米价回落。',
              effects: { treasury: -2, radicals: -3 },
            },
          ],
        },
      ]),
      { countryIds: ['QING'] },
    )
    expect(candidates.length).toBe(1)
    const candidate = candidates[0]
    if (candidate === undefined) return
    const event = {
      id: 'live-test',
      date: { ...world.date },
      kind: candidate.kind,
      title: candidate.title,
      text: candidate.text,
      countryId: 'QING',
      options: candidate.options,
      isResolved: false,
    }
    const radicalsBefore = qing.pops.radicals
    const treasuryBefore = qing.econ.treasury
    applyEventOption(world, event, 'relief')
    expect(Math.abs(qing.pops.radicals - (radicalsBefore - 3))).toBeLessThan(1e-9)
    expect(Math.abs(qing.econ.treasury - (treasuryBefore - 2))).toBeLessThan(1e-9)
    expect(event.isResolved).toBe(true)
  })

  test('parseLiveEventResponse rejects bad stat, over-bound and non-JSON output', async () => {    const badStat = JSON.stringify([
      {
        title: 'T',
        text: 'X',
        options: [{ label: 'L', result: 'R', effects: { modifiers: [{ stat: 'nonsense', value: 1 }] } }],
      },
    ])
    expect(parseLiveEventResponse(badStat)).toEqual([])

    const overBound = JSON.stringify([
      { title: 'T', text: 'X', options: [{ label: 'L', result: 'R', effects: { treasury: 1e9 } }] },
    ])
    expect(parseLiveEventResponse(overBound)).toEqual([])

    const unknownField = JSON.stringify([
      { title: 'T', text: 'X', options: [{ label: 'L', result: 'R', effects: { wealth: 5 } }] },
    ])
    expect(parseLiveEventResponse(unknownField)).toEqual([])

    const unknownTarget = JSON.stringify([
      {
        title: 'T',
        text: 'X',
        options: [
          {
            label: 'L',
            result: 'R',
            effects: { relationTarget: 'ZZZ', relationAmount: -5 },
          },
        ],
      },
    ])
    expect(parseLiveEventResponse(unknownTarget, { countryIds: ['QING'] })).toEqual([])

    expect(parseLiveEventResponse('完全不是 JSON')).toEqual([])
    expect(parseLiveEventResponse('[{"title":"T"')).toEqual([])
  })
})

// ---------------------------------------------------------------- host loop

const answered = (text: string) => ({
  isAnswered: true,
  text,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
})

const LIVE_REPLY = JSON.stringify([
  {
    kind: 'livelihood',
    title: '米价腾贵',
    text: '江南米价连日上涨，市民在粮铺前排队，怨声渐起。',
    options: [
      {
        id: 'relief',
        label: '开仓平粜',
        result: '官仓放粮，米价回落，民心稍安。',
        effects: { treasury: -2, radicals: -3, legitimacy: 2 },
      },
      {
        id: 'ignore',
        label: '责成地方自筹',
        result: '官府袖手，民怨加深。',
        effects: { radicals: 4 },
      },
    ],
  },
])

const AI_MARKER = '本月各国行动'

type Harness = {
  run: (input: unknown) => Promise<{ text: string }>
  modelCalls: string[]
  files: Map<string, string>
}

async function startCampaign($: any, on: unknown): Promise<Harness> {
  const files = new Map<string, string>()
  const modelCalls: string[] = []
  const anyOn = on as (event: string, hook: ($: any, e: any) => unknown) => void
  const hooks: Record<string, ($: any, e: any) => unknown> = {
    'session.start': ($inner: any, e: any) => ({ cwd: e.cwd }),
    'command.register': (_: any, e: any) => ({ value: { command: e.command } }),
    'tool.register': (_: any, e: any) => ({ value: { tool: `mcp__terminal-legend__${e.name}` } }),
    'agent.register': () => ({ value: { agent: 'terminal-legend:secretary' } }),
    'turn.complete': () => ({ text: '' }),
    'fs.exists': (_: any, e: any) => ({ value: files.has(e.path) }),
    'fs.read': (_: any, e: any) => ({ value: files.get(e.path) ?? '' }),
    'fs.write': (_: any, e: any) => {
      files.set(e.path, e.text)
      return { value: undefined }
    },
    'env.get': () => ({ value: '/tmp' }),
    'session.root': () => ({ value: '/tmp' }),
    'session.cwd': () => ({ value: '/tmp' }),
    'session.id': () => ({ value: 'test-session' }),
    'ui.open': () => ({ value: { isPlaced: true } }),
    'ui.status': () => ({ value: undefined }),
    'ui.log': () => ({ value: undefined }),
    'ui.toast': () => ({ value: undefined }),
    'model.complete': (_: any, e: any) => {
      modelCalls.push(String(e.prompt))
      return { value: answered(e.prompt.includes(AI_MARKER) ? '[]' : LIVE_REPLY) }
    },
  }
  for (const [event, hook] of Object.entries(hooks)) anyOn(event, hook)

  await ($.session.start as (e: unknown) => Promise<unknown>)({
    cwd: '/tmp',
    surface: 'terminal',
    isInteractive: true,
  })
  const run = (input: unknown) =>
    ($.command.run as (e: unknown) => Promise<{ text: string }>)(input)
  await run({ command: 'v3', args: 'new QING' })
  return { run, modelCalls, files }
}

const liveIds = (text: string): string[] =>
  [...text.matchAll(/\[(live-[^\]]+)\]/g)].map(match => match[1] as string)

const liveRadicals = (text: string): number | undefined => {
  const match = /激进(\d+)/.exec(text)
  return match === null ? undefined : Number(match[1])
}

describe('live events: host loop with a mock model (plan 0010 E1)', () => {
  test('a generated event is pushed and its option applies via applyEventOption', async ($, on) => {
    const { run } = await startCampaign($ as any, on)

    const advanced = await run({ command: 'v3', args: 'next' })
    expect(advanced.text).toContain('推进 1 个月')

    const listed = await run({ command: 'v3', args: 'events' })
    expect(listed.text).toContain('米价腾贵')
    const ids = liveIds(listed.text)
    expect(ids.length).toBe(1)
    const eventId = ids[0]
    expect(eventId).toBeDefined()
    if (eventId === undefined) return

    const radicalsBefore = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(radicalsBefore).toBeDefined()
    if (radicalsBefore === undefined) return

    const resolved = await run({ command: 'v3', args: `resolve ${eventId} relief` })
    expect(resolved.text).toContain('米价回落')

    const radicalsAfter = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(radicalsAfter).toBe(radicalsBefore - 3)

    const listedAfter = await run({ command: 'v3', args: 'events' })
    expect(liveIds(listedAfter.text)).toEqual([])
  })

  test('save then load keeps the events and does not regenerate them', async ($, on) => {
    const { run, modelCalls } = await startCampaign($ as any, on)

    await run({ command: 'v3', args: 'next' })
    const before = await run({ command: 'v3', args: 'events' })
    expect(liveIds(before.text).length).toBe(1)
    const callsAfterNext = modelCalls.length
    expect(callsAfterNext).toBeGreaterThan(0)

    await run({ command: 'v3', args: 'save' })
    await run({ command: 'v3', args: 'load' })

    expect(modelCalls.length).toBe(callsAfterNext)
    const after = await run({ command: 'v3', args: 'events' })
    expect(after.text).toBe(before.text)
  })
})
