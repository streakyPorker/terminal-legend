import type { ConstructionProject, Country, WorldState } from '../../types'
import { BUILDINGS, buildOf, isBuildingUnlocked, maxUnlockedTier } from '../data'
import {
  MAX_BUILDINGS_PER_SLOT,
  alreadyReserved,
  constructionGoldPerPoint,
  constructionMonthlyCost,
  constructionTotalCost,
  projectWorkload,
} from '../construction'
import { NON_UPGRADABLE_BUILDINGS } from '../config/construction'
import { computeProduction } from '../economy'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

/** `[FLAG] 名称` prefix shared by every action report line. */
const tagOf = (country: Country): string => `[${country.flag}] ${country.name}`

/**
 * Plan 0016 §S5 soft hint. IV/V seats are the only electricity consumers, and
 * electricity is `NON_TRADABLE` (ADR 0031 §6) — self-production is its only
 * source, so a country with no running power plants cannot feed the seats it is
 * ordering. This NEVER blocks the order (the plant can be built afterwards); it
 * just appends a warning to the success line so the player sees the trap before
 * the seats starve. A country with any domestic electricity output passes.
 */
const powerWarning = (country: Country, targetTier: number): string =>
  targetTier >= 4 && computeProduction(country).electricity <= 0
    ? '；⚠ 该国无电力供给：电力不可贸易，IV/V 级座位将无电可用，请先建发电厂'
    : ''

/** One `1=id（名×count）` entry per queued project, for not-found errors. */
const availableList = (country: Country): string => {
  const queue = country.econ.constructionQueue
  if (queue.length === 0) return '（空）'
  return queue
    .map(
      (project, i) =>
        `${i + 1}=${project.id}（${BUILDINGS[project.building].name}×${project.count}）`,
    )
    .join('、')
}

/**
 * Resolve a queue target by `params.projectId` (also accepts legacy `params.id`)
 * or by `params.index` (1-based position in the FULL queue). projectId wins when
 * both are supplied. Returns the array index and the live project object.
 */
const resolveQueueTarget = (
  country: Country,
  params: ActionParams,
): { index: number; project: ConstructionProject } | undefined => {
  const queue = country.econ.constructionQueue
  const projectId =
    params.projectId !== undefined
      ? String(params.projectId)
      : params.id !== undefined
        ? String(params.id)
        : ''
  if (projectId !== '') {
    const index = queue.findIndex(one => one.id === projectId)
    const project = index >= 0 ? queue[index] : undefined
    return project === undefined ? undefined : { index, project }
  }
  if (params.index !== undefined) {
    const index = Math.floor(num(params.index, 0)) - 1
    const project = queue[index]
    if (index >= 0 && project !== undefined) return { index, project }
  }
  return undefined
}

/** The identifier echoed back in a not-found message (id first, else index). */
const describeTarget = (params: ActionParams): string => {
  if (params.projectId !== undefined) return String(params.projectId)
  if (params.id !== undefined) return String(params.id)
  if (params.index !== undefined) return String(Math.floor(num(params.index, 0)))
  return ''
}

/**
 * Resolve where an insertion should land within `queue`, honouring
 * `position` (`head`/`tail`/`before`/`after`) and `before`. The destination is
 * expressed as a valid splice index in `[0, queue.length]`. `'before'`/`'after'`
 * require a `before` id that exists, otherwise an error string is returned.
 */
const resolveInsertPosition = (
  country: Country,
  params: ActionParams,
): { at: number; note: string } | { error: string } => {
  const queue = country.econ.constructionQueue
  const position = String(params.position ?? 'tail')
  if (position === 'head') return { at: 0, note: '，置于队首' }
  if (position === 'before' || position === 'after') {
    const beforeId = params.before !== undefined ? String(params.before) : ''
    const anchor = beforeId !== '' ? queue.findIndex(one => one.id === beforeId) : -1
    if (anchor < 0) {
      return {
        error: `未找到插入锚点项目 ${beforeId === '' ? '（空）' : beforeId}。可用项目：${availableList(country)}`,
      }
    }
    return {
      at: position === 'before' ? anchor : anchor + 1,
      note: position === 'before' ? `，置于 ${beforeId} 之前` : `，置于 ${beforeId} 之后`,
    }
  }
  // 'tail' and any unknown/garbage value push to the end.
  return { at: queue.length, note: '' }
}

