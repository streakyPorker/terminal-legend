import type { WorldState } from '../../types'
import { fiscalLedger } from '../fiscal'
import { infrastructureStats } from '../data'
import { constructionLoad } from '../sim'
import { n, pct, signed, warFor } from './shared'

/**
 * Next-month cash sketch (plan 0006): last settled income/expense, with the
 * construction block replaced by this month's points and the rent that will be
 * booked next month. It is a plan, not a promise: trade and events move.
 */
export function forecastWorld(world: WorldState): string {
  const country = world.countries[world.playerId]
  if (country === undefined) return '还没有进行中的游戏。'
  const ledger = fiscalLedger(country, {
    atWar: warFor(world, country.id),
    tick: world.tick,
  })
  const load = constructionLoad(country)
  const subsidy = Math.max(0, country.econ.spending.construction) * 0.45
  const construction = load.allocated * 0.2
  const rent =
    (load.privateRented + load.privateMarket) * 0.3
  const income =
    ledger.income.total - ledger.income.other + rent
  const expense =
    ledger.expense.total -
    ledger.expense.construction -
    ledger.expense.constructionSubsidy +
    construction +
    subsidy
  const net = income - expense
  const treasury = country.econ.treasury + net
  const inf = infrastructureStats(country)
  const lines = [
    `[${country.flag}] ${country.name} · 下月现金流预估（${world.date.year}.${String(world.date.month).padStart(2, '0')} 结算后）`,
    `收入约 ${n(income)} = 上月的 ${n(ledger.income.total)} − 上月「其他」${n(ledger.income.other)} + 预计租金 ${n(rent)}`,
    `支出约 ${n(expense)} = 上月 ${n(ledger.expense.total)} − 上月国有建设 ${n(ledger.expense.construction)} − 补贴 ${n(ledger.expense.constructionSubsidy)} + 本月建造点 ${n(load.allocated)}×0.2 + 补贴 ${n(subsidy)}`,
    `净额约 ${signed(net)} 金；结算后国库约 ${signed(treasury)}${treasury < 0 ? '（转国债）' : treasury > 0 ? '（主权基金）' : ''}`,
    `统一基础设施：水平 ${n(inf.level, 0)}/100，供给 ${n(inf.supply)} ÷ 需求 ${n(inf.demand)} = ${n(inf.ratio, 2)}，下月产出乘数约 ${pct(inf.multiplier)}`,
    `建造力 ${n(load.capacity)}，已分配 ${n(load.allocated)}，私人租用 ${n(load.privateRented + load.privateMarket)}，闲置 ${n(load.remaining)}`,
    '这是计划值：贸易量、事件、关税与私人租金都会让它偏移。',
  ]
  return lines.join('\n')
}
