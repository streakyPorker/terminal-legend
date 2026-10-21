import type {
  Country,
  Embargo,
  GameDate,
  GoodId,
  LogEntry,
  War,
  WarGoal,
  WorldState,
} from '../types'
import { addModifier, applyModifiers } from './modifiers'
import { installBlock, validateBlockConfig } from './blocks'
import {
  compileWarBlock,
  instantiateWarBlock,
  warBlockFor,
  warModifierId,
  warSource,
  warSpecsFor,
  type WarSide,
} from './config/blocks/war'
import { embargoed, type TradeBlocker } from './trade'
import { advanceDate, clamp, dateDistance } from './internal'
import type { Rng } from './rng'

/**
 * Goods whose trade sours relations (plan §2.7/§6): importing any of these
 * from a partner adds a monthly tension. Tuned against the 60-month baseline.
 */
export const SENSITIVE_GOODS: GoodId[] = ['opium', 'arms', 'grain']
/**
 * §11 calibration knob: the automatic *warmth* a full trade share earns (plan
 * §2.7 "最多 +2"). Scaled by `(1 - sensitiveShare)` so the sensitive slice of
 * trade earns no warmth — otherwise a monopoly partner's warmth swamps the drag.
 */
export const TRADE_WARMTH_MAX = 2
/**
 * §11 calibration knob: monthly relation *drag* per unit of sensitive-import
 * share (plan §2.7). The flat −0.5 draft was calibrated away (see §11.2): a
 * monopoly partner's import share is almost entirely sensitive, so a flat
 * penalty could never outrun the share-scaled warmth and the crisis bar
 * (§4.1, 中英关系 ≤ −10) was unreachable. This scales with how much of the
 * bilateral trade is actually sensitive, so opium dependency sinks relations.
 * It intentionally exceeds the ±10 monthly envelope: a fully sensitive
 * partner always moves at the cap, while a marginal sensitive slice can still
 * outrun the warmth term.
 */
export const SENSITIVE_DRAG = 15
/** Per ordered pair per month: auto + sensitive + agent tension is clamped here (plan §2.7). */
export const TRADE_RELATION_ENVELOPE = 10
/**
 * §11 calibration knob: floor for the *automatic* trade effects. Trade friction
 * alone must not reach the hard trade cut at `RELATION_CUTOFF` (−50, plan §1.2) —
 * severance is a diplomatic act (tension, embargo, war). Without it a monopoly
 * opium partner's drag crossed −50, closed the route, mean-reversion reopened it
 * trading only opium (sensitiveShare → 1) and shoved it back under: a limit cycle
 * that killed the opium flow through 1840–42.
 */
export const TRADE_RELATION_FLOOR = -45
/** Months of trade-tension history kept for the diplomacy UI (plan §2.7). */
export const TRADE_TENSION_RETENTION_MONTHS = 24
/** Longest embargo an action may set; absent means permanent (plan §3). */
export const EMBARGO_MONTHS_MAX = 60

export function atWar(world: WorldState, a: string, b: string): boolean {
  return world.wars.some(
    war =>
      (war.attackers.includes(a) && war.defenders.includes(b)) ||
      (war.defenders.includes(a) && war.attackers.includes(b)),
  )
}

/**
 * Creates a War with the shared shape both the `diplomacy` war move and the
 * crisis war packs use (plan §4.3/§5). Returns undefined when the pair is
 * already at war; the caller owns any relation/infamy changes, because those
 * differ between the diplomacy move (−50) and a result pack (−40).
 */
export function declareWar(
  world: WorldState,
  attackerId: string,
  targetId: string,
  goal: WarGoal,
  reason: string,
): War | undefined {
  const attacker = world.countries[attackerId]
  const target = world.countries[targetId]
  if (attacker === undefined || target === undefined) return undefined
  if (atWar(world, attackerId, targetId)) return undefined
  const defenders = [targetId, ...target.diplo.alliances.filter(id => id !== attackerId)]
  const war: War = {
    id: `war-${world.tick}-${attackerId}-${targetId}`,
    name: `${attacker.name}—${target.name}战争`,
    attackers: [attackerId],
    defenders,
    started: { ...world.date },
    months: 0,
    warScore: 0,
    battles: 0,
    reason,
    lastEvent: '战争爆发',
    goal,
    goalOwner: attackerId,
  }
  world.wars.push(war)
  return war
}

