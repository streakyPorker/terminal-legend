import type { EngineInterface } from 'claude-code'
import type { WorldState } from '../types'

/** Current world shape; older in-memory worlds are discarded like old saves. */
export const CURRENT_WORLD_VERSION = 7

const safeName = (name: string | undefined): string => {
  const cleaned = (name ?? 'save').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  return cleaned === '' ? 'save' : cleaned
}

async function projectRoot($: EngineInterface): Promise<string> {
  try {
    return await $.session.root()
  } catch {
    return await $.session.cwd()
  }
}

export async function savePath($: EngineInterface, name?: string): Promise<string> {
  const root = await projectRoot($)
  return `${root}/.terminal-legend/${safeName(name)}.json`
}

export async function saveGame(
  $: EngineInterface,
  world: WorldState,
  name?: string,
): Promise<string> {
  const path = await savePath($, name)
  await $.fs.write(path, JSON.stringify(world))
  return path
}

/**
 * Accepts only the current world shape. Older saves are deliberately not
 * supported (ADR 0005: no compatibility layer during early development).
 */
export function parseWorld(raw: unknown): WorldState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const world = raw as WorldState
  if (world.version !== CURRENT_WORLD_VERSION) return undefined
  if (typeof world.tick !== 'number' || typeof world.playerId !== 'string') return undefined
  if (typeof world.date !== 'object' || world.date === null) return undefined
  if (typeof world.countries !== 'object' || world.countries === null) return undefined
  if (typeof world.resumeOnStart !== 'boolean') return undefined
  return world
}

export async function loadGame(
  $: EngineInterface,
  name?: string,
): Promise<WorldState | undefined> {
  const path = await savePath($, name)
  const exists = await $.fs.exists(path)
  if (!exists) return undefined
  try {
    const text = await $.fs.read(path)
    const world = parseWorld(JSON.parse(text))
    // A session that ended mid-secretary leaves this transient flag set; it
    // must not lock the next session out of summoning the secretary.
    if (world !== undefined) world.secretary.isRunning = false
    return world
  } catch {
    return undefined
  }
}

export async function hasSave($: EngineInterface, name?: string): Promise<boolean> {
  try {
    return await $.fs.exists(await savePath($, name))
  } catch {
    return false
  }
}
