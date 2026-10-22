import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { advance, applyEventOption, newWorld } from '../engine/sim'
import { buildRoutineScene, routineSceneDue } from '../engine/liveEvents'
import { LIVE_ROUTINE_INTERVAL_MONTHS } from '../engine/config/events'
import type { Country, WorldState } from '../types'

/**
 * E7 (plan 0010 §7): calendar-based routine scenes. They fire on a fixed
 * cadence (about 1–2 per simulated year) and are skippable: a skip option has
 * no effect and never stalls the next advance.
 */

function snapshot(country: Country): string {
  return [
    country.econ.treasury,
    country.pops.radicals,
    country.pops.total,
    country.government.legitimacy,
    country.diplo.prestige,
    country.military.army,
    country.tech.points,
  ].join('|')
}

describe('live events: E7 calendar routine scenes (plan 0010 §7)', () => {
  test('routine scenes fire 1–2 times per simulated year', async () => {
    const world = newWorld(401, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const rng = makeRngForWorld(world)

    let count = 0
    for (let index = 0; index < 12; index += 1) {
      advance(world, 1, [], rng)
      const scene = buildRoutineScene(world)
      if (scene === undefined) continue
      count += 1
      expect(scene.countryId).toBe('QING')
      expect(scene.kind.startsWith('routine:')).toBe(true)
      const before = snapshot(qing)
      applyEventOption(world, scene, 'skip')
      expect(scene.isResolved).toBe(true)
      expect(snapshot(qing)).toBe(before)
    }
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(2)
    // Twelve advances always complete: a skipped routine scene blocks nothing.
    expect(world.date.year).toBe(1837)
    expect(world.date.month).toBe(1)
  })

  test('a routine scene is due only on the calendar cadence', async () => {
    const world = newWorld(402, 'QING')
    const due = (year: number, month: number): boolean => {
      world.date = { year, month }
      return routineSceneDue(world)
    }
    // 1836-01 is month index 1836 * 12, a multiple of any interval; then every
    // LIVE_ROUTINE_INTERVAL_MONTHS-th month is due.
    expect(LIVE_ROUTINE_INTERVAL_MONTHS).toBe(6)
    expect(due(1836, 1)).toBe(true)
    expect(due(1836, 3)).toBe(false)
    expect(due(1836, 7)).toBe(true)
    expect(due(1837, 1)).toBe(true)
    expect(due(1836, 2)).toBe(false)
  })

  test('a routine scene carries a skip option with no effects', async () => {
    const world = newWorld(403, 'QING')
    world.date = { year: 1836, month: 7 }
    const scene = buildRoutineScene(world)
    expect(scene).toBeDefined()
    if (scene === undefined) return
    const skip = scene.options.find(option => option.id === 'skip')
    expect(skip).toBeDefined()
    expect(skip?.effects).toEqual({})
    for (const option of scene.options) {
      expect(Object.keys(option).sort()).toEqual(['effects', 'id', 'label', 'result'])
    }
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

const AI_MARKER = '本月各国行动'

const LIVE_REPLY = JSON.stringify([
  {
    kind: 'politics',
    title: '朝议纷纭',
    text: '市井之间议论纷纷。',
    options: [
      { id: 'calm', label: '安抚', result: '人心稍定。', effects: { radicals: -2 } },
    ],
  },
])

async function startCampaign($: any, on: any): Promise<{ run: (i: unknown) => Promise<{ text: string }> }> {
  const files = new Map<string, string>()
  const hooks: Record<string, ($inner: any, e: any) => unknown> = {
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
    'model.complete': (_: any, e: any) => ({
      value: answered(e.prompt.includes(AI_MARKER) ? '[]' : LIVE_REPLY),
    }),
  }
  for (const [event, hook] of Object.entries(hooks)) on(event, hook)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const run = (input: unknown): Promise<{ text: string }> => $.command.run(input)
  await run({ command: 'v3', args: 'new QING' })
  return { run }
}

const liveRadicals = (text: string): number | undefined => {
  const match = /激进\s*(\d+)/.exec(text)
  return match === null ? undefined : Number(match[1])
}

describe('live events: E7 routine scenes in the host loop (plan 0010 §7)', () => {
  test('a routine scene appears on its month and a skip is a resolvable no-op', async ($, on) => {
    const { run } = await startCampaign($, on)

    let routineId: string | undefined
    for (let index = 0; index < 6 && routineId === undefined; index += 1) {
      await run({ command: 'v3', args: 'next' })
      const listed = await run({ command: 'v3', args: 'events' })
      routineId = [...listed.text.matchAll(/\[(routine-[^\]]+)\]/g)].map(match => match[1] as string)[0]
    }
    expect(routineId).toBeDefined()
    if (routineId === undefined) return

    const before = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(before).toBeDefined()
    if (before === undefined) return

    const resolved = await run({ command: 'v3', args: `resolve ${routineId} skip` })
    expect(resolved.text).toContain('循例')

    const after = liveRadicals((await run({ command: 'v3', args: 'status' })).text)
    expect(after).toBe(before)

    const listedAfter = await run({ command: 'v3', args: 'events' })
    expect(listedAfter.text).not.toContain(routineId)
  })
})
