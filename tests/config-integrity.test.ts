import { describe, expect, test } from 'claude-code/testing'
import * as balance from '../engine/config/balance'
import * as economy from '../engine/config/economy'
import * as society from '../engine/config/society'
import * as military from '../engine/config/military'
import * as tech from '../engine/config/tech'
import * as diplomacy from '../engine/config/diplomacy'
import * as trade from '../engine/config/trade'
import * as tax from '../engine/config/tax'
import * as fiscal from '../engine/config/fiscal'
import * as construction from '../engine/config/construction'
import * as events from '../engine/config/events'
import * as situations from '../engine/config/situations'
import {
  CAPACITY_COST as CONSTRUCTION_CAPACITY_COST,
  CONSTRUCTION_RENT_PER_POINT as CONSTRUCTION_RENT,
  WORKLOAD_MULTIPLIER as CONSTRUCTION_WORKLOAD,
  WORKSHOP_CAPACITY_OUTPUT as CONSTRUCTION_WORKSHOP_OUTPUT,
  PRIVATE_OWN_CAPACITY_SHARE as CONSTRUCTION_PRIVATE_OWN_SHARE,
} from '../engine/construction'
import { LAND_VALUE_PER_UNIT as TAX_LAND_VALUE } from '../engine/fiscal'
import {
  SENSITIVE_DRAG as DIPLO_SENSITIVE_DRAG,
  TRADE_WARMTH_MAX as DIPLO_TRADE_WARMTH,
} from '../engine/diplomacy'
import { TOP_PARTNERS as TRADE_TOP_PARTNERS } from '../engine/trade'
import {
  OPIUM_CRISIS_EMBARGO_MONTHS as ENGINE_SIT_EMBARGO,
  SITUATION_TIMEOUT_MONTHS as ENGINE_SIT_TIMEOUT,
} from '../engine/situations'
import { UTIL_SMOOTHING as ECON_UTIL_SMOOTHING } from '../engine/economy'
import {
  OPIUM_CRACKDOWN_AUTHORITY,
  OPIUM_CRACKDOWN_LEGITIMACY,
  OPIUM_CRACKDOWN_RELATION,
  OPIUM_COMPROMISE_TARIFF_CUT,
  OPIUM_WAR_RELATION,
  SITUATION_NARRATIVE_MAX,
} from '../engine/config/situations'
import { ADMIN_CAPACITY_MAX } from '../engine/config/construction'

const MODULES: Record<string, Record<string, unknown>> = {
  balance,
  economy,
  society,
  military,
  tech,
  diplomacy,
  trade,
  tax,
  fiscal,
  construction,
  events,
  situations,
}

