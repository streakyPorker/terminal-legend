import type { Country, WorldState } from '../../types'
import { techTier } from '../data'
import { nationalDebt } from '../fiscal'
import { n, pct } from './shared'

export function rankingsSection(world: WorldState): string[] {
  const all = Object.values(world.countries)
  const majors = all.filter(country => country.isMajor)
  const countries = majors.length >= 3 ? majors : all
  const by = (key: (country: Country) => number): Country[] =>
    [...countries].sort(
      (a, b) => key(b) - key(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const lines: string[] = [
    `列强排名（${countries.length} 国 · 各维度从高到低；单位 金/万/%）：`,
  ]
  const table = (
    title: string,
    rows: Country[],
    columns: [string, (country: Country) => string][],
  ): void => {
    lines.push(`${title}：`)
    for (const country of rows) {
      const cells = columns.map(([label, value]) => `${label} ${value(country)}`).join('，')
      lines.push(`- [${country.flag}]${country.name}(${country.id}) ${cells}`)
    }
  }
  table('经济（按 GDP 排序）', by(country => country.econ.gdp), [
    ['GDP', country => n(country.econ.gdp)],
    ['净资产', country => n(country.econ.treasury)],
    ['收入', country => n(country.econ.income)],
    ['国债', country => n(nationalDebt(country))],
  ])
  table('人口与社会（按人口排序）', by(country => country.pops.total), [
    ['人口', country => `${n(country.pops.total, 0)}万`],
    ['识字率', country => pct(country.pops.literacy)],
    ['生活水平', country => n(country.pops.sol, 0)],
    ['失业', country => `${n(country.econ.unemployment)}%`],
    ['激进', country => n(country.pops.radicals, 0)],
  ])
  table(
    '军事（按陆军战力排序）',
    by(country => country.military.army * country.military.quality),
    [
      ['陆军', country => `${n(country.military.army)}万`],
      ['海军', country => n(country.military.navy)],
      ['士气', country => n(country.military.morale, 0)],
      ['陆军战力', country => n(country.military.army * country.military.quality)],
    ],
  )
  table('科技与行政（按科技层级排序）', by(country => techTier(country.tech)), [
    ['科技', country => `时代${country.tech.era}·${country.tech.unlocked.length}项`],
    ['官僚效能', country => `${Math.round(country.bureaucracy.score)}/${Math.round(country.bureaucracy.ceiling)}`],
    ['合法性', country => n(country.government.legitimacy, 0)],
    ['权威', country => n(country.government.authority, 0)],
  ])
  table('外交与威望（按威望排序）', by(country => country.diplo.prestige), [
    ['威望', country => n(country.diplo.prestige, 0)],
    ['恶名', country => n(country.diplo.infamy, 0)],
    ['盟友', country => String(country.diplo.alliances.length)],
    ['对手', country => String(country.diplo.rivals.length)],
    [
      '战争',
      country =>
        String(
          world.wars.filter(
            war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
          ).length,
        ),
    ],
  ])
  return lines
}
