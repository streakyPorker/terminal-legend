import { describe, expect, test } from 'claude-code/testing'
import { makeRngForWorld } from '../engine/data'
import { newWorld } from '../engine/sim'
import type { LogEntry, WorldState } from '../types'
import {
  settleDueSituations,
  situationStanceName,
  situationStatus,
  situationTitleOf,
  tickSituations,
} from '../engine/situations'
import { Panel, type UiKit } from '../view/panels'

const PANE_PROPS = {
  title: '终末传奇',
  isFocused: false,
  bodyColumns: 110,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as unknown as never

const rngFor = (world: WorldState) => makeRngForWorld(world)

describe('S4 council/chronicle surface (plan 0002 §4)', () => {
  test('the council card shows an open proposal, its stance and its source', async ($, on) => {
    const world = newWorld(3, 'QING')
    world.situations.push({
      id: 'gbr-free-trade',
      kind: 'gbr-free-trade',
      opened: { ...world.date },
      countries: ['GBR'],
      proposals: [{ countryId: 'GBR', stance: 'free-trade', narrative: '降低关税壁垒' }],
      resolved: false,
      months: 1,
    })
    on('ui.render', { component: 'Pane', requestId: 'situation-open' }, async ($hang, e) => {
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
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'terminal-legend',
        surface,
        component: 'Pane',
        requestId: 'situation-open',
        props: PANE_PROPS,
      })
      expect(await ui.find({ type: 'Text', text: /自由贸易转向/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /自由贸易/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /降低关税壁垒/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /来源 situation:gbr-free-trade/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the council card shows a resolved outcome', async ($, on) => {
    const world = newWorld(3, 'QING')
    world.situations.push({
      id: 'qing-self-strengthening',
      kind: 'qing-self-strengthening',
      opened: { ...world.date },
      countries: ['QING'],
      proposals: [{ countryId: 'QING', stance: 'self-strengthen', narrative: '' }],
      resolved: true,
      resultId: 'self-strengthen',
      resolvedAt: { ...world.date },
      months: 3,
    })
    on('ui.render', { component: 'Pane', requestId: 'situation-done' }, async ($hang, e) => {
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
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'terminal-legend',
        surface,
        component: 'Pane',
        requestId: 'situation-done',
        props: PANE_PROPS,
      })
      expect(await ui.find({ type: 'Text', text: /自强运动/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /已解决：自强/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('resolution writes a chronicle entry naming the title and outcome', async () => {
    const world = newWorld(7301, 'GBR')
    world.date = { year: 1850, month: 1 }
    tickSituations(world, [])
    const record = world.situations.find(one => one.id === 'gbr-free-trade')
    if (record === undefined) throw new Error('no line')
    const log: LogEntry[] = []
    record.months = 3
    await settleDueSituations(world, async () => '', rngFor(world), log)
    expect(log.some(entry => entry.text.includes('自由贸易转向'))).toBe(true)
    expect(log.some(entry => entry.text.includes('自由贸易'))).toBe(true)
  })

  test('title/stance/status helpers read the registry, not hard-coded opium text', () => {
    const world = newWorld(7302, 'QING')
    world.date = { year: 1861, month: 1 }
    tickSituations(world, [])
    const record = world.situations.find(one => one.id === 'qing-self-strengthening')
    if (record === undefined) throw new Error('no line')
    expect(situationTitleOf(record)).toBe('自强运动')
    expect(situationStatus(world).startsWith('局势「')).toBe(true)
    expect(situationStanceName('self-strengthen')).toBe('自强')
  })
})
