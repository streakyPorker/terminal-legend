import type { ConstructionProject, Country, WorldState } from '../../types'
import { BUILDINGS, buildOf } from '../data'
import {
  MAX_BUILDINGS_PER_SLOT,
  constructionGoldPerPoint,
  constructionMonthlyCost,
  constructionTotalCost,
  projectWorkload,
} from '../construction'
import { clamp, num } from '../internal'
import type { ActionParams, ActionResult } from './types'

export function actionBuild(
  world: WorldState,
  country: Country,
  params: ActionParams,
): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const id = String(params.building ?? '')
  const building = buildOf(id)
  if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
  // Forward-compat tech gate (plan 0011 F6): a building is locked while its
  // `unlock.techLevel` exceeds the country's level. No building sets one yet.
  const unlock = BUILDINGS[building].unlock
  if (unlock?.techLevel !== undefined && country.tech.level < unlock.techLevel) {
    return {
      ok: false,
      text: `${tag} ${BUILDINGS[building].name}尚未解锁（需要科技等级 ${unlock.techLevel}，当前 ${country.tech.level}）`,
    }
  }
  const count = clamp(Math.floor(num(params.count, 1)), 1, MAX_BUILDINGS_PER_SLOT)
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
  }
  draft.monthlyCost = constructionMonthlyCost(draft)
  country.econ.constructionQueue.push(draft)
  return {
    ok: true,
    text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列（工程量 ${projectWorkload(draft).toFixed(1)} 点；按队列顺序取用闲置建造力，一次最多投入剩余工程量；总造价 ${constructionTotalCost(draft).toFixed(1)} 金，每点 ${constructionGoldPerPoint(draft).toFixed(2)} 金）`,
  }
}

export function actionCancel(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const projectId = String(params.projectId ?? params.id ?? '')
  const index = country.econ.constructionQueue.findIndex(
    project => project.id === projectId,
  )
  if (index < 0) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
  const project = country.econ.constructionQueue[index]
  if (project === undefined) return { ok: false, text: `${tag} 没有找到项目 ${projectId}` }
  if ((project.owner ?? 'state') === 'private') {
    return { ok: false, text: `${tag} 私人项目不可取消（${BUILDINGS[project.building].name}）` }
  }
  country.econ.constructionQueue.splice(index, 1)
  return {
    ok: true,
    text: `${tag} 取消了 ${BUILDINGS[project.building].name}×${project.count} 的国有建造项目`,
  }
}
