// The player/AI action surface was split out of this file into one module per
// action concern. This barrel preserves the file's public import surface —
// every symbol that used to be imported from `./actions` (or via the `./sim`
// barrel) is still available here — while the implementations live in the
// modules below.
//
//   types      → shared ActionResult / ActionParams shapes (leaf)
//   <action>   → one module per action concern (build/tax/.../play)
//   policy     → applyPolicy, random → randomDecision, interrupt → councilInterrupt
//   decision   → applyDecision, the dispatcher that delegates to the above

/** Free trade lowers the tariff but never below this floor (ADR 0009). The
 *  value lives in `config/tax.ts`; re-exported so the `./actions` / `./sim`
 *  import surface is unchanged. */
export { FREE_TRADE_TARIFF_FLOOR } from '../config/tax'
export { taxMenuText } from './tax'
export { applyDecision } from './decision'
export { applyPolicy } from './policy'
export { randomDecision } from './random'
export { councilInterrupt } from './interrupt'
