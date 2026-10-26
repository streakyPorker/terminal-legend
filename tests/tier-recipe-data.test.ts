import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_IDS, BUILDING_RECIPES, GOODS } from '../engine/data'
import type { BuildTierDef, BuildingId, GoodId, RecipeIO } from '../engine/data'

// ============================================================================
// Plan 0015 §S1 + plan 0016 §S0 — tier DATA single source of truth (附录 B / 附录 A).
//
// Two guards:
//   1. Drift guard — independently re-expand the multiplier rules (II/III from
//      0015 附录 B, IV/V from 0016 附录 A) from the tier-I `BUILDING_RECIPES[id]`
//      and assert bit-equality with the stored `tiers`. If the stored table is
//      ever hand-edited away from the rules, this fails.
//   2. Check-value guard — value-added per seat/month at BASE prices must match
//      the frozen 0015 oracle across I/II/III and the 0016 附录 A.3 derived oracle
//      across IV/V (tolerance ±0.005). A rule change that silently moves the
//      economics trips here.
//
// The expansion below is deliberately independent of `recipeAt`: it rebuilds the
// recipes from the tier-I baseline and the raw multipliers, never reading `tiers`.
// It is cumulative: IV multiplies III, V multiplies IV.
// ============================================================================

// ---------------------------------------------------------------- 附录-A/B families
const HEAVY: BuildingId[] = ['steelMills', 'machineryWorks', 'arsenals']
const EXTRACTION: BuildingId[] = ['coalMines', 'ironMines', 'lumberMills']
const LIGHT: BuildingId[] = ['textileMills', 'furnitureWorks', 'distilleries', 'luxuryWorks']
const SHIPYARD: BuildingId[] = ['navalYards']
const INFRA: BuildingId[] = ['infrastructure']
const NAVAL_BASE: BuildingId[] = ['navalBases']
// S3: the three new works + farms. chemicalWorks/locomotiveWorks are heavy-family
// members (coal substitution + their own electricity); powerPlants shares the
// heavy OUTPUT rule but takes no electricity and substitutes no coal; farms is
// its own land/labour family.
const NEW_WORKS: BuildingId[] = ['chemicalWorks', 'locomotiveWorks']
const POWER_PLANTS: BuildingId[] = ['powerPlants']
const FARMS: BuildingId[] = ['farms']

const TIERED: BuildingId[] = [
  ...HEAVY,
  ...EXTRACTION,
  ...LIGHT,
  ...SHIPYARD,
  ...INFRA,
  ...NAVAL_BASE,
  ...NEW_WORKS,
  ...POWER_PLANTS,
  ...FARMS,
]

/**
 * Cumulative family multipliers `[outII,inII,labII, outIII,inIII,labIII,
 * outIV,inIV,labIV, outV,inV,labV]` (附录 A.1). IV/V are only defined for the 13
 * S0 families plus the two S3 forward-compat rows.
 */
type FamilyRule = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

const FAMILY_RULES: Record<BuildingId, FamilyRule> = {
  steelMills: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  machineryWorks: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  arsenals: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  chemicalWorks: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  locomotiveWorks: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  coalMines: [1.3, 1, 1.15, 1.3, 1, 1.1, 1.3, 1, 1.1, 1.28, 1, 1.08],
  ironMines: [1.3, 1, 1.15, 1.3, 1, 1.1, 1.3, 1, 1.1, 1.28, 1, 1.08],
  lumberMills: [1.3, 1, 1.15, 1.3, 1, 1.1, 1.3, 1, 1.1, 1.28, 1, 1.08],
  textileMills: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05, 1.3, 1.1, 1.05, 1.28, 1.08, 1.03],
  furnitureWorks: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05, 1.3, 1.1, 1.05, 1.28, 1.08, 1.03],
  distilleries: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05, 1.3, 1.1, 1.05, 1.28, 1.08, 1.03],
  luxuryWorks: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05, 1.3, 1.1, 1.05, 1.28, 1.08, 1.03],
  navalYards: [1.25, 1.1, 1.1, 1.5, 1.08, 1.05, 1.3, 1.08, 1.05, 1.35, 1.06, 1.03],
  infrastructure: [1, 1.15, 1, 1, 1.2, 1, 1, 1.2, 1, 1, 1.25, 1],
  navalBases: [1, 1.1, 1, 1, 1.15, 1, 1, 1.15, 1, 1, 1.2, 1],
  powerPlants: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05, 1.3, 1.12, 1.05, 1.28, 1.1, 1.02],
  farms: [1.25, 1, 1.1, 1.25, 1, 1.08, 1.25, 1, 1.08, 1.25, 1, 1.05],
}

