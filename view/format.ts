import type { Country, GameDate, LogEntry, WorldState } from '../types'
import { fiscalLedger } from '../engine/fiscal'

const BLOCKS = '▁▂▃▄▅▆▇█'

export const fmtDate = (date: GameDate): string =>
  `${date.year}.${String(date.month).padStart(2, '0')}`

export const fmtDateLong = (date: GameDate): string => `${date.year} 年 ${date.month} 月`

export function fmtNumber(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(2)}M`
  if (abs >= 10000) return `${sign}${(abs / 1000).toFixed(1)}k`
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}k`
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`
  return `${sign}${abs.toFixed(1)}`
}

export function fmtSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${fmtNumber(value)}`
}

/** The game uses one abstract currency across countries. */
export const CURRENCY = '金'

export function fmtMoney(value: number): string {
  return `${fmtNumber(value)}${CURRENCY}`
}

export function fmtGdp(value: number): string {
  return `${fmtNumber(value)}${CURRENCY}/月`
}

export function fmtPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

/** Pops and armies are stored in ten-thousands; show 亿 once past 10000. */
export function fmtPop(tenThousands: number): string {
  if (tenThousands >= 10000) return `${(tenThousands / 10000).toFixed(2)} 亿`
  if (tenThousands >= 100) return `${Math.round(tenThousands)} 万`
  return `${tenThousands.toFixed(1)} 万`
}

export function clampText(text: string, width: number): string {
  if (width <= 1) return ''
  if (text.length <= width) return text
  if (width <= 2) return text.slice(0, width)
  return `${text.slice(0, width - 1)}…`
}

export function padEnd(text: string, width: number): string {
  return clampText(text, width).padEnd(width, ' ')
}

export function padStart(text: string, width: number): string {
  return clampText(text, width).padStart(width, ' ')
}

export function bar(value: number, max: number, width: number, full = '█', empty = '░'): string {
  const size = Math.max(1, width)
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max))
  const filled = Math.round(ratio * size)
  return `${full.repeat(filled)}${empty.repeat(size - filled)}`
}

export function sparkline(values: number[], width = 12): string {
  const slice = values.slice(-Math.max(1, width))
  if (slice.length === 0) return ''
  const min = Math.min(...slice)
  const max = Math.max(...slice)
  const span = max - min || 1
  return slice
    .map(value => {
      const index = Math.min(7, Math.max(0, Math.floor(((value - min) / span) * 7)))
      return BLOCKS[index] as string
    })
    .join('')
}

export function trend(values: number[]): string {
  if (values.length < 2) return '·'
  const last = values[values.length - 1] as number
  const prev = values[values.length - 2] as number
  if (Math.abs(last - prev) < 0.01) return '→'
  return last > prev ? '↑' : '↓'
}

export function moodLabel(mood: number): string {
  if (mood >= 60) return '热络'
  if (mood >= 20) return '友好'
  if (mood > -20) return '中立'
  if (mood > -60) return '冷淡'
  return '敌视'
}

export function relationColor(value: number): string {
  if (value >= 40) return 'green'
  if (value >= 10) return 'cyan'
  if (value > -10) return 'white'
  if (value > -40) return 'yellow'
  return 'red'
}

export function legitimacyColor(value: number): string {
  if (value >= 65) return 'green'
  if (value >= 40) return 'yellow'
  return 'red'
}

export function radicalColor(value: number): string {
  if (value >= 40) return 'red'
  if (value >= 20) return 'yellow'
  return 'green'
}

export function countryTag(country: Country): string {
  return `[${country.flag}]${country.name}`
}

export function logKindMark(kind: LogEntry['kind']): string {
  switch (kind) {
    case 'economy':
      return '¤'
    case 'diplomacy':
      return '※'
    case 'war':
      return '⚔'
    case 'tech':
      return '✦'
    case 'politics':
      return '§'
    case 'leader':
      return '☙'
    case 'event':
      return '◆'
    default:
      return '·'
  }
}

export function statusLine(world: WorldState): string {
  const player = world.countries[world.playerId]
  if (player === undefined) return '终末传奇 · 无进行中的游戏'
  const wars = world.wars.filter(
    war => war.attackers.includes(player.id) || war.defenders.includes(player.id),
  )
  const ledger = fiscalLedger(player, { atWar: wars.length > 0, tick: world.tick })
  const surplus = ledger.net
  const warText = wars.length > 0 ? `战争×${wars.length}` : '和平'
  const pending = world.events.filter(
    event => event.countryId === player.id && !event.isResolved,
  ).length
  return [
    fmtDate(world.date),
    `[${player.flag}]${player.name}`,
    `国库${fmtMoney(player.econ.treasury)}(${fmtSigned(surplus)}金/月)`,
    `收${fmtNumber(ledger.income.total)} 支${fmtNumber(ledger.expense.total)}`,
    ledger.debt > 0
      ? `国债${fmtMoney(ledger.debt)}`
      : `基金${fmtMoney(ledger.fund)}`,
    ledger.debtPressure.ratio >= 0.25
      ? `债务压力${ledger.debtPressure.label}`
      : '',
    `GDP${fmtGdp(player.econ.gdp)}`,
    `合法性${Math.round(player.government.legitimacy)}`,
    `激进${Math.round(player.pops.radicals)}`,
    `科技时代${player.tech.era}·${player.tech.unlocked.length}项`,
    warText,
    pending > 0 ? `事件${pending}` : '',
    world.ironman ? '铁人' : '',
  ]
    .filter(part => part !== '')
    .join(' │ ')
}

export function shortLeader(country: Country): string {
  return `${country.leader.title}${country.leader.name}`
}

export function eventSummary(world: WorldState, countryId: string): string {
  const events = world.events.filter(
    event => event.countryId === countryId && !event.isResolved,
  )
  if (events.length === 0) return '没有待处理事件'
  return events.map(event => `◆ ${event.title}：${event.text}`).join('\n')
}
