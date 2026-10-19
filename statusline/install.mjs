// Installs the terminal-legend status-line dispatcher.
//
// It remembers the current statusLine command (claude-hud's, normally) in
// delegate.txt, copies dispatcher.mjs beside it, and points ~/.claude/settings
// .json at the dispatcher. Run it again to repair the install; it never
// overwrites a delegate that already exists.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const home = process.env.HOME || os.homedir()
const settingsPath = path.join(home, '.claude', 'settings.json')
const targetDir = path.join(home, '.claude', 'plugins', 'terminal-legend')
const dispatcherPath = path.join(targetDir, 'statusline.mjs')
const delegatePath = path.join(targetDir, 'delegate.txt')

fs.mkdirSync(targetDir, { recursive: true })

const raw = fs.readFileSync(settingsPath, 'utf8')
const settings = JSON.parse(raw)
const current = settings.statusLine?.command ?? ''

if (current.includes(dispatcherPath)) {
  console.log('statusLine already points at the dispatcher; nothing to do.')
} else {
  if (current !== '') {
    fs.writeFileSync(delegatePath, `${current}\n`)
    console.log(`delegate saved: ${current}`)
  } else {
    console.log('no existing statusLine command; the dispatcher will print nothing when idle.')
  }

  const backup = `${settingsPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.writeFileSync(backup, raw)
  console.log(`settings backed up to ${backup}`)

  // Same runtime the old command used, when it named one; else plain node.
  const bunMatch = /^(\S*bun(?:\.exe)?)\b/.exec(current)
  const runtime = bunMatch?.[1] ?? process.execPath
  settings.statusLine = {
    type: 'command',
    command: `'${runtime}' --env-file /dev/null '${dispatcherPath}'`,
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`statusLine now: ${settings.statusLine.command}`)
}

fs.copyFileSync(path.join(here, 'dispatcher.mjs'), dispatcherPath)
console.log(`dispatcher installed at ${dispatcherPath}`)
console.log('Restart Claude Code (or start a new session) for the settings change to apply.')
