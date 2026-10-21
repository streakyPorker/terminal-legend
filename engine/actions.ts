import type {
  ConstructionProject,
  Country,
  GoodId,
  PolicyEffect,
  PolicyProposal,
  TaxBaseId,
  WorldState,
} from '../types'
import { BUILDINGS, GOODS, SPENDING, buildOf, techName } from './data'
import {
  TAX_BASE_IDS,
  TAX_BASE_NAMES,
  nationalDebt,
  taxBaseRevenues,
} from './fiscal'
import { MODIFIER_STATS, MODIFIER_STAT_NAMES, addModifier } from './modifiers'
import { installBlock, validateBlockConfig } from './blocks'
import { compilePolicyBlock } from './config/blocks/policies'
import {
  compileLawBlock,
  lawBlockFor,
  lawSource,
  lawSpecFor,
} from './config/blocks/laws'
import {
  EMBARGO_MONTHS_MAX,
  SENSITIVE_GOODS,
  TRADE_RELATION_ENVELOPE,
  atWar,
  declareWar,
  endWar,
  type ReparationTerms,
} from './diplomacy'
import {
  MAX_BUILDINGS_PER_SLOT,
  constructionGoldPerPoint,
  constructionMonthlyCost,
  constructionTotalCost,
  projectWorkload,
} from './construction'
import { ROUTE_MAX_LEVEL, TRADABLE_GOODS, embargoed, routeId } from './trade'
import { recordSituationProposal } from './situations'
import { inspectEconomy } from './economy'
import { applyEventOption } from './events'
import { asGood, asWarGoal, clamp, num, type Decision } from './internal'
import type { Rng } from './rng'

function relationLine(country: Country, other: Country): string {
  const value = Math.round(country.diplo.relations[other.id] ?? 0)
  return `[${other.flag}]${other.name} ${value >= 0 ? '+' : ''}${value}`
}

/**
 * Free trade lowers the tariff but never below this floor: a state still needs
 * a customs administration, and a 0% default makes the whole tax look absent
 * (playtest feedback, ADR 0009). The rate applies to both imports and exports.
 */
export const FREE_TRADE_TARIFF_FLOOR = 5

/** Political capital each law consumes (plan §7.6). */
const LAW_AUTHORITY_COST: Record<string, number> = {
  教育改革: 8,
  福利改革: 10,
  自由贸易: 12,
  保护关税: 10,
  征兵制: 15,
  宗教宽容: 5,
}

/**
 * Installs a law's modifier through the block engine (ADR 0024). The registered
 * block's id is `law:<name>` (the pre-C6 `source`); the modifier id is restored
 * to the pre-C6 shape (some laws carry a slot suffix like `law:自由贸易:income`).
 * A validation failure — which cannot happen for the derived static registry —
 * falls back to the legacy direct install, so behaviour cannot change.
 */
function installLawModifier(country: Country, law: string): void {
  const spec = lawSpecFor(law)
  if (spec === undefined) return
  const template = lawBlockFor(law) ?? compileLawBlock(spec)
  if (validateBlockConfig([template]).length === 0) {
    installBlock(country, template, { modifierId: () => spec.modifierId })
    return
  }
  addModifier(country, {
    id: spec.modifierId,
    label: spec.label,
    stat: spec.stat,
    stack: spec.stack,
    value: spec.value,
    source: lawSource(law),
  })
}

/** The four-base tax menu, shown when `v3_action tax` omits `base` (ADR 0023). */
export function taxMenuText(country: Country): string {
  return TAX_BASE_IDS.map(base => {
    const rate = base === 'tariff' ? country.econ.tariff : country.econ.taxes[base]
    return `${TAX_BASE_NAMES[base]}(${base}) ${rate.toFixed(0)}%`
  }).join(' / ')
}

