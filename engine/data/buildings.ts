import type { BuildingId, GoodId, ModifierStat, ResourceId } from '../../types'

// ============================================================ config: economy ==
// CONFIG SECTION. The engine formula that consumes these lives in
// `engine/economy.ts`; plan 0009 (ADR 0024) will relocate this block to
// `engine/config/economy.ts` without changing its shape. Kept declarative so the
// wage-split rule can be retuned without touching the profit formula.

/** Investment goods required per project-month, per building (plan 0003 §2.2). */
export const INVESTMENT_DEMAND: Record<BuildingId, Partial<Record<GoodId, number>>> = {
  farms: { wood: 0.12, furniture: 0.02 },
  // The three extraction buildings (plan 0011 F2). Steel, not ore, is the worked
  // metal every project buys (plan 0011 F1 moved investment demand off `iron`).
  coalMines: { steel: 0.1, machinery: 0.03, wood: 0.1 },
  ironMines: { steel: 0.05, machinery: 0.03, wood: 0.1 },
  lumberMills: { wood: 0.05, machinery: 0.02 },
  // Plan 0011 F3: the bundled factory split into seven industrial buildings.
  // Every project buys the worked metal (`steel`), never raw ore (plan 0011 F1).
  textileMills: { steel: 0.1, machinery: 0.1, wood: 0.1 },
  furnitureWorks: { wood: 0.2, steel: 0.08, machinery: 0.05 },
  distilleries: { steel: 0.1, machinery: 0.05, wood: 0.1 },
  machineryWorks: { steel: 0.2, machinery: 0.1 },
  steelMills: { steel: 0.15, machinery: 0.1 },
  arsenals: { steel: 0.2, machinery: 0.1 },
  luxuryWorks: { steel: 0.1, machinery: 0.1, fabric: 0.05 },
  // Plan 0014: railroads/ports/canals/telegraphs folded into one infrastructure
  // building. The basket is the old per-supply-weighted average of the merged
  // projects (steel + wood + a little machinery), so the aggregate construction
  // input of the infra stock is preserved.
  infrastructure: { steel: 0.29, wood: 0.49, machinery: 0.06 },
  universities: { furniture: 0.12, wood: 0.05 },
  barracks: { wood: 0.1, furniture: 0.05 },
  offices: { furniture: 0.1, wood: 0.05 },
  workshops: { wood: 0.3, steel: 0.2, furniture: 0.05 },
  // Plan 0011 F4: new buildings. As after F1, every project buys the
  // worked metal (`steel`), never raw ore.
  schools: { furniture: 0.1, wood: 0.05 },
  forts: { steel: 0.15, wood: 0.15 },
  navalYards: { wood: 0.3, steel: 0.2, machinery: 0.1 },
  // PT-066: naval base — a dry dock plus barracks for the fleet.
  navalBases: { steel: 0.25, wood: 0.2 },
  // Plan 0015 S4: the three new works keep an empty construction-investment
  // basket. They are public/strategic works whose admission is gated by
  // `isBuildingUnlocked`, so a new build consumes no goods — the added surface
  // would otherwise perturb the calibrated aggregate construction demand.
  chemicalWorks: {},
  powerPlants: {},
  locomotiveWorks: {},
}

/**
 * Legacy gross-output weights, retained as the private-investment shortage
 * signal (`investmentScore` in sim.ts). It is NOT a production source:
 * production reads `BUILDING_RECIPES` below. From B3 the profitability gate
 * (`buildingProfits.profitPerBuilding > 0`) is binding and this table only
 * allocates investment among already-profitable types (ADR 0022).
 */
export const BUILDING_OUTPUT: Record<BuildingId, Partial<Record<GoodId, number>>> = {
  farms: { grain: 1.05, wood: 0.16 },
  coalMines: { coal: 0.96 },
  ironMines: { iron: 0.96 },
  lumberMills: { wood: 0.96 },
  // F3: legacy shortage weights split off the old factories row (kept in the
  // same proportions so the private-investment ranking signal is unchanged).
  textileMills: { fabric: 0.6, clothes: 0.38 },
  furnitureWorks: { furniture: 0.22 },
  distilleries: { liquor: 0.2 },
  machineryWorks: { machinery: 0.09 },
  steelMills: { steel: 0.09 },
  arsenals: { arms: 0.07 },
  luxuryWorks: { luxury: 0.035 },
  // Plan 0014: no tradeable output — private investment never picks infrastructure
  // (as railroads/ports before the merge).
  infrastructure: {},
  universities: {},
  barracks: { arms: 0.05 },
  offices: {},
  workshops: {},
  navalBases: {},
  // Plan 0011 F4: the new buildings are public/military works. Empty here means
  // private investment never picks them (like universities/offices), so they are
  // only built by the state/AI and cannot perturb the goods calibration baseline.
  schools: {},
  forts: {},
  navalYards: {},
  // Plan 0015 S4: the three new works now carry a real shortage weight, so once
  // a tech node unlocks them private investment can bid for them. The weights
  // sit in the heavy-industry band (≈ steelMills 0.09) — the S4 baskets are
  // `chemicals` 1.4 / `electricity` 2.2 / `locomotives` 0.6 per seat per month.
  chemicalWorks: { chemicals: 0.08 },
  powerPlants: { electricity: 0.12 },
  locomotiveWorks: { locomotives: 0.03 },
}

