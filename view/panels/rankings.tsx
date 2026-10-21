import type { Country, WorldState } from '../../types'
import { nationalDebt } from '../../engine/fiscal'
import { countryTag, fmtNumber, fmtPercent, fmtPop } from '../format'
import { Heading, TableRow, playerOf, type UiKit } from './shared'

type RankColumn = {
  label: string
  width: number
  value: (country: Country) => string
}

export function RankingsPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  const all = Object.values(props.world.countries)
  const majors = all.filter(country => country.isMajor)
  const countries = majors.length >= 3 ? majors : all
  const by = (key: (country: Country) => number): Country[] =>
    [...countries].sort((a, b) => key(b) - key(a))
  const playerColor = player?.color ?? 'cyan'

  const table = (
    title: string,
    hint: string,
    rows: Country[],
    columns: RankColumn[],
  ): any => {
    const widths = [14, ...columns.map(column => column.width)]
    return (
      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text={title} hint={hint} />
        <TableRow
          ui={props.ui}
          cells={['国家', ...columns.map(column => column.label)]}
          widths={widths}
        />
        {rows.map(country => (
          <TableRow
            ui={props.ui}
            cells={[
              countryTag(country),
              ...columns.map(column => column.value(country)),
            ]}
            widths={widths}
            colors={[country.isPlayer ? playerColor : undefined]}
          />
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="列强排名" hint={`${countries.length} 国 · 各维度从高到低`} />
      <Text dimColor>高亮行为你扮演的国家。单位：金（净资产/GDP）、万（人口/陆军）、%（比率）。</Text>

      {table('经济', '按 GDP 排序', by(country => country.econ.gdp), [
        { label: 'GDP(金/月)', width: 12, value: country => fmtNumber(country.econ.gdp) },
        { label: '净资产(金)', width: 10, value: country => fmtNumber(country.econ.treasury) },
        { label: '收入(金/月)', width: 12, value: country => fmtNumber(country.econ.income) },
        { label: '国债(金)', width: 10, value: country => fmtNumber(nationalDebt(country)) },
      ])}

      {table('人口与社会', '按人口排序', by(country => country.pops.total), [
        { label: '人口', width: 10, value: country => fmtPop(country.pops.total) },
        { label: '识字率', width: 8, value: country => fmtPercent(country.pops.literacy) },
        { label: '生活水平', width: 8, value: country => String(Math.round(country.pops.sol)) },
        { label: '失业', width: 8, value: country => `${country.econ.unemployment.toFixed(1)}%` },
        { label: '激进', width: 6, value: country => String(Math.round(country.pops.radicals)) },
      ])}

      {table('军事', '按陆军战力排序', by(country => country.military.army * country.military.quality), [
        { label: '陆军(万)', width: 10, value: country => fmtNumber(country.military.army) },
        { label: '海军', width: 8, value: country => fmtNumber(country.military.navy) },
        { label: '士气', width: 6, value: country => String(Math.round(country.military.morale)) },
        { label: '陆军战力', width: 10, value: country => fmtNumber(country.military.army * country.military.quality) },
      ])}

      {table('科技与行政', '按科技等级排序', by(country => country.tech.level), [
        { label: '科技', width: 7, value: country => `${country.tech.level} 级` },
        { label: '官僚效能', width: 10, value: country => `${Math.round(country.bureaucracy.score)}/${Math.round(country.bureaucracy.ceiling)}` },
        { label: '合法性', width: 7, value: country => String(Math.round(country.government.legitimacy)) },
        { label: '权威', width: 6, value: country => String(Math.round(country.government.authority)) },
      ])}

      {table('外交与威望', '按威望排序', by(country => country.diplo.prestige), [
        { label: '威望', width: 6, value: country => String(Math.round(country.diplo.prestige)) },
        { label: '恶名', width: 6, value: country => String(Math.round(country.diplo.infamy)) },
        { label: '盟友', width: 6, value: country => String(country.diplo.alliances.length) },
        { label: '对手', width: 6, value: country => String(country.diplo.rivals.length) },
        { label: '战争', width: 6, value: country => String(props.world.wars.filter(war => war.attackers.includes(country.id) || war.defenders.includes(country.id)).length) },
      ])}
    </Box>
  )
}
