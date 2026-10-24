import type { Country, WorldState } from '../../types'
import { collectionEfficiency, fiscalLedger } from '../fiscal'
import { n, pct, signed, warFor } from './shared'

export function fiscalSection(world: WorldState, country: Country): string[] {
  const ledger = fiscalLedger(country, {
    atWar: warFor(world, country.id),
    tick: world.tick,
  })
  const pressure = ledger.debtPressure
  const qty = country.econ.taxBaseQty
  const rates = country.econ.taxes
  const bases = ledger.income.taxBases
  const transfers = (world.transfers ?? []).filter(
    schedule => schedule.from === country.id || schedule.to === country.id,
  )
  const lines = [
    `财政收入 ${n(ledger.income.total)} = 税入 ${n(ledger.income.taxes)} + 基建 ${n(ledger.income.ports)} + 基金收益 ${n(ledger.income.sovereignIncome)} + 赔款/转移 ${n(ledger.income.reparations)} + 其他 ${n(ledger.income.other)}`,
    `四税基（税额 = 税基量 × 税率 × 征收效率〔再乘逐基合规与债务削减〕；当前征收效率 ${pct(collectionEfficiency(country))}）：土地税 ${n(qty.land)} × ${n(rates.land, 0)}% = ${n(bases.land)}；企业所得税 ${n(qty.profit)} × ${n(rates.profit, 0)}% = ${n(bases.profit)}；消费税 ${n(qty.consumption)} × ${n(rates.consumption, 0)}% = ${n(bases.consumption)}；关税 ${n(qty.tariff)} × ${n(country.econ.tariff, 0)}% = ${n(bases.tariff)}`,
    `财政支出 ${n(ledger.expense.total)} = 陆军 ${n(ledger.expense.army)} + 海军 ${n(ledger.expense.navy)} + 行政 ${n(ledger.expense.administration)} + 教育 ${n(ledger.expense.education)} + 福利 ${n(ledger.expense.welfare)} + 债息 ${n(ledger.expense.debtInterest)} + 市场损耗 ${n(ledger.expense.marketLoss)} + 维护 ${n(ledger.expense.upkeep)} + 赔款/转移 ${n(ledger.expense.reparations)} + 国有建设 ${n(ledger.expense.construction)} + 建设补贴 ${n(ledger.expense.constructionSubsidy)}`,
    `净额 ${signed(ledger.net)} 金/月；国库 ${signed(country.econ.treasury)}（${ledger.debt > 0 ? `国债 ${n(ledger.debt)}，月息 ${pct(ledger.debtRate, 2)}` : `主权基金 ${n(ledger.fund)}，月息 ${pct(ledger.fundRate, 2)}`}）`,
    `债务压力 ${pressure.label}：债务/GDP ${pct(pressure.ratio, 0)}，收入 −${pct(pressure.incomePenalty, 0)}，建设速度 −${pct(pressure.constructionPenalty, 0)}，合法性目标 −${n(pressure.legitimacyPenalty)}，月息 +${pct(pressure.interestSpread, 2)}`,
    `私人贸易逆差 ${n(ledger.tradeGap)}（私人外债 ${n(ledger.privateDebt)}，不影响国库）；建造力租金收入 ${n(ledger.rentalIncome)}`,
    `税率：土地 ${n(rates.land, 0)}% / 企业 ${n(rates.profit, 0)}% / 消费 ${n(rates.consumption, 0)}%，进口关税 ${n(country.econ.tariff, 0)}% / 出口关税 ${n(country.econ.exportTariff ?? country.econ.tariff, 0)}%（GDP 是产出，不作税基）`,
  ]
  if (transfers.length > 0) {
    lines.push(
      `转移支付日程：${transfers
        .map(schedule => {
          const paying = schedule.from === country.id
          const otherId = paying ? schedule.to : schedule.from
          const other = world.countries[otherId]?.name ?? otherId
          return `${paying ? '付给' : '收自'}${other} 每月 ${n(schedule.monthlyAmount, 2)} 金，剩余 ${schedule.monthsLeft} 月（余 ${n(schedule.remaining, 2)} 金）｜${schedule.label}`
        })
        .join('；')}`,
    )
  }
  return lines
}
