import type { Country, EventOption, GameEvent, WorldState } from '../../types'
import type { Rng } from '../rng'
import { industrialBuildingCount } from './derivations'
import { GOODS } from './goods'
import { techTier } from './tech'

export function otherCountryIds(world: WorldState, countryId: string): string[] {
  return Object.keys(world.countries).filter(id => id !== countryId)
}

export function pickRival(world: WorldState, country: Country, rng: Rng): string {
  const rivals = country.diplo.rivals.filter(id => world.countries[id])
  if (rivals.length > 0) return rng.pick(rivals)
  const others = otherCountryIds(world, country.id)
  return rng.pick(others)
}

// Exported so the config-layer drift guard can assert 1:1 coverage by EVENT_BLOCKS.
export type EventTemplate = {
  kind: string
  title: string
  weight: number
  when?: (country: Country) => boolean
  text: (country: Country) => string
  options: (country: Country) => EventOption[]
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    kind: 'harvest',
    title: '丰年',
    weight: 14,
    text: c => `${c.name}各地风调雨顺，粮仓充盈，市集上的粮价应声回落。`,
    options: () => [
      {
        id: 'celebrate',
        label: '开仓平粜，与民同乐',
        result: '粮价稳定，民心稍安。',
        effects: {
          treasury: 2,
          legitimacy: 3,
          radicals: -2,
          modifiers: [
            { stat: 'sol', stack: 'flat', value: 2, months: 6, label: '丰年余庆' },
            { stat: 'growth', stack: 'percent', value: 10, months: 6, label: '丰年余庆' },
          ],
        },
      },
      {
        id: 'store',
        label: '囤积粮食，以备荒年',
        result: '国库多了些底气，百姓却觉得官府小气。',
        effects: {
          treasury: 4,
          legitimacy: -1,
          radicals: 1,
          modifiers: [
            { stat: 'income', stack: 'percent', value: 4, months: 6, label: '囤粮溢价' },
          ],
        },
      },
    ],
  },
  {
    kind: 'famine',
    title: '饥荒',
    weight: 10,
    // A famine needs an actual grain shortage, not merely low living
    // standards: grain priced above its base level (PT-025).
    when: c =>
      c.pops.sol < 45 &&
      (c.econ.prices.grain ?? GOODS.grain.basePrice) >=
        GOODS.grain.basePrice * 1.05,
    text: c => `${c.name}部分产粮区歉收，流民开始向城市聚集。`,
    options: c => [
      {
        id: 'relief',
        label: '开仓赈济',
        result: '灾民得到接济，地方秩序尚能维持。',
        effects: { treasury: -Math.max(2, c.econ.gdp * 0.006), radicals: -4, legitimacy: 2 },
      },
      {
        id: 'ignore',
        label: '责成地方自筹',
        result: '赈灾不力，怨声载道。',
        effects: { popsPercent: -0.4, radicals: 7, legitimacy: -4 },
      },
    ],
  },
  {
    kind: 'boom',
    title: '工业繁荣',
    weight: 12,
    when: c => industrialBuildingCount(c) >= 20,
    text: c => `${c.name}的工厂昼夜开工，商人们争相订购机器与煤炭。`,
    options: () => [
      {
        id: 'invest',
        label: '鼓励投资，扩大生产',
        result: '工业资本加速积累。',
        effects: {
          treasury: -2,
          techPoints: 35,
          radicals: -1,
          modifiers: [
            { stat: 'factoryOutput', stack: 'percent', value: 10, months: 12, label: '工业投资' },
            { stat: 'techPoints', stack: 'percent', value: 10, months: 12, label: '工业投资' },
          ],
        },
      },
      {
        id: 'tax',
        label: '加征工商税',
        result: '国库充盈，工厂主怨声载道。',
        effects: { treasury: 5, radicals: 4 },
      },
    ],
  },
  {
    kind: 'slump',
    title: '经济萧条',
    weight: 9,
    when: c => c.econ.marketAccess > 0.4,
    text: c => `${c.name}的市场出现滞销，银行收紧信贷，工场开始裁员。`,
    options: c => [
      {
        id: 'bailout',
        label: '政府出面救市',
        result: '市场暂时稳住，财政背上包袱。',
        effects: {
          treasury: -Math.max(3, c.econ.gdp * 0.01),
          radicals: -3,
          modifiers: [
            { stat: 'income', stack: 'percent', value: 5, months: 6, label: '救市余波' },
            { stat: 'expense', stack: 'percent', value: 5, months: 6, label: '救市余波' },
          ],
        },
      },
      {
        id: 'austerity',
        label: '紧缩开支，任其出清',
        result: '失业上升，街头开始出现骚动。',
        effects: { treasury: 3, radicals: 7, legitimacy: -2 },
      },
    ],
  },
  {
    kind: 'revolution',
    title: '革命浪潮',
    weight: 18,
    when: c => c.pops.radicals >= 25,
    text: c => `${c.name}的城市里出现秘密结社与传单，激进分子要求立宪与普选。`,
    options: c => [
      {
        id: 'repress',
        label: '出动军队镇压',
        result: '街头恢复秩序，但血债被记下了。',
        effects: { army: -1.5, radicals: 5, legitimacy: -3, prestige: 2 },
      },
      {
        id: 'reform',
        label: '宣布有限改革',
        result: '改革派暂时满意，保守派开始不安。',
        effects: { treasury: -Math.max(2, c.econ.gdp * 0.008), radicals: -9, legitimacy: 6 },
      },
    ],
  },
  {
    kind: 'border',
    title: '边疆危机',
    weight: 10,
    text: c => `${c.name}的边境传出摩擦：邻国的巡逻队越过了界河。`,
    options: () => [
      {
        id: 'hard',
        label: '增兵边境，寸土不让',
        result: '国内民族情绪高涨，外交局势紧张。',
        effects: { treasury: -2, prestige: 4, relationTarget: '@rival', relationAmount: -12 },
      },
      {
        id: 'talk',
        label: '派使节谈判',
        result: '危机暂时化解，但被指软弱。',
        effects: { prestige: -2, relationTarget: '@rival', relationAmount: 8 },
      },
    ],
  },
  {
    kind: 'breakthrough',
    title: '技术突破',
    weight: 8,
    when: c => techTier(c.tech) >= 2,
    text: c => `${c.name}的学者与工程师取得进展，一项新技术正走出实验室。`,
    options: () => [
      {
        id: 'fund',
        label: '追加拨款，尽快应用',
        result: '技术加速落地。',
        effects: { treasury: -3, techPoints: 70 },
      },
      {
        id: 'shelve',
        label: '先存档，等待时机',
        result: '知识被保存下来，但进展缓慢。',
        effects: { techPoints: 15 },
      },
    ],
  },
  {
    kind: 'succession',
    title: '领袖病重',
    weight: 6,
    when: c => c.leader.age >= 55,
    text: c => `${c.name}的${c.leader.title}${c.leader.name}身体抱恙，宫廷开始讨论继承问题。`,
    options: () => [
      {
        id: 'pray',
        label: '举行仪式，稳定人心',
        result: '宫廷秩序暂时无虞。',
        effects: { treasury: -1, legitimacy: 3 },
      },
      {
        id: 'prepare',
        label: '迎立新君，完成交接',
        result: '新领袖走上台前，旧时代的阴影仍在。',
        effects: { legitimacy: -2, radicals: 3, prestige: 1, succeed: true },
      },
    ],
  },
  {
    kind: 'colony',
    title: '殖民地动荡',
    weight: 7,
    when: c => c.diplo.prestige >= 40,
    text: c => `${c.name}的海外领地传来叛乱的消息，当地驻军请求增援。`,
    options: () => [
      {
        id: 'send',
        label: '派兵镇压',
        result: '叛乱被扑灭，帝国威严得以维持。',
        effects: { treasury: -3, army: -1, prestige: 5, radicals: 1 },
      },
      {
        id: 'concede',
        label: '给予有限自治',
        result: '殖民地暂时平静，国内强硬派不满。',
        effects: { treasury: 1, prestige: -4, radicals: 2 },
      },
    ],
  },
  {
    kind: 'diplomatic',
    title: '外交照会',
    weight: 9,
    text: c => `${c.name}收到一份措辞强硬的外交照会，对方要求重新划定势力范围。`,
    options: () => [
      {
        id: 'accept',
        label: '接受条件，换取和平',
        result: '风波平息，但威望受损。',
        effects: { prestige: -3, relationTarget: '@rival', relationAmount: 15 },
      },
      {
        id: 'reject',
        label: '严词拒绝',
        result: '国内舆论叫好，两国关系骤然紧张。',
        effects: { prestige: 3, relationTarget: '@rival', relationAmount: -15 },
      },
    ],
  },
]

export function spawnEvent(
  world: WorldState,
  country: Country,
  rng: Rng,
  forcedKind?: string,
): GameEvent | undefined {
  const candidates = EVENT_TEMPLATES.filter(template => {
    if (forcedKind !== undefined && template.kind !== forcedKind) return false
    if (template.kind === forcedKind) return true
    return template.when === undefined || template.when(country)
  })
  if (candidates.length === 0) return undefined

  const total = candidates.reduce((sum, template) => sum + template.weight, 0)
  let roll = rng.next() * total
  let chosen = candidates[candidates.length - 1] as EventTemplate
  for (const template of candidates) {
    roll -= template.weight
    if (roll <= 0) {
      chosen = template
      break
    }
  }

  const rivalId = pickRival(world, country, rng)
  const options = chosen.options(country).map(option => ({
    ...option,
    effects: {
      ...option.effects,
      ...(option.effects.relationTarget === '@rival'
        ? { relationTarget: rivalId }
        : {}),
    },
  }))

  return {
    id: `ev-${world.tick}-${country.id}-${rng.int(9999)}`,
    date: { ...world.date },
    kind: chosen.kind,
    title: chosen.title,
    text: chosen.text(country),
    countryId: country.id,
    options,
    isResolved: false,
  }
}
