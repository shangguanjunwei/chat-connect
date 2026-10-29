#!/usr/bin/env node
/**
 * Place a self-contained Node.js runtime in `resources/node` for packaging.
 *
 * The Harness runtime ships native addons compiled for Node, so the desktop app
 * runs the CLI under a real Node binary instead of Electron's embedded Node.
 * The version is pinned to the release the Harness declares (24.21.x).
 *
 * The script reuses the Node that ran the install when it already matches, and
 * otherwise downloads the official archive for the current platform.
 */
import { createWriteStream, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODE_VERSION = '24.21.0'
const PLATFORM = { darwin: 'darwin', win32: 'win', linux: 'linux' }[process.platform]
const ARCH = { arm64: 'arm64', x64: 'x64' }[process.arch]

const targetDir = join(ROOT, 'resources', 'node')
const targetBin = process.platform === 'win32' ? join(targetDir, 'node.exe') : join(targetDir, 'bin', 'node')

function log(message) {
  console.log(`[prepare-node] ${message}`)
}

function versionOf(binary) {
  try {
    return execFileSync(binary, ['-v'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: ${response.status} ${url}`)
  }
  await pipeline(response.body, createWriteStream(destination))
}

async function main() {
  if (PLATFORM === undefined || ARCH === undefined) {
    throw new Error(`Unsupported platform ${process.platform}/${process.arch}`)
  }

  if (existsSync(targetBin) && versionOf(targetBin) === `v${NODE_VERSION}`) {
    log(`already prepared: ${targetBin}`)
    return
  }

  mkdirSync(process.platform === 'win32' ? targetDir : join(targetDir, 'bin'), { recursive: true })

  if (process.version === `v${NODE_VERSION}`) {
    log(`copying the running Node ${process.version}`)
    copyFileSync(process.execPath, targetBin)
    if (process.platform !== 'win32') chmodSync(targetBin, 0o755)
    log(`wrote ${targetBin}`)
    return
  }

  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const name = `node-v${NODE_VERSION}-${PLATFORM}-${ARCH}`
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}.${ext}`
  const archive = join(tmpdir(), `${name}.${ext}`)
  log(`downloading ${url}`)
  await download(url, archive)

  const shaResponse = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)
  if (!shaResponse.ok) throw new Error('could not download SHASUMS256.txt')
  const shasums = await shaResponse.text()
  const expected = shasums
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1] === `${name}.${ext}`)?.[0]
  if (expected === undefined) throw new Error(`no checksum for ${name}.${ext}`)
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (digest !== expected) throw new Error(`checksum mismatch for ${name}.${ext}`)

  const extractRoot = join(tmpdir(), `dsh-node-${process.pid}`)
  rmSync(extractRoot, { recursive: true, force: true })
  mkdirSync(extractRoot, { recursive: true })
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${extractRoot}' -Force`,
    ])
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', extractRoot])
  }

  const extracted = join(extractRoot, name)
  const sourceBin = process.platform === 'win32' ? join(extracted, 'node.exe') : join(extracted, 'bin', 'node')
  if (!existsSync(sourceBin)) throw new Error(`archive did not contain ${sourceBin}`)
  copyFileSync(sourceBin, targetBin)
  if (process.platform !== 'win32') chmodSync(targetBin, 0o755)
  rmSync(extractRoot, { recursive: true, force: true })
  rmSync(archive, { force: true })
  log(`wrote ${targetBin} (${versionOf(targetBin)})`)
}

main().catch(error => {
  console.error(`[prepare-node] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
