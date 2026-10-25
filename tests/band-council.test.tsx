import { describe, expect, test } from 'claude-code/testing'

/**
 * PT-072: the band's 「打开议事」 button looked dead. Two causes:
 *   1. it shared the key `band:council` with the later 「御前」 button, so the
 *      two rows registered the same element key on the same site;
 *   2. the band sits outside the pane, and `controlGame('council')` only wrote
 *      `ui.tab` plus `$.ui.open`, which retitles an already-open pane without
 *      redrawing it.
 * Fixed by a unique key (`band:open-council`) and an explicit
 * `$.ui.invalidate('ui.render')` (hooks/internal.redrawUi).
 *
 * This drives the real band and the real pane: press the band button, then
 * read the pane.
 */
const noop = { value: undefined }

async function boot($: any, on: any): Promise<void> {
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
  anyOn('session.id', () => ({ value: 'band-council-session' }))
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
  await ($.command.run as unknown as (e: unknown) => Promise<unknown>)({
    command: 'v3',
    args: 'new QING',
  })
}

async function mountPane($: any): Promise<any> {
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

async function mountBand($: any): Promise<any> {
  return $.ui.mount({
    plugin: 'terminal-legend',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'terminal-legend',
    props: {
      bodyColumns: 110,
      maxRows: 40,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    } as unknown as never,
  })
}

describe('band council button (PT-072)', () => {
  test('打开议事 switches an already-open pane back to the council tab', async ($, on) => {
    await boot($, on)
    const pane = await mountPane($)

    // The council holds under review, so the band's extra row is drawn.
    await pane.press({ key: 'tab:market' })
    expect(await pane.find({ type: 'Text', text: '商品市场' })).toBeDefined()

    // The band is the only site this press touches; the pane must follow.
    const band = await mountBand($)
    expect(await band.find({ type: 'Button', key: 'band:open-council' })).toBeDefined()
    await band.press({ key: 'band:open-council' })

    expect(await pane.find({ type: 'Text', text: '御前会议' })).toBeDefined()

    await band.unmount()
    await pane.unmount()
  })
})
