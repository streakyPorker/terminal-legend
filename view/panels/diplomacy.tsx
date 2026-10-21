import type { WorldState } from '../../types'
import { GOODS, WAR_GOAL_NAMES } from '../../engine/data'
import {
  bar,
  countryTag,
  fmtNumber,
  fmtPercent,
  fmtSigned,
  moodLabel,
  padEnd,
  relationColor,
  shortLeader,
} from '../format'
import { Heading, SituationCard, partnerTotals, playerOf, type UiKit } from './shared'

export function DiplomacyPanel(props: { ui: UiKit; world: WorldState }): any {
  const { Box, Text } = props.ui
  const player = playerOf(props.world)
  if (player === undefined) return <Text dimColor>无进行中的游戏。</Text>
  const others = Object.values(props.world.countries)
    .filter(country => country.id !== player.id)
    .map(country => ({ country, value: Math.round(player.diplo.relations[country.id] ?? 0) }))
    .sort((a, b) => b.value - a.value)
  const tradePartners = partnerTotals(player).slice(0, 6)

  return (
    <Box flexDirection="column">
      <Heading ui={props.ui} text="外交关系" hint={`威望 ${Math.round(player.diplo.prestige)} · 恶名 ${Math.round(player.diplo.infamy)}`} />
      {others.map(row => {
        const war = props.world.wars.find(
          one =>
            (one.attackers.includes(player.id) && one.defenders.includes(row.country.id)) ||
            (one.defenders.includes(player.id) && one.attackers.includes(row.country.id)),
        )
        const marks = [
          war !== undefined ? '战' : '',
          player.diplo.alliances.includes(row.country.id) ? '盟' : '',
          player.diplo.rivals.includes(row.country.id) ? '敌' : '',
        ].filter(mark => mark !== '').join('')
        return (
          <Box flexDirection="row" columnGap={1}>
            <Text wrap="truncate">{padEnd(countryTag(row.country), 12)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(bar(row.value + 100, 200, 10), 11)}</Text>
            <Text color={relationColor(row.value)}>{padEnd(`${row.value >= 0 ? '+' : ''}${row.value}`, 5)}</Text>
            <Text color={marks === '战' ? 'red' : 'yellow'}>{padEnd(marks, 3)}</Text>
            <Text dimColor wrap="wrap">{shortLeader(row.country)} · {moodLabel(row.country.leader.mood)}</Text>
          </Box>
        )
      })}

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="贸易依赖" hint="Top-6 · 双边贸易额 · 伙伴依赖度" />
        {tradePartners.length === 0 ? (
          <Text dimColor>本月暂无贸易往来。</Text>
        ) : (
          tradePartners.map(row => {
            const partner = props.world.countries[row.id]
            const partnerTrade = partner !== undefined ? partner.trade.exportValue + partner.trade.importValue : 0
            const dependency = partnerTrade > 0 ? fmtPercent(row.total / partnerTrade) : '—'
            return (
              <Box flexDirection="row" columnGap={1}>
                <Text wrap="truncate">{padEnd(partner !== undefined ? countryTag(partner) : row.id, 12)}</Text>
                <Text>{padEnd(`往来 ${fmtNumber(row.total)}`, 11)}</Text>
                <Text dimColor>依赖 {padEnd(dependency, 6)}</Text>
              </Box>
            )
          })
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="禁运列表" hint="玩家施加 · 范围 · 剩余" />
        {player.embargoes.length === 0 ? (
          <Text dimColor>无禁运。</Text>
        ) : (
          player.embargoes.map(embargo => {
            const target = props.world.countries[embargo.target]
            const scope =
              embargo.goods === 'all'
                ? '全部商品'
                : embargo.goods.map(good => GOODS[good].name).join('、')
            const duration = embargo.months === undefined ? '永久' : `剩 ${embargo.months} 月`
            return (
              <Box flexDirection="row" columnGap={1}>
                <Text wrap="truncate">{padEnd(target !== undefined ? countryTag(target) : embargo.target, 12)}</Text>
                <Text wrap="truncate">{padEnd(scope, 22)}</Text>
                <Text dimColor>{duration}</Text>
              </Box>
            )
          })
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="贸易张力记录" hint="近 5 条 · 最新在前" />
        {props.world.tradeTensions.length === 0 ? (
          <Text dimColor>暂无贸易张力。</Text>
        ) : (
          props.world.tradeTensions
            .slice(-5)
            .reverse()
            .map(tension => {
              const from = props.world.countries[tension.from]
              const partner = props.world.countries[tension.partner]
              return (
                <Box flexDirection="row" columnGap={1}>
                  <Text wrap="truncate">{padEnd(from !== undefined ? countryTag(from) : tension.from, 10)}</Text>
                  <Text dimColor>→</Text>
                  <Text wrap="truncate">{padEnd(partner !== undefined ? countryTag(partner) : tension.partner, 10)}</Text>
                  <Text wrap="truncate">{padEnd(GOODS[tension.good].name, 6)}</Text>
                  <Text color={relationColor(tension.relationDelta)}>{padEnd(fmtSigned(tension.relationDelta), 6)}</Text>
                  <Text dimColor wrap="wrap">{tension.reason}</Text>
                </Box>
              )
            })
        )}
      </Box>

      <SituationCard ui={props.ui} world={props.world} />

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="领袖与议程" />
        {others.filter(row => row.country.isMajor).map(row => (
          <Text wrap="wrap">{[countryTag(row.country), ` ${row.country.leader.persona}`].join(' · ')}</Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Heading ui={props.ui} text="战争" />
        {props.world.wars.length === 0 ? (
          <Text dimColor>世界暂时和平。</Text>
        ) : (
          props.world.wars.map(war => (
            <Box flexDirection="column">
              <Text color="red" wrap="wrap">{war.name} · 第 {war.months} 月 · 目标{WAR_GOAL_NAMES[war.goal]}</Text>
              <Text dimColor wrap="wrap">{war.attackers.join(',')} vs {war.defenders.join(',')} · {war.lastEvent}</Text>
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>战争分数</Text>
                <Text color={war.warScore >= 0 ? 'red' : 'cyan'}>{padEnd(bar(war.warScore + 100, 200, 16), 17)}</Text>
                <Text>{Math.round(war.warScore)}</Text>
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}
