import type { ConstructionProject, GoodId, ModifierStack, ModifierStat, WorldState } from '../types'
import { BUILDINGS, GOOD_IDS, GOODS, buildOf, makeRngForWorld, spawnEvent } from './data'
import { MODIFIER_STATS, MODIFIER_STAT_NAMES, addModifier, removeModifiers } from './modifiers'
import { clamp, completeBuilding, completeUpgrade, projectKind } from './sim'

export type CheatParams = Record<string, string | number | undefined>

const finite = (value: unknown, fallback = 0): number => {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The 天命 tools: deliberate, player-only edits to the world. Ironman refuses
 * every one of them. Returns the line written to the chronicle.
 */
export function applyCheat(
  world: WorldState,
  params: CheatParams,
): { ok: boolean; text: string } {
  if (world.ironman) return { ok: false, text: '铁人模式下无法使用天命。' }
  const player = world.countries[world.playerId]
  if (player === undefined) return { ok: false, text: '还没有进行中的游戏。' }
  const tag = `[${player.flag}] ${player.name}`
  const action = String(params.action ?? '')
  // Player-scoped destiny actions accept `country` so the GM can edit any
  // power (a captured convoy, a foreign tech grant, a foreign leader). The
  // bilateral actions (relations/warScore) keep `country` as the counterparty.
  const subjectFor = (raw: unknown) =>
    String(raw ?? '').toUpperCase() === ''
      ? player
      : world.countries[String(raw ?? '').toUpperCase()]

  let text = ''
  switch (action) {
    case 'treasury': {
      const amount = finite(params.amount)
      const target = subjectFor(params.country)
      if (target === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      // Net assets may go negative: that is national debt, not a separate stock.
      target.econ.treasury += amount
      const stock =
        target.econ.treasury < 0
          ? `国债 ${(-target.econ.treasury).toFixed(1)} 金`
          : `主权基金 ${target.econ.treasury.toFixed(1)} 金`
      const who = target.id === player.id ? '' : `${target.name}的`
      text = `${who}国库净资产${amount >= 0 ? '增加' : '减少'} ${Math.abs(amount).toFixed(1)} 金，现为${stock}`
      break
    }
    case 'techPoints': {
      const amount = finite(params.amount)
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      subject.tech.points = Math.max(0, subject.tech.points + amount)
      const who = subject.id === player.id ? '' : `${subject.name}的`
      text = `${who}科技点${amount >= 0 ? '增加' : '减少'} ${Math.abs(amount).toFixed(1)}，现为 ${subject.tech.points.toFixed(1)}`
      break
    }
    case 'constructionEfficiency': {
      // PT-108: per-country multiplier on how much work a construction point
      // buys (1 = base). Stacks with the constructionSpeed modifier, which
      // raises the *capacity*; this raises the *yield* of each point.
      const value = finite(params.value ?? params.amount, 1)
      if (value <= 0) return { ok: false, text: 'constructionEfficiency 必须大于 0。' }
      const scoped = typeof params.country === 'string' && params.country !== ''
      const targets = scoped ? [subjectFor(params.country)] : Object.values(world.countries)
      if (targets.some(target => target === undefined)) {
        return { ok: false, text: `未知国家 ${String(params.country)}` }
      }
      for (const target of targets) {
        if (target === undefined) continue
        if (Math.abs(value - 1) < 1e-9) delete target.econ.constructionEfficiency
        else target.econ.constructionEfficiency = value
      }
      const who = scoped ? targets[0]?.name ?? '' : '全球'
      text =
        Math.abs(value - 1) < 1e-9
          ? `${who}的建造效率已恢复为 1`
          : `${who}的建造效率设为 ×${value}（同一点数完成 ${value} 倍工程量）`
      break
    }
    case 'prices': {
      // PT-105: shift a country's whole price level. The price model converges
      // toward `basePrice × (1 + value/100) × f(supply/demand)`, so the effect
      // ramps in over a few months and persists until cleared.
      const value = finite(params.value ?? params.amount)
      const scoped = typeof params.country === 'string' && params.country !== ''
      const targets = scoped ? [subjectFor(params.country)] : Object.values(world.countries)
      if (targets.some(target => target === undefined)) {
        return { ok: false, text: `未知国家 ${String(params.country)}` }
      }
      for (const target of targets) {
        if (target === undefined) continue
        if (value === 0) delete target.econ.priceLevel
        else target.econ.priceLevel = value
      }
      const who = scoped ? targets[0]?.name ?? '' : '全球'
      text =
        value === 0
          ? `${who}的价格水平修正已清除`
          : `${who}的整体价格水平设为 ${value >= 0 ? '+' : ''}${value}%（逐月收敛）`
      break
    }
    case 'legitimacy': {
      // PT-100: legitimacy is a *stock* that drifts toward a target at 8%/month,
      // so a `modifier` on it only moves the target. This action moves the stock
      // itself, for when the GM wants the number to change now.
      const amount = finite(params.amount)
      const target = subjectFor(params.country)
      if (target === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const before = target.government.legitimacy
      target.government.legitimacy = Math.min(100, Math.max(0, before + amount))
      const who = target.id === player.id ? '' : `${target.name}的`
      text = `${who}合法性${amount >= 0 ? '提高' : '降低'} ${Math.abs(amount).toFixed(1)}，${before.toFixed(0)} → ${target.government.legitimacy.toFixed(0)}`
      break
    }
    case 'navy': {
      const amount = finite(params.amount)
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      subject.military.navy = Math.max(0, subject.military.navy + amount)
      const who = subject.id === player.id ? '' : `${subject.name}的`
      text = `${who}海军${amount >= 0 ? '增加' : '减少'} ${Math.abs(amount).toFixed(1)} 艘，现为 ${subject.military.navy.toFixed(1)} 艘`
      break
    }
    case 'building': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const id = buildOf(String(params.building ?? ''))
      if (id === undefined) return { ok: false, text: `未知建筑 ${String(params.building ?? '')}` }
      const count = clamp(Math.round(finite(params.count ?? params.amount, 1)), -20, 20)
      if (count === 0) return { ok: false, text: '数量不能为 0。' }
      // completeBuilding applies (or reverses) the side effects and re-derives
      // bureaucracy, so removing a railroad also removes its infrastructure.
      completeBuilding(subject, id, count)
      text = `${subject.name}的${id}数量${count > 0 ? '增加' : '减少'} ${Math.abs(count)}，现为 ${subject.econ.buildings[id]}`
      break
    }
    case 'finishProjects': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const stateProjects = subject.econ.constructionQueue.filter(
        project => (project.owner ?? 'state') !== 'private',
      )
      if (stateProjects.length === 0) {
        return { ok: false, text: '国有建造队列为空。' }
      }
      const label = (project: ConstructionProject): string =>
        projectKind(project) === 'upgrade'
          ? `${BUILDINGS[project.building].name} ${(project.fromTier ?? 0) + 1}→${(project.toTier ?? 0) + 1}×${project.count}`
          : `${BUILDINGS[project.building].name}×${project.count}`
      const summary = stateProjects.map(label).join('、')
      // Upgrades move seats and never trigger the build side effects; a source
      // tier that shrank mid-queue leaves a remainder to keep (plan 0015 §S2).
      const remainders: ConstructionProject[] = []
      for (const project of stateProjects) {
        if (projectKind(project) === 'upgrade') {
          const remainder = completeUpgrade(subject, project)
          if (remainder !== undefined) remainders.push(remainder)
        } else {
          completeBuilding(subject, project.building, project.count, project.toTier ?? 0)
        }
      }
      subject.econ.constructionQueue = [
        ...subject.econ.constructionQueue.filter(
          project => (project.owner ?? 'state') === 'private',
        ),
        ...remainders,
      ]
      text = `${subject.name}国有建造队列全部完成：${summary}`
      break
    }
    case 'relations': {
      const targetId = String(params.country ?? params.target ?? '').toUpperCase()
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
      const amount = clamp(finite(params.amount, 10), -100, 100)
      player.diplo.relations[target.id] = clamp(
        (player.diplo.relations[target.id] ?? 0) + amount,
        -100,
        100,
      )
      target.diplo.relations[player.id] = clamp(
        (target.diplo.relations[player.id] ?? 0) + amount * 0.6,
        -100,
        100,
      )
      text = `与${target.name}的关系${amount >= 0 ? '改善' : '恶化'} ${Math.abs(amount)}`
      break
    }
    case 'warScore': {
      const targetId = String(params.country ?? params.target ?? '').toUpperCase()
      const war = world.wars.find(
        one =>
          (one.attackers.includes(player.id) && one.defenders.includes(targetId)) ||
          (one.defenders.includes(player.id) && one.attackers.includes(targetId)),
      )
      if (war === undefined) return { ok: false, text: `与${targetId}并未交战。` }
      const amount = finite(params.amount, 10)
      war.warScore = clamp(war.warScore + amount, -100, 100)
      text = `${war.name}的战争分数变为 ${war.warScore.toFixed(0)}`
      break
    }
    case 'date': {
      const year = Math.round(finite(params.year, world.date.year))
      const month = clamp(Math.round(finite(params.month, world.date.month)), 1, 12)
      world.date = { year, month }
      text = `日期设为 ${year} 年 ${month} 月`
      break
    }
    case 'event': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const kind = typeof params.kind === 'string' ? params.kind : undefined
      const event = spawnEvent(world, subject, makeRngForWorld(world), kind)
      if (event === undefined) return { ok: false, text: '没有可触发的事件。' }
      world.events.push(event)
      if (world.events.length > 80) world.events.splice(0, world.events.length - 80)
      text = `${subject.name}触发事件「${event.title}」`
      break
    }
    case 'modifier': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const stat = String(params.stat ?? '') as ModifierStat
      if (!MODIFIER_STATS.includes(stat)) {
        return {
          ok: false,
          text: `未知修正对象 ${stat}。可用：${MODIFIER_STATS.join(', ')}`,
        }
      }
      const stack = String(params.stack ?? 'flat') as ModifierStack
      if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
        return { ok: false, text: 'stack 必须是 flat / percent / multiply。' }
      }
      const value = finite(params.value ?? params.amount)
      const months = finite(params.months)
      const id =
        typeof params.id === 'string' && params.id !== ''
          ? params.id
          : `${subject.id}:cheat:${stat}:${subject.modifiers.length}`
      addModifier(subject, {
        id,
        label:
          typeof params.label === 'string' && params.label !== ''
            ? params.label
            : `天命·${MODIFIER_STAT_NAMES[stat]}`,
        stat,
        stack,
        value,
        monthsLeft: months > 0 ? months : undefined,
        source: 'cheat',
      })
      const who = subject.id === player.id ? '' : `${subject.name}：`
      text = `${who}施加修正 ${MODIFIER_STAT_NAMES[stat]} ${value}${stack === 'flat' ? '' : '%'}（${months > 0 ? `${months} 月` : '长期'}）`
      break
    }
    case 'demand': {
      // PT-097: set the GM's demand levers for one good. A country's demand for
      // a good reads `(model + popFactor × x + a) × (1 + pct)`, so there are
      // three independent knobs:
      //   amount — x, the per-popFactor coefficient (scales with population);
      //   flat   — a, a constant quantity per month;
      //   value  — pct, a percentage multiplier on the whole sum.
      // Omit `country` to apply to every power in the world. Each knob is a
      // level: calling again replaces it, 0 clears it.
      const good = String(params.good ?? '') as GoodId
      if (!(GOOD_IDS as readonly string[]).includes(good)) {
        return { ok: false, text: `未知商品 ${String(params.good)}。可用：${GOOD_IDS.join(', ')}` }
      }
      const setPerPop = params.amount !== undefined
      const setFlat = params.flat !== undefined
      const setPct = params.value !== undefined
      if (!setPerPop && !setFlat && !setPct) {
        return {
          ok: false,
          text: 'demand 需要 amount（人均系数 x）/ flat（常数项 a）/ value（百分比）至少其一。',
        }
      }
      const perPop = setPerPop ? finite(params.amount) : 0
      const flat = setFlat ? finite(params.flat) : 0
      const pct = setPct ? finite(params.value) : 0
      const scoped = typeof params.country === 'string' && params.country !== ''
      const targets = scoped ? [subjectFor(params.country)] : Object.values(world.countries)
      if (targets.some(target => target === undefined)) {
        return { ok: false, text: `未知国家 ${String(params.country)}` }
      }
      for (const target of targets) {
        if (target === undefined) continue
        if (setPerPop) {
          const base = { ...(target.econ.demandBase ?? {}) }
          if (perPop === 0) delete base[good]
          else base[good] = perPop
          target.econ.demandBase = base
        }
        if (setFlat) {
          const flats = { ...(target.econ.demandFlat ?? {}) }
          if (flat === 0) delete flats[good]
          else flats[good] = flat
          target.econ.demandFlat = flats
        }
        if (setPct) {
          const pcts = { ...(target.econ.demandPct ?? {}) }
          if (pct === 0) delete pcts[good]
          else pcts[good] = pct
          target.econ.demandPct = pcts
        }
      }
      const who = scoped ? targets[0]?.name ?? '' : '全球'
      const parts: string[] = []
      if (setPerPop) {
        parts.push(perPop === 0 ? 'x 清除' : `x=${perPop}（每 popFactor，随人口缩放）`)
      }
      if (setFlat) parts.push(flat === 0 ? 'a 清除' : `a=${flat}（每月常数）`)
      if (setPct) parts.push(pct === 0 ? '百分比清除' : `×(${1 + pct / 100})`)
      text = `${who}的「${GOODS[good].name}」需求：${parts.join('，')}`
      break
    }
    case 'removeModifier': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const id = typeof params.id === 'string' && params.id !== '' ? params.id : undefined
      const label =
        typeof params.label === 'string' && params.label !== '' ? params.label : undefined
      const stat =
        typeof params.stat === 'string' && params.stat !== ''
          ? (params.stat as ModifierStat)
          : undefined
      if (id === undefined && label === undefined && stat === undefined) {
        return { ok: false, text: '撤销天命修正需要 id、label 或 stat 至少一项。' }
      }
      const removed = removeModifiers(
        subject,
        modifier =>
          modifier.source === 'cheat' &&
          (id === undefined || modifier.id === id) &&
          (label === undefined || modifier.label === label) &&
          (stat === undefined || modifier.stat === stat),
      )
      if (removed === 0) return { ok: false, text: '没有匹配的天命修正可撤销。' }
      const who = subject.id === player.id ? '' : `${subject.name}：`
      text = `${who}撤销 ${removed} 条天命修正`
      break
    }
    case 'clearModifiers': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const stat =
        typeof params.stat === 'string' && params.stat !== ''
          ? (params.stat as ModifierStat)
          : undefined
      const removed = removeModifiers(
        subject,
        modifier =>
          modifier.source === 'cheat' && (stat === undefined || modifier.stat === stat),
      )
      if (removed === 0) return { ok: false, text: '没有可清除的天命修正。' }
      const who = subject.id === player.id ? '' : `${subject.name}：`
      text = `${who}清除 ${removed} 条天命修正`
      break
    }
    case 'leader': {
      const subject = subjectFor(params.country)
      if (subject === undefined) return { ok: false, text: `未知国家 ${String(params.country)}` }
      const name = String(params.name ?? params.leader ?? '').trim()
      if (name === '') return { ok: false, text: '需要领袖姓名。' }
      subject.leader.name = name.slice(0, 40)
      if (typeof params.title === 'string' && params.title !== '') {
        subject.leader.title = params.title.slice(0, 20)
      }
      if (typeof params.persona === 'string' && params.persona !== '') {
        subject.leader.persona = params.persona.slice(0, 200)
      }
      text = `${subject.name}领袖换成${subject.leader.title}${subject.leader.name}`
      break
    }
    default:
      return {
        ok: false,
        text: '未知天命：treasury / techPoints / navy / building / finishProjects / relations / warScore / date / event / leader / modifier / removeModifier / clearModifiers / demand / legitimacy / prices',
      }
  }

  world.log.push({ date: { ...world.date }, kind: 'system', text: `[天命] ${tag} ${text}` })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text: `${tag} ${text}` }
}
