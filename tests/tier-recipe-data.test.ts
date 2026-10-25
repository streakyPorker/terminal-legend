import { describe, expect, test } from 'claude-code/testing'
import { BUILDING_IDS, BUILDING_RECIPES, GOODS } from '../engine/data'
import type { BuildTierDef, BuildingId, GoodId, RecipeIO } from '../engine/data'

// ============================================================================
// Plan 0015 §S1 — tier DATA single source of truth (附录 B).
//
// Two guards:
//   1. Drift guard — independently re-expand the 附录-B multiplier rules from the
//      tier-I `BUILDING_RECIPES[id]` and assert bit-equality with the stored
//      `tiers`. If the stored table is ever hand-edited away from the rules,
//      this fails.
//   2. Check-value guard — value-added per seat/month at BASE prices must match
//      the frozen 附录-B oracle (tolerance ±0.005). This is the same oracle S1/S2
//      reuse, so a rule change that silently moves the economics trips here.
//
// The expansion below is deliberately independent of `recipeAt`: it rebuilds the
// recipes from the tier-I baseline and the raw multipliers, never reading `tiers`.
// ============================================================================

// ---------------------------------------------------------------- 附录-B families
const HEAVY: BuildingId[] = ['steelMills', 'machineryWorks', 'arsenals']
const EXTRACTION: BuildingId[] = ['coalMines', 'ironMines', 'lumberMills']
const LIGHT: BuildingId[] = ['textileMills', 'furnitureWorks', 'distilleries', 'luxuryWorks']
const SHIPYARD: BuildingId[] = ['navalYards']
const INFRA: BuildingId[] = ['infrastructure']
const NAVAL_BASE: BuildingId[] = ['navalBases']

const TIERED: BuildingId[] = [
  ...HEAVY,
  ...EXTRACTION,
  ...LIGHT,
  ...SHIPYARD,
  ...INFRA,
  ...NAVAL_BASE,
]

/** 附录-B multiplier rows, cumulative: [outII, inII, labII, outIII, inIII, labIII]. */
const FAMILY_RULES: Record<BuildingId, readonly [number, number, number, number, number, number]> =
  {
    steelMills: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05],
    machineryWorks: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05],
    arsenals: [1.35, 1.15, 1.1, 1.35, 1.12, 1.05],
    coalMines: [1.3, 1, 1.15, 1.3, 1, 1.1],
    ironMines: [1.3, 1, 1.15, 1.3, 1, 1.1],
    lumberMills: [1.3, 1, 1.15, 1.3, 1, 1.1],
    textileMills: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05],
    furnitureWorks: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05],
    distilleries: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05],
    luxuryWorks: [1.3, 1.12, 1.1, 1.3, 1.1, 1.05],
    navalYards: [1.25, 1.1, 1.1, 1.5, 1.08, 1.05],
    infrastructure: [1, 1.15, 1, 1, 1.2, 1],
    navalBases: [1, 1.1, 1, 1, 1.15, 1],
  }

const round3 = (n: number): number => Math.round(n * 1000) / 1000

