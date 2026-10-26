import type { BuildingId, Country, TaxBaseId, WorldState } from '../../types'
import {
  TAX_BASE_IDS,
  TAX_BASE_NAMES,
  nationalDebt,
  taxBaseRevenues,
} from '../fiscal'
import { BUILDINGS, isBuildingUnlocked, maxUnlockedTier } from '../data'
import { upgradeCandidate } from '../investment'
import type { Decision } from '../internal'
import type { Rng } from '../rng'

/** The roster the AI fallback may retrofit, in deterministic id order. */
const UPGRADE_ROSTER: BuildingId[] = [
  'farms',
  'coalMines',
  'ironMines',
  'lumberMills',
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
  'infrastructure',
  'navalYards',
  'chemicalWorks',
  'powerPlants',
  'locomotiveWorks',
]

/**
 * Plan 0016 §S6: the deterministic retrofit the AI fallback would order — the
 * first roster building whose mid/late tier is unlocked and whose next-tier
 * gross margin improves. Gated on `maxUnlockedTier >= 3` so the early-game build
 * fallback (and the tests that pin it) stay exactly as they were; the private
 * investment path covers the tier-II step. No RNG in the choice.
 */
function aiUpgradeCandidate(
  country: Country,
): { building: BuildingId; fromTier: number; toTier: number; count: number } | undefined {
  for (const building of UPGRADE_ROSTER) {
    if (!isBuildingUnlocked(country, building)) continue
    if (maxUnlockedTier(country, building) < 3) continue
    const candidate = upgradeCandidate(country, building, 1)
    if (candidate !== undefined) return { building, ...candidate }
  }
  return undefined
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
    // Plan 0016 §S6: within the construction branch, a retrofit of existing
    // seats wins over a new build when the next tier is unlocked and improves
    // the projected margin (deterministic pick, no extra RNG draw).
    const retrofit = aiUpgradeCandidate(country)
    if (retrofit !== undefined) {
      return {
        countryId: country.id,
        action: 'upgrade',
        params: {
          building: retrofit.building,
          fromTier: retrofit.fromTier + 1,
          toTier: retrofit.toTier + 1,
          count: retrofit.count,
        },
        narrative: `${country.name}将${BUILDINGS[retrofit.building].name}升级到更高等级`,
      }
    }
    const options: BuildingId[] = [
      'textileMills',
      'furnitureWorks',
      'distilleries',
      'machineryWorks',
      'steelMills',
      'arsenals',
      'luxuryWorks',
      'schools',
      'infrastructure',
      'forts',
      'navalYards',
      'farms',
      'coalMines',
      'ironMines',
      'lumberMills',
      'universities',
      'workshops',
      // Plan 0015 §S4: the new works become candidates once their tech node is
      // unlocked; `tierWeightedMultiplier`-style gating is the shared seam.
      'chemicalWorks',
      'powerPlants',
      'locomotiveWorks',
    ]
    // ADR 0031 §9.2: filter to buildable types so a locked new work can never be
    // chosen (the legacy roster is always unlocked, so this is a no-op for it).
    const buildable = options.filter(id => isBuildingUnlocked(country, id))
    const building = rng.pick(buildable)
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