export function actionBuild(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = tagOf(country)
  const id = String(params.building ?? '')
  const building = buildOf(id)
  if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
  // Plan 0015 §S4 / ADR 0031 §9.2: the single buildability gate, covering both
  // the legacy `unlock.techLevel` field and the derived `unlockBuilding` node
  // (the three new works).
  if (!isBuildingUnlocked(country, building)) {
    return { ok: false, text: `${tag} ${BUILDINGS[building].name}尚未解锁（需科技解锁）` }
  }
  const count = clamp(Math.floor(num(params.count, 1)), 1, MAX_BUILDINGS_PER_SLOT)
  // Plan 0015 §S2: `tier` (1-based; default 1 = tier I) lets a new build land
  // directly on an unlocked higher tier. A tier > 1 needs `maxUnlockedTier` to
  // reach it, and the project records its target index so completion files the
  // seats in the right `buildingTiers` bucket.
  const tier = Math.max(1, Math.floor(num(params.tier, 1)))
  const ceiling = maxUnlockedTier(country, building)
  if (tier > ceiling) {
    return {
      ok: false,
      text: `${tag} ${BUILDINGS[building].name}的 ${tier} 级尚未解锁（当前上限 ${ceiling} 级）`,
    }
  }
  // Orders per month are unlimited: every slot holds at most five buildings.
  // Gold is paid per workload point; duration falls out of the points.
  const draft: ConstructionProject = {
    id: `proj-${world.tick}-${country.id}-${country.econ.constructionQueue.length}`,
    building,
    count,
    owner: 'state',
    monthsLeft: 1,
    monthlyCost: 0,
    lastSpend: 0,
    progress: 0,
    startedAt: { ...world.date },
    ...(tier > 1 ? { toTier: tier - 1 } : {}),
  }
  draft.monthlyCost = constructionMonthlyCost(draft, country)
  const placement = resolveInsertPosition(country, params)
  if ('error' in placement) return { ok: false, text: `${tag} ${placement.error}` }
  country.econ.constructionQueue.splice(placement.at, 0, draft)
  return {
    ok: true,
    text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列${placement.note}（工程量 ${projectWorkload(draft).toFixed(1)} 点；按队列顺序取用闲置建造力，一次最多投入剩余工程量；总造价 ${constructionTotalCost(draft, country).toFixed(1)} 金，每点 ${constructionGoldPerPoint(draft, country).toFixed(2)} 金）${powerWarning(country, tier)}`,
  }
}

/**
 * Plan 0015 §S2 / ADR 0031 §5: order an upgrade project that retrofits existing
 * seats from one tier to a higher one. `fromTier`/`toTier` are 1-based (tier I =
 * 1); the project stores 0-based indices so it matches `buildingTiers` /
 * `recipeAt`. The order is UNBOUNDED in `count` (no five-seat slot cap) but may
 * not claim more than the seats at `fromTier` that no other pending upgrade has
 * already reserved.
 */
export function actionUpgrade(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = tagOf(country)
  const id = String(params.building ?? '')
  const building = buildOf(id)
  if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
  if (NON_UPGRADABLE_BUILDINGS.includes(building)) {
    return { ok: false, text: `${tag} ${BUILDINGS[building].name}不可升级` }
  }
  const fromTier = Math.max(1, Math.floor(num(params.fromTier, 1)))
  const toTier = Math.max(fromTier + 1, Math.floor(num(params.toTier, fromTier + 1)))
  const ceiling = maxUnlockedTier(country, building)
  if (toTier > ceiling) {
    return {
      ok: false,
      text: `${tag} ${BUILDINGS[building].name}的 ${toTier} 级尚未解锁（当前上限 ${ceiling} 级）`,
    }
  }
  const count = Math.max(1, Math.floor(num(params.count, 1)))
  const fromIndex = fromTier - 1
  const seats = country.econ.buildingTiers[building]?.[fromIndex] ?? 0
  const reserved = alreadyReserved(country, building, fromIndex)
  if (count > seats - reserved) {
    return {
      ok: false,
      text: `${tag} ${BUILDINGS[building].name} ${fromTier} 级座数不足：现存 ${seats}，已预约 ${reserved}，可升级 ${Math.max(0, seats - reserved)}，请求 ${count}`,
    }
  }
  const draft: ConstructionProject = {
    id: `proj-${world.tick}-${country.id}-${country.econ.constructionQueue.length}`,
    building,
    count,
    kind: 'upgrade',
    fromTier: fromIndex,
    toTier: toTier - 1,
    owner: 'state',
    monthsLeft: 1,
    monthlyCost: 0,
    lastSpend: 0,
    progress: 0,
    startedAt: { ...world.date },
  }
  draft.monthlyCost = constructionMonthlyCost(draft, country)
  const placement = resolveInsertPosition(country, params)
  if ('error' in placement) return { ok: false, text: `${tag} ${placement.error}` }
  country.econ.constructionQueue.splice(placement.at, 0, draft)
  return {
    ok: true,
    text: `${tag} 将 ${count} 座${BUILDINGS[building].name}从 ${fromTier} 级升级到 ${toTier} 级列入升级队列${placement.note}（工程量 ${projectWorkload(draft).toFixed(1)} 点；总造价 ${constructionTotalCost(draft, country).toFixed(1)} 金，每点 ${constructionGoldPerPoint(draft, country).toFixed(2)} 金）${powerWarning(country, toTier)}`,
  }
}

export function actionCancel(country: Country, params: ActionParams): ActionResult {
  const tag = tagOf(country)
  const found = resolveQueueTarget(country, params)
  if (found === undefined) {
    return {
      ok: false,
      text: `${tag} 没有找到项目 ${describeTarget(params)}。可用项目：${availableList(country)}`,
    }
  }
  const { index, project } = found
  if ((project.owner ?? 'state') === 'private') {
    return { ok: false, text: `${tag} 私人项目不可取消（${BUILDINGS[project.building].name}）` }
  }
  country.econ.constructionQueue.splice(index, 1)
  return {
    ok: true,
    text: `${tag} 取消了 ${BUILDINGS[project.building].name}×${project.count} 的国有建造项目`,
  }
}

/**
 * Move an existing state project within `country.econ.constructionQueue`.
 * The project object is spliced, never rebuilt, so its progress / fields
 * survive. `position` is `head`/`tail`/`before`/`after` (default `tail`);
 * `before` names the anchor for before/after. Resolves the target by
 * `projectId` or 1-based `index`, like {@link actionCancel}.
 */
export function actionReorder(country: Country, params: ActionParams): ActionResult {
  const tag = tagOf(country)
  const queue = country.econ.constructionQueue
  const found = resolveQueueTarget(country, params)
  if (found === undefined) {
    return {
      ok: false,
      text: `${tag} 没有找到项目 ${describeTarget(params)}。可用项目：${availableList(country)}`,
    }
  }
  const { index, project } = found
  if ((project.owner ?? 'state') === 'private') {
    return { ok: false, text: `${tag} 私人项目不可重排（${BUILDINGS[project.building].name}）` }
  }
  const position = String(params.position ?? 'tail')
  // Validate the anchor against the full queue before mutating anything.
  if (position === 'before' || position === 'after') {
    const beforeId = params.before !== undefined ? String(params.before) : ''
    const exists = beforeId !== '' && queue.some(one => one.id === beforeId)
    if (!exists) {
      return {
        ok: false,
        text: `${tag} 未找到插入锚点项目 ${beforeId === '' ? '（空）' : beforeId}。可用项目：${availableList(country)}`,
      }
    }
  }
  const label = `${BUILDINGS[project.building].name}×${project.count}`
  // Detach the target first; its object identity is preserved across the move.
  queue.splice(index, 1)
  let dest: number
  let note: string
  if (position === 'head') {
    dest = 0
    note = '移到队首'
  } else if (position === 'before' || position === 'after') {
    const beforeId = String(params.before)
    const anchor = queue.findIndex(one => one.id === beforeId)
    dest = anchor < 0 ? queue.length : position === 'before' ? anchor : anchor + 1
    note = position === 'before' ? `移到 ${beforeId} 之前` : `移到 ${beforeId} 之后`
  } else {
    dest = queue.length
    note = '移到队尾'
  }
  queue.splice(Math.max(0, Math.min(dest, queue.length)), 0, project)
  return {
    ok: true,
    text: `${tag} 将 ${label} ${note}（队列第 ${queue.indexOf(project) + 1} 位）`,
  }
}
