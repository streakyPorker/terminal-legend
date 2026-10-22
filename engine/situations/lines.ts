import type { WorldState } from '../../types'
import type { SituationDefinition } from './types'

const f = (value: number, digits = 0): string => value.toFixed(digits)

/** The context the GBR free-trade line hands to its agent. */
function gbrFreeTradeContext(world: WorldState): string {
  const gbr = world.countries.GBR
  if (gbr === undefined) return `${world.date.year}年，英国权衡自由贸易。`
  return [
    `${world.date.year}年${world.date.month}月，英国工业资本呼吁打开海外市场。`,
    `${gbr.leader.name}（${gbr.leader.persona}）议程：${gbr.leader.agenda}。`,
    `关税 ${Math.round(gbr.econ.tariff)}%，国库 ${Math.round(gbr.econ.treasury)}，月度收入 ${gbr.econ.income.toFixed(1)}。`,
  ].join('\n')
}

/** The context the QING self-strengthening line hands to its agent. */
function qingSelfStrengtheningContext(world: WorldState): string {
  const qing = world.countries.QING
  if (qing === undefined) return `${world.date.year}年，清廷筹议自强。`
  return [
    `${world.date.year}年${world.date.month}月，内忧外患之下清廷筹议自强。`,
    `${qing.leader.name}（${qing.leader.persona}）议程：${qing.leader.agenda}。`,
    `工业基础 ${f(qing.econ.gdp, 0)}，识字率 ${Math.round(qing.pops.literacy * 100)}%，国库 ${Math.round(qing.econ.treasury)}。`,
  ].join('\n')
}

/**
 * The first sample great-power lines (plan 0002 §2/S2): GBR's free-trade pivot
 * and QING's self-strengthening movement. Both are single-participant `engine`
 * situations that produce stackable `situation:` modifiers through the generic
 * path. Their trigger years sit outside every 60/120-month baseline window, so
 * they never perturb the existing regressions.
 */
export const SAMPLE_LINES: SituationDefinition[] = [
  {
    id: 'gbr-free-trade',
    title: '自由贸易转向',
    triggers: [
      { conditions: [], predicate: (world: WorldState) => world.date.year >= 1850 },
    ],
    participants: ['GBR'],
    context: gbrFreeTradeContext,
    envelope: {
      stats: ['marketAccess', 'income', 'taxEfficiency', 'gdp'],
      maxEffects: 3,
      monthsRange: [12, 36],
    },
    order: 'simultaneous',
    resolve: 'engine',
    stances: ['free-trade', 'protection'],
    stanceNames: { 'free-trade': '自由贸易', protection: '保护关税' },
    defaults: {
      GBR: {
        stance: 'free-trade',
        narrative: '削减关税壁垒，以通商开拓海外市场',
        effects: [
          { stat: 'marketAccess', stack: 'flat', value: 0.05, months: 36, label: '自由贸易' },
          { stat: 'income', stack: 'percent', value: 4, months: 36, label: '通商红利' },
          { stat: 'taxEfficiency', stack: 'percent', value: -3, months: 36, label: '关税损失' },
        ],
      },
    },
    resolveText: '「{title}」定策「{outcome}」',
  },
  {
    id: 'qing-self-strengthening',
    title: '自强运动',
    triggers: [
      { conditions: [], predicate: (world: WorldState) => world.date.year >= 1861 },
    ],
    participants: ['QING'],
    context: qingSelfStrengtheningContext,
    envelope: {
      stats: ['factoryOutput', 'techPoints', 'income', 'production'],
      maxEffects: 3,
      monthsRange: [24, 60],
    },
    order: 'simultaneous',
    resolve: 'engine',
    stances: ['self-strengthen', 'conservative'],
    stanceNames: { 'self-strengthen': '自强', conservative: '守旧' },
    defaults: {
      QING: {
        stance: 'self-strengthen',
        narrative: '师夷长技以自强，兴办机器局与同文馆',
        effects: [
          { stat: 'factoryOutput', stack: 'percent', value: 6, months: 48, label: '洋务' },
          { stat: 'techPoints', stack: 'percent', value: 8, months: 48, label: '西学' },
          { stat: 'income', stack: 'percent', value: -3, months: 48, label: '经费' },
        ],
      },
    },
    resolveText: '「{title}」定策「{outcome}」',
  },
]
