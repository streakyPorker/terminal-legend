import type { Country, WorldState } from '../../types'
import { GOODS } from '../data'
import {
  OPIUM_CRISIS_TITLE,
  SITUATION_TIMEOUT_MONTHS,
  resultName,
  stanceSummary,
} from '../situations'
import { fmtDate, n, signed, warBetween } from './shared'

export function diplomacySection(world: WorldState, country: Country): string[] {
  const diplo = country.diplo
  const lines: string[] = [
    `威望 ${n(diplo.prestige, 0)}，恶名 ${n(diplo.infamy, 0)}；盟友 ${diplo.alliances.length}，对手 ${diplo.rivals.length}，势力范围 ${diplo.sphere.length}`,
  ]
  const others = Object.values(world.countries)
    .filter(other => other.id !== country.id)
    .map(other => ({ other, value: Math.round(diplo.relations[other.id] ?? 0) }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        (a.other.id < b.other.id ? -1 : a.other.id > b.other.id ? 1 : 0),
    )
  lines.push('关系（对本国，正值友好）：')
  for (const { other, value } of others) {
    const marks = [
      warBetween(world, country.id, other.id) ? '战' : '',
      diplo.alliances.includes(other.id) ? '盟' : '',
      diplo.rivals.includes(other.id) ? '敌' : '',
    ]
      .filter(mark => mark !== '')
      .join('')
    lines.push(`- [${other.flag}]${other.name}(${other.id}) ${signed(value, 0)}${marks === '' ? '' : ` ${marks}`}`)
  }
  const nameOf = (id: string): string => {
    const target = world.countries[id]
    return target === undefined ? id : `${target.name}(${id})`
  }
  lines.push(`盟友：${diplo.alliances.length > 0 ? diplo.alliances.map(nameOf).join('、') : '无'}`)
  lines.push(`对手：${diplo.rivals.length > 0 ? diplo.rivals.map(nameOf).join('、') : '无'}`)

  const embargoes = country.embargoes ?? []
  if (embargoes.length === 0) {
    lines.push('本国禁运：无')
  } else {
    lines.push('本国禁运：')
    for (const embargo of embargoes) {
      const scope =
        embargo.goods === 'all'
          ? '全部商品'
          : embargo.goods.map(good => GOODS[good].name).join('、')
      const duration = embargo.months === undefined ? '永久' : `剩 ${embargo.months} 月`
      const reason = embargo.reason === undefined ? '' : `（${embargo.reason}）`
      lines.push(`- 对 ${nameOf(embargo.target)}：${scope}，${duration}${reason}`)
    }
  }
  const against = Object.values(world.countries).filter(other =>
    (other.embargoes ?? []).some(embargo => embargo.target === country.id),
  )
  if (against.length > 0) {
    lines.push(`被禁运：${against.map(other => nameOf(other.id)).join('、')}`)
  }

  const tensions = (world.tradeTensions ?? []).filter(
    tension => tension.from === country.id || tension.partner === country.id,
  )
  if (tensions.length === 0) {
    lines.push('贸易张力：无')
  } else {
    lines.push(`贸易张力（近 ${Math.min(5, tensions.length)} 条）：`)
    for (const tension of tensions.slice(-5).reverse()) {
      lines.push(
        `- ${fmtDate(tension.date)} ${nameOf(tension.from)}→${nameOf(tension.partner)} ${GOODS[tension.good].name} ${signed(tension.relationDelta, 0)} ${tension.reason}`,
      )
    }
  }

  if (world.situations.length === 0) {
    lines.push('局势：无')
  } else {
    lines.push('局势：')
    for (const situation of world.situations) {
      const state = situation.resolved
        ? `已解决：${resultName(situation.resultId) || '—'}`
        : situation.months >= SITUATION_TIMEOUT_MONTHS
          ? '待仲裁'
          : `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
      lines.push(`- ${OPIUM_CRISIS_TITLE} ${state}｜${stanceSummary(situation)}`)
    }
  }
  return lines
}
