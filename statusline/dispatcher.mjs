// Status-line dispatcher for terminal-legend.
//
// When a Claude Code session has a terminal-legend campaign active, the game's
// own $.ui.status line and AbovePrompt band own the bottom of the screen, so
// this script prints nothing and claude-hud stays hidden.
// Otherwise it delegates byte-for-byte to the command saved in delegate.txt
// (claude-hud's statusline by default), so nothing changes for other sessions.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const home = process.env.HOME || os.homedir()
const dir = path.join(home, '.claude', 'plugins', 'terminal-legend')
const activePath = path.join(dir, 'active.json')
const delegatePath = path.join(dir, 'delegate.txt')
const TTL_MS = 12 * 60 * 60 * 1000

let raw = ''
try {
  raw = fs.readFileSync(0, 'utf8')
} catch {
  raw = ''
}

let input = {}
try {
  input = JSON.parse(raw)
} catch {
  input = {}
}

const sessionId = typeof input.session_id === 'string' ? input.session_id : ''
const cwd =
  typeof input.cwd === 'string'
    ? input.cwd
    : typeof input.workspace?.current_dir === 'string'
      ? input.workspace.current_dir
      : ''

function isGameActive() {
  try {
    const parsed = JSON.parse(fs.readFileSync(activePath, 'utf8'))
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    const now = Date.now()
    return sessions.some(entry => {
      if (typeof entry?.at !== 'number' || now - entry.at > TTL_MS) return false
      if (sessionId !== '' && entry.id === sessionId) return true
      return sessionId === '' && cwd !== '' && entry.cwd === cwd
    })
  } catch {
    return false
  }
}

if (!isGameActive()) {
  try {
    const command = fs.readFileSync(delegatePath, 'utf8').trim()
    if (command !== '') {
      const result = spawnSync('/bin/sh', ['-c', command], {
        input: raw,
        encoding: 'utf8',
        timeout: 8000,
        env: process.env,
      })
      if (typeof result.stdout === 'string' && result.stdout !== '') {
        process.stdout.write(result.stdout)
      }
    }
  } catch {
    // A missing delegate leaves the line empty rather than breaking the UI.
  }
}

process.exit(0)
