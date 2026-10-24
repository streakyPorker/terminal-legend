import type { Country, GoodId, WorldState } from '../../types'
import { GOODS } from '../data'
import {
  EMBARGO_MONTHS_MAX,
  SENSITIVE_GOODS,
  TRADE_RELATION_ENVELOPE,
  atWar,
  declareWar,
  endWar,
  type ReparationTerms,
} from '../diplomacy'
import {
  DIPLOMACY_ALLIANCE_MIN_RELATION,
  DIPLOMACY_EMBARGO_BACK,
  DIPLOMACY_EMBARGO_RELATION,
  DIPLOMACY_GIFT_BACK_FACTOR,
  DIPLOMACY_GIFT_DEFAULT,
  DIPLOMACY_GIFT_FACTOR,
  DIPLOMACY_GIFT_MAX,
  DIPLOMACY_IMPROVE_BACK_FACTOR,
  DIPLOMACY_IMPROVE_DEFAULT,
  DIPLOMACY_IMPROVE_MAX,
  DIPLOMACY_INSULT,
  DIPLOMACY_INSULT_BACK,
  DIPLOMACY_PEACE_SCORE,
  DIPLOMACY_RIVAL_RELATION,
  DIPLOMACY_UNEMBARGO_RELATION,
  DIPLOMACY_WAR_INFAMY,
  DIPLOMACY_WAR_RELATION,
} from '../config/diplomacy'
import { asGood, asWarGoal, clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

function relationLine(country: Country, other: Country): string {
  const value = Math.round(country.diplo.relations[other.id] ?? 0)
  return `[${other.flag}]${other.name} ${value >= 0 ? '+' : ''}${value}`
}

export function actionDiplomacy(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const targetId = String(params.target ?? '')
  const target = world.countries[targetId]
  if (target === undefined) return { ok: false, text: `${tag} 未知目标 ${targetId}` }
  const move = String(params.move ?? params.action ?? '')
  const current = country.diplo.relations[target.id] ?? 0
  switch (move) {
    case 'improve': {
      const amount = clamp(num(params.amount, DIPLOMACY_IMPROVE_DEFAULT), 1, DIPLOMACY_IMPROVE_MAX)
      country.diplo.relations[target.id] = clamp(current + amount, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) + amount * DIPLOMACY_IMPROVE_BACK_FACTOR,
        -100,
        100,
      )
      return { ok: true, text: `${tag} 改善了与${target.name}的关系（${relationLine(country, target)}）` }
    }
    case 'insult': {
      country.diplo.relations[target.id] = clamp(current - DIPLOMACY_INSULT, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) - DIPLOMACY_INSULT_BACK,
        -100,
        100,
      )
      return { ok: true, text: `${tag} 与${target.name}交恶` }
    }
    case 'alliance': {
      if (country.diplo.rivals.includes(target.id) || current < DIPLOMACY_ALLIANCE_MIN_RELATION) {
        return { ok: false, text: `${tag} 与${target.name}的关系不足以结盟` }
      }
      if (!country.diplo.alliances.includes(target.id)) country.diplo.alliances.push(target.id)
      if (!target.diplo.alliances.includes(country.id)) target.diplo.alliances.push(country.id)
      return { ok: true, text: `${tag} 与${target.name}缔结同盟` }
    }
    case 'rival': {
      if (!country.diplo.rivals.includes(target.id)) country.diplo.rivals.push(target.id)
      country.diplo.relations[target.id] = clamp(current - DIPLOMACY_RIVAL_RELATION, -100, 100)
      return { ok: true, text: `${tag} 将${target.name}列为竞争对手` }
    }
    case 'gift': {
      const amount = clamp(num(params.amount, DIPLOMACY_GIFT_DEFAULT), 1, DIPLOMACY_GIFT_MAX)
      if (country.econ.treasury < amount) return { ok: false, text: `${tag} 国库不足以赠礼` }
      country.econ.treasury -= amount
      country.diplo.relations[target.id] = clamp(current + amount * DIPLOMACY_GIFT_FACTOR, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) + amount * DIPLOMACY_GIFT_BACK_FACTOR,
        -100,
        100,
      )
      return { ok: true, text: `${tag} 向${target.name}赠送了价值 ${amount.toFixed(1)} 的礼物` }
    }
    case 'loan': {
      // Sovereign loan: the player pays the principal now and receives an
      // equal-installment (annuity) stream back, booked through the same
      // monthly schedule machinery as reparations (PT-064).
      const principal = clamp(num(params.amount, 0), 1, 100000)
      const months = Math.round(clamp(num(params.months, 120), 1, 240))
      const rate = clamp(num(params.rate, 5), 0, 30)
      if (atWar(world, country.id, target.id)) {
        return { ok: false, text: `${tag} 与${target.name}处于战争状态，无法放贷` }
      }
      if (country.econ.treasury < principal) {
        return { ok: false, text: `${tag} 国库不足以放贷 ${principal.toFixed(1)} 金` }
      }
      const r = rate / 100 / 12
      const growth = Math.pow(1 + r, months)
      const monthly =
        r <= 0 ? principal / months : (principal * r * growth) / (growth - 1)
      const monthlyAmount = Math.round(monthly * 100) / 100
      country.econ.treasury -= principal
      target.econ.treasury += principal
      if (!Array.isArray(world.transfers)) world.transfers = []
      world.transfers.push({
        id: `loan-${country.id}-${target.id}-${world.tick}-${world.transfers.length}`,
        from: target.id,
        to: country.id,
        monthlyAmount,
        monthsLeft: months,
        remaining: Math.round(monthlyAmount * months * 100) / 100,
        startsAtTick: world.tick + 1,
        startedAt: { ...world.date },
        label: `${country.name}向${target.name}贷款 ${principal.toFixed(0)} 金 · 年息 ${rate}% · ${months} 期`,
      })
      country.diplo.relations[target.id] = clamp(current + 5, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) + 8,
        -100,
        100,
      )
      return {
        ok: true,
        text: `${tag} 向${target.name}放贷 ${principal.toFixed(0)} 金，年息 ${rate}%，${months} 期等额本息，每月还款 ${monthlyAmount.toFixed(2)} 金`,
      }
    }
    case 'war': {
      const war = declareWar(
        world,
        country.id,
        target.id,
        asWarGoal(params.goal),
        String(params.reason ?? '边境争端'),
      )
      if (war === undefined) return { ok: false, text: `${tag} 与${target.name}已经在战争中` }
      country.diplo.relations[target.id] = clamp(current - DIPLOMACY_WAR_RELATION, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) - DIPLOMACY_WAR_RELATION,
        -100,
        100,
      )
      country.diplo.infamy = clamp(country.diplo.infamy + DIPLOMACY_WAR_INFAMY, 0, 100)
      return { ok: true, text: `${tag} 向${target.name}宣战（${war.defenders.length} 国应战）` }
    }
    case 'peace': {
      const war = world.wars.find(
        one =>
          (one.attackers.includes(country.id) && one.defenders.includes(target.id)) ||
          (one.defenders.includes(country.id) && one.attackers.includes(target.id)),
      )
      if (war === undefined) return { ok: false, text: `${tag} 与${target.name}并未交战` }
      // The victor's terms: total gold and the maximum installment term.
      // Omitted values fall back to 10% of GDP and 60 months.
      const terms: ReparationTerms = {
        total:
          typeof params.indemnityTotal === 'number'
            ? params.indemnityTotal
            : undefined,
        maxMonths:
          typeof params.indemnityMonths === 'number'
            ? params.indemnityMonths
            : undefined,
      }
      endWar(
        world,
        war,
        war.warScore > DIPLOMACY_PEACE_SCORE
          ? war.attackers.includes(country.id)
            ? 'attackers'
            : 'defenders'
          : war.warScore < -DIPLOMACY_PEACE_SCORE
            ? war.attackers.includes(country.id)
              ? 'defenders'
              : 'attackers'
            : 'white',
        [],
        terms,
      )
      return { ok: true, text: `${tag} 与${target.name}停战` }
    }
    case 'embargo': {
      if (target.id === country.id) return { ok: false, text: `${tag} 不能对自己禁运` }
      const goodParam = params.good === undefined ? undefined : String(params.good)
      const good = goodParam === undefined ? undefined : asGood(goodParam)
      if (goodParam !== undefined && good === undefined) {
        return { ok: false, text: `${tag} 未知商品 ${goodParam}` }
      }
      const goods: GoodId[] | 'all' = good === undefined ? 'all' : [good]
      const months =
        params.months === undefined
          ? undefined
          : clamp(Math.floor(num(params.months, 1)), 1, EMBARGO_MONTHS_MAX)
      const reason = params.reason === undefined ? undefined : String(params.reason)
      const key = goods === 'all' ? 'all' : goods.join(',')
      const existing = country.embargoes.find(one =>
        one.target === target.id &&
        (one.goods === 'all' ? 'all' : one.goods.join(',')) === key,
      )
      if (existing !== undefined) {
        existing.since = { ...world.date }
        existing.months = months
        existing.reason = reason
      } else {
        country.embargoes.push({
          target: target.id,
          goods,
          since: { ...world.date },
          months,
          reason,
        })
      }
      // The file's `insult` convention: the sender cools more than the target.
      country.diplo.relations[target.id] = clamp(current - DIPLOMACY_EMBARGO_RELATION, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) - DIPLOMACY_EMBARGO_BACK,
        -100,
        100,
      )
      const scope =
        goods === 'all' ? '全面' : `对${goods.map(one => GOODS[one].name).join('、')}`
      return {
        ok: true,
        text: `${tag} 对${target.name}实施${scope}禁运${months === undefined ? '（永久）' : `（${months} 个月）`}（${relationLine(country, target)}）`,
      }
    }
    case 'unembargo': {
      if (target.id === country.id) return { ok: false, text: `${tag} 不能对自己解除禁运` }
      const goodParam = params.good === undefined ? undefined : String(params.good)
      const good = goodParam === undefined ? undefined : asGood(goodParam)
      if (goodParam !== undefined && good === undefined) {
        return { ok: false, text: `${tag} 未知商品 ${goodParam}` }
      }
      const before = country.embargoes.length
      country.embargoes = country.embargoes.filter(one => {
        if (one.target !== target.id) return true
        if (good === undefined) return false
        return !(one.goods === 'all' || one.goods.includes(good))
      })
      const lifted = before - country.embargoes.length
      // Gift-style symmetry: both sides warm by the same amount (plan §3).
      country.diplo.relations[target.id] = clamp(current + DIPLOMACY_UNEMBARGO_RELATION, -100, 100)
      target.diplo.relations[country.id] = clamp(
        (target.diplo.relations[country.id] ?? 0) + DIPLOMACY_UNEMBARGO_RELATION,
        -100,
        100,
      )
      return {
        ok: true,
        text:
          lifted > 0
            ? `${tag} 解除对${target.name}的禁运（${lifted} 项），关系回暖（${relationLine(country, target)}）`
            : `${tag} 与${target.name}本无禁运，关系回暖（${relationLine(country, target)}）`,
      }
    }
    case 'tension': {
      const good = asGood(String(params.good ?? ''))
      if (good === undefined || !SENSITIVE_GOODS.includes(good)) {
        return {
          ok: false,
          text: `${tag} 贸易张力只允许敏感商品：${SENSITIVE_GOODS.join('、')}`,
        }
      }
      const delta = num(params.relationDelta, num(params.amount, 0))
      if (!Number.isFinite(delta) || Math.abs(delta) > TRADE_RELATION_ENVELOPE) {
        return {
          ok: false,
          text: `${tag} 贸易张力变化必须在 ±${TRADE_RELATION_ENVELOPE} 之内`,
        }
      }
      // Record the intent only; the monthly §2.7 step applies it next month.
      world.tradeTensions.push({
        date: { ...world.date },
        from: country.id,
        partner: target.id,
        good,
        relationDelta: delta,
        reason: String(params.reason ?? '贸易摩擦'),
      })
      return {
        ok: true,
        text: `${tag} 就${GOODS[good].name}贸易向${target.name}施加张力 ${delta >= 0 ? '+' : ''}${delta}（下月生效）`,
      }
    }
    default:
      return { ok: false, text: `${tag} 未知外交动作 ${move}` }
  }
}
