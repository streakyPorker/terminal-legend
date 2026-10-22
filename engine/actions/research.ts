import type { Country } from '../../types'
import { TECH_NODES, canResearchNode, eraGateOk, prereqOk, techNode } from '../data'
import type { ActionParams, ActionResult } from './types'

export function actionResearch(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const id = String(params.tech ?? params.node ?? '')
  if (id === '') {
    const menu = TECH_NODES.filter(node => canResearchNode(country.tech, node))
      .map(node => `${node.id}(${node.name})`)
      .join('、')
    return { ok: false, text: `${tag} 需要节点 id；当前可研究：${menu === '' ? '无' : menu}` }
  }
  const node = techNode(id)
  if (node === undefined) return { ok: false, text: `${tag} 未知科技节点 ${id}` }
  if (country.tech.unlocked.includes(node.id)) {
    return { ok: false, text: `${tag}「${node.name}」已解锁` }
  }
  if (!eraGateOk(country.tech, node)) {
    return {
      ok: false,
      text: `${tag}「${node.name}」需时代 ${node.era}（当前 ${country.tech.era}）`,
    }
  }
  if (!prereqOk(country.tech, node)) {
    return { ok: false, text: `${tag}「${node.name}」前置未满足` }
  }
  country.tech.researching = node.id
  return { ok: true, text: `${tag} 将研究方向定为「${node.name}」` }
}
