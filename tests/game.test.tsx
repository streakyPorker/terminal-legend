import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld, spawnEvent } from '../engine/data'
import { advance, applyDecision, applyEventOption, newWorld } from '../engine/sim'
import { Band, Panel, Report, type UiKit } from '../view/panels'
import type { TabId } from '../types'

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
    const beforeFactories = prussia.econ.buildings.factories
    const result = applyDecision(
      world,
      {
        countryId: 'PRU',
        action: 'build',
        params: { building: 'factories', count: 1 },
      },
      makeRngForWorld(world),
    )
    expect(result.ok).toBe(true)
    expect(prussia.econ.buildings.factories).toBe(beforeFactories)
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

describe('terminal-legend drawing', () => {
  const PANE_PROPS = {
    title: '终末传奇',
    isFocused: false,
    bodyColumns: 110,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  } as unknown as never

  test('every pane tab draws on terminal and desktop', async ($, on) => {
    const world = newWorld(3, 'QING')
    let tab: TabId = 'overview'
    on('ui.render', { component: 'Pane', requestId: 'test-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab={tab}
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const tabs: TabId[] = [
      'council',
      'overview',
      'rankings',
      'economy',
      'pops',
      'diplomacy',
      'military',
      'tech',
      'events',
      'log',
    ]
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const one of tabs) {
        tab = one
        const ui = await $.ui.mount({
          plugin: 'terminal-legend',
          surface,
          component: 'Pane',
          requestId: 'test-pane',
          props: PANE_PROPS,
        })
        expect(await ui.find({ type: 'Text', text: /大清/ })).toBeDefined()
        await ui.unmount()
      }
    }
  })

  test('the council tab draws the report, secretary and queue', async ($, on) => {
    const world = newWorld(3, 'QING')
    world.secretary.lastReport = '已执行：无。'
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.modifiers.push({
      id: 'test-buff',
      label: '纺织繁荣',
      stat: 'fabricOutput',
      stack: 'percent',
      value: 20,
      monthsLeft: 3,
      source: 'test',
    })
    qing.econ.constructionQueue.push({
      id: 'proj-test',
      building: 'farms',
      count: 1,
      owner: 'state',
      monthsLeft: 2,
      monthlyCost: 0.75,
      lastSpend: 0.75,
      progress: 0.5,
      startedAt: { ...world.date },
    })
    on('ui.render', { component: 'Pane', requestId: 'council-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="council"
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{
            isOpen: true,
            report: '推进 1 个月：1836.01 → 1836.02',
            secretaryReport: '已执行：调整税率。建议：无。风险：财政紧张。',
            isRunning: false,
          }}
          onCouncil={() => undefined}
        />
      )
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'terminal-legend',
        surface,
        component: 'Pane',
        requestId: 'council-pane',
        props: PANE_PROPS,
      })
      expect(await ui.find({ type: 'Text', text: /御前会议/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /已执行：调整税率/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /农场×1/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /纺织繁荣/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the rankings tab draws world tables', async ($, on) => {
    const world = newWorld(3, 'QING')
    on('ui.render', { component: 'Pane', requestId: 'rank-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="rankings"
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'terminal-legend',
        surface,
        component: 'Pane',
        requestId: 'rank-pane',
        props: PANE_PROPS,
      })
      expect(await ui.find({ type: 'Text', text: /经济/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /人口与社会/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /军事/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the band draws above the prompt', async ($, on) => {
    const world = newWorld(8, 'FRA')
    on('ui.render', { component: 'AbovePrompt', requestId: 'test-band' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Band
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          maxRows={e.props.maxRows}
          onControl={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'test-band',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 8,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 7 },
        view: {},
      } as unknown as never,
    })
    expect(await ui.find({ type: 'Text', text: /法国/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /御前会议 · 待议/ })).toBeDefined()
    await ui.unmount()
  })

  test('a command row draws the report inline', async ($, on) => {
    const world = newWorld(4, 'GBR')
    on(
      'ui.render',
      { component: 'CommandOutput', requestId: 'test-command' },
      async ($hang, e) => {
        const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
        return (
          <Report
            ui={kit}
            world={world}
            width={100}
            args="status"
            text="status"
            onEvent={() => undefined}
          />
        )
      },
    )
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'CommandOutput',
      requestId: 'test-command',
      props: {
        command: 'test-v3',
        args: 'status',
        text: 'status',
        isErrored: false,
      } as unknown as never,
    })
    expect(await ui.find({ type: 'Text', text: /英国|GDP|国库/ })).toBeDefined()
    await ui.unmount()
  })
})
