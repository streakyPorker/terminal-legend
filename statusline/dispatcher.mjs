// Status-line dispatcher for terminal-legend.
//
// Always delegates byte-for-byte to the command saved in delegate.txt
// (claude-hud's statusline by default). A running campaign draws its own
// AbovePrompt band on top of that, so claude-hud and the game coexist instead
// of one hiding the other.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const home = process.env.HOME || os.homedir()
const dir = path.join(home, '.claude', 'plugins', 'terminal-legend')
const delegatePath = path.join(dir, 'delegate.txt')

let raw = ''
try {
  raw = fs.readFileSync(0, 'utf8')
} catch {
  raw = ''
}

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

process.exit(0)