// ---------------------------------------------------------------- building recipes

/** A per-building goods basket: good → quantity per building per month. */
export type RecipeIO = Partial<Record<GoodId, number>>

/**
 * Multiplier seams a recipe's output may pass through. The values are the same
 * runtime multipliers `computeProduction` always applied by hand; the recipe
 * only declares which ones a given output good uses, so results are unchanged.
 */
export type RecipeGates = {
  /** Country tech level multiplier (1 + level × 0.07). */
  tech?: boolean
  /**
   * Retired as a per-recipe gate by plan 0011 F5: infrastructure is now the
   * single unified pool multiplier in `computeProduction`, applied to every
   * building, not a flag a recipe opts into. Field kept for forward compatibility.
   */
  infrastructure?: boolean
  /** Market-access multiplier (0.55 + marketAccess × 0.9). */
  access?: boolean
  /** Coal/iron endowment factor (0.7..1.3), applied to industrial buildings. */
  industrial?: boolean
  /** Resource endowments that scale this output (forward-compat; unused in B1+B2). */
  resource?: ResourceId[]
}

/**
 * Plan 0015 §S1: one unlocked tier's recipe deltas. `tiers[0]` is II, `tiers[1]`
 * is III; `BUILDING_RECIPES[id]` stays tier I. S1 filled these here — every
 * tiered building below now carries its II/III recipes, per appendix B.
 */
export type BuildTierDef = {
  output: Partial<Record<GoodId, number>>
  input: Partial<Record<GoodId, number>>
  labor: number
}

/**
 * The single source of truth for building production and intermediate inputs
 * (ADR 0021, plan 0008 B1). `output` is the per-building monthly basket before
 * gates and per-good modifiers; `input` is the per-building monthly
 * intermediate consumption; `labor` is the per-building labor-demand
 * coefficient (ten-thousands of workers per building).
 */
export type BuildingRecipe = {
  output: RecipeIO
  input: RecipeIO
  labor: number
  /** Multipliers applied to every output good unless `outputGates` overrides. */
  gates?: RecipeGates
  /**
   * Per-output-good gate overrides for byproducts that share none of the
   * building's default gates (e.g. farms' wood, distilleries' liquor).
   */
  outputGates?: Partial<Record<GoodId, RecipeGates>>
  /** Building-category output modifier seam (farmOutput/mineOutput/factoryOutput). */
  outputModifier?: ModifierStat
  /**
   * Tier II/III recipes beyond the tier-I `BUILDING_RECIPES[id]` baseline
   * (plan 0015 §S1, per appendix B). S1 filled these on every tiered building;
   * an unset `tiers` means the building has no upgrade path, so `recipeAt`
   * falls back to tier I.
   */
  tiers?: BuildTierDef[]
}

/**
 * B1 copied these from the literals previously hardcoded in `computeProduction`
 * and the per-building intermediate block in `computeDemand`; B5 (plan 0008 §5)
 * then recalibrated the industrial row (details in plan 0008 B5). It cut the
 * material inputs and trimmed the consumer-good output so that a factory's value
 * added covers its allocated wage at the (locally glutted) consumer-good prices
 * — the pre-B5 row was ~87% material cost and ran at a loss. `workshops` output
 * is construction points, special-cased in sim.ts, so its `output` is empty.
 */