export function applyDecision(
  world: WorldState,
  decision: Decision,
  rng: Rng,
): { ok: boolean; text: string } {
  const country = world.countries[decision.countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${decision.countryId}` }
  const params = decision.params
  const tag = `[${country.flag}] ${country.name}`

  switch (decision.action) {
    case 'build': {
      const id = String(params.building ?? '')
      const building = buildOf(id)
      if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
      const count = clamp(Math.floor(num(params.count, 1)), 1, MAX_BUILDINGS_PER_SLOT)
      // Orders per month are unlimited: every slot holds at most five buildings.
      // Gold is paid per workload point; duration falls out of the points.
      const draft: ConstructionProject = {
        id: `proj-${world.tick}-${country.id}-${country.econ.constructionQueue.length}`,
        building,
        count,
        owner: 'state',
        monthsLeft: 1,
        monthlyCost: 0,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      }
      draft.monthlyCost = constructionMonthlyCost(draft)
      country.econ.constructionQueue.push(draft)
      return {
        ok: true,
        text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列（工程量 ${projectWorkload(draft).toFixed(1)} 点；按队列顺序取用闲置建造力，一次最多投入剩余工程量；总造价 ${constructionTotalCost(draft).toFixed(1)} 金，每点 ${constructionGoldPerPoint(draft).toFixed(2)} 金）`,
      }
    }
    case 'tax': {
      const base = String(params.base ?? '') as TaxBaseId
      if (!TAX_BASE_IDS.includes(base)) {
        return {
          ok: false,
          text: `${tag} 需要税基 base（land/profit/consumption/tariff）。当前：${taxMenuText(country)}`,
        }
      }
      const rate = clamp(num(params.rate, country.econ.taxes[base]), 0, 60)
      if (base === 'tariff') {
        country.econ.tariff = rate
        country.econ.taxes.tariff = rate
      } else {
        country.econ.taxes[base] = rate
      }
      return { ok: true, text: `${tag} 将${TAX_BASE_NAMES[base]}税率调整为 ${rate.toFixed(0)}%` }
    }
    case 'tariff': {
      const rate = clamp(num(params.rate, country.econ.tariff), 0, 60)
      country.econ.tariff = rate
      country.econ.taxes.tariff = rate
      // Without a separate export rate the old single-rate behaviour stands;
      // supplying `exportRate` splits the two directions (ADR 0014).
      const exportRate =
        params.exportRate === undefined
          ? rate
          : clamp(num(params.exportRate, rate), 0, 60)
      country.econ.exportTariff = exportRate
      return {
        ok: true,
        text: `${tag} 将进口关税调整为 ${rate.toFixed(0)}%，出口关税 ${exportRate.toFixed(0)}%`,
      }
    }
    case 'spending': {
      const category = String(params.category ?? '') as keyof Country['econ']['spending']
      if (!(category in country.econ.spending)) {
        return { ok: false, text: `${tag} 未知支出类别 ${category}` }
      }
      const amount = clamp(num(params.amount, country.econ.spending[category]), 0, 50)
      country.econ.spending[category] = amount
      return {
        ok: true,
        text: `${tag} 将${SPENDING[category].name}支出调整为 ${amount.toFixed(1)}`,
      }
    }
    case 'research': {
      const name = String(params.tech ?? techName(country.tech.level + 1))
      country.tech.researching = name
      return { ok: true, text: `${tag} 将研究方向定为「${name}」` }
    }
    case 'invest': {
      // AI investment confidence, bounded to ±10 around the country's base
      // and ±3 per month (plan 0003 §4/§6).
      const base = country.politicalEconomy.investmentConfidence
      const delta = clamp(num(params.amount, 1), -3, 3)
      const next = clamp(country.econ.investmentConfidence + delta, base - 10, base + 10)
      country.econ.investmentConfidence = next
      return {
        ok: true,
        text: `${tag} 将投资信心调整为 ${next >= 0 ? '+' : ''}${next.toFixed(0)}`,
      }
    }
    case 'conscript': {
      const wanted = clamp(num(params.amount, 1), 1, 20)
      const possible = Math.min(wanted, country.military.manpower / 2)
      if (possible <= 0.1) return { ok: false, text: `${tag} 没有可用的人力` }
      country.military.army += possible
      country.military.manpower -= possible * 2
      country.pops.radicals = clamp(country.pops.radicals + possible * 0.4, 0, 100)
      country.pops.total = Math.max(1, country.pops.total - possible * 0.4)
      return { ok: true, text: `${tag} 征召了 ${possible.toFixed(1)} 万兵力` }
    }
    case 'cancel': {
      const projectId = String(params.projectId ?? params.id ?? '')
      const index = country.econ.constructionQueue.findIndex(
        project => project.id === projectId,
      )
      if (index < 0) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
      const project = country.econ.constructionQueue[index]
      if (project === undefined) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
      if ((project.owner ?? 'state') === 'private') {
        return { ok: false, text: `${tag} 私人项目不可取消（${BUILDINGS[project.building].name}）` }
      }
      country.econ.constructionQueue.splice(index, 1)
      return {
        ok: true,
        text: `${tag} 取消了 ${BUILDINGS[project.building].name}×${project.count} 的国有建造项目`,
      }
    }
    case 'law': {
      const name = String(params.name ?? params.law ?? '')
      if (name === '') return { ok: false, text: `${tag} 未知法案` }
      const legal: Record<string, () => string> = {
        教育改革: () => {
          country.pops.literacy = clamp(country.pops.literacy + 0.04, 0, 1)
          country.econ.spending.education += 0.5
          installLawModifier(country, '教育改革')
          return `${tag} 推行教育改革，识字率上升`
        },
        福利改革: () => {
          country.pops.radicals = clamp(country.pops.radicals - 6, 0, 100)
          country.econ.spending.welfare += 0.5
          installLawModifier(country, '福利改革')
          return `${tag} 推行福利改革，民怨稍减`
        },
        自由贸易: () => {
          const exportRate = country.econ.exportTariff ?? country.econ.tariff
          country.econ.tariff = clamp(
            country.econ.tariff - 8,
            FREE_TRADE_TARIFF_FLOOR,
            60,
          )
          country.econ.exportTariff = clamp(
            exportRate - 8,
            FREE_TRADE_TARIFF_FLOOR,
            60,
          )
          country.econ.marketAccess = clamp(country.econ.marketAccess + 0.08, 0, 1)
          installLawModifier(country, '自由贸易')
          return `${tag} 推行自由贸易，进口关税 ${country.econ.tariff.toFixed(0)}%、出口关税 ${country.econ.exportTariff.toFixed(0)}%（下限 ${FREE_TRADE_TARIFF_FLOOR}%），市场接入提高`
        },
        保护关税: () => {
          const exportRate = country.econ.exportTariff ?? country.econ.tariff
          country.econ.tariff = clamp(country.econ.tariff + 8, 0, 60)
          country.econ.exportTariff = clamp(exportRate + 8, 0, 60)
          country.econ.marketAccess = clamp(country.econ.marketAccess - 0.04, 0, 1)
          installLawModifier(country, '保护关税')
          return `${tag} 推行保护关税，国库与工厂受益`
        },
        征兵制: () => {
          country.military.manpower = clamp(country.military.manpower + 10, 0, country.pops.total * 0.06)
          country.pops.radicals = clamp(country.pops.radicals + 3, 0, 100)
          installLawModifier(country, '征兵制')
          return `${tag} 推行征兵制，人力池扩大`
        },
        宗教宽容: () => {
          country.pops.radicals = clamp(country.pops.radicals - 4, 0, 100)
          country.government.legitimacy = clamp(country.government.legitimacy + 2, 0, 100)
          installLawModifier(country, '宗教宽容')
          return `${tag} 推行宗教宽容，社会稳定`
        },
      }
      const apply = legal[name]
      if (apply === undefined) return { ok: false, text: `${tag} 未知法案 ${name}` }
      const cost = LAW_AUTHORITY_COST[name] ?? 8
      if (country.government.authority < cost) {
        return {
          ok: false,
          text: `${tag} 权威不足，无法通过${name}（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
        }
      }
      country.government.authority = clamp(country.government.authority - cost, 0, 100)
      return { ok: true, text: apply() }
    }
    case 'diplomacy': {
      const targetId = String(params.target ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `${tag} 未知目标 ${targetId}` }
      const move = String(params.move ?? params.action ?? '')
      const current = country.diplo.relations[target.id] ?? 0
      switch (move) {
        case 'improve': {
          const amount = clamp(num(params.amount, 8), 1, 30)
          country.diplo.relations[target.id] = clamp(current + amount, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 0.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 改善了与${target.name}的关系（${relationLine(country, target)}）` }
        }
        case 'insult': {
          country.diplo.relations[target.id] = clamp(current - 15, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 12,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 与${target.name}交恶` }
        }
        case 'alliance': {
          if (country.diplo.rivals.includes(target.id) || current < 30) {
            return { ok: false, text: `${tag} 与${target.name}的关系不足以结盟` }
          }
          if (!country.diplo.alliances.includes(target.id)) country.diplo.alliances.push(target.id)
          if (!target.diplo.alliances.includes(country.id)) target.diplo.alliances.push(country.id)
          return { ok: true, text: `${tag} 与${target.name}缔结同盟` }
        }
        case 'rival': {
          if (!country.diplo.rivals.includes(target.id)) country.diplo.rivals.push(target.id)
          country.diplo.relations[target.id] = clamp(current - 30, -100, 100)
          return { ok: true, text: `${tag} 将${target.name}列为竞争对手` }
        }
        case 'gift': {
          const amount = clamp(num(params.amount, 3), 1, 20)
          if (country.econ.treasury < amount) return { ok: false, text: `${tag} 国库不足以赠礼` }
          country.econ.treasury -= amount
          country.diplo.relations[target.id] = clamp(current + amount * 2, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 1.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 向${target.name}赠送了价值 ${amount.toFixed(1)} 的礼物` }
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
          country.diplo.relations[target.id] = clamp(current - 50, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 50,
            -100,
            100,
          )
          country.diplo.infamy = clamp(country.diplo.infamy + 10, 0, 100)
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
            war.warScore > 10
              ? war.attackers.includes(country.id)
                ? 'attackers'
                : 'defenders'
              : war.warScore < -10
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
          country.diplo.relations[target.id] = clamp(current - 15, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 12,
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
          country.diplo.relations[target.id] = clamp(current + 5, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + 5,
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
    case 'route': {
      const op = String(params.op ?? 'open')
      const goodParam = String(params.good ?? '')
      const good = asGood(goodParam)
      if (good === undefined || !TRADABLE_GOODS.includes(good)) {
        return { ok: false, text: `${tag} 未知或不可贸易商品 ${goodParam}` }
      }
      const partnerId = String(params.partner ?? '')
      const partner = world.countries[partnerId]
      if (partner === undefined) return { ok: false, text: `${tag} 未知伙伴 ${partnerId}` }
      if (partnerId === country.id) return { ok: false, text: `${tag} 不能与本国开通贸易路线` }
      if (atWar(world, country.id, partnerId)) {
        return { ok: false, text: `${tag} 与${partner.name}处于战争状态，无法通商` }
      }
      if (
        embargoed(country.embargoes, partnerId, good) ||
        embargoed(partner.embargoes, country.id, good)
      ) {
        return { ok: false, text: `${tag} 与${partner.name}就该商品存在禁运` }
      }
      // Direction: the endpoint with the larger net surplus exports. A tie goes
      // to the lexicographically smaller id so the pair is symmetric.
      const own = inspectEconomy(country)
      const other = inspectEconomy(partner)
      const ownSurplus = own.production[good] - own.demand[good]
      const partnerSurplus = other.production[good] - other.demand[good]
      const playerExports =
        ownSurplus > partnerSurplus ||
        (ownSurplus === partnerSurplus && country.id < partnerId)
      const fromId = playerExports ? country.id : partnerId
      const toId = playerExports ? partnerId : country.id
      const id = routeId(good, fromId, toId)
      const index = world.tradeRoutes.findIndex(route => route.id === id)
      const existing = index < 0 ? undefined : world.tradeRoutes[index]
      const label = `${GOODS[good].name} ${fromId}→${toId}`
      if (op === 'open') {
        if (existing !== undefined) {
          return { ok: false, text: `${tag} 与${partner.name}的${label}航线已存在（等级 ${existing.level}）` }
        }
        world.tradeRoutes.push({
          id,
          good,
          from: fromId,
          to: toId,
          level: 1,
          owner: 'state',
          openedAt: { ...world.date },
          lastQty: 0,
          lastMargin: 0,
        })
        return { ok: true, text: `${tag} 开通${label}航线（等级 1，国有）` }
      }
      if (existing === undefined) {
        return { ok: false, text: `${tag} 未找到与${partner.name}的${label}航线` }
      }
      if (op === 'raise') {
        existing.level = Math.min(ROUTE_MAX_LEVEL, existing.level + 1)
        return { ok: true, text: `${tag} 将${label}航线提升到等级 ${existing.level}` }
      }
      if (op === 'lower') {
        existing.level -= 1
        if (existing.level <= 0) world.tradeRoutes.splice(index, 1)
        return {
          ok: true,
          text:
            existing.level <= 0
              ? `${tag} 关闭了${label}航线`
              : `${tag} 将${label}航线降低到等级 ${existing.level}`,
        }
      }
      if (op === 'close') {
        world.tradeRoutes.splice(index, 1)
        return { ok: true, text: `${tag} 关闭了${label}航线` }
      }
      return { ok: false, text: `${tag} 未知航线操作 ${op}` }
    }
    case 'situation': {
      // A crisis proposal (plan §4.2): context for the arbitration only.
      const stance = String(params.stance ?? '')
      const narrative = String(params.narrative ?? decision.narrative ?? '')
      return recordSituationProposal(world, country.id, stance, narrative)
    }
    case 'event': {
      const eventId = String(params.eventId ?? '')
      const optionId = String(params.optionId ?? '')
      const event = world.events.find(one => one.id === eventId)
      if (event === undefined) return { ok: false, text: `未知事件 ${eventId}` }
      const result = applyEventOption(world, event, optionId)
      return { ok: true, text: result }
    }
    case 'play': {
      const targetId = String(params.country ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
      const oldPlayer = world.countries[world.playerId]
      if (oldPlayer !== undefined) oldPlayer.isPlayer = false
      target.isPlayer = true
      world.playerId = target.id
      return { ok: true, text: `你现在扮演${target.name}` }
    }
    default:
      return { ok: false, text: `未知行动 ${decision.action}` }
  }
}

/**
 * Validates and applies a policy proposal from the model or the secretary.
 * Magnitudes are free (ADR 0002); the engine checks shapes, costs authority,
 * and turns each effect entry into a modifier (ADR 0003/0004).
 */
/**
 * How a flat policy value translates into "one percent of effect" for
 * authority pricing. Percent/multiply values already are percentages; flat
 * values need a stat-specific scale (e.g. literacy is a 0..1 fraction, so a
 * flat +0.5 is +50 points, not +0.5).
 */
const POLICY_FLAT_SCALE: Partial<Record<PolicyEffect['stat'], number>> = {
  literacy: 100,
  marketAccess: 100,
  laborShare: 100,
  privateInvestment: 100,
  consumption: 100,
  growth: 1000,
  taxEfficiency: 100,
  gdp: 2,
  income: 2,
  expense: 2,
  techPoints: 2,
  production: 2,
  demand: 2,
  farmOutput: 2,
  mineOutput: 2,
  factoryOutput: 2,
}

const flatScale = (stat: PolicyEffect['stat']): number => {
  if (stat.endsWith('Output') || stat.endsWith('Demand')) return 2
  // The default treats one flat point of a 0..100 stock/flow stat as a
  // substantial effect (10 "percent-equivalent" points).
  return POLICY_FLAT_SCALE[stat] ?? 10
}

export function applyPolicy(
  world: WorldState,
  countryId: string,
  proposal: PolicyProposal,
): { ok: boolean; text: string } {
  const country = world.countries[countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${countryId}` }
  const name = String(proposal.name ?? '').trim().slice(0, 40)
  if (name === '') return { ok: false, text: '政策需要一个名称。' }
  const effects = Array.isArray(proposal.effects) ? proposal.effects.slice(0, 12) : []
  if (effects.length === 0) return { ok: false, text: '政策至少需要一个效果条目。' }

  const parsed: PolicyEffect[] = []
  for (const effect of effects) {
    if (!MODIFIER_STATS.includes(effect.stat)) {
      return { ok: false, text: `未知修正对象 ${String(effect.stat)}` }
    }
    const value = Number(effect.value)
    if (!Number.isFinite(value)) return { ok: false, text: '效果数值必须是有限数字。' }
    if (Math.abs(value) > 200) {
      return { ok: false, text: '单个效果数值不能超过 200（防止无界政策）' }
    }
    const cappedStat =
      effect.stat === 'gdp' ||
      effect.stat === 'consumption' ||
      effect.stat === 'demand' ||
      effect.stat === 'production' ||
      effect.stat.endsWith('Output') ||
      effect.stat.endsWith('Demand')
    if (cappedStat && (effect.stack ?? 'flat') !== 'flat' && Math.abs(value) > 100) {
      return {
        ok: false,
        text: `「${MODIFIER_STAT_NAMES[effect.stat]}」类修正单条不得超过 100%`,
      }
    }
    const stack = effect.stack ?? 'flat'
    if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
      return { ok: false, text: '效果单位必须是 flat / percent / multiply。' }
    }
    const months =
      effect.months === undefined
        ? undefined
        : Math.min(240, Math.max(1, Math.round(Number(effect.months))))
    if (months !== undefined && !Number.isFinite(months)) {
      return { ok: false, text: '持续月数必须是数字。' }
    }
    parsed.push({
      stat: effect.stat,
      stack,
      value,
      months,
      label: effect.label,
    })
  }

  // Compile the proposal into a `policy:<name>` block and re-run the C1
  // invariant validator on it. The shape checks above already produce today's
  // error surface, so this branch is a guard, not a user-facing path.
  const block = compilePolicyBlock(name, parsed)
  const violations = validateBlockConfig([block])
  if (violations.length > 0) {
    return { ok: false, text: violations.join('；') }
  }

  // Authority cost scales with the effect's magnitude and duration. This keeps
  // a permanent +50% GDP policy from costing the same 5 points as a +2% one
  // (round-2 playtest P0-3).
  const weight = parsed.reduce((sum, effect) => {
    // A permanent effect is priced as 48 months; flat values are converted to
    // percentage-equivalent units by stat scale.
    const months = effect.months ?? 48
    const magnitude =
      effect.stack === 'flat'
        ? Math.abs(effect.value) * flatScale(effect.stat)
        : Math.abs(effect.value)
    return sum + magnitude * (months / 12)
  }, 0)
  const required = clamp(Math.round(weight * 0.2), 1, 40)
  const requested = clamp(Math.round(num(proposal.authorityCost, 5)), 1, 40)
  const cost = Math.max(required, requested)
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `权威不足，无法推行「${name}」（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)

  // Install through the block engine: the modifiers get `source = policy:<name>`
  // and flow through the same stack path as thresholds. The id scheme stays the
  // historical one — a permanent effect replaces any earlier permanent effect on
  // the same stat/stack (`policy:<stat>:<stack>`), a timed effect keeps its own
  // slot (`policy:<name>:<index>`) and expires normally.
  installBlock(country, block, {
    upkeep: cost / 48 / parsed.length,
    modifierId: (effect, index) =>
      effect.months === undefined
        ? `policy:${effect.stat}:${effect.stack}`
        : `${block.id}:${index}`,
  })

  const summary = parsed
    .map(
      effect =>
        `${MODIFIER_STAT_NAMES[effect.stat]} ${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}${effect.months === undefined ? '' : `（${effect.months} 月）`}`,
    )
    .join('；')
  const text = `[${country.flag}] ${country.name} 推行政策「${name}」：${summary}（权威 -${cost}）`
  world.log.push({
    date: { ...world.date },
    kind: 'politics',
    countryId: country.id,
    text,
  })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text }
}

export function randomDecision(world: WorldState, country: Country, rng: Rng): Decision | undefined {
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  // Crisis fallback (plan §6): a participant in an open situation states a
  // persona-driven stance when the model gave none; proposals carry no effects.
  const situation = world.situations.find(one => !one.resolved)
  if (
    situation !== undefined &&
    situation.countries.includes(country.id) &&
    !situation.proposals.some(one => one.countryId === country.id)
  ) {
    const aggressive = country.leader.traits.some(trait =>
      ['扩张', '军事', '专制', '民粹', '海权'].includes(trait),
    )
    const reformist = country.leader.traits.some(trait =>
      ['改革', '贸易', '务实', '维新'].includes(trait),
    )
    const stance = aggressive
      ? country.id === 'QING'
        ? 'crackdown'
        : 'war'
      : reformist
        ? 'compromise'
        : 'neutral'
    return {
      countryId: country.id,
      action: 'situation',
      params: { stance, narrative: `${country.name}就鸦片危机表明立场` },
    }
  }
  // Debt service is a hard constraint; the deterministic fallback raises the
  // lowest-yielding base (no RNG in the choice) before a debt spiral hardens.
  if (nationalDebt(country) > country.econ.gdp && rng.chance(0.5)) {
    const revenues = taxBaseRevenues(country, country.econ.lastTariffRevenue)
    let base: TaxBaseId = 'land'
    for (const id of TAX_BASE_IDS) {
      if (revenues[id] < revenues[base]) base = id
    }
    const current = base === 'tariff' ? country.econ.tariff : country.econ.taxes[base]
    if (current < 45) {
      return {
        countryId: country.id,
        action: 'tax',
        params: { base, rate: Math.min(45, current + 2) },
        narrative: `${country.name}为偿债提高${TAX_BASE_NAMES[base]}`,
      }
    }
  }
  if (
    country.econ.income < country.econ.expense &&
    country.econ.treasury < 5 &&
    country.econ.spending.army > 1 &&
    rng.chance(0.3)
  ) {
    return {
      countryId: country.id,
      action: 'spending',
      params: { category: 'army', amount: country.econ.spending.army - 1 },
      narrative: `${country.name}压缩军费以平衡预算`,
    }
  }
  // Confidence drifts with the fiscal mood when the model is unavailable.
  if (rng.chance(0.15)) {
    const mood = country.econ.income - country.econ.expense > 0 ? 1 : -1
    return {
      countryId: country.id,
      action: 'invest',
      params: { amount: mood },
      narrative: `${country.name}调整投资信心`,
    }
  }
  if (
    !atWar &&
    country.econ.treasury > 8 &&
    country.econ.constructionQueue.length < 6 &&
    rng.chance(0.45)
  ) {
    const options = [
      'factories',
      'farms',
      'mines',
      'railroads',
      'universities',
      'workshops',
    ] as const
    const building = rng.pick(options)
    return {
      countryId: country.id,
      action: 'build',
      params: { building, count: 1 },
      narrative: `${country.name}扩建${building}`,
    }
  }
  if (country.pops.radicals > 30 && country.econ.treasury > 4 && rng.chance(0.4)) {
    return {
      countryId: country.id,
      action: 'law',
      params: { name: '福利改革' },
      narrative: `${country.name}以福利安抚民怨`,
    }
  }
  const others = Object.values(world.countries).filter(one => one.id !== country.id)
  const infamous = others.filter(
    one => one.diplo.infamy > 25 && !country.diplo.rivals.includes(one.id),
  )
  if (!atWar && infamous.length > 0 && rng.chance(0.08)) {
    const target = rng.pick(infamous)
    return {
      countryId: country.id,
      action: 'diplomacy',
      params: { target: target.id, move: 'rival' },
      narrative: `${country.name}对声名狼藉的${target.name}提高警惕`,
    }
  }
  if (!atWar && rng.chance(0.12)) {
    const target = rng.pick(others)
    const current = country.diplo.relations[target.id] ?? 0
    if (current > -60 && rng.chance(0.4)) {
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'improve' },
        narrative: `${country.name}向${target.name}示好`,
      }
    }
  }
  if (
    !atWar &&
    rng.chance(0.03) &&
    country.leader.traits.some(trait => ['扩张', '军事', '海权', '民粹'].includes(trait))
  ) {
    const targets = Object.values(world.countries).filter(
      one => one.id !== country.id && (country.diplo.relations[one.id] ?? 0) < -20,
    )
    if (targets.length > 0) {
      const target = rng.pick(targets)
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'war', reason: '宿怨与野心', goal: 'reparations' },
        narrative: `${country.name}对${target.name}发出最后通牒`,
      }
    }
  }
  return undefined
}

/**
 * Why a managed run should stop after the month that just passed, or '' to
 * keep going (plan §4.5). The secretary-overreach check lives in the hooks
 * layer, where the audit flag is.
 */
export function councilInterrupt(before: WorldState, after: WorldState): string {
  const pendingOf = (world: WorldState): number =>
    world.events.filter(event => event.countryId === world.playerId && !event.isResolved).length
  // Any unresolved player event stops a run, whether it was already open or
  // arrived this month (plan §4.5).
  if (pendingOf(after) > 0) return '有待决事件'

  const atWar = (world: WorldState, id: string): boolean =>
    world.wars.some(
      war =>
        war.id === id &&
        (war.attackers.includes(world.playerId) || war.defenders.includes(world.playerId)),
    )
  const newWar = after.wars.some(war => !before.wars.some(one => one.id === war.id) && atWar(after, war.id))
  if (newWar) return '新的战争'
  const warEnded = before.wars.some(war => atWar(before, war.id) && !after.wars.some(one => one.id === war.id))
  if (warEnded) return '战争结束'
  return ''
}