/**
 * A blocked (importer, exporter, good) pair never trades (plan §3): a war
 * severs it in either direction, and an embargo severs it in either direction
 * because the embargoing country cuts the corresponding trade outright.
 */
export function tradeBlocker(world: WorldState): TradeBlocker {
  return (importerId, exporterId, good) => {
    if (atWar(world, importerId, exporterId)) return true
    const importer = world.countries[importerId]
    const exporter = world.countries[exporterId]
    if (importer !== undefined && embargoed(importer.embargoes, exporterId, good)) return true
    if (exporter !== undefined && embargoed(exporter.embargoes, importerId, good)) return true
    return false
  }
}

/** Ages embargoes by one month; those reaching zero are lifted and logged. */
export function expireEmbargoes(world: WorldState, log: LogEntry[]): void {
  for (const country of Object.values(world.countries)) {
    const remaining: Embargo[] = []
    for (const embargo of country.embargoes) {
      if (embargo.months === undefined) {
        remaining.push(embargo)
        continue
      }
      const months = embargo.months - 1
      if (months <= 0) {
        const target = world.countries[embargo.target]
        log.push({
          date: { ...world.date },
          kind: 'diplomacy',
          countryId: country.id,
          text: `[${country.flag}] ${country.name} 对 ${target?.name ?? embargo.target} 的禁运到期`,
        })
        continue
      }
      remaining.push({ ...embargo, months })
    }
    country.embargoes = remaining
  }
}

/** This month's bilateral trade with one partner, at unit prices (plan §2.7). */
function bilateralTradeValue(country: Country, partnerId: string): number {
  let value = 0
  for (const flow of country.trade.exports) if (flow.to === partnerId) value += flow.value
  for (const flow of country.trade.imports) if (flow.from === partnerId) value += flow.value
  return value
}

function sameDate(a: GameDate, b: GameDate): boolean {
  return a.year === b.year && a.month === b.month
}

/**
 * The sensitive slice of `country`'s imports from one partner, as a share of
 * `country`'s *total* import gold value (plan §2.7). 0 when nothing is imported
 * at all. This is the weight on the drag — and the part of trade warmed by 1×.
 */
function sensitiveImportShare(country: Country, partnerId: string): number {
  const totalImports = country.trade.importValue
  if (totalImports <= 0) return 0
  let sensitive = 0
  for (const flow of country.trade.imports) {
    if (flow.from === partnerId && SENSITIVE_GOODS.includes(flow.good)) sensitive += flow.value
  }
  return sensitive / totalImports
}

/**
 * Monthly trade-driven relation effects (plan §2.7), a deterministic step
 * beside `driftRelations`. For each ordered pair:
 *
 *   delta = TRADE_WARMTH_MAX × (1 − sensitiveShare) × partnerShare
 *         − SENSITIVE_DRAG × sensitiveShare
 *         + Σ(agent tradeTension deltas recorded last month for this pair)
 *
 * A partner's trade share warms relations, but the sensitive slice earns no
 * warmth and instead drags them down proportional to its share of imports — so
 * a monsoon-trade partner (GBR for QING) sinks while a non-sensitive partner
 * still warms. The sum is clamped to the ±10 envelope, then the relation is
 * clamped to [-100, 100]; when no agent tension is involved the automatic part
 * additionally floors at `TRADE_RELATION_FLOOR` so trade alone cannot sever the
 * pair. Routine auto drift is *not* logged (it would flood the
 * 400-entry chronicle); agent tensions are logged where they are submitted and
 * embargo changes where they happen.
 */
