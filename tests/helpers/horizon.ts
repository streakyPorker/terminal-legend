/**
 * PT-095: shared horizon for paired equivalence runs.
 *
 * A great many tests build two worlds (control vs variant, left vs right) and
 * advance both to compare them. Those checks only need the systems to have
 * settled and diverged — 60 months bought nothing over 24 and dominated the
 * suite's wall time.
 *
 * The test sandbox has no `process`, so the knobs live on `globalThis`: set
 * `globalThis.TL_TEST_MONTHS = 60` / `TL_TEST_LONG_MONTHS = 120` (or edit these
 * numbers) for a full-length run before a release.
 */
const knobs = globalThis as { TL_TEST_MONTHS?: number; TL_TEST_LONG_MONTHS?: number }

export const EQ_MONTHS = knobs.TL_TEST_MONTHS ?? 24

/** Long-horizon determinism runs (the old ten-year drift checks). */
export const LONG_MONTHS = knobs.TL_TEST_LONG_MONTHS ?? 48