export const BUILDING_RECIPES: Record<BuildingId, BuildingRecipe> = {
  farms: {
    output: { grain: 0.2, wood: 0.04, opium: 0.004 },
    input: {},
    labor: 0.3,
    gates: { tech: true, access: true },
    outputGates: { wood: {} },
    outputModifier: 'farmOutput',
    // Plan 0016 §S3 / 附录 A (farm family): output ×1.25 per tier, labor
    // ×1.10/×1.08/×1.08/×1.05. No input basket and no electricity — farms are a
    // land/labour upgrade only.
    tiers: [
      { output: { grain: 0.25, wood: 0.05, opium: 0.005 }, input: {}, labor: 0.33 },
      { output: { grain: 0.313, wood: 0.063, opium: 0.006 }, input: {}, labor: 0.356 },
      { output: { grain: 0.391, wood: 0.078, opium: 0.008 }, input: {}, labor: 0.385 },
      { output: { grain: 0.488, wood: 0.098, opium: 0.01 }, input: {}, labor: 0.404 },
    ],
  },
  coalMines: {
    output: { coal: 0.96 },
    input: {},
    labor: 0.6,
    gates: { tech: true },
    outputModifier: 'mineOutput',
    tiers: [
      { output: { coal: 1.248 }, input: {}, labor: 0.69 },
      { output: { coal: 1.622 }, input: {}, labor: 0.759 },
      { output: { coal: 2.109 }, input: { electricity: 0.08 }, labor: 0.835 },
      { output: { coal: 2.7 }, input: { electricity: 0.12 }, labor: 0.902 },
    ],
  },
  ironMines: {
    output: { iron: 0.96 },
    input: {},
    labor: 0.6,
    gates: { tech: true },
    outputModifier: 'mineOutput',
    tiers: [
      { output: { iron: 1.248 }, input: {}, labor: 0.69 },
      { output: { iron: 1.622 }, input: {}, labor: 0.759 },
      { output: { iron: 2.109 }, input: { electricity: 0.08 }, labor: 0.835 },
      { output: { iron: 2.7 }, input: { electricity: 0.12 }, labor: 0.902 },
    ],
  },
  lumberMills: {
    output: { wood: 0.96 },
    input: {},
    labor: 0.4,
    gates: { tech: true },
    outputModifier: 'mineOutput',
    tiers: [
      { output: { wood: 1.248 }, input: {}, labor: 0.46 },
      { output: { wood: 1.622 }, input: {}, labor: 0.506 },
      { output: { wood: 2.109 }, input: { electricity: 0.08 }, labor: 0.557 },
      { output: { wood: 2.7 }, input: { electricity: 0.12 }, labor: 0.601 },
    ],
  },
  // Plan 0011 F3: the bundled `factories` row is split into seven single/few-
  // output industrial buildings. Outputs are `old_factory_output / valueShare`
  // so the national supply of every industrial good is conserved across the
  // split (the same conservation move F2 made for the mines); inputs reproduce
  // the old factory's per-factory consumption basket — grain to textiles/
  // distilleries, the ore to the smelters, the fabric to furniture/luxury, and
  // coal/wood/machinery (industrial working capital) to every type — so the
  // aggregate input bill, and with it the old ~16% margin band, is preserved.
  // The per-building gates are the old
  // `{tech, industrial}` pair, with the old liquor-only-industrial override kept
  // on `distilleries`. All seven share the `factoryOutput` seam.
  textileMills: {
    // B5-r2: the mill now works the fibre (fabric) and leaves the finished
    // garment mostly to the handicraft sector, so clothes can trade on both
    // sides (PT-002 reversal). Fabric output is raised to keep the mill's
    // value added — and with it the industrial margin band — intact.
    output: { fabric: 2.0, clothes: 0.2 },
    input: { grain: 1.0, coal: 0.18, wood: 0.1, machinery: 0.18 },
    labor: 0.9,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { fabric: 2.6, clothes: 0.26 },
        input: { grain: 1.12, coal: 0.202, wood: 0.112, machinery: 0.202 },
        labor: 0.99,
      },
      {
        output: { fabric: 3.38, clothes: 0.338 },
        input: { grain: 1.232, coal: 0.222, wood: 0.123, machinery: 0.222 },
        labor: 1.04,
      },
      {
        output: { fabric: 4.394, clothes: 0.439 },
        input: { grain: 1.355, coal: 0.195, wood: 0.136, machinery: 0.244, electricity: 0.15 },
        labor: 1.091,
      },
      {
        output: { fabric: 5.624, clothes: 0.562 },
        input: { grain: 1.464, coal: 0.148, wood: 0.146, machinery: 0.263, electricity: 0.2 },
        labor: 1.124,
      },
    ],
  },
  furnitureWorks: {
    // B5-r2: scaled to 0.45 of the F7 recipe (output × input together) so the
    // work is small enough that other countries bid for furniture, while the
    // operating margin is preserved (value added scales with the recipe).
    output: { furniture: 0.693 },
    input: { wood: 0.027, coal: 0.045, fabric: 0.315, steel: 0.081, machinery: 0.045 },
    labor: 0.7,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { furniture: 0.901 },
        input: { wood: 0.03, coal: 0.05, fabric: 0.353, steel: 0.091, machinery: 0.05 },
        labor: 0.77,
      },
      {
        output: { furniture: 1.171 },
        input: { wood: 0.033, coal: 0.055, fabric: 0.388, steel: 0.1, machinery: 0.055 },
        labor: 0.809,
      },
      {
        output: { furniture: 1.523 },
        input: {
          wood: 0.037,
          coal: 0.049,
          fabric: 0.427,
          steel: 0.11,
          machinery: 0.061,
          electricity: 0.15,
        },
        labor: 0.849,
      },
      {
        output: { furniture: 1.949 },
        input: {
          wood: 0.04,
          coal: 0.037,
          fabric: 0.461,
          steel: 0.119,
          machinery: 0.066,
          electricity: 0.2,
        },
        labor: 0.874,
      },
    ],
  },
  distilleries: {
    // B5-r2: scaled to 0.45 of the F7 recipe (output × input together). Cutting
    // spirit output alone would have broken the light-industry margin band;
    // scaling the input basket with it keeps value added per building intact
    // while leaving room for other countries to bid for liquor (PT-002).
    output: { liquor: 0.855 },
    input: { grain: 0.6075, coal: 0.09, wood: 0.0495, machinery: 0.0855 },
    labor: 0.6,
    gates: { tech: true, industrial: true },
    // The old bundled factory gated liquor by `industrial` alone (plan 0011 F3).
    outputGates: { liquor: { industrial: true } },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { liquor: 1.112 },
        input: { grain: 0.68, coal: 0.101, wood: 0.055, machinery: 0.096 },
        labor: 0.66,
      },
      {
        output: { liquor: 1.445 },
        input: { grain: 0.748, coal: 0.111, wood: 0.061, machinery: 0.105 },
        labor: 0.693,
      },
      {
        output: { liquor: 1.878 },
        input: { grain: 0.823, coal: 0.098, wood: 0.067, machinery: 0.116, electricity: 0.15 },
        labor: 0.728,
      },
      {
        output: { liquor: 2.404 },
        input: { grain: 0.889, coal: 0.074, wood: 0.072, machinery: 0.125, electricity: 0.2 },
        labor: 0.749,
      },
    ],
  },
  machineryWorks: {
    output: { machinery: 0.8 },
    input: { steel: 0.55, coal: 0.2, wood: 0.1, machinery: 0.18 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { machinery: 1.08 },
        input: { steel: 0.633, coal: 0.23, wood: 0.115, machinery: 0.207 },
        labor: 1.1,
      },
      {
        output: { machinery: 1.458 },
        input: { steel: 0.708, coal: 0.258, wood: 0.129, machinery: 0.232 },
        labor: 1.155,
      },
      {
        output: { machinery: 1.895 },
        input: { steel: 0.793, coal: 0.202, wood: 0.144, machinery: 0.26, electricity: 0.3 },
        labor: 1.213,
      },
      {
        output: { machinery: 2.426 },
        input: { steel: 0.873, coal: 0.133, wood: 0.159, machinery: 0.286, electricity: 0.4 },
        labor: 1.237,
      },
    ],
  },
  steelMills: {
    output: { steel: 4.0 },
    // Ore (raw `iron`) + coal are smelted into steel: the only consumer of ore.
    input: { iron: 3.2, coal: 1.0, machinery: 0.1 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    // Plan 0015 S1 / 附录 B (heavy industry), expanded from the I-level row:
    // II = output ×1.35, input ×1.15, labor ×1.10; III = II × output ×1.35,
    // input ×1.12, labor ×1.05 (cumulative, rounded to 3 decimals only here).
    tiers: [
      { output: { steel: 5.4 }, input: { iron: 3.68, coal: 1.15, machinery: 0.115 }, labor: 1.1 },
      {
        output: { steel: 7.29 },
        input: { iron: 4.122, coal: 1.288, machinery: 0.129 },
        labor: 1.155,
      },
      {
        output: { steel: 9.477 },
        input: { iron: 4.616, coal: 1.01, machinery: 0.144, electricity: 0.3 },
        labor: 1.213,
      },
      {
        output: { steel: 12.131 },
        input: { iron: 5.078, coal: 0.666, machinery: 0.159, electricity: 0.4 },
        labor: 1.237,
      },
    ],
  },
  arsenals: {
    output: { arms: 1.0 },
    input: { steel: 0.36, machinery: 0.18, coal: 0.12, iron: 0.18 },
    labor: 0.9,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { arms: 1.35 },
        input: { steel: 0.414, machinery: 0.207, coal: 0.138, iron: 0.207 },
        labor: 0.99,
      },
      {
        output: { arms: 1.823 },
        input: { steel: 0.464, machinery: 0.232, coal: 0.155, iron: 0.232 },
        labor: 1.04,
      },
      {
        output: { arms: 2.369 },
        input: { steel: 0.519, machinery: 0.26, coal: 0.121, iron: 0.26, electricity: 0.3 },
        labor: 1.091,
      },
      {
        output: { arms: 3.033 },
        input: { steel: 0.571, machinery: 0.286, coal: 0.08, iron: 0.286, electricity: 0.4 },
        labor: 1.113,
      },
    ],
  },
  luxuryWorks: {
    output: { luxury: 0.48 },
    input: { fabric: 1.5, coal: 0.26, wood: 0.14, machinery: 0.24 },
    labor: 0.8,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    tiers: [
      {
        output: { luxury: 0.624 },
        input: { fabric: 1.68, coal: 0.291, wood: 0.157, machinery: 0.269 },
        labor: 0.88,
      },
      {
        output: { luxury: 0.811 },
        input: { fabric: 1.848, coal: 0.32, wood: 0.172, machinery: 0.296 },
        labor: 0.924,
      },
      {
        output: { luxury: 1.055 },
        input: { fabric: 2.033, coal: 0.282, wood: 0.19, machinery: 0.325, electricity: 0.15 },
        labor: 0.97,
      },
      {
        output: { luxury: 1.35 },
        input: { fabric: 2.195, coal: 0.213, wood: 0.205, machinery: 0.351, electricity: 0.2 },
        labor: 0.999,
      },
    ],
  },
  // Plan 0011 F4. `schools` is the one new service producer (primary education);
  // `forts`/`navalYards` produce a small military good (arms / machinery).
  schools: {
    output: { services: 0.1 },
    input: {},
    labor: 0.15,
    gates: { access: true },
  },
  // Plan 0014: no tradeable output — a cost centre whose return is the unified
  // infrastructure flow (`INFRA_SUPPLY`), market access (on completion) and the
  // port tariff effect. The only merged provider that consumed goods was the
  // railroad (steel 0.5 / wood 0.4 per building over 60 buildings); folding that
  // draw across the 172 infrastructure buildings gives ≈0.175 steel. It is set to
  // 0.20 so the merge stays reference-point-neutral (the exact fold leaves the
  // small port-only economies just short of the private-investment-continuity
  // gate). Its running upkeep is the shared `INFRA_UPKEEP`, not this input.
  infrastructure: {
    output: {},
    input: { steel: 0.2, wood: 0.16 },
    labor: 0.54,
    tiers: [
      { output: {}, input: { steel: 0.23, wood: 0.184 }, labor: 0.54 },
      { output: {}, input: { steel: 0.276, wood: 0.221, locomotives: 0.4 }, labor: 0.54 },
      {
        output: {},
        input: { steel: 0.331, wood: 0.265, locomotives: 0.48, electricity: 0.3 },
        labor: 0.54,
      },
      {
        output: {},
        input: { steel: 0.414, wood: 0.331, locomotives: 0.6, electricity: 0.4 },
        labor: 0.54,
      },
    ],
  },
  forts: {
    output: { arms: 0.08 },
    input: { steel: 0.02, wood: 0.03 },
    labor: 0.3,
    gates: { tech: true, industrial: true },
  },
  navalYards: {
    // PT-066: a yard lays down hulls. `ships` is a tradeable good; the naval
    // base below turns delivered hulls into `military.navy`.
    output: { ships: 0.5, machinery: 0.03 },
    input: { steel: 0.18, wood: 0.12, machinery: 0.04 },
    labor: 0.8,
    gates: { tech: true, industrial: true },
    tiers: [
      {
        output: { ships: 0.625, machinery: 0.033 },
        input: { steel: 0.198, wood: 0.132, machinery: 0.044 },
        labor: 0.88,
      },
      {
        output: { ships: 0.938, machinery: 0.033 },
        input: { steel: 0.214, wood: 0.143, machinery: 0.048 },
        labor: 0.924,
      },
      {
        output: { ships: 1.219, machinery: 0.033 },
        input: { steel: 0.231, wood: 0.154, machinery: 0.051, electricity: 0.2 },
        labor: 0.97,
      },
      {
        output: { ships: 1.645, machinery: 0.033 },
        input: { steel: 0.245, wood: 0.163, machinery: 0.054, electricity: 0.28 },
        labor: 0.999,
      },
    ],
  },
  navalBases: {
    // Consumes one hull a month; the settlement grows the navy by the number
    // of hulls actually delivered.
    output: {},
    input: { ships: 0.5 },
    labor: 0.6,
    gates: { tech: true },
    tiers: [
      { output: {}, input: { ships: 0.55 }, labor: 0.6 },
      { output: {}, input: { ships: 0.633 }, labor: 0.6 },
      { output: {}, input: { ships: 0.727, electricity: 0.1 }, labor: 0.6 },
      { output: {}, input: { ships: 0.873, electricity: 0.15 }, labor: 0.6 },
    ],
  },
  universities: {
    output: { services: 0.2 },
    input: {},
    labor: 0.2,
  },
  barracks: {
    output: { arms: 0.05 },
    input: {},
    labor: 0.3,
  },
  offices: {
    output: { services: 0.8 },
    input: {},
    labor: 0.1,
  },
  workshops: {
    output: {},
    input: { wood: 1, grain: 0.6, iron: 0.3 },
    // Construction is labour-intensive: 0.8 makes 20 workshops a real employer
    // (~16 units of labour demand) instead of a zero-labour special case.
    labor: 0.8,
    // Plan 0016 §S7 / 附录 A.5: a higher-grade workshop switches raw `iron` for
    // worked `steel` (II+), adds `machinery` (III) and `electricity` (IV/V); wood
    // and grain ease slightly and labour rises. `output` stays `{}` — the
    // construction points are produced by `constructionCapacity`, not this recipe.
    tiers: [
      {
        output: {},
        input: { wood: 1.0, grain: 0.58, iron: 0.15, steel: 0.15 },
        labor: 0.88,
      },
      {
        output: {},
        input: { wood: 0.98, grain: 0.55, iron: 0.06, steel: 0.2, machinery: 0.06 },
        labor: 0.968,
      },
      {
        output: {},
        input: { wood: 0.95, grain: 0.52, steel: 0.26, machinery: 0.1, electricity: 0.15 },
        labor: 1.045,
      },
      {
        output: {},
        input: { wood: 0.92, grain: 0.5, steel: 0.3, machinery: 0.14, electricity: 0.22 },
        labor: 1.129,
      },
    ],
  },
  // Plan 0015 S4: the three new works. ADR 0031 §6 fixes the good sets (output
  // and the input members); the coefficients are NOT in the frozen appendix, so
  // they are derived here from the closest existing scale — the heavy-industry
  // family (steelMills / machineryWorks / arsenals) — with a value-added /
  // revenue ratio kept below the F7 heavyIndustry band ceiling (0.36) so the
  // per-seat gross margin sits inside [0, 0.36] at the reference point.
  // plan 0015 S4 derived (not in 附录 B); tunable.
  chemicalWorks: {
    // VA = 1.5×3 − (0.5×1.6 + 1.25×1 + 0.2×5.2) = 1.41 → 0.313 of revenue.
    output: { chemicals: 1.5 },
    input: { coal: 0.5, iron: 1.25, machinery: 0.2 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    // Plan 0016 §S3 / 附录 A: heavy-industry family (output ×1.35/×1.35/×1.30/×1.28,
    // input ×1.15/×1.12/×1.12/×1.10, labor ×1.10/×1.05/×1.05/×1.02) with coal
    // substitution (×0.70 IV, ×0.60 V, cumulative) and its own electricity draw.
    tiers: [
      { output: { chemicals: 2.025 }, input: { coal: 0.575, iron: 1.438, machinery: 0.23 }, labor: 1.1 },
      { output: { chemicals: 2.734 }, input: { coal: 0.644, iron: 1.61, machinery: 0.258 }, labor: 1.155 },
      {
        output: { chemicals: 3.554 },
        input: { coal: 0.505, iron: 1.803, machinery: 0.289, electricity: 0.35 },
        labor: 1.213,
      },
      {
        output: { chemicals: 4.549 },
        input: { coal: 0.333, iron: 1.984, machinery: 0.317, electricity: 0.45 },
        labor: 1.237,
      },
    ],
  },
  powerPlants: {
    // VA = 2.8×2 − (0.6×1.6 + 0.2×5.2 + 0.7×2.6) = 1.78 → 0.318 of revenue.
    output: { electricity: 2.8 },
    input: { coal: 0.6, machinery: 0.2, steel: 0.7 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    // Plan 0016 §S3 / 附录 A: heavy-industry OUTPUT rule, but a plant produces
    // electricity, so its own input takes NO electricity and substitutes NO coal.
    tiers: [
      { output: { electricity: 3.78 }, input: { coal: 0.69, machinery: 0.23, steel: 0.805 }, labor: 1.1 },
      { output: { electricity: 5.103 }, input: { coal: 0.773, machinery: 0.258, steel: 0.902 }, labor: 1.155 },
      { output: { electricity: 6.634 }, input: { coal: 0.866, machinery: 0.289, steel: 1.01 }, labor: 1.213 },
      { output: { electricity: 8.491 }, input: { coal: 0.952, machinery: 0.317, steel: 1.111 }, labor: 1.237 },
    ],
  },
  locomotiveWorks: {
    // VA = 0.8×8 − (1.0×2.6 + 0.2×5.2 + 0.4×1.6) = 2.12 → 0.331 of revenue.
    output: { locomotives: 0.8 },
    input: { steel: 1.0, machinery: 0.2, coal: 0.4 },
    labor: 1.0,
    gates: { tech: true, industrial: true },
    outputModifier: 'factoryOutput',
    // Plan 0016 §S3 / 附录 A: heavy-industry family with coal substitution and
    // its own (lighter, 0.25/0.32) electricity draw.
    tiers: [
      { output: { locomotives: 1.08 }, input: { steel: 1.15, machinery: 0.23, coal: 0.46 }, labor: 1.1 },
      { output: { locomotives: 1.458 }, input: { steel: 1.288, machinery: 0.258, coal: 0.515 }, labor: 1.155 },
      {
        output: { locomotives: 1.895 },
        input: { steel: 1.443, machinery: 0.289, coal: 0.404, electricity: 0.25 },
        labor: 1.213,
      },
      {
        output: { locomotives: 2.426 },
        input: { steel: 1.587, machinery: 0.317, coal: 0.267, electricity: 0.32 },
        labor: 1.237,
      },
    ],
  },
}

/**
 * Handicraft ("artisan") monthly output per ten-thousand artisans, per good.
 * These are the national, population-derived terms `computeProduction` always
 * added by hand alongside `BUILDING_RECIPES` (ADR 0021 keeps them out of the
 * per-building recipes because they scale with the artisan pop, not buildings).
 *
 * B5-r2 (plan 0008 §5) keeps these coefficients at their B5 values. Cutting
 * them was the other route to two-sided clothes/liquor/furniture, but it strips
 * the agrarian economies of their handicraft, so their unfillable consumer
 * demand cannot be paid for (imports are payment-capacity bound) and the
 * QING→GBR opium trade collapses below its ≥2/month gate (plan 0004 §4.1). B5-r2
 * therefore reaches two-sidedness from the factory side instead — the mills and
 * works make intermediates / smaller consumer baskets — and leaves artisans as
 * the bottom of the finished-goods market.
 */
export const ARTISAN_OUTPUT: Partial<Record<GoodId, number>> = {
  clothes: 0.035,
  liquor: 0.01,
  furniture: 0.006,
}

/** Artisan service output per ten-thousand artisans (national term). */
export const ARTISAN_SERVICE_OUTPUT = 0.01

/**
 * Forward-compatible building unlock contract (plan 0011 F6, ADR 0026 §5).
 * A building is gated behind `unlock.techLevel` when that field is set: the
 * `build` action then requires the country's derived `techTier`
 * (`1 + era×1.5 + unlocked×0.05`, plan 0005 K0) to be at least the threshold.
 * `unlock` absent, or `techLevel` absent, means always buildable. No building
 * sets a threshold yet — every building stays bit-for-bit buildable.
 */
export type BuildingUnlock = { techLevel?: number }

export type BuildingDef = {
  name: string
  cost: number
  note: string
  /** Forward-compat tech gate (plan 0005); absent = always buildable (F6). */
  unlock?: BuildingUnlock
  infrastructureNeed: number
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  // Plan 0011 F5: `infrastructureNeed` is the per-building monthly draw on the
  // unified national infrastructure pool (ADR 0026 §3). Heavy industry draws the
  // most, light industry less, and subsistence agriculture draws none (a single
  // QING seed carries ~3000 farms, so even a small per-farm need would swamp the
  // national pool — the plan's draft 0.4 produced a 0.016 ratio). All values are
  // the F5 calibration; F7 re-tunes.
  // Plan 0011 F6: `unlock` is the forward-compat tech gate; all 19 buildings
  // leave it absent (always buildable) so this slice stays behaviour-preserving.
  farms: { name: '农场', cost: 1.5, note: '粮食与原料，吸纳农业人口', infrastructureNeed: 0 },
  coalMines: { name: '煤矿', cost: 2.5, note: '煤炭，工业与钢铁的燃料', infrastructureNeed: 0.15 },
  ironMines: { name: '铁矿', cost: 2.5, note: '铁矿石，钢铁厂的原料', infrastructureNeed: 0.15 },
  lumberMills: { name: '伐木场', cost: 2, note: '木材，建造与家具的原料', infrastructureNeed: 0.12 },
  textileMills: { name: '纺织厂', cost: 4, note: '布料与成衣，轻工业的起点', infrastructureNeed: 0.18 },
  furnitureWorks: { name: '家具厂', cost: 3.5, note: '家具，木材与钢铁的下游', infrastructureNeed: 0.15 },
  distilleries: { name: '酿酒厂', cost: 3.5, note: '酒类，粮食的下游消费', infrastructureNeed: 0.12 },
  machineryWorks: { name: '机械厂', cost: 5, note: '机械，钢铁与煤的下游', infrastructureNeed: 0.18 },
  steelMills: { name: '钢铁厂', cost: 5, note: '钢铁，铁矿石与煤的冶炼', infrastructureNeed: 0.22 },
  arsenals: { name: '兵工厂', cost: 4.5, note: '军械，钢铁与机械的军工', infrastructureNeed: 0.15 },
  luxuryWorks: { name: '奢侈品厂', cost: 5, note: '奢侈品，布料与煤的高端制造', infrastructureNeed: 0.09 },
  schools: { name: '学校', cost: 2, note: '初等教育，产出服务并在建成时提升识字率', infrastructureNeed: 0.03 },
  infrastructure: { name: '基础设施', cost: 5, note: '统一基础设施：铁路/港口/电报合一，供给基础设施池、市场接入与关税收入', infrastructureNeed: 0.165 },
  forts: { name: '要塞', cost: 4, note: '国防工事，产少量军械', infrastructureNeed: 0.05 },
  navalYards: { name: '船坞', cost: 5, note: '造舰产能，产少量机械', infrastructureNeed: 0.15 },
  universities: { name: '大学', cost: 5, note: '科技点数、识字率与行政能力', infrastructureNeed: 0.05 },
  barracks: { name: '兵营', cost: 2.5, note: '军械产出', infrastructureNeed: 0.09 },
  offices: { name: '官署', cost: 3, note: '行政能力与官僚效能上限', infrastructureNeed: 0.08 },
  workshops: { name: '营造所', cost: 3, note: '消耗木材、粮食与铁，产出建造点', infrastructureNeed: 0.12 },
  navalBases: { name: '海军营地', cost: 5, note: '消耗船只，编练为海军', infrastructureNeed: 0.12 },
  // Plan 0015 S4: the three new works are gated by tech `unlockBuilding` effects
  // (see `buildingUnlocked` / `isBuildingUnlocked` in data/tech.ts), not by the
  // legacy `unlock.techLevel` field, which they leave absent. Costs sit in the
  // heavy-industry band (machineryWorks/steelMills).
  chemicalWorks: { name: '化工厂', cost: 5, note: '化工品，钢铁与煤的化学工业', infrastructureNeed: 0.2 },
  powerPlants: { name: '发电厂', cost: 5, note: '电力，工业与城市的动力来源', infrastructureNeed: 0.25 },
  locomotiveWorks: { name: '机车厂', cost: 5, note: '机车，钢铁与机械的交通装备', infrastructureNeed: 0.22 },
}

export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[]

export function buildOf(id: string): BuildingId | undefined {
  return (BUILDING_IDS as string[]).includes(id) ? (id as BuildingId) : undefined
}

// ---------------------------------------------------------------- infrastructure
// Plan 0011 F5 / ADR 0026: ONE national infrastructure pool. The old
// accumulated `transportInfrastructure` scalar becomes a DERIVED reading of this
// model — the same field now stores the unified level `clamp(100 × supply/demand,
// 0, 100)`, recomputed from building counts. The derived readers live in
// `./derivations.ts`; these are the declarative coefficients they read.

/**
 * Plan 0014 / ADR 0029: the single source of truth for "which buildings supply
 * the unified infrastructure pool". Today it holds only the merged
 * `infrastructure` building, but every infra consumer (supply summation, upkeep,
 * market access, panel grouping, "is this infra?" checks, the port tariff
 * effect) iterates THIS list and reads per-building coefficient tables, never a
 * hardcoded id — so re-splitting the merge later is a data-only change.
 */
export const INFRA_BUILDING_IDS: BuildingId[] = ['infrastructure']

/**
 * Public cost centres: they exist to supply something the goods market cannot
 * price (infrastructure, construction points), so their `buildingProfits` row
 * always reads as a deep loss. Profit-driven mechanisms — idling toward
 * `UTIL_IDLE_FLOOR` and the extra deep-loss wear — must skip them (PT-052).
 */
export const COST_CENTRE_BUILDING_IDS: BuildingId[] = [...INFRA_BUILDING_IDS, 'workshops']

export function isCostCentre(id: BuildingId): boolean {
  return COST_CENTRE_BUILDING_IDS.includes(id)
}

/**
 * Infrastructure each provider building adds per month. Chosen by a
 * supply-equivalence fold of the pre-merge providers:
 *
 *   legacy supply weights: railroads 2.5 / ports 1.1 / canals 1.6 / telegraphs 0.7
 *   legacy market access:  railroad 0.02 / port 0.01 / canal 0.01 / telegraph 0.005
 *
 * 2.16 + the 0.165 `infrastructureNeed` keep the 1836 ten-country infra `ratio`
 * within 2.7% of the pre-merge baseline (the hidden offset needed because the
 * merged building also replaces the providers' own demand).
 */
export const INFRA_SUPPLY: Partial<Record<BuildingId, number>> = {
  infrastructure: 2.16,
}

/**
 * Plan 0015 S4 / appendix B: the per-tier multiplier on `INFRA_SUPPLY`.
 * Index 0 is tier I (1), 1 is II (×1.30), 2 is III (×1.60); plan 0016 §S0
 * extends the table to IV (×2.08) and V (×2.70). `mixed` tiers blend
 * the multiplier by seat share (`tierWeightedMultiplier`), so an upgrade adds
 * supply without adding a seat — the only way a tiered infrastructure can pay
 * for its extra input and labour.
 */
export const INFRA_SUPPLY_TIER_MULTIPLIER: Partial<Record<BuildingId, number[]>> = {
  infrastructure: [1, 1.3, 1.6, 2.08, 2.7],
}

/** Shortfall-multiplier floor: a linear debuff cannot bite harder than this. */
export const INFRA_MULT_FLOOR = 0.35

/** Infrastructure running costs: throughput scales with supply, admin with level. */
export const INFRA_UPKEEP: {
  throughput: Partial<Record<GoodId, number>>
  admin: Partial<Record<GoodId, number>>
} = {
  throughput: { wood: 0.01, coal: 0.015, services: 0.02 },
  admin: { services: 0.01 },
}

/**
 * The seven industrial types the bundled `factories` split into (plan 0011 F3).
 * They share the seed-split share, the `industry` config condition stat, and
 * every proxy that used to read `buildings.factories` (urbanisation, artisan
 * shift, unemployment, the `boom` event).
 */
export const INDUSTRIAL_BUILDING_IDS: BuildingId[] = [
  'textileMills',
  'furnitureWorks',
  'distilleries',
  'machineryWorks',
  'steelMills',
  'arsenals',
  'luxuryWorks',
]
