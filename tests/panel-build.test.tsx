import { describe, expect, test } from 'claude-code/testing'

/**
 * PT-056: the build-panel order path read `world.econ`, which does not exist
 * (the queue hangs off `world.countries[playerId].econ`). Every `建 1×1` click
 * threw, and `void controlGame(...)` in the render hook swallowed the
 * rejection, so the button looked dead. These tests drive the real Pane hook
 * and press the real buttons.
 */
const noop = { value: undefined }

async function boot($: any, on: any): Promise<{ run: (args: string) => Promise<unknown> }> {
  const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
  anyOn('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  anyOn('command.register', ($: any, e: any) => ({ value: { command: e.command } }))
  anyOn('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__terminal-legend__${e.name}` } }))
  anyOn('agent.register', () => ({ value: { agent: 'terminal-legend:secretary' } }))
  anyOn('fs.exists', () => ({ value: false }))
  anyOn('fs.write', () => noop)
  anyOn('fs.read', () => ({ value: '' }))
  anyOn('env.get', () => ({ value: '/tmp' }))
  anyOn('session.root', () => ({ value: '/tmp' }))
  anyOn('session.cwd', () => ({ value: '/tmp' }))
  anyOn('session.id', () => ({ value: 'panel-build-session' }))
  anyOn('clock.every', () => noop)
  anyOn('ui.open', () => ({ value: { isPlaced: true } }))
  anyOn('ui.status', () => noop)
  anyOn('ui.log', () => noop)
  anyOn('ui.toast', () => noop)
  anyOn('session.append', ($: any, e: any, next: any) => next(e))
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

  await ($.session.start as unknown as (e: unknown) => Promise<unknown>)({
    cwd: '/tmp',
    surface: 'terminal',
    isInteractive: true,
  })
  const run = (args: string) =>
    ($.command.run as unknown as (e: unknown) => Promise<unknown>)({ command: 'v3', args })
  await run('new QING')
  return { run }
}

async function mountPane($: any) {
  return $.ui.mount({
    plugin: 'terminal-legend',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'terminal-legend',
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
}

describe('build panel order buttons (PT-056)', () => {
  test('建 1×1 queues one state project', async ($, on) => {
    await boot($, on)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Button', key: 'o:farms:1x1' })).toBeDefined()
    await pane.press({ key: 'o:farms:1x1' })
    expect(await pane.find({ type: 'Text', text: /农场×1/ })).toBeDefined()
    await pane.unmount()
  })

  test('建 5×1 queues five buildings in one slot', async ($, on) => {
    await boot($, on)
    const pane = await mountPane($)
    await pane.press({ key: 'o:coalMines:5x1' })
    expect(await pane.find({ type: 'Text', text: /煤矿×5/ })).toBeDefined()
    await pane.unmount()
  })

  test('⇤1×1 lands the order at the head of the queue', async ($, on) => {
    await boot($, on)
    const pane = await mountPane($)
    await pane.press({ key: 'o:farms:1x1' })
    await pane.press({ key: 'o:coalMines:head' })
    // The order report is echoed as the panel notice; a thrown `world.econ`
    // (the PT-056 bug) would leave no notice at all.
    expect(await pane.find({ type: 'Text', text: /置于队首/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /煤矿×1/ })).toBeDefined()
    await pane.unmount()
  })
})
