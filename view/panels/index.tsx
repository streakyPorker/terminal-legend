// Barrel for the panel modules. `view/panels.tsx` was split into one module per
// panel (plan 0012 S3); this file keeps the original public import surface
// (`./panels` still resolves here).
export type {
  UiKit,
  ControlAction,
  CouncilAction,
  CouncilHandlers,
  PanelProps,
  BandProps,
  ReportProps,
} from './shared'
export { PanePlaceholder, helpText } from './shared'
export { Panel } from './panel'
export { Band } from './band'
export { Report } from './report'
export { eventSummary, clampText } from '../format'
