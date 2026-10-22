// Read-only detail views for the GM (plan 0006). The status line is a
// summary; when a player asks "why did this move", the answer should come from
// an inspect section rather than from reading the save or the engine source.
//
// Context economy: facts live in exactly one section. Per-building lines sit
// in `buildings` (not `economy`); trade routes sit in `routes` (not `trade`);
// the cross-country comparison sits in `rankings` (not `v3_status`).
//
// The sections were split out of the original `engine/inspect.ts` into one
// module per section. This file keeps `INSPECT_SECTIONS`, the `InspectSection`
// type and the `inspectWorld` dispatcher, and re-exports `forecastWorld` and
// `InspectOptions` so the `./inspect` import surface is unchanged.

import type { WorldState } from '../../types'
import { economySection } from './economy'
import { marketSection } from './market'
import { fiscalSection } from './fiscal'
import { laborSection } from './labor'
import { tradeSection } from './trade'
import { routesSection } from './routes'
import { buildingsSection } from './buildings'
import { constructionSection } from './construction'
import { militarySection } from './military'
import { popsSection } from './pops'
import { diplomacySection } from './diplomacy'
import { techSection } from './tech'
import { modifiersSection } from './modifiers'
import { rankingsSection } from './rankings'
import { logSection } from './log'
import { historySection } from './history'
import type { InspectOptions } from './shared'

export const INSPECT_SECTIONS = [
  'economy',
  'market',
  'fiscal',
  'labor',
  'trade',
  'routes',
  'buildings',
  'construction',
  'military',
  'pops',
  'diplomacy',
  'tech',
  'modifiers',
  'rankings',
  'log',
  'history',
] as const

export type InspectSection = (typeof INSPECT_SECTIONS)[number]

export { forecastWorld } from './forecast'
export type { InspectOptions } from './shared'

/** Build one inspect report for the player country. */
export function inspectWorld(
  world: WorldState,
  section: string,
  options?: InspectOptions,
): string {
  const country = world.countries[world.playerId]
  if (country === undefined) return '还没有进行中的游戏。'
  const key = section.toLowerCase() as InspectSection
  const header = `[${country.flag}] ${country.name} · ${world.date.year}.${String(world.date.month).padStart(2, '0')}`
  let body: string[]
  switch (key) {
    case 'economy':
      body = economySection(country)
      break
    case 'market':
      body = marketSection(country)
      break
    case 'fiscal':
      body = fiscalSection(world, country)
      break
    case 'labor':
      body = laborSection(country)
      break
    case 'trade':
      body = tradeSection(world, country)
      break
    case 'routes':
      body = routesSection(world, country)
      break
    case 'buildings':
      body = buildingsSection(country)
      break
    case 'construction':
      body = constructionSection(country)
      break
    case 'military':
      body = militarySection(world, country)
      break
    case 'pops':
      body = popsSection(country)
      break
    case 'diplomacy':
      body = diplomacySection(world, country)
      break
    case 'tech':
      body = techSection(country)
      break
    case 'modifiers':
      body = modifiersSection(world)
      break
    case 'rankings':
      body = rankingsSection(world)
      break
    case 'log':
      body = logSection(world, options)
      break
    case 'history':
      body = historySection(world, country)
      break
    default:
      return `未知的 inspect 分区「${section}」。可用：${INSPECT_SECTIONS.join(' / ')}`
  }
  return [header, ...body].join('\n')
}
