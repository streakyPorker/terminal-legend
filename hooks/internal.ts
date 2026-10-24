import type { EngineInterface } from 'claude-code'
import type { UiState, WorldState } from '../types'
import { initialUi } from '../engine/data'
import { CURRENT_WORLD_VERSION } from '../engine/save'
import { statusLine } from '../view/format'

// ---------------------------------------------------------------- constants

export const PANE = 'terminal-legend'
const WORLD = { plugin: 'terminal-legend', key: 'world' } as const
const UI = { plugin: 'terminal-legend', key: 'ui' } as const
export const SECRETARY_AGENT = 'terminal-legend:secretary'
export const SECRETARY_TIMEOUT_MS = 240_000
// Live-event generation is a blocking call in the turn's critical path; this
// bounds it so time never stalls (ADR 0025 §7; value is 待定, plan 0010 §10).
export const LIVE_EVENT_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------- state

export async function getWorld($: EngineInterface): Promise<WorldState | undefined> {
  const world = (await $.state.get(WORLD)).value
  // A world left in plugin state by an older build is not migrated (ADR 0005);
  // it must not keep drawing a stale status line or crash the new engine.
  if (world !== undefined && world.version !== CURRENT_WORLD_VERSION) return undefined
  return world
}

export async function setWorld($: EngineInterface, world: WorldState): Promise<void> {
  await $.state.set(WORLD, world)
}

export async function getUi($: EngineInterface): Promise<UiState> {
  return (await $.state.get(UI)).value ?? initialUi()
}

export async function setUi($: EngineInterface, ui: UiState): Promise<void> {
  await $.state.set(UI, ui)
}

export async function patchUi($: EngineInterface, patch: Partial<UiState>): Promise<void> {
  await setUi($, { ...(await getUi($)), ...patch })
}

export async function activeWorld(
  $: EngineInterface,
): Promise<{ world: WorldState; ui: UiState } | undefined> {
  const world = await getWorld($)
  const ui = await getUi($)
  if (world === undefined || !ui.isActive) return undefined
  return { world, ui }
}

/**
 * Repo root for reading repo docs at runtime (the GM handbook). Mirrors the
 * save/load path resolution; it never touches `.terminal-legend/save.json`.
 */
export async function readProjectDoc($: EngineInterface, relativePath: string): Promise<string | undefined> {
  const root = await (async (): Promise<string> => {
    try {
      return await $.session.root()
    } catch {
      return await $.session.cwd()
    }
  })()
  const path = `${root}/${relativePath}`
  const exists = await $.fs.exists(path)
  if (!exists) return undefined
  const text = await $.fs.read(path)
  return typeof text === 'string' && text.trim() !== '' ? text : undefined
}

// ---------------------------------------------------------------- text

export function pendingOf(world: WorldState) {
  return world.events.filter(event => event.countryId === world.playerId && !event.isResolved)
}

// ---------------------------------------------------------------- GM notifications

/**
 * Who set a mutation in motion: the GM via an MCP tool (`tool`), the player via
 * a panel button or a typed `/v3` command (`ui`), or the engine itself (`engine`,
 * e.g. a managed-run step).
 */
export type ActionOrigin = 'tool' | 'ui' | 'engine'

/**
 * Appends one hidden user-role row the GM model reads on its next request.
 * `$.ui.log` is NOT model-visible, so panel-button and typed-command actions —
 * and managed-run outcomes — must go through here or the narrator never learns
 * the world moved (PT-044/PT-045). Best-effort: a refusal or a closed session
 * must never fail the action that triggered it.
 */
export async function noteToModel($: EngineInterface, text: string): Promise<void> {
  try {
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text }] },
    })
  } catch {
    // The row is a courtesy to the GM; the game action stands regardless.
  }
}

// ---------------------------------------------------------------- UI plumbing

export async function refreshStatus($: EngineInterface): Promise<void> {
  const world = await getWorld($)
  const ui = await getUi($)
  if (world === undefined || !ui.isActive) {
    $.ui.status(undefined)
    return
  }
  const council = ui.council?.isOpen === true ? ' · 待议' : ' · 已批'
  $.ui.status(`${statusLine(world)}${council}`)
}

export async function openPane($: EngineInterface): Promise<void> {
  try {
    const opened = await $.ui.open({ id: PANE, title: '终末传奇' })
    await patchUi($, { isPaneOpen: opened.isPlaced })
    if (!opened.isPlaced) {
      $.ui.log('终末传奇：面板暂未展开（终端宽度不足），加宽终端或按 Ctrl+X Tab 查看。')
    }
  } catch (error) {
    $.ui.log(`终末传奇：打开面板失败 ${String(error)}`, { to: 'debug' })
  }
}

// ---------------------------------------------------------------- shared mutable state

/** agentId -> settle the answer its `turn.complete` will carry. */
export const secretaryAnswers = new Map<string, (text: string) => void>()

// Set while a managed (delegated) run is in flight; read by the command surface.
let delegatedRun = false

export function isDelegatedRun(): boolean {
  return delegatedRun
}

export function setDelegatedRun(value: boolean): void {
  delegatedRun = value
}

// Set when the player asks the in-flight delegated run to stop (PT-039). The
// monthly loop polls it and breaks after the current month; `v3_control`/`/v3
// stop` set it, `startDelegated` clears it.
let delegatedStopRequested = false

export function requestDelegatedStop(): void {
  delegatedStopRequested = true
}

export function isDelegatedStopRequested(): boolean {
  return delegatedStopRequested
}

export function clearDelegatedStop(): void {
  delegatedStopRequested = false
}
