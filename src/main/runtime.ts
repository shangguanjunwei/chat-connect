import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeInfo } from '../shared/types'

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeError'
  }
}

export interface SpawnRuntime {
  command: string
  /** Arguments placed before the dsh CLI entry point. */
  prefixArgs: string[]
  env: NodeJS.ProcessEnv
  kind: 'bundled' | 'system' | 'electron'
  nodeVersion: string
  dshBin: string
}

const MINIMUM_NODE = [22, 19, 0] as const
let cachedSystemNode: string | null | undefined

function dshBinCandidates(): string[] {
  if (app.isPackaged) {
    return [
      join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js',
      ),
      join(process.resourcesPath, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    ]
  }
  return [join(app.getAppPath(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')]
}

export function dshBinPath(): string {
  const found = dshBinCandidates().find(candidate => existsSync(candidate))
  if (found === undefined) {
    throw new RuntimeError(
      '未找到内置的本地引擎。请先运行 npm install，或重新安装应用。',
    )
  }
  return found
}

export function dshVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(app.getAppPath(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
    ) as { version?: string }
    return manifest.version ?? '0.2.1-rc.4'
  } catch {
    try {
      const manifest = JSON.parse(
        readFileSync(join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
      ) as { version?: string }
      return manifest.version ?? '0.2.1-rc.4'
    } catch {
      return '0.2.1-rc.4'
    }
  }
}

function nodeAtLeast(version: string, minimum: readonly number[] = MINIMUM_NODE): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return false
  const parts = match.slice(1, 4).map(Number)
  for (let index = 0; index < 3; index += 1) {
    const value = parts[index] ?? 0
    const floor = minimum[index] ?? 0
    if (value > floor) return true
    if (value < floor) return false
  }
  return true
}

function nodeVersionOf(binary: string): string | null {
  try {
    return execFileSync(binary, ['-v'], { encoding: 'utf8', timeout: 5_000 }).trim()
  } catch {
    return null
  }
}

/** Resources/node is produced by scripts/prepare-node.mjs before packaging. */
function bundledNodePath(): string | null {
  const roots = app.isPackaged
    ? [join(process.resourcesPath, 'node')]
    : [join(app.getAppPath(), 'resources', 'node')]
  for (const root of roots) {
    const candidates =
      process.platform === 'win32'
        ? [join(root, 'node.exe'), join(root, 'bin', 'node.exe')]
        : [join(root, 'bin', 'node'), join(root, 'node')]
    const found = candidates.find(candidate => existsSync(candidate))
    if (found !== undefined) return found
  }
  return null
}

function findSystemNode(): string | null {
  if (process.env.CHAT_CONNECT_NODE !== undefined && process.env.CHAT_CONNECT_NODE !== '') {
    return process.env.CHAT_CONNECT_NODE
  }
  if (cachedSystemNode !== undefined) return cachedSystemNode

  const executable = process.platform === 'win32' ? 'node.exe' : 'node'
  const pathEntries = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  const candidates = [
    ...pathEntries.map(entry => join(entry, executable)),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    join(process.env.HOME ?? '', '.volta', 'bin', 'node'),
  ]
  cachedSystemNode = candidates.find(candidate => {
    try {
      return candidate !== '' && existsSync(candidate)
    } catch {
      return false
    }
  }) ?? null
  return cachedSystemNode
}

/**
 * Resolve how to run the bundled Harness CLI.
 *
 * The app prefers a real Node binary because the Harness production tree
 * contains native addons compiled against Node. Electron's embedded Node is a
 * last-resort fallback; it works for most features but can reject those addons.
 */
export function resolveSpawnRuntime(): SpawnRuntime {
  const dshBin = dshBinPath()

  const bundled = bundledNodePath()
  if (bundled !== null) {
    const version = nodeVersionOf(bundled)
    if (version !== null && nodeAtLeast(version)) {
      return {
        command: bundled,
        prefixArgs: ['--expose-internals'],
        env: {},
        kind: 'bundled',
        nodeVersion: version,
        dshBin,
      }
    }
  }

  const system = findSystemNode()
  if (system !== null) {
    const version = nodeVersionOf(system)
    if (version !== null && nodeAtLeast(version)) {
      return {
        command: system,
        prefixArgs: ['--expose-internals'],
        env: {},
        kind: 'system',
        nodeVersion: version,
        dshBin,
      }
    }
  }

  if (nodeAtLeast(process.versions.node)) {
    return {
      command: process.execPath,
      prefixArgs: ['--expose-internals'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      kind: 'electron',
      nodeVersion: process.versions.node,
      dshBin,
    }
  }

  throw new RuntimeError(
    '没有可用的 Node.js 22.19+ 运行时。请重新安装应用，或设置 CHAT_CONNECT_NODE 指向 Node 可执行文件。',
  )
}

export function runtimeInfo(): RuntimeInfo {
  const base = {
    appVersion: app.getVersion(),
    dshVersion: dshVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  }
  try {
    const runtime = resolveSpawnRuntime()
    return {
      ...base,
      dshBin: runtime.dshBin,
      node: runtime.command,
      nodeKind: runtime.kind,
      nodeVersion: runtime.nodeVersion,
    }
  } catch {
    return {
      ...base,
      dshBin: '',
      node: '',
      nodeKind: 'electron',
    }
  }
}

export function runtimeWarning(): string | null {
  try {
    resolveSpawnRuntime()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
