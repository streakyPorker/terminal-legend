import type { Country, GoodId, Region, ResourceId, SpendingCategory, WarGoal } from '../../types'
import { demandShiftPercent } from './tech'

/** Chinese display labels for the four war goals (plan 0004 §5). */
export const WAR_GOAL_NAMES: Record<WarGoal, string> = {
  reparations: '赔款',
  openMarket: '开放市场',
  sphere: '势力范围',
  humiliation: '威望羞辱',
}

export const GOODS: Record<GoodId, { name: string; basePrice: number }> = {
  grain: { name: '粮食', basePrice: 1 },
  wood: { name: '木材', basePrice: 1.2 },
  coal: { name: '煤炭', basePrice: 1.6 },
  // `iron` is now raw ORE (铁矿石): a cheap raw material whose ONLY industrial
  // use is feeding the steel chain. `steel` (钢铁, below) is the worked metal
  // the heavy consumers (construction, railroads, machinery/arms) actually buy.
  // The id `iron` is kept to minimise cross-table churn (plan 0011 F1).
  iron: { name: '铁矿石', basePrice: 1 },
  // Priced at the OLD `iron` base price so every downstream consumer that switched
  // from `iron` to `steel` sees its real input cost unchanged. Tunable — F7 tunes.
  steel: { name: '钢铁', basePrice: 2 },
  fabric: { name: '布料', basePrice: 2 },
  clothes: { name: '成衣', basePrice: 3 },
  liquor: { name: '酒类', basePrice: 2.6 },
  furniture: { name: '家具', basePrice: 3.2 },
  machinery: { name: '机械', basePrice: 6 },
  arms: { name: '军械', basePrice: 7 },
  luxury: { name: '奢侈品', basePrice: 20 },
  opium: { name: '鸦片', basePrice: 2.5 },
  services: { name: '服务', basePrice: 4 },
  // PT-066: a ship is a capital good, not a consumer good. Shipyards produce
  // it; naval bases consume it and convert it into `military.navy`.
  ships: { name: '船只', basePrice: 12 },
  // Plan 0015 S4: prices kept from the S0 placeholder. They sit inside the
  // existing 1..10 band — chemicals a mid-tier industrial good (≈ steel),
  // electricity a cheap utility (≈ fabric), locomotives a capital good
  // (≈ ships). S4 did not retune them.
  chemicals: { name: '化工品', basePrice: 5 },
  electricity: { name: '电力', basePrice: 3 },
  locomotives: { name: '机车', basePrice: 12 },
}

export const GOOD_IDS = Object.keys(GOODS) as GoodId[]

/**
 * Region-pair transport cost multipliers (plan 0004 §1.2). Symmetric; the
 * diagonal is 1.0 so domestic-equivalent pairs pay no transport friction.
 */
export const REGION_COST: Record<Region, Record<Region, number>> = {
  europe: { europe: 1.0, eastAsia: 1.25, americas: 1.15, middleEast: 1.08 },
  eastAsia: { europe: 1.25, eastAsia: 1.0, americas: 1.3, middleEast: 1.2 },
  americas: { europe: 1.15, eastAsia: 1.3, americas: 1.0, middleEast: 1.25 },
  middleEast: { europe: 1.08, eastAsia: 1.2, americas: 1.25, middleEast: 1.0 },
}

// ---------------------------------------------------------------- resources

/**
 * Resource endowments are national and static in this slice. Only this table
 * changes when a new resource is added (plan 0003 §5).
 */
export const RESOURCE_IDS = ['farmland', 'timber', 'coal', 'iron'] as const

export const RESOURCE_MAP: Record<
  ResourceId,
  { name: string; goods: Partial<Record<GoodId, number>> }
> = {
  farmland: { name: '农田', goods: { grain: 1 } },
  timber: { name: '林地', goods: { wood: 1, furniture: 0.2 } },
  coal: { name: '煤矿', goods: { coal: 1 } },
  iron: { name: '铁矿', goods: { iron: 1 } },
}

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  farmland: '农田',
  timber: '林地',
  coal: '煤矿',
  iron: '铁矿',
}

// ---------------------------------------------------------------- demand parameters

/**
 * Stone-Geary consumer demand (plan 0003 §2.1). Values are per popFactor
 * (population in 万 / 1000) per month. Elasticity shares sum to 1, so all
 * supernumerary income is spent.
 */
export const CONSUMER_GOODS: GoodId[] = [
  'grain',
  'clothes',
  'furniture',
  'liquor',
  'services',
  'luxury',
]