describe('config integrity (plan 0009 §9 D1)', () => {
  test('every numeric export is a finite number', () => {
    for (const [name, module] of Object.entries(MODULES)) {
      for (const [key, value] of Object.entries(module)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${name}.${key} = ${value}`).toBe(true)
        }
      }
    }
  })

  test('every config module exports at least one constant', () => {
    for (const [name, module] of Object.entries(MODULES)) {
      expect(Object.keys(module).length, `${name} is empty`).toBeGreaterThan(0)
    }
  })

  test('each module exposes the expected shape', () => {
    expect(Object.keys(balance)).toEqual(
      expect.arrayContaining([
        'LEGITIMACY_MAX',
        'RADICALS_MAX',
        'LOYALISTS_MAX',
        'PRESTIGE_MAX',
        'RELATION_MIN',
        'RELATION_MAX',
        'HISTORY_MONTHS',
      ]),
    )
    expect(typeof economy.PRICE_SMOOTHING).toBe('number')
    expect(typeof economy.UTIL_IDLE_FLOOR).toBe('number')
    expect(typeof society.LEGITIMACY_PULL).toBe('number')
    expect(typeof military.WAR_SCORE_WIN).toBe('number')
    expect(typeof tech.RESEARCH_BASE).toBe('number')
    expect(typeof diplomacy.TRADE_WARMTH_MAX).toBe('number')
    expect(typeof trade.ROUTE_MAX_LEVEL).toBe('number')
    expect(typeof tax.LAND_VALUE_PER_UNIT).toBe('number')
    expect(typeof fiscal.DEBT_RATE_BASE).toBe('number')
    expect(typeof construction.WORKLOAD_MULTIPLIER).toBe('number')
    expect(typeof events.EVENT_BASE_CHANCE).toBe('number')
    expect(typeof situations.SITUATION_TIMEOUT_MONTHS).toBe('number')
    expect(typeof situations.SITUATION_NARRATIVE_MAX).toBe('number')
    expect(typeof situations.OPIUM_WAR_RELATION).toBe('number')
    expect(typeof construction.ADMIN_CAPACITY_MAX).toBe('number')
  })

  test('table-shaped exports keep their keys', () => {
    const buildingIds = Object.keys(construction.CAPACITY_COST)
    expect(buildingIds.length).toBeGreaterThan(0)
    expect(Object.keys(construction.BUILDING_COST_MULTIPLIER).sort()).toEqual(
      [...buildingIds].sort(),
    )
    expect(Object.keys(construction.BUILDING_COST_ADDEND).sort()).toEqual(
      [...buildingIds].sort(),
    )
    expect(society.GOVERNMENT_LEGITIMACY_BONUS['专制君主制']).toBe(-4)
    expect(diplomacy.SENSITIVE_GOODS).toEqual(['opium', 'arms', 'grain'])
  })

  test('re-exported values equal the config originals (no drift)', () => {
    expect(CONSTRUCTION_CAPACITY_COST).toBe(construction.CAPACITY_COST)
    expect(CONSTRUCTION_RENT).toBe(construction.CONSTRUCTION_RENT_PER_POINT)
    expect(CONSTRUCTION_WORKLOAD).toBe(construction.WORKLOAD_MULTIPLIER)
    expect(TAX_LAND_VALUE).toBe(tax.LAND_VALUE_PER_UNIT)
    expect(DIPLO_SENSITIVE_DRAG).toBe(diplomacy.SENSITIVE_DRAG)
    expect(DIPLO_TRADE_WARMTH).toBe(diplomacy.TRADE_WARMTH_MAX)
    expect(TRADE_TOP_PARTNERS).toBe(trade.TOP_PARTNERS)
    expect(ECON_UTIL_SMOOTHING).toBe(economy.UTIL_SMOOTHING)
    expect(ENGINE_SIT_TIMEOUT).toBe(situations.SITUATION_TIMEOUT_MONTHS)
    expect(ENGINE_SIT_EMBARGO).toBe(situations.OPIUM_CRISIS_EMBARGO_MONTHS)
    expect(CONSTRUCTION_WORKSHOP_OUTPUT).toBe(construction.WORKSHOP_CAPACITY_OUTPUT)
    expect(CONSTRUCTION_PRIVATE_OWN_SHARE).toBe(construction.PRIVATE_OWN_CAPACITY_SHARE)
  })

  test('D3 relocated situations/construction constants match the prior inline literals', () => {
    expect(OPIUM_CRACKDOWN_LEGITIMACY).toBe(6)
    expect(OPIUM_CRACKDOWN_AUTHORITY).toBe(8)
    expect(OPIUM_CRACKDOWN_RELATION).toBe(-15)
    expect(OPIUM_COMPROMISE_TARIFF_CUT).toBe(8)
    expect(OPIUM_WAR_RELATION).toBe(-40)
    expect(SITUATION_NARRATIVE_MAX).toBe(160)
    expect(situations.OPIUM_CRACKDOWN_PRESTIGE).toBe(8)
    expect(situations.OPIUM_CRACKDOWN_GBR_PRESTIGE).toBe(5)
    expect(situations.OPIUM_COMPROMISE_LEGITIMACY).toBe(4)
    expect(situations.OPIUM_COMPROMISE_RADICALS).toBe(5)
    expect(situations.OPIUM_COMPROMISE_RELATION).toBe(10)
    expect(ADMIN_CAPACITY_MAX).toBe(100)
  })

  test('a sample of values equals the prior inline constants', () => {
    expect(economy.PRICE_SMOOTHING).toBe(0.3)
    expect(economy.PRICE_RATIO_MIN).toBe(0.35)
    expect(economy.PRICE_RATIO_MAX).toBe(3)
    expect(economy.PRICE_FLOOR_FACTOR).toBe(0.25)
    expect(economy.PRICE_CEILING_FACTOR).toBe(4)
    expect(society.GROWTH_BASE).toBe(0.0012)
    expect(society.LEGITIMACY_PULL).toBe(0.08)
    expect(diplomacy.RELATION_DRIFT).toBe(0.012)
    expect(diplomacy.RELATION_ALLIANCE_TARGET).toBe(55)
    expect(diplomacy.RELATION_RIVAL_TARGET).toBe(-35)
    expect(diplomacy.INFAMY_DRAG).toBe(0.1)
    expect(trade.ROUTE_UNIT_VOLUME).toBe(2)
    expect(tax.FREE_TRADE_TARIFF_FLOOR).toBe(5)
    expect(military.WAR_SCORE_WIN).toBe(75)
    expect(situations.OPIUM_TRIGGER_IMPORT_SHARE).toBe(0.2)
  })
})
