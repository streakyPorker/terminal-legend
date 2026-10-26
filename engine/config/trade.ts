/**
 * Trade config: candidate counts, persistent-route calibration knobs, landed
 * price factors, capacity terms and the private deficit share (plan 0009 §9 D1).
 * Leaf module.
 */

/** How many candidate exporters one importer may draw on per good. */
export const TOP_PARTNERS = 6
/** Relations below this cut a partner out of the candidate list. */
export const RELATION_CUTOFF = -50
/** Persistent routes (ADR 0020). */
export const ROUTE_UNIT_VOLUME = 2
/**
 * Hulls needed per route level (PT-067). 0.5 means one ship carries two levels
 * of a route. The exporter's fleet is `military.navy + econ.merchantHulls`;
 * when it falls short, `routePass` scales every one of that country's routes
 * down proportionally instead of letting paper routes conjure tonnage.
 */
export const SHIPS_PER_ROUTE_LEVEL = 0.5
export const ROUTE_MAX_LEVEL = 5
export const ROUTE_GROW_UTILIZATION = 0.8
export const ROUTE_RESIDUAL_FRICTION = 1.15
export const ROUTE_RESIDUAL_TOP_PARTNERS = 3
export const ROUTE_SPOT_DISCOUNT = 0.9
export const ROUTE_MAX_PER_COUNTRY = 12
export const ROUTE_SEED_PER_PAIR = 3
/**
 * Grace window for a freshly opened route (PT-043): the number of monthly
 * growth passes after the month it opened during which `growRoutes` neither
 * grows nor decays it (the route is held at its current level). A level-1 route
 * carries almost nothing in its first settlement, so without this it always
 * fails the `ROUTE_GROW_UTILIZATION` gate and is deleted the month after it
 * opens — "open one, it dies immediately". Age is a pure month difference from
 * `openedAt` (`year * 12 + month`); the window covers `1 <= age <= this`, i.e.
 * the first N growth passes, after which normal growth/decay resumes.
 */
export const ROUTE_GRACE_MONTHS = 2
/** Share of GDP the private sector may borrow abroad in one month. */
export const MAX_MONTHLY_DEFICIT_SHARE = 0.03

/** Landed-price factors. */
export const ACCESS_FACTOR_BASE = 1.15
export const ACCESS_FACTOR_COEF = 0.25
export const TRANSPORT_FACTOR_BASE = 1.2
export const TRANSPORT_FACTOR_DIVISOR = 500
export const RELATION_RISK_DIVISOR = 200
/** Route capacity factors. */
export const ROUTE_CAPACITY_TRANSPORT_DIVISOR = 400
export const ROUTE_CAPACITY_PORT_COEF = 0.02

/** Soft import capacity in gold. */
export const IMPORT_CAPACITY_BASE = 50
export const IMPORT_CAPACITY_PORT = 8
export const IMPORT_CAPACITY_ACCESS = 200
export const IMPORT_CAPACITY_TRANSPORT = 1
export const IMPORT_CAPACITY_RESTRUCTURE_FACTOR = 0.5
/** Post-default private external debt cap as a multiple of GDP. */
export const TRADE_DEBT_GDP_CAP = 0.2

/** Resource-import endowment bonus: capped points, and the share scale. */
export const RESOURCE_IMPORT_BONUS_MAX = 15
export const RESOURCE_IMPORT_BONUS_SCALE = 20
