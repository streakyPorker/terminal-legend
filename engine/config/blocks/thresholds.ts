import type { ConfigBlock } from '../../../types'

/**
 * Threshold blocks (migrated 1:1 from the old THRESHOLD_RULES). `source` stays
 * `threshold:<id>` so audits and old saves are unaffected. Do not reorder —
 * evaluation order is part of the behaviour contract.
 */
export const THRESHOLD_BLOCKS: ConfigBlock[] = [
  {
    id: 'threshold:unrest',
    kind: 'threshold',
    label: '民怨沸腾',
    description: '激进达到 50',
    potential_trigger: [{ stat: 'radicals', op: '>=', value: 50 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'income', stack: 'percent', value: -8 },
      { stat: 'constructionSpeed', stack: 'percent', value: -10 },
    ],
  },
  {
    id: 'threshold:stability',
    kind: 'threshold',
    label: '社会安定',
    description: '激进不高于 10 且合法性达到 65',
    potential_trigger: [
      { stat: 'radicals', op: '<=', value: 10 },
      { stat: 'legitimacy', op: '>=', value: 65 },
    ],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'taxEfficiency', stack: 'percent', value: 6 },
      { stat: 'growth', stack: 'percent', value: 10 },
    ],
  },
  {
    id: 'threshold:revolutionary-crisis',
    kind: 'threshold',
    label: '革命危机',
    description: '激进达到约 80（带滞回，78 即触发）',
    potential_trigger: [{ stat: 'radicals', op: '>=', value: 78 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'income', stack: 'percent', value: -20 },
      { stat: 'constructionSpeed', stack: 'percent', value: -30 },
      { stat: 'legitimacy', stack: 'flat', value: -2 },
      { stat: 'armyStrength', stack: 'percent', value: -10 },
    ],
  },
  {
    id: 'threshold:state-collapse',
    kind: 'threshold',
    label: '国家崩解',
    description: '激进达到约 95（带滞回，92 即触发）',
    potential_trigger: [{ stat: 'radicals', op: '>=', value: 92 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'income', stack: 'percent', value: -35 },
      { stat: 'constructionSpeed', stack: 'percent', value: -50 },
      { stat: 'armyStrength', stack: 'percent', value: -20 },
      { stat: 'authority', stack: 'flat', value: -3 },
    ],
  },
  {
    id: 'threshold:debt-crisis',
    kind: 'threshold',
    label: '债台高筑',
    description: '国债超过 GDP 的 1.5 倍',
    potential_trigger: [{ stat: 'debtRatio', op: '>=', value: 1.5 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'expense', stack: 'percent', value: 10 },
      { stat: 'taxEfficiency', stack: 'percent', value: -8 },
    ],
  },
  {
    id: 'threshold:industrial-takeoff',
    kind: 'threshold',
    label: '工业起飞',
    description: '工业建筑达到 100 座',
    potential_trigger: [{ stat: 'industry', op: '>=', value: 100 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [{ stat: 'factoryOutput', stack: 'percent', value: 10 }],
  },
  {
    id: 'threshold:mass-unemployment',
    kind: 'threshold',
    label: '失业潮',
    description: '失业率达到 20%',
    potential_trigger: [{ stat: 'unemployment', op: '>=', value: 20 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'income', stack: 'percent', value: -5 },
      { stat: 'legitimacy', stack: 'flat', value: -1 },
    ],
  },
  {
    id: 'threshold:efficient-state',
    kind: 'threshold',
    label: '高效行政',
    description: '官僚效能达到 70',
    potential_trigger: [{ stat: 'bureaucracy', op: '>=', value: 70 }],
    lifecycle: 'while',
    scales_with: [],
    effects: [
      { stat: 'constructionSpeed', stack: 'percent', value: 10 },
      { stat: 'income', stack: 'percent', value: 4 },
    ],
  },
  {
    id: 'threshold:enlightenment',
    kind: 'threshold',
    label: '启蒙时代',
    description: '识字率达到 60%（一次性）',
    potential_trigger: [{ stat: 'literacy', op: '>=', value: 0.6 }],
    lifecycle: 'once',
    scales_with: [],
    effects: [
      { stat: 'techPoints', stack: 'percent', value: 15 },
      { stat: 'legitimacy', stack: 'flat', value: 2 },
    ],
  },
]
