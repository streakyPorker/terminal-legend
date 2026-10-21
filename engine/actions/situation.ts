import type { Country, WorldState } from '../../types'
import { recordSituationProposal } from '../situations'
import type { ActionParams, ActionResult } from './types'

export function actionSituation(
  world: WorldState,
  country: Country,
  params: ActionParams,
  decisionNarrative: string | undefined,
): ActionResult {
  // A crisis proposal (plan §4.2): context for the arbitration only.
  const stance = String(params.stance ?? '')
  const narrative = String(params.narrative ?? decisionNarrative ?? '')
  return recordSituationProposal(world, country.id, stance, narrative)
}
