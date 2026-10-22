import type { Country, WorldState } from '../../types'
import { techTier } from '../data'
import { nationalDebt } from '../fiscal'
import { constructionLoad } from '../sim'
import { n, pct, type InspectOptions } from './shared'

/**
 * Optional cross-country columns. The five default dimensions stay lean; a GM
 * asks for the extra parameters it actually needs (PT-051):
 * `v3_inspect rankings` + `metrics: ['construction', 'manpower']`.
 */
export const RANKING_METRICS = [
  'construction',
  'privateCapital',
  'infrastructure',
  'loyalty',
  'quality',
  'manpower',
  'techPoints',
] as const

export type RankingMetric = (typeof RANKING_METRICS)[number]

type Column = [string, (country: Country) => string]

type TableName = 'economy' | 'pops' | 'military' | 'tech'

const EXTRA_COLUMNS: Record<RankingMetric, { table: TableName; column: Column }> = {
  construction: {
    table: 'economy',
    column: ['建造力', country => `${n(constructionLoad(country).capacity)}点/月`],
  },
  privateCapital: {
    table: 'economy',
    column: ['私人资本', country => n(country.econ.privateCapital)],
  },
  infrastructure: {
    table: 'economy',
    column: ['基建', country => `${n(country.econ.transportInfrastructure, 0)}/100`],
  },
  loyalty: {
    table: 'pops',
    column: ['忠诚', country => n(country.pops.loyalists ?? 0, 0)],
  },
  quality: {
    table: 'military',
    column: ['质量', country => n(country.military.quality)],
  },
  manpower: {
    table: 'military',
    column: ['人力', country => `${n(country.military.manpower)}万`],
  },
  techPoints: {
    table: 'tech',
    column: ['科技点', country => n(country.tech.points, 0)],
  },
}

export function rankingsSection(world: WorldState, options?: InspectOptions): string[] {
  const all = Object.values(world.countries)
  const majors = all.filter(country => country.isMajor)
  const countries = majors.length >= 3 ? majors : all
  const by = (key: (country: Country) => number): Country[] =>
    [...countries].sort(
      (a, b) => key(b) - key(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const requested = (options?.metrics ?? []).filter(
    (metric): metric is RankingMetric =>
      (RANKING_METRICS as readonly string[]).includes(metric),
  )
  const extrasFor = (table: TableName): Column[] =>
    requested
      .filter(metric => EXTRA_COLUMNS[metric].table === table)
      .map(metric => EXTRA_COLUMNS[metric].column)
  const lines: string[] = [
    `列强排名（${countries.length} 国 · 各维度从高到低；单位 金/万/%）：`,
  ]
  if (requested.length > 0) {
    lines.push(
      `附加列（按需）：${requested.map(metric => EXTRA_COLUMNS[metric].column[0]).join('、')}`,
    )
  }
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
    ...extrasFor('economy'),
  ])
  table('人口与社会（按人口排序）', by(country => country.pops.total), [
    ['人口', country => `${n(country.pops.total, 0)}万`],
    ['识字率', country => pct(country.pops.literacy)],
    ['生活水平', country => n(country.pops.sol, 0)],
    ['失业', country => `${n(country.econ.unemployment)}%`],
    ['激进', country => n(country.pops.radicals, 0)],
    ...extrasFor('pops'),
  ])
  table(
    '军事（按陆军战力排序）',
    by(country => country.military.army * country.military.quality),
    [
      ['陆军', country => `${n(country.military.army)}万`],
      ['海军', country => n(country.military.navy)],
      ['士气', country => n(country.military.morale, 0)],
      ['陆军战力', country => n(country.military.army * country.military.quality)],
      ...extrasFor('military'),
    ],
  )
  table('科技与行政（按科技层级排序）', by(country => techTier(country.tech)), [
    ['科技', country => `时代${country.tech.era}·${country.tech.unlocked.length}项`],
    ['官僚效能', country => `${Math.round(country.bureaucracy.score)}/${Math.round(country.bureaucracy.ceiling)}`],
    ['合法性', country => n(country.government.legitimacy, 0)],
    ['权威', country => n(country.government.authority, 0)],
    ...extrasFor('tech'),
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