export function applyTradeRelations(world: WorldState, log: LogEntry[]): void {
  const ids = Object.keys(world.countries).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  // Agent tensions are recorded at the pre-tick date and settled on the next
  // tick, so each is applied exactly once as the month rolls forward.
  const pending = world.tradeTensions.filter(tension =>
    sameDate(advanceDate(tension.date), world.date),
  )
  for (const fromId of ids) {
    const country = world.countries[fromId]
    if (country === undefined) continue
    const total = country.trade.exportValue + country.trade.importValue
    for (const partnerId of ids) {
      if (partnerId === fromId) continue
      let auto = 0
      if (total > 0) {
        const partnerShare = bilateralTradeValue(country, partnerId) / total
        const sensitiveShare = sensitiveImportShare(country, partnerId)
        auto += TRADE_WARMTH_MAX * (1 - sensitiveShare) * partnerShare
        auto -= SENSITIVE_DRAG * sensitiveShare
      }
      let agentDelta = 0
      for (const tension of pending) {
        if (tension.from === fromId && tension.partner === partnerId) {
          agentDelta += tension.relationDelta
        }
      }
      const delta = auto + agentDelta
      if (delta === 0) continue
      const bounded = clamp(delta, -TRADE_RELATION_ENVELOPE, TRADE_RELATION_ENVELOPE)
      const current = country.diplo.relations[partnerId] ?? 0
      let next = current + bounded
      // The floor binds the automatic effects only; an explicit agent tension may
      // still drive the pair all the way to -100 (plan §2.7).
      if (agentDelta === 0) next = Math.max(next, TRADE_RELATION_FLOOR)
      country.diplo.relations[partnerId] = clamp(next, -100, 100)
    }
  }
  world.tradeTensions = world.tradeTensions.filter(
    tension => dateDistance(world.date, tension.date) < TRADE_TENSION_RETENTION_MONTHS,
  )
}

export function driftRelations(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    for (const other of Object.values(world.countries)) {
      if (other.id === country.id) continue
      const current = country.diplo.relations[other.id] ?? 0
      // Infamy drags every relationship's resting point down.
      const infamyDrag = country.diplo.infamy * 0.1
      const target =
        (country.diplo.alliances.includes(other.id)
          ? 55
          : country.diplo.rivals.includes(other.id)
            ? -35
            : 0) - infamyDrag
      country.diplo.relations[other.id] = current + (target - current) * 0.012
    }
  }
}

export function strength(world: WorldState, ids: string[]): number {
  let total = 0
  for (const id of ids) {
    const country = world.countries[id]
    if (country === undefined) continue
    total += applyModifiers(
      country,
      'armyStrength',
      country.military.army *
        country.military.quality *
        (country.military.morale / 60) *
        (1 + country.tech.level * 0.03),
    )
  }
  return total
}

/**
 * The victor's reparation terms: total gold and the maximum installment term.
 * The loser decides how much of the total it pays immediately and how the
 * remainder is spread over the term (see the `reparations` goal branch).
 */
export type ReparationTerms = {
  /** Defaults to 10% of the loser's GDP. */
  total?: number
  /** Maximum installment term in months; defaults to 60 (five years). */
  maxMonths?: number
}

/**
 * Installs a war goal's modifiers on `country` through the block engine
 * (ADR 0024). The runtime block is rebound to `source = war:<warId>` and its
 * modifier id restored to the pre-C6 shape (`war:<warId>:<goal>:<slot>`). A
 * validation failure — which cannot happen for the derived static registry —
 * falls back to the legacy direct install, so behaviour cannot change.
 */
function installWarModifiers(
  country: Country,
  warId: string,
  goal: WarGoal,
  side: WarSide,
): void {
  for (const spec of warSpecsFor(goal, side)) {
    const template = warBlockFor(spec) ?? compileWarBlock(spec)
    const installed = instantiateWarBlock(template, warId)
    if (validateBlockConfig([installed]).length === 0) {
      installBlock(country, installed, {
        modifierId: () => warModifierId(warId, spec),
      })
      continue
    }
    addModifier(country, {
      id: warModifierId(warId, spec),
      label: spec.label,
      stat: spec.stat,
      stack: spec.stack,
      value: spec.value,
      monthsLeft: spec.months,
      source: warSource(warId),
    })
  }
}