/** Per-family `coal` substitution multipliers at IV / V (附录 A.1); 1 = none. */
const FAMILY_COAL: Partial<Record<BuildingId, readonly [number, number]>> = {
  steelMills: [0.7, 0.6],
  machineryWorks: [0.7, 0.6],
  arsenals: [0.7, 0.6],
  chemicalWorks: [0.7, 0.6],
  locomotiveWorks: [0.7, 0.6],
  textileMills: [0.8, 0.7],
  furnitureWorks: [0.8, 0.7],
  distilleries: [0.8, 0.7],
  luxuryWorks: [0.8, 0.7],
}

/** Per-building IV/V `electricity` input, per seat per month (附录 A.2). */
const PER_BUILDING_ELECTRICITY: Partial<Record<BuildingId, readonly [number, number]>> = {
  steelMills: [0.3, 0.4],
  machineryWorks: [0.3, 0.4],
  arsenals: [0.3, 0.4],
  chemicalWorks: [0.35, 0.45],
  locomotiveWorks: [0.25, 0.32],
  coalMines: [0.08, 0.12],
  ironMines: [0.08, 0.12],
  lumberMills: [0.08, 0.12],
  textileMills: [0.15, 0.2],
  furnitureWorks: [0.15, 0.2],
  distilleries: [0.15, 0.2],
  luxuryWorks: [0.15, 0.2],
  navalYards: [0.2, 0.28],
  infrastructure: [0.3, 0.4],
  navalBases: [0.1, 0.15],
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

const mul = (io: RecipeIO, factor: number): RecipeIO => {
  const out: RecipeIO = {}
  for (const [good, qty] of Object.entries(io)) out[good as GoodId] = (qty ?? 0) * factor
  return out
}

/** 附录 A.1 order: scale the whole basket, then substitute `coal`, then add electricity. */
const electrify = (input: RecipeIO, coalFactor: number, electricity: number): RecipeIO => {
  const out: RecipeIO = { ...input }
  if (out.coal !== undefined) out.coal *= coalFactor
  if (electricity > 0) out.electricity = electricity
  return out
}

const roundIO = (io: RecipeIO): RecipeIO => {
  const out: RecipeIO = {}
  for (const [good, qty] of Object.entries(io)) out[good as GoodId] = round3(qty)
  return out
}

type RawTier = { output: RecipeIO; input: RecipeIO; labor: number }

const roundDef = (raw: RawTier): BuildTierDef => ({
  output: roundIO(raw.output),
  input: roundIO(raw.input),
  labor: round3(raw.labor),
})

/** Independently re-expand 附录 A/B from the tier-I baseline (never reads `tiers`). */
const expandTiersRaw = (id: BuildingId): RawTier[] => {
  const base = BUILDING_RECIPES[id]
  const r = FAMILY_RULES[id]
  const coal = FAMILY_COAL[id] ?? [1, 1]
  const elec = PER_BUILDING_ELECTRICITY[id] ?? [0, 0]
  let t2: RawTier
  let t3: RawTier
  let t4: RawTier
  let t5: RawTier
  if (SHIPYARD.includes(id)) {
    // ships ×r[0]/×r[3]/×r[6]/×r[9] for II…V; machinery carries at II (×r[1]) for good.
    const ships2 = (base.output.ships ?? 0) * r[0] * r[3]
    const mach2 = (base.output.machinery ?? 0) * r[1]
    t2 = {
      output: { ships: (base.output.ships ?? 0) * r[0], machinery: mach2 },
      input: mul(base.input, r[1]),
      labor: base.labor * r[2],
    }
    t3 = {
      output: { ships: ships2, machinery: mach2 },
      input: mul(t2.input, r[4]),
      labor: t2.labor * r[5],
    }
    t4 = {
      output: { ships: ships2 * r[6], machinery: mach2 },
      input: electrify(mul(t3.input, r[7]), coal[0], elec[0]),
      labor: t3.labor * r[8],
    }
    t5 = {
      output: { ships: ships2 * r[6] * r[9], machinery: mach2 },
      input: electrify(mul(t4.input, r[10]), coal[1], elec[1]),
      labor: t4.labor * r[11],
    }
  } else if (INFRA.includes(id)) {
    t2 = { output: {}, input: mul(base.input, r[1]), labor: base.labor }
    t3 = {
      output: {},
      input: { ...mul(t2.input, r[4]), locomotives: 0.4 },
      labor: base.labor,
    }
    t4 = { output: {}, input: electrify(mul(t3.input, r[7]), coal[0], elec[0]), labor: base.labor }
    t5 = { output: {}, input: electrify(mul(t4.input, r[10]), coal[1], elec[1]), labor: base.labor }
  } else if (NAVAL_BASE.includes(id)) {
    t2 = { output: {}, input: mul(base.input, r[1]), labor: base.labor }
    t3 = { output: {}, input: mul(t2.input, r[4]), labor: base.labor }
    t4 = { output: {}, input: electrify(mul(t3.input, r[7]), coal[0], elec[0]), labor: base.labor }
    t5 = { output: {}, input: electrify(mul(t4.input, r[10]), coal[1], elec[1]), labor: base.labor }
  } else {
    t2 = { output: mul(base.output, r[0]), input: mul(base.input, r[1]), labor: base.labor * r[2] }
    t3 = { output: mul(t2.output, r[3]), input: mul(t2.input, r[4]), labor: t2.labor * r[5] }
    t4 = {
      output: mul(t3.output, r[6]),
      input: electrify(mul(t3.input, r[7]), coal[0], elec[0]),
      labor: t3.labor * r[8],
    }
    t5 = {
      output: mul(t4.output, r[9]),
      input: electrify(mul(t4.input, r[10]), coal[1], elec[1]),
      labor: t4.labor * r[11],
    }
  }
  return [t2, t3, t4, t5]
}

const expandTiers = (id: BuildingId): BuildTierDef[] => expandTiersRaw(id).map(roundDef)

describe('Tier recipe data — 附录-B drift guard (plan 0015 S1 / plan 0016 S0)', () => {
  test('each of the 17 tiered buildings stores exactly four tiers', () => {
    for (const id of TIERED) {
      const tiers = BUILDING_RECIPES[id].tiers
      expect(tiers, `${id}.tiers is defined`).toBeDefined()
      expect(tiers?.length, `${id} has exactly II + III + IV + V`).toBe(4)
    }
  })

  test('stored tiers are bit-equal to the rules re-expanded from tier I', () => {
    for (const id of TIERED) {
      const stored = BUILDING_RECIPES[id].tiers
      const expanded = expandTiers(id)
      expect(stored?.[0], `${id} II 级`).toEqual(expanded[0])
      expect(stored?.[1], `${id} III 级`).toEqual(expanded[1])
      expect(stored?.[2], `${id} IV 级`).toEqual(expanded[2])
      expect(stored?.[3], `${id} V 级`).toEqual(expanded[3])
    }
  })

  test('per-building IV/V electricity is encoded per building, not per family (附录 A.2)', () => {
    const elec = (id: BuildingId, tier: number): number | undefined =>
      BUILDING_RECIPES[id].tiers?.[tier]?.input.electricity
    expect(elec('steelMills', 2)).toBe(0.3)
    expect(elec('machineryWorks', 2)).toBe(0.3)
    expect(elec('arsenals', 2)).toBe(0.3)
    // The heavy family is NOT uniform: chemicalWorks 0.35 ≠ steelMills 0.30 ≠
    // locomotiveWorks 0.25 (S3, 附录 A.2).
    expect(elec('chemicalWorks', 2)).toBe(0.35)
    expect(elec('locomotiveWorks', 2)).toBe(0.25)
    expect(elec('infrastructure', 2)).toBe(0.3)
    expect(elec('lumberMills', 2)).toBe(0.08)
    expect(elec('textileMills', 2)).toBe(0.15)
    expect(elec('distilleries', 2)).toBe(0.15)
    expect(elec('navalYards', 2)).toBe(0.2)
    expect(elec('navalBases', 2)).toBe(0.1)
    expect(elec('steelMills', 3)).toBe(0.4)
    expect(elec('chemicalWorks', 3)).toBe(0.45)
    expect(elec('locomotiveWorks', 3)).toBe(0.32)
    expect(elec('coalMines', 3)).toBe(0.12)
    expect(elec('luxuryWorks', 3)).toBe(0.2)
    expect(new Set([0.08, 0.1, 0.15, 0.2, 0.3]).size).toBe(5)
  })

  test('tier I is untouched and the other 6 buildings stay untiered', () => {
    for (const id of BUILDING_IDS) {
      if (TIERED.includes(id)) continue
      expect(BUILDING_RECIPES[id].tiers, `${id} must stay untiered`).toBeUndefined()
    }
  })

  test('S3: powerPlants/farms derive four tiers with no electricity input (附录 A.2)', () => {
    for (const id of [...POWER_PLANTS, ...FARMS]) {
      const expanded = expandTiers(id)
      expect(expanded.length, `${id} derives II–V`).toBe(4)
      for (const tier of expanded) {
        expect(tier.input.electricity, `${id} takes no electricity`).toBeUndefined()
      }
    }
  })
})

// ---------------------------------------------------------------- check values
const ruleRecipe = (id: BuildingId, tier: number): { output: RecipeIO; input: RecipeIO } => {
  if (tier <= 0) return BUILDING_RECIPES[id]
  return expandTiersRaw(id)[tier - 1] ?? BUILDING_RECIPES[id]
}

const valueAdded = (recipe: { output: RecipeIO; input: RecipeIO }): number => {
  let va = 0
  for (const [good, qty] of Object.entries(recipe.output)) {
    va += (qty ?? 0) * GOODS[good as GoodId].basePrice
  }
  for (const [good, qty] of Object.entries(recipe.input)) {
    va -= (qty ?? 0) * GOODS[good as GoodId].basePrice
  }
  return va
}

/** Frozen oracle: value-added per seat/month at base prices (0015 附录 B + 0016 附录 A.3). */
const CHECK: Record<BuildingId, { I: number; II: number; III: number; IV: number; V: number }> = {
  steelMills: { I: 5.08, II: 7.92, III: 12.1, IV: 17.06, V: 23.77 },
  machineryWorks: { I: 1.35, II: 2.39, III: 3.97, IV: 5.35, V: 7.66 },
  arsenals: { I: 3.26, II: 4.84, III: 7.13, IV: 9.28, V: 12.5 },
  textileMills: { I: 2.26, II: 3.35, III: 4.89, IV: 6.71, V: 9.29 },
  furnitureWorks: { I: 1.04, II: 1.56, III: 2.3, IV: 2.99, V: 4.16 },
  luxuryWorks: { I: -0.03, II: 0.83, III: 2.16, IV: 3.81, V: 6.29 },
}

const checkVA = (id: BuildingId, tier: number, expected: number): void => {
  // The 0015/0016 oracles are "由规则展开" — coefficients are rounded to 3 decimals
  // only when stored, so the check is evaluated on the pre-storage rule expansion.
  const va = valueAdded(ruleRecipe(id, tier))
  expect(
    Math.abs(va - expected),
    `${id} tier ${tier} value-added: computed ${va} vs oracle ${expected}`,
  ).toBeLessThan(0.005)
}

describe('Tier recipe data — check values at base prices (plan 0015 S1 / plan 0016 S0)', () => {
  test('value-added per seat/month matches the frozen oracle across I–V', () => {
    for (const [id, expected] of Object.entries(CHECK)) {
      const building = id as BuildingId
      checkVA(building, 0, expected.I)
      checkVA(building, 1, expected.II)
      checkVA(building, 2, expected.III)
      checkVA(building, 3, expected.IV)
      checkVA(building, 4, expected.V)
    }
  })
})
