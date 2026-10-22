import { describe, expect, test } from 'claude-code/testing'
import { GOODS } from '../engine/data'
import { newWorld } from '../engine/sim'
import { buildLiveEventPrompt, generateLiveEvents, salientTopics } from '../engine/liveEvents'
import { LIVE_NARRATIVE_PERSPECTIVES } from '../engine/config/events'
import type { Country, WorldState } from '../types'

/**
 * E6 (plan 0010 §7): the three narratorial perspectives 史官 / 市井 / 列国舆论
 * enter the generation prompt as guidance only. The output shape is unchanged:
 * generated events still consist of `EventOption`s with the existing effect
 * fields, and no new world field is introduced.
 */

const GRAIN_BASE = GOODS.grain.basePrice

function neutralise(world: WorldState, country: Country): void {
  country.pops.sol = 60
  country.pops.literacy = 0.5
  country.pops.radicals = 0
  country.government.legitimacy = 50
  country.econ.treasury = 0
  country.econ.prices.grain = GRAIN_BASE
  country.econ.unemployment = 6
  country.econ.history.gdp = [100, 100]
  country.diplo.infamy = 0
  world.wars = []
}

const LIVE_REPLY = JSON.stringify([
  {
    kind: 'politics',
    title: '朝议纷纭',
    text: '市井之间议论纷纷，列国亦侧目。',
    options: [
      {
        id: 'calm',
        label: '安抚',
        result: '人心稍定。',
        effects: { radicals: -2, legitimacy: 1 },
      },
    ],
  },
])

const EVENT_KEYS = ['countryId', 'date', 'id', 'isResolved', 'kind', 'options', 'text', 'title']
const OPTION_KEYS = ['effects', 'id', 'label', 'result']
const EFFECT_KEYS = [
  'army',
  'legitimacy',
  'modifiers',
  'popsPercent',
  'prestige',
  'radicals',
  'relationAmount',
  'relationTarget',
  'succeed',
  'techPoints',
  'treasury',
]

describe('live events: E6 three-perspective prompt guidance (plan 0010 §7)', () => {
  test('LIVE_NARRATIVE_PERSPECTIVES names the three voices in order', async () => {
    expect([...LIVE_NARRATIVE_PERSPECTIVES]).toEqual(['史官', '市井', '列国舆论'])
  })

  test('the generation prompt carries one guidance bullet per voice', async () => {
    const world = newWorld(301, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    neutralise(world, qing)
    qing.pops.sol = 20
    const topics = salientTopics(world, qing)
    expect(topics.length).toBeGreaterThan(0)
    const prompt = buildLiveEventPrompt(world, qing, topics)
    for (const voice of LIVE_NARRATIVE_PERSPECTIVES) {
      expect(prompt).toContain(`- ${voice}：`)
    }
    expect(prompt).toContain('不设硬结构')
  })

  test('generated events keep the EventOption shape and no new fields', async () => {
    const world = newWorld(302, 'QING')
    const qing = world.countries.QING
    expect(qing).toBeDefined()
    if (qing === undefined) return
    neutralise(world, qing)
    qing.pops.radicals = 90

    const events = await generateLiveEvents(world, async () => LIVE_REPLY)
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual([...EVENT_KEYS].sort())
      expect(event.kind.startsWith('live:')).toBe(true)
      for (const option of event.options) {
        expect(Object.keys(option).sort()).toEqual([...OPTION_KEYS].sort())
        for (const key of Object.keys(option.effects)) {
          expect(EFFECT_KEYS).toContain(key)
        }
      }
    }
  })
})
