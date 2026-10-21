import type { Country } from '../../types'
import { FREE_TRADE_TARIFF_FLOOR } from '../config/tax'
import {
  compileLawBlock,
  lawBlockFor,
  lawSource,
  lawSpecFor,
} from '../config/blocks/laws'
import { installBlock, validateBlockConfig } from '../blocks'
import { addModifier } from '../modifiers'
import { clamp } from '../internal'
import type { ActionParams, ActionResult } from './types'

/** Political capital each law consumes (plan §7.6). */
const LAW_AUTHORITY_COST: Record<string, number> = {
  教育改革: 8,
  福利改革: 10,
  自由贸易: 12,
  保护关税: 10,
  征兵制: 15,
  宗教宽容: 5,
}

/**
 * Installs a law's modifier through the block engine (ADR 0024). The registered
 * block's id is `law:<name>` (the pre-C6 `source`); the modifier id is restored
 * to the pre-C6 shape (some laws carry a slot suffix like `law:自由贸易:income`).
 * A validation failure — which cannot happen for the derived static registry —
 * falls back to the legacy direct install, so behaviour cannot change.
 */
function installLawModifier(country: Country, law: string): void {
  const spec = lawSpecFor(law)
  if (spec === undefined) return
  const template = lawBlockFor(law) ?? compileLawBlock(spec)
  if (validateBlockConfig([template]).length === 0) {
    installBlock(country, template, { modifierId: () => spec.modifierId })
    return
  }
  addModifier(country, {
    id: spec.modifierId,
    label: spec.label,
    stat: spec.stat,
    stack: spec.stack,
    value: spec.value,
    source: lawSource(law),
  })
}

export function actionLaw(country: Country, params: ActionParams): ActionResult {
  const tag = `[${country.flag}] ${country.name}`
  const name = String(params.name ?? params.law ?? '')
  if (name === '') return { ok: false, text: `${tag} 未知法案` }
  const legal: Record<string, () => string> = {
    教育改革: () => {
      country.pops.literacy = clamp(country.pops.literacy + 0.04, 0, 1)
      country.econ.spending.education += 0.5
      installLawModifier(country, '教育改革')
      return `${tag} 推行教育改革，识字率上升`
    },
    福利改革: () => {
      country.pops.radicals = clamp(country.pops.radicals - 6, 0, 100)
      country.econ.spending.welfare += 0.5
      installLawModifier(country, '福利改革')
      return `${tag} 推行福利改革，民怨稍减`
    },
    自由贸易: () => {
      const exportRate = country.econ.exportTariff ?? country.econ.tariff
      country.econ.tariff = clamp(
        country.econ.tariff - 8,
        FREE_TRADE_TARIFF_FLOOR,
        60,
      )
      country.econ.exportTariff = clamp(
        exportRate - 8,
        FREE_TRADE_TARIFF_FLOOR,
        60,
      )
      country.econ.marketAccess = clamp(country.econ.marketAccess + 0.08, 0, 1)
      installLawModifier(country, '自由贸易')
      return `${tag} 推行自由贸易，进口关税 ${country.econ.tariff.toFixed(0)}%、出口关税 ${country.econ.exportTariff.toFixed(0)}%（下限 ${FREE_TRADE_TARIFF_FLOOR}%），市场接入提高`
    },
    保护关税: () => {
      const exportRate = country.econ.exportTariff ?? country.econ.tariff
      country.econ.tariff = clamp(country.econ.tariff + 8, 0, 60)
      country.econ.exportTariff = clamp(exportRate + 8, 0, 60)
      country.econ.marketAccess = clamp(country.econ.marketAccess - 0.04, 0, 1)
      installLawModifier(country, '保护关税')
      return `${tag} 推行保护关税，国库与工厂受益`
    },
    征兵制: () => {
      country.military.manpower = clamp(country.military.manpower + 10, 0, country.pops.total * 0.06)
      country.pops.radicals = clamp(country.pops.radicals + 3, 0, 100)
      installLawModifier(country, '征兵制')
      return `${tag} 推行征兵制，人力池扩大`
    },
    宗教宽容: () => {
      country.pops.radicals = clamp(country.pops.radicals - 4, 0, 100)
      country.government.legitimacy = clamp(country.government.legitimacy + 2, 0, 100)
      installLawModifier(country, '宗教宽容')
      return `${tag} 推行宗教宽容，社会稳定`
    },
  }
  const apply = legal[name]
  if (apply === undefined) return { ok: false, text: `${tag} 未知法案 ${name}` }
  const cost = LAW_AUTHORITY_COST[name] ?? 8
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `${tag} 权威不足，无法通过${name}（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)
  return { ok: true, text: apply() }
}