/**
 * Calibrated: the plan's per-popFactor table was scaled by 0.6 after the
 * 60-month baseline showed the seed economies sitting below a 693-gold
 * subsistence line, which pinned them in a poverty trap. See
 * docs/plans/0003-economic-loop.md §0.2 for the recorded calibration.
 *
 * B5-r2 (plan 0008 §5) raised the clothes / liquor / furniture floors so the
 * final consumer basket actually absorbs enough output for those goods to trade
 * on both sides (PT-002 reversal). The other three floors are unchanged.
 */
export const SUBSISTENCE_SCALE = 0.62

export const SUBSISTENCE: Record<GoodId, number> = {
  grain: 7.0 * SUBSISTENCE_SCALE,
  clothes: 1.5 * SUBSISTENCE_SCALE,
  furniture: (5 / 12) * SUBSISTENCE_SCALE,
  liquor: (5 / 6) * SUBSISTENCE_SCALE,
  services: 1.0 * SUBSISTENCE_SCALE,
  luxury: 0.02 * SUBSISTENCE_SCALE,
  wood: 0,
  coal: 0,
  iron: 0,
  steel: 0,
  fabric: 0,
  machinery: 0,
  arms: 0,
  opium: 0,
  // Plan 0015 S4: the new goods have no Stone-Geary subsistence floor; `ships`
  // was a pre-existing omission too. `chemicals` joins the basket (`consumerBasket`)
  // via `industry-5`'s `demandShift` as a purely discretionary good, so its raw
  // table entries stay 0.
  ships: 0,
  chemicals: 0,
  electricity: 0,
  locomotives: 0,
}

/**
 * Share of supernumerary income actually spent on consumer goods this month.
 * The rest is household saving/leakage, which keeps the expenditure
 * multiplier from amplifying small investment shocks into runaway growth.
 */
export const CONSUMPTION_PROPENSITY = 0.75

export const INCOME_ELASTICITY: Record<GoodId, number> = {
  grain: 0.15,
  clothes: 0.25,
  furniture: 0.1,
  liquor: 0.1,
  services: 0.2,
  luxury: 0.2,
  wood: 0,
  coal: 0,
  iron: 0,
  steel: 0,
  fabric: 0,
  machinery: 0,
  arms: 0,
  opium: 0,
  // Plan 0015 S4: the raw elasticity of the new goods is 0. `chemicals`' active
  // consumer-basket weight is synthesised by `consumerBasket` from the
  // `demandShift` (see `DEMAND_SHIFT_ELASTICITY_BASE`), never written here.
  ships: 0,
  chemicals: 0,
  electricity: 0,
  locomotives: 0,
}

/**
 * plan 0015 S4 derived (not in 附录 B); tunable. Base elasticity a good starts
 * with when a completed node's `demandShift` first admits it to the consumer
 * basket (only `chemicals`, via `industry-5`). Kept small so the shift perturbs
 * the six calibrated consumer goods by well under the F7 margin bands.
 */
export const DEMAND_SHIFT_ELASTICITY_BASE = 0.05

/**
 * Plan 0015 §S4 / ADR 0031 §6: the Stone-Geary consumer basket for a country,
 * grown by node-level `demandShift` effects. A good that is already a consumer
 * good is always present; any other good with a nonzero `demandShiftPercent`
 * joins the basket with `DEMAND_SHIFT_ELASTICITY_BASE × (1 + shift/100)` as its
 * raw weight. The weights are renormalised so Σ elasticity === 1 — all
 * supernumerary income is spent — which leaves the six baseline goods untouched
 * while no shift is active (their raw weights already sum to 1).
 */
export function consumerBasket(country: Country): {
  goods: GoodId[]
  elasticity: Record<GoodId, number>
} {
  const goods = [...CONSUMER_GOODS]
  const elasticity: Record<GoodId, number> = { ...INCOME_ELASTICITY }
  for (const good of GOOD_IDS) {
    if (goods.includes(good)) continue
    const shift = demandShiftPercent(country, good)
    if (shift <= 0) continue
    goods.push(good)
    elasticity[good] = DEMAND_SHIFT_ELASTICITY_BASE * (1 + shift / 100)
  }
  let total = 0
  for (const good of goods) total += elasticity[good] ?? 0
  if (total > 0 && Math.abs(total - 1) > 1e-12) {
    for (const good of goods) elasticity[good] = (elasticity[good] ?? 0) / total
  }
  return { goods, elasticity }
}

/** Government purchases by spending category (plan 0003 §2.3). */
export const GOVERNMENT_DEMAND: Record<SpendingCategory, Partial<Record<GoodId, number>>> = {
  army: { arms: 0.7, machinery: 0.3 },
  navy: { arms: 0.5, machinery: 0.5 },
  bureaucracy: { services: 0.8, furniture: 0.2 },
  education: { services: 0.7, furniture: 0.3 },
  welfare: { grain: 0.6, clothes: 0.4 },
  construction: { wood: 0.4, steel: 0.35, machinery: 0.25 },
}
