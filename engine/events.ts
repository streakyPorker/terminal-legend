import type {
  Country,
  EventOption,
  GameEvent,
  LogEntry,
  WorldState,
} from '../types'
import { makeRngForWorld, spawnEvent, successorFor } from './data'
import { addModifier } from './modifiers'
import { clamp } from './internal'
import { installBlock, validateBlockConfig } from './blocks'
import { findBlock } from './config/blocks'
import {
  compileEventBlock,
  eventBlockId,
  instantiateEventBlock,
} from './config/blocks/events'
import type { Rng } from './rng'

/**
 * Installs an option's `effects.modifiers` through the block engine (ADR 0024).
 * The static registry block (`event:<kind>:<optionId>`) is the source of truth;
 * it is rebound to the runtime event id so `source` and modifier ids keep their
 * pre-C3 shape. Options outside the registry (e.g. synthetic events) compile
 * inline. A rare validation failure falls back to the legacy direct install, so
 * behaviour cannot change.
 */
function installEventModifiers(
  country: Country,
  event: GameEvent,
  option: EventOption,
  modifiers: NonNullable<EventOption['effects']['modifiers']>,
): void {
  const template = findBlock(eventBlockId(event.kind, option.id))
  const block =
    template ?? compileEventBlock(event.kind, option.id, event.title, modifiers)
  const installed = instantiateEventBlock(block, event.id)
  if (validateBlockConfig([installed]).length === 0) {
    installBlock(country, installed)
    return
  }
  modifiers.forEach((one, index) => {
    addModifier(country, {
      id: `event:${event.id}:${index}`,
      label: one.label ?? event.title,
      stat: one.stat,
      stack: one.stack ?? 'flat',
      value: one.value,
      monthsLeft: one.months,
      source: `event:${event.id}`,
    })
  })
}

function aiEventChoice(country: Country, options: EventOption[], rng: Rng): EventOption {
  const aggressive = country.leader.traits.some(trait =>
    ['扩张', '军事', '专制', '民粹', '海权'].includes(trait),
  )
  const reformist = country.leader.traits.some(trait =>
    ['改革', '贸易', '务实', '维新'].includes(trait),
  )
  if (aggressive && rng.chance(0.65)) return options[0] as EventOption
  if (reformist && options.length > 1 && rng.chance(0.65)) return options[1] as EventOption
  return rng.pick(options)
}

export function applyEventOption(
  world: WorldState,
  event: GameEvent,
  optionId: string,
  log?: LogEntry[],
  rng?: Rng,
): string {
  if (event.isResolved) return '该事件已经处理过了。'
  const option = event.options.find(one => one.id === optionId)
  if (option === undefined) return `没有找到选项 ${optionId}。`
  const country = world.countries[event.countryId]
  if (country === undefined) return '事件所属国家不存在。'

  const effects = option.effects
  if (effects.treasury !== undefined) {
    // A negative result stays on the books as national debt; there is no
    // separate debt stock to transfer it into.
    country.econ.treasury += effects.treasury
  }
  if (effects.radicals !== undefined) {
    country.pops.radicals = clamp(country.pops.radicals + effects.radicals, 0, 100)
  }
  if (effects.legitimacy !== undefined) {
    country.government.legitimacy = clamp(
      country.government.legitimacy + effects.legitimacy,
      0,
      100,
    )
  }
  if (effects.prestige !== undefined) {
    country.diplo.prestige = clamp(country.diplo.prestige + effects.prestige, 0, 240)
  }
  if (effects.army !== undefined) {
    country.military.army = Math.max(0, country.military.army + effects.army)
  }
  if (effects.popsPercent !== undefined) {
    country.pops.total = Math.max(1, country.pops.total * (1 + effects.popsPercent / 100))
  }
  if (effects.techPoints !== undefined) {
    country.tech.points += effects.techPoints
  }
  if (effects.relationTarget !== undefined && effects.relationAmount !== undefined) {
    const target = world.countries[effects.relationTarget]
    if (target !== undefined) {
      const current = country.diplo.relations[target.id] ?? 0
      country.diplo.relations[target.id] = clamp(current + effects.relationAmount, -100, 100)
      const back = target.diplo.relations[country.id] ?? 0
      target.diplo.relations[country.id] = clamp(back + effects.relationAmount * 0.6, -100, 100)
    }
  }
  if (effects.modifiers !== undefined) {
    installEventModifiers(country, event, option, effects.modifiers)
  }
  if (effects.succeed === true) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng ?? makeRngForWorld(world))
    if (log !== undefined) {
      log.push({
        date: { ...world.date },
        kind: 'leader',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}：${oldName}退位，${country.leader.title}${country.leader.name}继位`,
      })
    }
  }

  event.isResolved = true
  event.resolvedOption = option.id
  country.leader.memory.push(`「${event.title}」：${option.label}`)
  if (country.leader.memory.length > 8) country.leader.memory.shift()

  const line: LogEntry = {
    date: { ...world.date },
    kind: 'event',
    countryId: country.id,
    text: `[${country.flag}] ${event.title}：${option.result}`,
  }
  if (log !== undefined) log.push(line)

  return `${event.title}：${option.result}`
}

export function tickEvents(world: WorldState, rng: Rng, log: LogEntry[]): GameEvent[] {
  const pending: GameEvent[] = []
  for (const country of Object.values(world.countries)) {
    const chance = 0.055 + country.pops.radicals / 1200
    if (!rng.chance(chance)) continue
    if (country.isPlayer) {
      const open = world.events.filter(
        event => event.countryId === country.id && !event.isResolved,
      )
      if (open.length >= 3) continue
    }
    const event = spawnEvent(world, country, rng)
    if (event === undefined) continue
    if (country.isPlayer) {
      pending.push(event)
      log.push({
        date: { ...world.date },
        kind: 'event',
        countryId: country.id,
        text: `[${country.flag}] 新事件：${event.title} — ${event.text}`,
      })
    } else {
      const option = aiEventChoice(country, event.options, rng)
      applyEventOption(world, event, option.id, log)
    }
  }
  return pending
}
