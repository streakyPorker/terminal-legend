import { describe, expect, test } from 'claude-code/testing'

// Split out of `first-slice.test.ts` (plan 0012 S6): the command/hook-surface
// halves of the M3/M4/M5/M6 milestones plus the `v3_manual` tool surface. The
// engine-side halves live in `first-slice-engine.test.ts`.

const setupSurface = (
  anyOn: (event: string, hook: ($: any, e: any) => unknown) => void,
  extra?: Record<string, ($: any, e: any) => unknown>,
): void => {
  const hooks: Record<string, ($: any, e: any) => unknown> = {
    'session.start': ($: any, e: any) => ({ cwd: e.cwd }),
    'command.register': ($: any, e: any) => ({ value: { command: e.command } }),
    'tool.register': ($: any, e: any) => ({
      value: { tool: `mcp__terminal-legend__${e.name}` },
    }),
    'agent.register': () => ({ value: { agent: 'terminal-legend:secretary' } }),
    'turn.complete': () => ({ text: '' }),
    'fs.exists': () => ({ value: false }),
    'fs.write': () => ({ value: undefined }),
    'fs.read': () => ({ value: '' }),
    'env.get': () => ({ value: '/tmp' }),
    'session.root': () => ({ value: '/tmp' }),
    'session.cwd': () => ({ value: '/tmp' }),
    'session.id': () => ({ value: 'test-session' }),
    'ui.open': () => ({ value: { isPlaced: true } }),
    'ui.status': () => ({ value: undefined }),
    'ui.log': () => ({ value: undefined }),
    'ui.toast': () => ({ value: undefined }),
    ...extra,
  }
  for (const [event, hook] of Object.entries(hooks)) anyOn(event, hook)
}

const startCampaign = async (
  $: any,
): Promise<((input: unknown) => Promise<{ text: string }>)> => {
  await ($.session.start as unknown as (e: unknown) => Promise<unknown>)({
    cwd: '/tmp',
    surface: 'terminal',
    isInteractive: true,
  })
  const run = (input: unknown) =>
    ($.command.run as unknown as (e: unknown) => Promise<{ text: string }>)(input)
  await run({ command: 'v3', args: 'new QING' })
  return run
}

// ---------------------------------------------------------------- M3

describe('M3 secretary subagent', () => {
  test('the secretary type is hidden from the model', async ($) => {
    const offered = await $.agent.offer({ agent: 'terminal-legend:secretary' })
    expect(offered).toEqual({ isOffered: false })
  })

  test(
    'a secretary war declaration is audited, not refused',
    async ($, on) => {
      const toasts: string[] = []
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'ui.toast': (_$: any, e: any) => {
          toasts.push(String(e.text ?? ''))
          return { value: undefined }
        },
      })
      await startCampaign($ as any)

      const result = (await ($.tool.call as unknown as (e: unknown) => Promise<unknown>)({
        tool: 'mcp__terminal-legend__v3_diplomacy',
        target: 'GBR',
        move: 'war',
        reason: '秘书擅自开战',
        agentId: 'secretary-1',
      })) as { result?: string; deny?: string }
      expect(result.result).toBeDefined()
      expect(result.result ?? '').toContain('宣战')
      expect(toasts.some(text => text.includes('秘书越权'))).toBe(true)
    },
  )
})

describe('M3 secretary command surface', () => {
  test(
    'the fourth consecutive overreach is refused',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn)
      await startCampaign($ as any)
      const call = () =>
        ($.tool.call as unknown as (e: unknown) => Promise<{ result?: string; deny?: string }>)({
          tool: 'mcp__terminal-legend__v3_cheat',
          action: 'treasury',
          amount: 1,
          agentId: 'secretary-1',
        })
      const first = await call()
      expect(first.result).toBeDefined()
      const second = await call()
      expect(second.result).toBeDefined()
      const third = await call()
      expect(third.result).toBeDefined()
      const fourth = await call()
      expect(fourth.deny ?? '').toContain('越权')
    },
  )


  // The test harness has no engine beneath `agent.spawn` that starts a real
  // subagent and mints an agentId, so the full spawn -> turn.complete round
  // trip cannot be mocked here. The command surface and the tool path the
  // secretary uses are covered instead.
  test(
    'delegation toggles and an agent build uses the same tool path',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'agent.spawn': () => ({ model: 'haiku' }),
        'clock.after': () => ({ value: { cancel: () => undefined } }),
      })
      const run = await startCampaign($ as any)

      const delegated = await run({ command: 'v3', args: 'delegate internal on' })
      expect(delegated.text).toContain('内政委托已开启')

      const built = (await ($.tool.call as unknown as (e: unknown) => Promise<unknown>)({
        tool: 'mcp__terminal-legend__v3_action',
        action: 'build',
        building: 'farms',
        count: 1,
        agentId: 'secretary-1',
      })) as { result?: string; deny?: string }
      expect(built.result ?? '').toContain('建造队列')

      const status = await run({ command: 'v3', args: 'status' })
      expect(status.text).toContain('建造队列')
      expect(status.text).toContain('农场×1')
      expect(status.text).toContain('内政开')

      const started = await run({ command: 'v3', args: 'secretary' })
      expect(started.text).toContain('已受命')
    },
  )
})