/**
 * Peace terms for one war (plan 0004 §5). The goal owner's side winning applies
 * the victory column, its side losing the defeat column; effects land on every
 * country of a side, mirroring the belligerent loop in `endWar`. Exported so
 * the C6 migration test can compare it against a frozen pre-C6 oracle.
 */
export function applyWarGoal(
  world: WorldState,
  war: War,
  goalOwnerWon: boolean,
  winnerIds: string[],
  loserIds: string[],
  terms?: ReparationTerms,
): void {
  const goalSide = goalOwnerWon ? winnerIds : loserIds
  const otherSide = goalOwnerWon ? loserIds : winnerIds

  if (!goalOwnerWon) {
    for (const id of goalSide) {
      const country = world.countries[id]
      if (country === undefined) continue
      switch (war.goal) {
        case 'reparations':
          country.diplo.prestige = clamp(country.diplo.prestige - 10, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
        case 'openMarket':
          for (const otherId of otherSide) {
            country.diplo.relations[otherId] = clamp(
              (country.diplo.relations[otherId] ?? 0) - 10,
              -100,
              100,
            )
          }
          country.diplo.prestige = clamp(country.diplo.prestige - 5, 0, 240)
          break
        case 'sphere':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 2, 0, 100)
          break
        case 'humiliation':
          country.diplo.prestige = clamp(country.diplo.prestige - 8, 0, 240)
          country.government.legitimacy = clamp(country.government.legitimacy - 3, 0, 100)
          break
      }
    }
    return
  }

  switch (war.goal) {
    case 'reparations': {
      const recipient = world.countries[war.goalOwner]
      if (!Array.isArray(world.indemnities)) world.indemnities = []
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        const rawTotal = terms?.total
        const total = clamp(
          Number.isFinite(rawTotal) ? (rawTotal as number) : loser.econ.gdp * 0.1,
          0,
          loser.econ.gdp * 2,
        )
        const rawMonths = terms?.maxMonths
        const maxMonths = clamp(
          Number.isFinite(rawMonths) ? Math.round(rawMonths as number) : 60,
          1,
          240,
        )
        // The loser pays what it can without going into debt, then spreads the
        // rest over at most `maxMonths`. The victor only set the total and the
        // term; this split is the loser's own plan.
        const lump = clamp(loser.econ.treasury, 0, total)
        loser.econ.treasury -= lump
        loser.government.legitimacy = clamp(loser.government.legitimacy - 5, 0, 100)
        if (recipient !== undefined && lump > 0) recipient.econ.treasury += lump

        const remaining = total - lump
        if (remaining > 0.01) {
          const capacity = Math.max(0.5, loser.econ.income * 0.15)
          const months = Math.min(
            maxMonths,
            Math.max(1, Math.ceil(remaining / capacity)),
          )
          world.indemnities.push({
            id: `indemnity-${war.id}-${id}`,
            from: id,
            to: war.goalOwner,
            monthlyAmount: remaining / months,
            monthsLeft: months,
            remaining,
            startsAtTick: world.tick + 1,
            startedAt: { ...world.date },
          })
        }
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 10, 0, 240)
      }
      break
    }
    case 'openMarket': {
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.econ.tariff = clamp(loser.econ.tariff - 10, 0, 60)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 4, 0, 100)
        installWarModifiers(loser, war.id, 'openMarket', 'loser')
      }
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        installWarModifiers(winner, war.id, 'openMarket', 'winner')
      }
      break
    }
    case 'sphere': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          if (!winner.diplo.sphere.includes(loserId)) winner.diplo.sphere.push(loserId)
        }
        installWarModifiers(winner, war.id, 'sphere', 'winner')
      }
      // Both sides fall an extra 10 beyond the belligerent relation decline.
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        for (const loserId of loserIds) {
          winner.diplo.relations[loserId] = clamp(
            (winner.diplo.relations[loserId] ?? 0) - 10,
            -100,
            100,
          )
          const loser = world.countries[loserId]
          if (loser === undefined) continue
          loser.diplo.relations[id] = clamp(
            (loser.diplo.relations[id] ?? 0) - 10,
            -100,
            100,
          )
        }
      }
      break
    }
    case 'humiliation': {
      for (const id of winnerIds) {
        const winner = world.countries[id]
        if (winner === undefined) continue
        winner.diplo.prestige = clamp(winner.diplo.prestige + 15, 0, 240)
      }
      for (const id of loserIds) {
        const loser = world.countries[id]
        if (loser === undefined) continue
        loser.diplo.prestige = clamp(loser.diplo.prestige - 15, 0, 240)
        loser.government.legitimacy = clamp(loser.government.legitimacy - 8, 0, 100)
      }
      break
    }
  }
}

