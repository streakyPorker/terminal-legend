import { describe, expect, test } from 'claude-code/testing'

/**
 * Plan 0015 §S6 / ADR 0031 §8: the build page became a read-only dashboard —
 * the `建 1×1` / `建 5×1` / `⇤1×1` order buttons are gone and ordering happens
 * in the dialogue (`v3_action build` / `v3_action upgrade`). Queue management
 * (取消 / ↑ / ↓ / 置顶) stays on the panel and must keep working.
 *
 * PT-056 regression guard: the queue hangs off `world.countries[playerId].econ`,
 * and the controls are driven through the real Pane hook and real presses. The
 * orders are seeded through the real GM tool path — the only entry left.
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

type ToolResult = { result?: string; deny?: string }

const callTool = ($: any, input: Record<string, unknown>): Promise<ToolResult> =>
  ($.tool.call as unknown as (e: unknown) => Promise<ToolResult>)({
    agentId: 'gm',
    ...input,
  })

/** One order through the real GM tool path (the only entry left in §S6). */
async function order($: any, params: Record<string, unknown>): Promise<void> {
  const result = await callTool($, {
    tool: 'mcp__terminal-legend__v3_action',
    action: 'build',
    ...params,
  })
  expect(result.result).toBeDefined()
}

/** The player queue order, read straight off `v3_inspect construction`. */
async function queueIds($: any): Promise<string[]> {
  const result = await callTool($, {
    tool: 'mcp__terminal-legend__v3_inspect',
    section: 'construction',
  })
  const text = result.result ?? ''
  expect(text).toContain('建造力')
  return [...text.matchAll(/id=(\S+)/g)].map(match => match[1] ?? '')
}

describe('build panel is a read-only dashboard (plan 0015 §S6)', () => {
  test('no order buttons render and the hint points at the dialogue', async ($, on) => {
    await boot($, on)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: /可建建筑/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /下单请在对话中下令/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /v3_action build \/ upgrade/ })).toBeDefined()
    for (const id of ['farms', 'coalMines', 'steelMills', 'workshops']) {
      expect(await pane.find({ type: 'Button', key: `o:${id}:1x1` })).toBeUndefined()
      expect(await pane.find({ type: 'Button', key: `o:${id}:5x1` })).toBeUndefined()
      expect(await pane.find({ type: 'Button', key: `o:${id}:head` })).toBeUndefined()
    }
    expect(await pane.find({ type: 'Text', text: /没有在建的国有项目/ })).toBeDefined()
    await pane.unmount()
  })

  test('queue management still cancels a project', async ($, on) => {
    await boot($, on)
    await order($, { building: 'farms', count: 1 })
    const ids = await queueIds($)
    expect(ids.length).toBe(1)
    const id = ids[0] ?? ''
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Button', key: `cancel:${id}` })).toBeDefined()
    await pane.press({ key: `cancel:${id}` })
    // The cancel report is echoed as the panel notice; the queue row is gone.
    expect(await pane.find({ type: 'Text', text: /取消了.*农场×1/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `cancel:${id}` })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /没有在建的国有项目/ })).toBeDefined()
    await pane.unmount()
  })

  test('queue management still reorders', async ($, on) => {
    await boot($, on)
    await order($, { building: 'farms', count: 1 })
    await order($, { building: 'coalMines', count: 1 })
    const ids = await queueIds($)
    expect(ids.length).toBe(2)
    const first = ids[0] ?? ''
    const second = ids[1] ?? ''
    const pane = await mountPane($)
    // First row: no ↑, has ↓. Last row: has ↑, no ↓.
    expect(await pane.find({ type: 'Button', key: `up:${first}` })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: `down:${first}` })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `up:${second}` })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `down:${second}` })).toBeUndefined()
    // ↓ on the first row moves 农场 after 煤矿; the queue order flips.
    await pane.press({ key: `down:${first}` })
    expect(await pane.find({ type: 'Button', key: `up:${first}` })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `down:${second}` })).toBeDefined()
    expect(await queueIds($)).toEqual([second, first])
    // ↑ moves it back to the head.
    await pane.press({ key: `up:${first}` })
    expect(await pane.find({ type: 'Button', key: `down:${first}` })).toBeDefined()
    expect(await queueIds($)).toEqual([first, second])
    await pane.unmount()
  })

  test('a real upgrade order renders its roman tier label on the pane (plan 0016 §S4)', async ($, on) => {
    await boot($, on)
    // The default QING world ships `general-1836`, so farms II is unlocked and
    // a I→II order goes through the real GM path.
    const result = await callTool($, {
      tool: 'mcp__terminal-legend__v3_action',
      action: 'upgrade',
      building: 'farms',
      fromTier: 1,
      toTier: 2,
      count: 2,
    })
    expect(result.result).toContain('列入升级队列')
    const ids = await queueIds($)
    expect(ids.length).toBe(1)
    const pane = await mountPane($)
    expect(await pane.find({ type: 'Text', text: /农场 I→II ×2/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: `cancel:${ids[0] ?? ''}` })).toBeDefined()
    const inspect = await callTool($, {
      tool: 'mcp__terminal-legend__v3_inspect',
      section: 'construction',
    })
    expect(inspect.result ?? '').toContain('农场 I→II×2')
    await pane.unmount()
  })
})
