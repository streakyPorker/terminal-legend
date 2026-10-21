import type { WorldState } from '../../types'
import { MODIFIER_STAT_NAMES } from '../modifiers'
import { signed } from './shared'

export function modifiersSection(world: WorldState): string[] {
  const countries = Object.values(world.countries).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const lines: string[] = []
  for (const country of countries) {
    const modifiers = country.modifiers ?? []
    if (modifiers.length === 0) continue
    lines.push(`[${country.flag}]${country.name}(${country.id}) 修正 ${modifiers.length} 项：`)
    for (const modifier of modifiers) {
      const value = `${signed(modifier.value, 2)}${modifier.stack === 'flat' ? '' : '%'}`
      const months = modifier.monthsLeft === undefined ? '长期' : `${modifier.monthsLeft} 月`
      lines.push(
        `- ${modifier.label}｜stat=${MODIFIER_STAT_NAMES[modifier.stat]}｜stack=${modifier.stack}｜value=${value}｜到期=${months}｜来源=${modifier.source}`,
      )
    }
  }
  if (lines.length === 0) return ['无生效中的修正。']
  return lines
}