export function endWar(
  world: WorldState,
  war: War,
  winner: 'attackers' | 'defenders' | 'white',
  log: LogEntry[],
  terms?: ReparationTerms,
): void {
  const attackerIds = war.attackers
  const defenderIds = war.defenders
  const winnerIds = winner === 'attackers' ? attackerIds : winner === 'defenders' ? defenderIds : []
  const loserIds = winner === 'attackers' ? defenderIds : winner === 'defenders' ? attackerIds : []

  // Exhaustion recovery, morale and leader memory stay goal-independent; only
  // the generic prestige/radical effects are replaced (plan §5).
  for (const id of winnerIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    country.military.exhaustion = clamp(country.military.exhaustion - 15, 0, 100)
    country.military.morale = clamp(country.military.morale + 10, 20, 100)
    country.leader.memory.push(`${war.name}以胜利告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }
  for (const id of loserIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    country.military.exhaustion = clamp(country.military.exhaustion + 5, 0, 100)
    country.leader.memory.push(`${war.name}以失败告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }

  // A white peace or the 60-month timeout settles no goal (plan §5).
  if (winner !== 'white') {
    applyWarGoal(
      world,
      war,
      winnerIds.includes(war.goalOwner),
      winnerIds,
      loserIds,
      terms,
    )
  }

  for (const id of [...attackerIds, ...defenderIds]) {
    const country = world.countries[id]
    if (country === undefined) continue
    for (const otherId of [...attackerIds, ...defenderIds]) {
      if (otherId === id) continue
      const current = country.diplo.relations[otherId] ?? 0
      country.diplo.relations[otherId] = clamp(current - 20, -100, 100)
    }
  }

  world.wars = world.wars.filter(one => one.id !== war.id)
  log.push({
    date: { ...world.date },
    kind: 'war',
    text:
      winner === 'white'
        ? `《${war.name}》以白和告终`
        : `《${war.name}》结束：${winner === 'attackers' ? '进攻方' : '防守方'}获胜`,
  })
}

export function resolveWars(world: WorldState, rng: Rng, log: LogEntry[]): void {
  for (const war of [...world.wars]) {
    war.months += 1
    war.battles += 1
    const attack = strength(world, war.attackers) / Math.max(1, war.attackers.length)
    const defend = strength(world, war.defenders) / Math.max(1, war.defenders.length)
    const delta = clamp(((attack - defend) / Math.max(1, attack + defend)) * 12, -12, 12)
    war.warScore = clamp(war.warScore + delta + rng.range(-2, 2), -100, 100)
    war.lastEvent =
      delta > 3
        ? '进攻方在战场上占了上风'
        : delta < -3
          ? '防守方稳住了阵线'
          : '双方在战线上僵持'

    for (const id of [...war.attackers, ...war.defenders]) {
      const country = world.countries[id]
      if (country === undefined) continue
      country.military.exhaustion = clamp(country.military.exhaustion + 1.2, 0, 100)
      country.military.morale = clamp(country.military.morale - 0.4, 20, 100)
      country.pops.radicals = clamp(country.pops.radicals + 0.5, 0, 100)
    }

    if (war.warScore >= 75) {
      endWar(world, war, 'attackers', log)
    } else if (war.warScore <= -75) {
      endWar(world, war, 'defenders', log)
    } else if (war.months >= 60) {
      endWar(world, war, 'white', log)
    }
  }
}
