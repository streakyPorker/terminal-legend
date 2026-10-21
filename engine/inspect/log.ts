import type { WorldState } from '../../types'
import { fmtDate, type InspectOptions } from './shared'

export function logSection(world: WorldState, options?: InspectOptions): string[] {
  let entries = world.log
  const filters: string[] = []
  if (options?.kind !== undefined) {
    entries = entries.filter(entry => entry.kind === options.kind)
    filters.push(`kind=${options.kind}`)
  }
  if (options?.country !== undefined) {
    entries = entries.filter(entry => entry.countryId === options.country)
    filters.push(`country=${options.country}`)
  }
  const limit = Math.min(100, Math.max(1, Math.floor(options?.limit ?? 20)))
  const shown = entries.slice(-limit)
  const desc = filters.length === 0 ? `最近 ${shown.length} 条` : `${filters.join('，')}，最近 ${shown.length} 条`
  const lines = [`编年史（${desc}）：`]
  if (shown.length === 0) {
    lines.push('- 无匹配的日志条目')
    return lines
  }
  for (const entry of shown) {
    const country = entry.countryId === undefined ? '' : `(${entry.countryId})`
    lines.push(`- ${fmtDate(entry.date)} [${entry.kind}]${country} ${entry.text}`)
  }
  return lines
}
