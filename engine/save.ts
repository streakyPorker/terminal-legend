import type { EngineInterface } from 'claude-code'
import type { WorldState } from '../types'

const ACTIVE_TTL_MS = 12 * 60 * 60 * 1000

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

export async function loadGame(
  $: EngineInterface,
  name?: string,
): Promise<WorldState | undefined> {
  const path = await savePath($, name)
  const exists = await $.fs.exists(path)
  if (!exists) return undefined
  try {
    const text = await $.fs.read(path)
    const parsed = JSON.parse(text) as WorldState
    if (parsed.version !== 1 || typeof parsed.tick !== 'number') return undefined
    if (parsed.countries === undefined || parsed.date === undefined) return undefined
    return parsed
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

type ActiveEntry = { id: string; cwd: string; at: number }

async function activePath($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return undefined
  return `${home}/.claude/plugins/terminal-legend/active.json`
}

async function readActive($: EngineInterface, path: string): Promise<ActiveEntry[]> {
  try {
    if (!(await $.fs.exists(path))) return []
    const text = await $.fs.read(path)
    const parsed = JSON.parse(text) as { sessions?: ActiveEntry[] }
    if (!Array.isArray(parsed.sessions)) return []
    const cutoff = Date.now() - ACTIVE_TTL_MS
    return parsed.sessions.filter(
      entry =>
        typeof entry.id === 'string' &&
        typeof entry.cwd === 'string' &&
        typeof entry.at === 'number' &&
        entry.at >= cutoff,
    )
  } catch {
    return []
  }
}

/**
 * Tells the statusline dispatcher whether this session is running a game, so
 * claude-hud yields the line while a campaign is active.
 */
export async function setActive($: EngineInterface, isActive: boolean): Promise<void> {
  const path = await activePath($)
  if (path === undefined) return
  const id = await $.session.id()
  const cwd = await $.session.cwd()
  const entries = (await readActive($, path)).filter(entry => entry.id !== id)
  if (isActive) entries.push({ id, cwd, at: Date.now() })
  try {
    await $.fs.write(path, JSON.stringify({ sessions: entries }, null, 2))
  } catch {
    // A status line is decoration; the game runs without it.
  }
}
