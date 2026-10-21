import type { Country } from '../../types'
import { n, pct } from './shared'

export function popsSection(country: Country): string[] {
  const pops = country.pops
  const total = Math.max(1, pops.total)
  const classes: [string, number][] = [
    ['农民', pops.peasants],
    ['工人', pops.workers],
    ['手工业者', pops.artisans],
    ['教士', pops.clergy],
    ['贵族', pops.aristocrats],
    ['资本家', pops.capitalists],
  ]
  const lines: string[] = [
    `总人口 ${n(pops.total, 0)} 万；识字率 ${pct(pops.literacy)}，生活水平 ${n(pops.sol, 0)}，激进 ${n(pops.radicals, 0)}，忠诚 ${n(pops.loyalists, 0)}，月增长 ${pct(pops.growth, 2)}`,
    '阶级结构（万人 / 占比）：',
  ]
  for (const [name, value] of classes) {
    lines.push(`- ${name} ${n(value, 0)}（${pct(value / total)}）`)
  }
  lines.push(`失业 ${n(country.econ.unemployment)}%（就业与工资分解见 v3_inspect labor）`)
  return lines
}
