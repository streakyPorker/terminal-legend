import type { Decision } from '../internal'

/** Shared return shape for every per-action handler (mirrors `applyDecision`). */
export type ActionResult = { ok: boolean; text: string }

/** Action parameters as supplied on a `Decision`. */
export type ActionParams = Decision['params']
