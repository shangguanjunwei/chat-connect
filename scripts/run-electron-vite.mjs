#!/usr/bin/env node
/**
 * Launch electron-vite with a clean Electron environment.
 *
 * Some terminals (including IDE-spawned ones) export ELECTRON_RUN_AS_NODE=1.
 * Electron then starts as plain Node and `require('electron').app` is undefined,
 * which makes the app exit before any window exists. Strip it here.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const command = process.argv[2] ?? 'dev'
const bin = resolve('node_modules', 'electron-vite', 'bin', 'electron-vite.js')
if (!existsSync(bin)) {
  console.error(`[chat-connect] electron-vite not found at ${bin}. Run npm install first.`)
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const child = spawn(process.execPath, [bin, command], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
