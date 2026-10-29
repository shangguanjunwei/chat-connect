#!/usr/bin/env node
/**
 * One-command engine (DeepSeek Harness) upgrade for development.
 *
 *   npm run upgrade:core              # upgrade to the latest npm release
 *   npm run upgrade:core -- 0.2.2     # pin a specific version
 *   npm run upgrade:core -- --dry-run # show what would change
 *   npm run upgrade:core -- --package # also build DMG + ZIP afterwards
 *   npm run upgrade:core -- 0.2.1 --force  # explicit rollback
 *
 * The script bumps the pinned engine packages, reinstalls, and runs any
 * package install scripts that npm 11.19+ gated behind its approval prompt.
 * Missing peer / nested dependencies are restored at package time by
 * scripts/after-pack.cjs, so an upgrade does not need manual peer bookkeeping.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_JSON = join(ROOT, 'package.json')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const withPackage = argv.includes('--package')
const requested = argv.find(arg => !arg.startsWith('--'))

function run(args, options = {}) {
  execFileSync(NPM, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
}

function capture(args) {
  return execFileSync(NPM, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.replace(/^v/, ''))
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return 0
  for (let index = 0; index < 3; index += 1) {
    const diff = a.core[index] - b.core[index]
    if (diff !== 0) return diff
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) return leftNumber - rightNumber
    } else if (leftNumber !== null) {
      return -1
    } else if (rightNumber !== null) {
      return 1
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }
  return 0
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)))
}

function readPackage() {
  return readJson(PACKAGE_JSON)
}

function writePackage(pkg) {
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`)
}

function isEnginePackage(name) {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

function resolveTarget() {
  if (requested !== undefined) {
    if (!VERSION_PATTERN.test(requested)) {
      throw new Error(`Invalid version: ${requested}`)
    }
    return requested
  }
  let output
  try {
    output = capture(['view', '@deepseek-ai/dsh', 'version'])
  } catch (error) {
    throw new Error(
      `could not query the latest version (${error instanceof Error ? error.message : String(error)}). ` +
        'Pass one explicitly: npm run upgrade:core -- 0.2.2',
    )
  }
  const latest = output.split(/\r?\n/).filter(Boolean).at(-1)
  if (latest === undefined || !VERSION_PATTERN.test(latest)) {
    throw new Error(`Could not resolve the latest version (npm view returned: ${output})`)
  }
  return latest
}

function installedVersion(name) {
  const manifest = join(ROOT, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return readJson(manifest).version ?? null
  } catch {
    return null
  }
}

function main() {
  const target = resolveTarget()
  const pkg = readPackage()
  const current = pkg.version
  const force = argv.includes('--force')

  // `npm view ... version` returns the `latest` dist-tag, which may point to an
  // older prerelease than the one this project is already on. Never downgrade
  // silently just because the latest tag is stale.
  if (compareVersions(target, current) < 0 && !force) {
    throw new Error(
      `refusing to downgrade ${current} -> ${target}. ` +
        (requested === undefined
          ? 'npm latest may point at an older prerelease; pass the intended version explicitly, or use --force to roll back.'
          : 'Add --force if this rollback is intentional.'),
    )
  }

  if (target === current && !force) {
    console.log(`[upgrade] already on ${target}. Use --force to reinstall anyway.`)
    if (!withPackage) return
  } else {
    console.log(`[upgrade] ${current} -> ${target}`)
  }

  const next = structuredClone(pkg)
  next.version = target
  let bumped = 0
  for (const name of Object.keys(next.dependencies)) {
    if (isEnginePackage(name)) {
      next.dependencies[name] = target
      bumped += 1
    }
  }
  next.dependencies = sortObject(next.dependencies)

  console.log(`[upgrade] pinned ${bumped} engine packages to ${target}`)
  if (dryRun) {
    console.log(JSON.stringify({ version: next.version, dependencies: next.dependencies }, null, 2))
    console.log('[upgrade] dry run: no files changed')
    return
  }

  writePackage(next)
  run(['install', '--no-audit', '--no-fund'])

  const installedDsh = installedVersion('@deepseek-ai/dsh')
  if (installedDsh !== target) {
    throw new Error(
      `npm installed @deepseek-ai/dsh@${installedDsh ?? '?'} instead of ${target}. ` +
        'The dependency tree is inconsistent; run npm install again or restore it from a known-good lockfile.',
    )
  }

  // npm 11.19+ holds dependency install scripts until they are approved.
  // Approving here keeps native addons (node-pty, koffi) working after a bump.
  try {
    run(['install-scripts', 'approve', '--all'])
    run(['rebuild', '--foreground-scripts'])
  } catch {
    console.warn('[upgrade] this npm does not support install-scripts; skipped approvals')
  }

  const dsh = installedVersion('@deepseek-ai/dsh')
  const mismatched = Object.entries(readPackage().dependencies)
    .filter(([name]) => isEnginePackage(name))
    .map(([name, expected]) => [name, expected, installedVersion(name)])
    .filter(([, expected, actual]) => expected !== actual)
  if (mismatched.length > 0) {
    console.warn(`[upgrade] ${mismatched.length} engine packages are not at ${target}:`)
    for (const [name, expected, actual] of mismatched.slice(0, 10)) {
      console.warn(`  ${name}: expected ${expected}, installed ${actual ?? 'missing'}`)
    }
  }
  console.log(`[upgrade] installed @deepseek-ai/dsh@${dsh ?? '?'}`)

  const manifest = readJson(join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  const engine = manifest.engines?.node
  if (engine !== undefined) {
    const runtime = readFileSync(join(ROOT, 'scripts', 'prepare-node.mjs'), 'utf8').match(
      /const NODE_VERSION = '([^']+)'/,
    )?.[1]
    console.log(`[upgrade] engine requires Node ${engine}; packaged runtime is ${runtime ?? 'unknown'}`)
    const required = engine.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1]
    if (runtime !== undefined && required !== undefined && compareVersions(runtime, required) < 0) {
      console.warn('[upgrade] update NODE_VERSION in scripts/prepare-node.mjs before packaging')
    }
  }

  console.log('[upgrade] next:')
  console.log('  npm run typecheck && npm run dist:mac')
  console.log('  verify the packaged app from /tmp or a mounted DMG')
  console.log('  check the workspace storage version in src/main/seed-workspace.ts')

  if (withPackage) {
    run(['run', 'typecheck'])
    run(['run', 'dist:mac'])
  }
}

try {
  main()
} catch (error) {
  console.error(`[upgrade] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