const mul = (io: RecipeIO, factor: number): RecipeIO => {
  const out: RecipeIO = {}
  for (const [good, qty] of Object.entries(io)) out[good as GoodId] = (qty ?? 0) * factor
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

/** Independently re-expand 附录-B from the tier-I baseline (never reads `tiers`). */
const expandTiersRaw = (id: BuildingId): RawTier[] => {
  const base = BUILDING_RECIPES[id]
  const r = FAMILY_RULES[id]
  let t2: RawTier
  let t3: RawTier
  if (SHIPYARD.includes(id)) {
    // ships ×1.25 / machinery ×1.10 for II; ships ×1.50 for III, machinery carries forward.
    const ships2 = (base.output.ships ?? 0) * r[0]
    const mach2 = (base.output.machinery ?? 0) * r[1]
    t2 = {
      output: { ships: ships2, machinery: mach2 },
      input: mul(base.input, r[1]),
      labor: base.labor * r[2],
    }
    t3 = {
      output: { ships: ships2 * r[3], machinery: mach2 },
      input: mul(t2.input, r[4]),
      labor: t2.labor * r[5],
    }
  } else if (INFRA.includes(id)) {
    t2 = { output: {}, input: mul(base.input, r[1]), labor: base.labor }
    t3 = {
      output: {},
      input: { ...mul(t2.input, r[4]), locomotives: 0.4 },
      labor: base.labor,
    }
  } else if (NAVAL_BASE.includes(id)) {
    t2 = { output: {}, input: mul(base.input, r[1]), labor: base.labor }
    t3 = { output: {}, input: mul(t2.input, r[4]), labor: base.labor }
  } else {
    t2 = { output: mul(base.output, r[0]), input: mul(base.input, r[1]), labor: base.labor * r[2] }
    t3 = {
      output: mul(t2.output, r[3]),
      input: mul(t2.input, r[4]),
      labor: t2.labor * r[5],
    }
  }
  return [t2, t3]
}

const expandTiers = (id: BuildingId): BuildTierDef[] => expandTiersRaw(id).map(roundDef)

describe('Tier recipe data — 附录-B drift guard (plan 0015 S1)', () => {
  test('each of the 13 tiered buildings stores exactly two tiers', () => {
    for (const id of TIERED) {
      const tiers = BUILDING_RECIPES[id].tiers
      expect(tiers, `${id}.tiers is defined`).toBeDefined()
      expect(tiers?.length, `${id} has exactly II + III`).toBe(2)
    }
  })

  test('stored tiers are bit-equal to the 附录-B rules re-expanded from tier I', () => {
    for (const id of TIERED) {
      const stored = BUILDING_RECIPES[id].tiers
      const expanded = expandTiers(id)
      expect(stored?.[0], `${id} II 级`).toEqual(expanded[0])
      expect(stored?.[1], `${id} III 级`).toEqual(expanded[1])
    }
  })

  test('tier I is untouched and the other 10 buildings stay untiered', () => {
    for (const id of BUILDING_IDS) {
      if (TIERED.includes(id)) continue
      expect(BUILDING_RECIPES[id].tiers, `${id} must stay untiered`).toBeUndefined()
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

/** 附录-B frozen oracle: value-added per seat/month at base prices. */
const CHECK: Record<BuildingId, { I: number; II: number; III: number }> = {
  steelMills: { I: 5.08, II: 7.92, III: 12.1 },
  machineryWorks: { I: 1.35, II: 2.39, III: 3.97 },
  arsenals: { I: 3.26, II: 4.84, III: 7.13 },
  textileMills: { I: 2.26, II: 3.35, III: 4.89 },
  furnitureWorks: { I: 1.04, II: 1.56, III: 2.3 },
  luxuryWorks: { I: -0.03, II: 0.83, III: 2.16 },
}

const checkVA = (id: BuildingId, tier: number, expected: number): void => {
  // 附录-B says its oracle is "由规则展开" — coefficients are rounded to 3 decimals
  // only when stored, so the check is evaluated on the pre-storage rule expansion.
  const va = valueAdded(ruleRecipe(id, tier))
  expect(
    Math.abs(va - expected),
    `${id} tier ${tier} value-added: computed ${va} vs 附录-B ${expected}`,
  ).toBeLessThan(0.005)
}

describe('Tier recipe data — 附录-B check values at base prices (plan 0015 S1)', () => {
  test('value-added per seat/month matches the frozen oracle across I/II/III', () => {
    for (const [id, expected] of Object.entries(CHECK)) {
      const building = id as BuildingId
      checkVA(building, 0, expected.I)
      checkVA(building, 1, expected.II)
      checkVA(building, 2, expected.III)
    }
  })
})
