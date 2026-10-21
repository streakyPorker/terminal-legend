/**
 * Tech config: the monthly research-rate formula (plan 0009 §9 D1). The tech
 * multiplier curve itself lives in `config/blocks/tech.ts` (C5); this file only
 * holds the research flow dials.
 */

/** Base research points per month before literacy/bureaucracy. */
export const RESEARCH_BASE = 2
export const RESEARCH_LITERACY_COEF = 3
export const RESEARCH_BUREAUCRACY_COEF = 0.06
/** University research term. */
export const RESEARCH_UNIVERSITY_PER_BUILDING = 0.9
export const RESEARCH_UNIVERSITY_LITERACY_BASE = 0.4
export const RESEARCH_EDUCATION_COEF = 0.03
export const RESEARCH_TECH_LEVEL_COEF = 0.02
/** Highest tech level; research stops here. */
export const TECH_MAX_LEVEL = 10
