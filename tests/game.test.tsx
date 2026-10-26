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
      'market',
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
      expect(await ui.find({ type: 'Text', text: /科技与行政/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /外交与威望/ })).toBeDefined()
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

  test('the construction panel is read-only and keeps queue management', async ($, on) => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.constructionQueue = [
      {
        id: 'proj-abc',
        building: 'farms',
        count: 2,
        owner: 'state',
        monthsLeft: 1,
        monthlyCost: 0.5,
        lastSpend: 0.5,
        progress: 0.25,
        startedAt: { ...world.date },
      },
    ]
    const calls: { control: ControlAction; payload?: ControlPayload }[] = []
    on('ui.render', { component: 'Pane', requestId: 'build-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="council"
          notice=""
          onTab={() => undefined}
          onControl={(control, payload) => {
            calls.push({ control, payload })
          }}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'build-pane',
      props: {
        title: '终末传奇',
        isFocused: true,
        isPlaced: true,
        bodyColumns: 110,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 400 },
        view: {},
      } as unknown as never,
    })
    expect(await ui.find({ type: 'Text', text: /可建建筑/ })).toBeDefined()
    for (const id of BUILDING_IDS) {
      expect(await ui.find({ type: 'Text', text: new RegExp(BUILDINGS[id].name) })).toBeDefined()
    }
    // PT-062: the queue row is player-facing; internal project ids stay hidden.
    expect(await ui.find({ type: 'Text', text: /id:proj-abc/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /农场×2/ })).toBeDefined()
    // §S6: ordering left the panel — the dialogue is the only order entry.
    expect(await ui.find({ type: 'Text', text: /下单请在对话中下令/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'o:farms:1x1' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'o:farms:5x1' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'o:farms:head' })).toBeUndefined()
    // Queue management stays on the panel; its payload path is pressed for
    // real in tests/panel-build.test.tsx (a hand-rendered pane is not pressable).
    expect(await ui.find({ type: 'Button', key: 'cancel:proj-abc' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'head:proj-abc' })).toBeDefined()
    expect(calls).toHaveLength(0)
    await ui.unmount()
  })

  test('the queue row shows upgrade projects as 钢铁厂 I→II ×12 and III→IV ×12', async ($, on) => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    qing.econ.constructionQueue = [
      {
        id: 'proj-upgrade',
        building: 'steelMills',
        count: 12,
        kind: 'upgrade',
        fromTier: 0,
        toTier: 1,
        owner: 'state',
        monthsLeft: 3,
        monthlyCost: 1,
        lastSpend: 0,
        progress: 0.25,
        startedAt: { ...world.date },
      },
      {
        id: 'proj-upgrade-34',
        building: 'steelMills',
        count: 12,
        kind: 'upgrade',
        fromTier: 2,
        toTier: 3,
        owner: 'state',
        monthsLeft: 5,
        monthlyCost: 1.5,
        lastSpend: 0,
        progress: 0.1,
        startedAt: { ...world.date },
      },
    ]
    on('ui.render', { component: 'Pane', requestId: 'upgrade-pane' }, async ($hang, e) => {
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
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'upgrade-pane',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /钢铁厂 I→II ×12/ })).toBeDefined()
    // Plan 0016 §S4: a 5-tier upgrade label must survive the row's label column.
    expect(await ui.find({ type: 'Text', text: /钢铁厂 III→IV ×12/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'cancel:proj-upgrade' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'cancel:proj-upgrade-34' })).toBeDefined()
    await ui.unmount()
  })

  test('the economy tab draws tier proportion bars from buildingTiers', async ($, on) => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    // A 63/37 mix: the bar must report the buildingTiers distribution, not the
    // raw seat count, and must not leak the per-tier recipe note.
    qing.econ.buildings.steelMills = 100
    qing.econ.buildingTiers.steelMills = [63, 37]
    on('ui.render', { component: 'Pane', requestId: 'econ-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="economy"
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'econ-pane',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /建筑与基础设施/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /钢铁厂/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /I 级 63%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /II 级 37%/ })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /钢铁，铁矿石与煤的冶炼/ }),
    ).toBeUndefined()
    await ui.unmount()
  })

  test('the economy tab draws the tier proportion bar across all 5 tiers', async ($, on) => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    // Plan 0016 §S4: a 5-seat-class mix must render five bar segments, with
    // roman IV/V labels and a TIER_COLORS entry for every tier.
    qing.econ.buildings.steelMills = 100
    qing.econ.buildingTiers.steelMills = [40, 25, 20, 10, 5]
    on('ui.render', { component: 'Pane', requestId: 'econ-five-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="economy"
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'econ-five-pane',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /I 级 40%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /II 级 25%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /III 级 20%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /IV 级 10%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /V 级 5%/ })).toBeDefined()
    await ui.unmount()
  })

  test('the tech tab is read-only: researchable nodes are Text, not buttons', async ($, on) => {
    const world = newWorld(3, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    const pickable = TECH_NODES.find(node => canResearchNode(qing.tech, node))
    expect(pickable).toBeDefined()
    if (pickable === undefined) return
    on('ui.render', { component: 'Pane', requestId: 'tech-pane' }, async ($hang, e) => {
      const kit = ($hang as unknown as { ui: { resolve: (x: unknown) => UiKit } }).ui.resolve(e)
      return (
        <Panel
          ui={kit}
          world={world}
          width={e.props.bodyColumns}
          tab="tech"
          notice=""
          onTab={() => undefined}
          onControl={() => undefined}
          onEvent={() => undefined}
          council={{ isOpen: true, report: '', secretaryReport: '', isRunning: false }}
          onCouncil={() => undefined}
        />
      )
    })
    const ui = await $.ui.mount({
      plugin: 'terminal-legend',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'tech-pane',
      props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: /v3_action research/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /可研究/ })).toBeDefined()
    // Before §S6 a researchable node rendered its name as a Button; the Text
    // lookup would then fail. Now the whole panel is a read-only dashboard.
    expect(await ui.find({ type: 'Text', text: new RegExp(pickable.name) })).toBeDefined()
    // Plan 0016 §S4: `effectText` renders `unlockTier` effects up to tier 5.
    expect(await ui.find({ type: 'Text', text: /解锁钢铁厂等级5/ })).toBeDefined()
    await ui.unmount()
  })
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