// ---------------------------------------------------------------- M4/M5

describe('M4/M5 council and managed runs', () => {
  test('a managed run starts in the background and advances', async ($, on) => {
    const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
    setupSurface(anyOn)
    const run = await startCampaign($ as any)
    const started = await run({ command: 'v3', args: 'run 2' })
    expect(started.text).toContain('托管已开始')
    // The background host advances on its own schedule, so poll for the target
    // date instead of sleeping a fixed 250ms: per-month work grew with the trade
    // slices, and sibling test files keep the event loop busy, which made a short
    // fixed wait flaky. The assertion is unchanged.
    let status = ''
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      status = (await run({ command: 'v3', args: 'status' })).text
      if (status.includes('1836年2月') || status.includes('1836年3月')) break
    }
    // A pending event or a new war legitimately stops a managed run after one
    // month (plan 0001 §5); either way the run must have advanced past January.
    expect(status).toMatch(/1836年[23]月/)
  })
})

// ---------------------------------------------------------------- M6

describe('M6 ironman command surface', () => {
  test('the cheat command accepts camelCase actions', async ($, on) => {
    const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
    setupSurface(anyOn)
    const run = await startCampaign($ as any)
    const points = await run({ command: 'v3', args: 'cheat techPoints 50' })
    expect(points.text).toContain('科技点')
    const score = await run({ command: 'v3', args: 'cheat warScore GBR 10' })
    expect(score.text).toContain('并未交战')
  })


  test(
    'ironman blocks destiny, named saves and loading',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn, {
        'agent.spawn': () => ({ model: 'haiku' }),
        'clock.after': () => ({ value: { cancel: () => undefined } }),
      })
      const run = await startCampaign($ as any)

      const enabled = await run({ command: 'v3', args: 'ironman on' })
      expect(enabled.text).toContain('铁人模式已开启')

      const cheat = await run({ command: 'v3', args: 'cheat treasury 100' })
      expect(cheat.text).toContain('铁人')

      const saved = await run({ command: 'v3', args: 'save backup' })
      expect(saved.text).toContain('铁人')

      const loaded = await run({ command: 'v3', args: 'load backup' })
      expect(loaded.text).toContain('铁人')

      await run({ command: 'v3', args: 'next' })
      const late = await run({ command: 'v3', args: 'ironman off' })
      expect(late.text).toContain('第一个月')
    },
  )
})

// ---------------------------------------------------------------- v3_manual

describe('v3_manual tool surface', () => {
  test(
    'returns the handbook text when the doc exists',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      const handbook = `# 终末传奇 GM 手册\n${'规则口径说明。'.repeat(40)}`
      setupSurface(anyOn, {
        'fs.exists': (_$: any, e: any) => ({
          value: String(e.path).endsWith('docs/gm-handbook.md'),
        }),
        'fs.read': (_$: any, e: any) => ({
          value: String(e.path).endsWith('docs/gm-handbook.md') ? handbook : '',
        }),
      })
      await startCampaign($ as any)
      const result = (await ($.tool.call as unknown as (e: unknown) => Promise<{
        result?: string
        deny?: string
      }>)({ tool: 'mcp__terminal-legend__v3_manual' }))
      expect(result.result ?? '').toContain('GM 手册')
      expect((result.result ?? '').length).toBeGreaterThan(100)
    },
  )

  test(
    'falls back to a tool and section list when the doc is missing',
    async ($, on) => {
      const anyOn = on as unknown as (event: string, hook: ($: any, e: any) => unknown) => void
      setupSurface(anyOn)
      await startCampaign($ as any)
      const result = (await ($.tool.call as unknown as (e: unknown) => Promise<{
        result?: string
        deny?: string
      }>)({ tool: 'mcp__terminal-legend__v3_manual' }))
      expect(result.result ?? '').toContain('v3_inspect')
      expect(result.result ?? '').toContain('rankings')
    },
  )
})
