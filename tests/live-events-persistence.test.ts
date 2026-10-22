import { describe, expect, test } from 'claude-code/testing'
import { EVENTS_MAX } from '../engine/config/balance'
import { makeRngForWorld } from '../engine/data'
import { advance, newWorld } from '../engine/sim'
import type { GameEvent } from '../types'

/**
 * E4 (plan 0010 §5, §7): persistence and reproducibility. Generated events live
 * in `world.events`; a reload reuses what was stored and makes **zero** model
 * calls, and the array keeps its cap (oldest dropped on overflow).
 */

// ---------------------------------------------------------------- engine cap

function seedEvents(world: ReturnType<typeof newWorld>, count: number): GameEvent[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `seed-${index}`,
    date: { ...world.date },
    kind: 'live',
    title: `旧事件 ${index}`,
    text: '旧正文',
    countryId: 'QING',
    options: [{ id: 'opt1', label: '选项', result: '结果', effects: {} }],
    isResolved: false,
  }))
}

describe('live events: E4 persistence (plan 0010 §5)', () => {
  test('world.events is capped at EVENTS_MAX, dropping the oldest', async () => {
    const world = newWorld(1001, 'QING')
    world.events = seedEvents(world, EVENTS_MAX + 5)
    advance(world, 1, [], makeRngForWorld(world))
    expect(world.events.length).toBe(EVENTS_MAX)
    const ids = new Set(world.events.map(event => event.id))
    expect(ids.has('seed-0')).toBe(false)
    expect(ids.has(`seed-${EVENTS_MAX + 4}`)).toBe(true)
  })
})

// ---------------------------------------------------------------- host reload

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

async function startCampaign($: any, on: any): Promise<Harness> {
  const files = new Map<string, string>()
  const modelCalls: string[] = []
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
  for (const [event, hook] of Object.entries(hooks)) on(event, hook)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const run = (input: unknown): Promise<{ text: string }> => $.command.run(input)
  await run({ command: 'v3', args: 'new QING' })
  return { run, modelCalls, files }
}

const liveIds = (text: string): string[] =>
  [...text.matchAll(/\[(live-[^\]]+)\]/g)].map(match => match[1] as string)

const liveRadicals = (text: string): number | undefined => {
  const match = /激进\s*(\d+)/.exec(text)
  return match === null ? undefined : Number(match[1])
}

describe('live events: E4 reload reproducibility (plan 0010 §5)', () => {
  test('a reload reuses the stored events and makes zero model calls', async ($, on) => {
    const { run, modelCalls } = await startCampaign($, on)

    await run({ command: 'v3', args: 'next' })
    const before = await run({ command: 'v3', args: 'events' })
    const idsBefore = liveIds(before.text)
    expect(idsBefore.length).toBe(1)
    const callsAfterNext = modelCalls.length
    expect(callsAfterNext).toBeGreaterThan(0)

    await run({ command: 'v3', args: 'save' })
    await run({ command: 'v3', args: 'load' })
    expect(modelCalls.length).toBe(callsAfterNext)

    await run({ command: 'v3', args: 'load' })
    expect(modelCalls.length).toBe(callsAfterNext)

    const after = await run({ command: 'v3', args: 'events' })
    expect(after.text).toBe(before.text)
    expect(liveIds(after.text)).toEqual(idsBefore)
  })

  test('a stored event still resolves after reload, with its option and no model call', async ($, on) => {
    const { run, modelCalls } = await startCampaign($, on)

    await run({ command: 'v3', args: 'next' })
    const eventId = liveIds((await run({ command: 'v3', args: 'events' })).text)[0]
    expect(eventId).toBeDefined()
    if (eventId === undefined) return

    await run({ command: 'v3', args: 'save' })
    await run({ command: 'v3', args: 'load' })
    const callsBeforeResolve = modelCalls.length

    const radicalsBefore = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(radicalsBefore).toBeDefined()
    if (radicalsBefore === undefined) return

    const resolved = await run({ command: 'v3', args: `resolve ${eventId} relief` })
    expect(resolved.text).toContain('米价回落')

    const radicalsAfter = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(radicalsAfter).toBe(radicalsBefore - 3)
    expect(modelCalls.length).toBe(callsBeforeResolve)
  })
})
