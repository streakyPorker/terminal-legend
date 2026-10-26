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

