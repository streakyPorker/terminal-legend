import type { EngineInterface } from 'claude-code'
import type {
  Bureaucracy,
  Country,
  Economy,
  SecretaryState,
  WorldState,
} from '../types'
import {
  administrativeCapacityFor,
  defaultSecretaryState,
  deriveBureaucracy,
  deriveUnemployment,
} from './data'

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

type LegacyEconomy = Economy & { infrastructure?: number }
type LegacyCountry = Omit<Country, 'econ' | 'bureaucracy'> & {
  econ: LegacyEconomy
  bureaucracy?: Bureaucracy
}
type LegacyWorld = Omit<WorldState, 'countries' | 'secretary' | 'ironman'> & {
  version: number
  countries: Record<string, LegacyCountry>
  secretary?: SecretaryState
  ironman?: boolean
}

/**
 * Brings a v1 (or already-v2) save up to the current world shape. Returns
 * undefined for anything that is not a game world, so a stray file read as
 * JSON cannot brick the session.
 */
export function migrateWorld(raw: unknown): WorldState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const world = raw as LegacyWorld
  if (world.version !== 1 && world.version !== 2) return undefined
  if (typeof world.tick !== 'number' || typeof world.playerId !== 'string') return undefined
  if (typeof world.date !== 'object' || world.date === null) return undefined
  if (typeof world.countries !== 'object' || world.countries === null) return undefined

  for (const country of Object.values(world.countries)) {
    if (typeof country !== 'object' || country === null) return undefined
    const econ = country.econ
    if (typeof econ !== 'object' || econ === null) return undefined

    if (typeof econ.transportInfrastructure !== 'number') {
      econ.transportInfrastructure =
        typeof econ.infrastructure === 'number' ? econ.infrastructure : 25
    }
    delete econ.infrastructure
    if (typeof econ.administrativeCapacity !== 'number') {
      econ.administrativeCapacity = administrativeCapacityFor(
        country.pops.literacy,
        econ.spending.bureaucracy,
      )
    }
    if (typeof econ.buildings.offices !== 'number') econ.buildings.offices = 0
    if (!Array.isArray(econ.constructionQueue)) econ.constructionQueue = []
    if (typeof country.bureaucracy !== 'object' || country.bureaucracy === null) {
      country.bureaucracy = deriveBureaucracy(country as unknown as Country, false)
    }
    if (typeof econ.unemployment !== 'number') {
      econ.unemployment = deriveUnemployment(country as unknown as Country)
    }
  }

  world.version = 2
  world.secretary ??= defaultSecretaryState()
  world.ironman ??= false
  return world as unknown as WorldState
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
    return migrateWorld(JSON.parse(text))
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
 * Notes that this session is running a game. The status line now always shows
 * claude-hud and the campaign's band together, so this is bookkeeping only.
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
