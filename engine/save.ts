import type { EngineInterface } from 'claude-code'
import type { WorldState } from '../types'
import { BUILDING_IDS, DEFAULT_TAX_RATES, emptyBuildingProfits, emptyTaxBaseQty } from './data'
import { normalizeConstructionQueue } from './sim'

/** Current world shape; older in-memory worlds are discarded like old saves. */
export const CURRENT_WORLD_VERSION = 13

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
/**
 * Fills fields added after v7 was first written. The construction-sector
 * building is additive, so an old v7 save can keep playing: every country
 * without workshops gets one, and the construction-rent / per-project capacity
 * fields default to 0.
 */
function normalizeWorld(world: WorldState): WorldState {
  if (!Array.isArray(world.tradeRoutes)) world.tradeRoutes = []
  for (const country of Object.values(world.countries)) {
    const buildings = country.econ.buildings as Record<string, number>
    if (typeof buildings.workshops !== 'number') {
      buildings.workshops = 1
    }
    for (const id of BUILDING_IDS) {
      if (typeof buildings[id] !== 'number') buildings[id] = 0
    }
    if (typeof country.econ.lastConstructionRent !== 'number') {
      country.econ.lastConstructionRent = 0
    }
    if (typeof country.econ.lastIncomeOther !== 'number') {
      country.econ.lastIncomeOther = 0
    }
    if (typeof country.econ.lastPrivateStartTick !== 'number') {
      country.econ.lastPrivateStartTick = -999
    }
    if (typeof country.econ.buildingProfits !== 'object' || country.econ.buildingProfits === null) {
      country.econ.buildingProfits = emptyBuildingProfits()
    }
    if (typeof country.econ.taxBaseQty !== 'object' || country.econ.taxBaseQty === null) {
      country.econ.taxBaseQty = emptyTaxBaseQty()
    }
    if (typeof country.econ.taxes !== 'object' || country.econ.taxes === null) {
      country.econ.taxes = { ...DEFAULT_TAX_RATES, tariff: country.econ.tariff ?? 0 }
    }
    const history = country.econ.history as Record<string, unknown>
    for (const key of [
      'gdp',
      'treasury',
      'sol',
      'legitimacy',
      'radicals',
      'c',
      'i',
      'g',
      'income',
      'expense',
      'unemployment',
      'debt',
      'tariff',
    ]) {
      if (!Array.isArray(history[key])) history[key] = []
    }
    if (
      typeof country.econ.lastConstructionDemand !== 'object' ||
      country.econ.lastConstructionDemand === null
    ) {
      country.econ.lastConstructionDemand = {}
    }
    for (const project of country.econ.constructionQueue) {
      if (typeof project.lastCapacity !== 'number') project.lastCapacity = 0
    }
    normalizeConstructionQueue(country)
  }
  return world
}

export function parseWorld(raw: unknown): WorldState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const world = raw as WorldState
  if (world.version !== CURRENT_WORLD_VERSION) return undefined
  if (typeof world.tick !== 'number' || typeof world.playerId !== 'string') return undefined
  if (typeof world.date !== 'object' || world.date === null) return undefined
  if (typeof world.countries !== 'object' || world.countries === null) return undefined
  if (typeof world.resumeOnStart !== 'boolean') return undefined
  return normalizeWorld(world)
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
