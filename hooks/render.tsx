import type { EngineInterface } from 'claude-code'
import { Band, Panel, Report, type UiKit } from '../view/panels'
import { activeWorld, patchUi } from './internal'
import { controlGame, councilAction, resolveEvent } from './council'

// ---------------------------------------------------------------- drawing

export async function renderPane($: EngineInterface, e: any) {
  const current = await activeWorld($)
  const kit = $.ui.resolve(e) as unknown as UiKit
  if (current === undefined) {
    const { Box, Text } = kit
    return (
      <Box flexDirection="column">
        <Text bold>终末传奇</Text>
        <Text dimColor>还没有进行中的游戏。输入 /v3 new 开始，/v3 load 读取存档。</Text>
      </Box>
    )
  }
  return (
    <Panel
      ui={kit}
      world={current.world}
      width={e.props.bodyColumns}
      tab={current.ui.tab}
      notice={current.ui.isBusy ? '处理中…' : current.ui.notice}
      onTab={tab => {
        void patchUi($, { tab })
      }}
      onControl={(control, payload) => {
        void controlGame($, control, payload)
      }}
      onEvent={(eventId, optionId) => {
        void resolveEvent($, eventId, optionId)
      }}
      council={current.ui.council}
      onCouncil={(action, value) => {
        void councilAction($, action, value)
      }}
    />
  )
}

export async function renderAbovePrompt($: EngineInterface, e: any, next: any) {
  const current = await activeWorld($)
  if (current === undefined) return next(e)
  const kit = $.ui.resolve(e) as unknown as UiKit
  return (
    <Band
      ui={kit}
      world={current.world}
      width={e.props.bodyColumns}
      maxRows={e.props.maxRows}
      onControl={(control, payload) => {
        void controlGame($, control, payload)
      }}
      council={current.ui.council}
      onCouncil={(action, value) => {
        void councilAction($, action, value)
      }}
    />
  )
}

export async function renderCommandOutput($: EngineInterface, e: any) {
  const current = await activeWorld($)
  const kit = $.ui.resolve(e) as unknown as UiKit
  if (current === undefined) {
    const { Text } = kit
    return <Text dimColor>{e.props.text}</Text>
  }
  return (
    <Report
      ui={kit}
      world={current.world}
      width={e.viewport?.columns ?? 100}
      args={e.props.args}
      text={e.props.text}
      onEvent={(eventId, optionId) => {
        void resolveEvent($, eventId, optionId)
      }}
    />
  )
}
