import { describe, expect, test } from 'claude-code/testing'
import {
  BUILDINGS,
  BUILDING_IDS,
  TECH_NODES,
  canResearchNode,
  makeRngForWorld,
  spawnEvent,
} from '../engine/data'
import { advance, applyDecision, applyEventOption, newWorld } from '../engine/sim'
import { Band, Panel, Report, type UiKit } from '../view/panels'
import type { ControlAction, ControlPayload, TabId } from '../types'

describe('terminal-legend engine', () => {
  test('a new world starts in 1836 with ten countries', async () => {
    const world = newWorld(42, 'QING')
    expect(Object.keys(world.countries).length).toBe(10)
    expect(world.date).toEqual({ year: 1836, month: 1 })
    expect(world.playerId).toBe('QING')
    expect(world.countries.QING?.isPlayer).toBe(true)
    expect(world.countries.QING?.econ.gdp ?? 0).toBeGreaterThan(0)
    expect(world.countries.GBR?.econ.gdp ?? 0).toBeGreaterThan(0)
  })

  test('one month advances the date and keeps every number finite', async () => {
    const world = newWorld(123, 'QING')
    const report = advance(world, 1, [], makeRngForWorld(world))
    expect(report.end).toEqual({ year: 1836, month: 2 })
    for (const country of Object.values(world.countries)) {
      expect(Number.isFinite(country.econ.gdp)).toBe(true)
      expect(Number.isFinite(country.econ.treasury)).toBe(true)
      expect(Number.isFinite(country.pops.total)).toBe(true)
      expect(country.econ.gdp).toBeGreaterThan(0)
      expect(country.pops.total).toBeGreaterThan(0)
    }
    expect(world.tick).toBe(1)
  })

  test('the same seed and decisions produce the same world', async () => {
    const left = newWorld(99, 'FRA')
    const right = newWorld(99, 'FRA')
    advance(left, 6, [], makeRngForWorld(left))
    advance(right, 6, [], makeRngForWorld(right))
    expect(left.date).toEqual(right.date)
    expect(left.countries.FRA?.econ).toEqual(right.countries.FRA?.econ)
    expect(left.countries.GBR?.pops.total).toEqual(right.countries.GBR?.pops.total)
  })

  test('building a factory queues a project instead of finishing it', async () => {
    const world = newWorld(5, 'PRU')
    const prussia = world.countries.PRU
    expect(prussia).toBeDefined()
    if (prussia === undefined) return
    const beforeTreasury = prussia.econ.treasury
    const beforeTextiles = prussia.econ.buildings.textileMills
    const result = applyDecision(
      world,
      {
        countryId: 'PRU',
        action: 'build',
        params: { building: 'textileMills', count: 1 },
      },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(prussia.econ.buildings.textileMills).toBe(beforeTextiles)
    expect(prussia.econ.treasury).toBe(beforeTreasury)
    expect(prussia.econ.constructionQueue.length).toBe(1)
  })

  test('an event option applies its effects and resolves', async () => {
    const world = newWorld(11, 'OTT')
    const ottoman = world.countries.OTT
    expect(ottoman).toBeDefined()
    if (ottoman === undefined) return
    const event = spawnEvent(world, ottoman, makeRngForWorld(world), 'harvest')
    expect(event).toBeDefined()
    if (event === undefined) return
    const option = event.options[0]
    expect(option).toBeDefined()
    if (option === undefined) return
    const text = applyEventOption(world, event, option.id)
    expect(event.isResolved).toBe(true)
    expect(event.resolvedOption).toBe(option.id)
    expect(typeof text).toBe('string')
  })

  test('declaring war creates a war and relations fall', async () => {
    const world = newWorld(17, 'RUS')
    const before = world.countries.RUS?.diplo.relations.OTT ?? 0
    const result = applyDecision(
      world,
      {
        countryId: 'RUS',
        action: 'diplomacy',
        params: { target: 'OTT', move: 'war', reason: '黑海出海口' },
      },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(world.wars.length).toBe(1)
    expect(world.countries.RUS?.diplo.relations.OTT ?? 0).toBeLessThan(before)
  })
})

describe('terminal-legend command surface', () => {
  test(
    'a campaign starts, advances and reports through /v3',
    async ($, on) => {
    const anyOn = on as unknown as (
      event: string,
      hook: ($: any, e: any) => unknown,
    ) => void
    anyOn('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    anyOn('command.register', ($: any, e: any) => ({ value: { command: e.command } }))
    anyOn('tool.register', ($: any, e: any) => ({
      value: { tool: `mcp__terminal-legend__${e.name}` },
    }))
    anyOn('agent.register', () => ({
      value: { agent: 'terminal-legend:secretary' },
    }))
    anyOn('fs.exists', () => ({ value: false }))
    anyOn('fs.write', () => ({ value: undefined }))
    anyOn('fs.read', () => ({ value: '' }))
    anyOn('env.get', () => ({ value: '/tmp' }))
    anyOn('session.root', () => ({ value: '/tmp' }))
    anyOn('session.cwd', () => ({ value: '/tmp' }))
    anyOn('session.id', () => ({ value: 'test-session' }))
    anyOn('clock.every', () => ({ value: undefined }))
    anyOn('ui.open', () => ({ value: { isPlaced: true } }))
    const statuses: string[] = []
    anyOn('ui.status', ($: any, e: any) => {
      statuses.push(String(e.text ?? ''))
      return { value: undefined }
    })
    anyOn('ui.log', () => ({ value: undefined }))
    anyOn('ui.toast', () => ({ value: undefined }))
    anyOn('model.complete', () => ({
      value: {
        isAnswered: true,
        text: '[]',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }))

    const run = (input: unknown) =>
      ($.command.run as unknown as (e: unknown) => Promise<{ text: string }>)(input)

    await ($.session.start as unknown as (e: unknown) => Promise<unknown>)({
      cwd: '/tmp',
      surface: 'terminal',
      isInteractive: true,
    })
    const started = await run({ command: 'v3', args: 'new QING' })
    expect(started.text).toContain('新游戏开始')
    expect(statuses.some(line => line.includes('待议'))).toBe(true)

    const advanced = await run({ command: 'v3', args: 'next' })
    expect(advanced.text).toContain('推进 1 个月')
    expect(statuses[statuses.length - 1] ?? '').toContain('待议')

    const status = await run({ command: 'v3', args: 'status' })
    expect(status.text).toContain('大清')
    expect(status.text).toContain('金')

      const built = await run({ command: 'v3', args: 'help' })
      expect(built.text).toContain('/v3 new')
    },
  )
})

describe('terminal-legend GM notifications (PT-045)', () => {
  test('a player command that changes the world appends a model-visible note', async ($, on) => {
    const anyOn = on as unknown as (
      event: string,
      hook: ($: any, e: any) => unknown,
    ) => void
    anyOn('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    anyOn('command.register', ($: any, e: any) => ({ value: { command: e.command } }))
    anyOn('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__terminal-legend__${e.name}` } }))
    anyOn('agent.register', () => ({ value: { agent: 'terminal-legend:secretary' } }))
    anyOn('fs.exists', () => ({ value: false }))
    anyOn('fs.write', () => ({ value: undefined }))
    anyOn('fs.read', () => ({ value: '' }))
    anyOn('env.get', () => ({ value: '/tmp' }))
    anyOn('session.root', () => ({ value: '/tmp' }))
    anyOn('session.cwd', () => ({ value: '/tmp' }))
    anyOn('session.id', () => ({ value: 'test-session' }))
    anyOn('clock.every', () => ({ value: undefined }))
    anyOn('ui.open', () => ({ value: { isPlaced: true } }))
    anyOn('ui.status', () => ({ value: undefined }))
    anyOn('ui.log', () => ({ value: undefined }))
    anyOn('ui.toast', () => ({ value: undefined }))
    anyOn('model.complete', () => ({
      value: {
        isAnswered: true,
        text: '[]',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }))
    // PT-045: the note must be a hidden user row (the model reads it), not a
    // system notice ($.ui.log, which the model never sees).
    const notes: { type: string; text: string }[] = []
    anyOn('session.append', ($: any, e: any, next: any) => {
      notes.push({
        type: String(e?.message?.type ?? ''),
        text: String(e?.message?.content?.[0]?.text ?? ''),
      })
      return next(e)
    })

    await ($.session.start as unknown as (e: unknown) => Promise<unknown>)({
      cwd: '/tmp',
      surface: 'terminal',
      isInteractive: true,
    })
    const run = (input: unknown) =>
      ($.command.run as unknown as (e: unknown) => Promise<{ text: string }>)(input)
    await run({ command: 'v3', args: 'new QING' })
    await run({ command: 'v3', args: 'next' })

    const advance = notes.find(note => note.text.includes('推进'))
    expect(advance).toBeDefined()
    expect(advance?.type).toBe('user')
    expect(advance?.text).toContain('非玩家发言')
    expect(advance?.text).toContain('玩家')
  })
})
