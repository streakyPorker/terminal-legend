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

