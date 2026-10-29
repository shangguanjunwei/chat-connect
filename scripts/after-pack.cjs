/**
 * electron-builder afterPack hook.
 *
 * electron-builder copies the top-level production dependency tree but skips
 * nested `node_modules` copies (for example the `zod` version pinned under each
 * Harness package). Those copies matter: Node resolves them first, and the
 * top-level version is not always the one a package declared.
 *
 * This hook asks npm for the complete production dependency paths and copies
 * every nested package into `app.asar.unpacked`, preserving the exact layout
 * the Harness was installed with.
 */
const { execFileSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync } = require('node:fs')
const { join, relative, sep } = require('node:path')

function productionPaths(projectDir) {
  const output = execFileSync(
    'npm',
    ['ls', '--omit=dev', '--all', '--parseable'],
    { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const nodeModules = join(projectDir, 'node_modules') + sep
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(nodeModules))
    .map(line => relative(projectDir, line))
}

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir
  const appName = context.packager.appInfo.productFilename
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  const targetRoot = join(resources, 'app.asar.unpacked')

  if (!existsSync(targetRoot)) {
    console.warn('[after-pack] app.asar.unpacked is missing; skipping nested modules')
    return
  }

  const production = productionPaths(projectDir).sort((left, right) => left.length - right.length)
  const copiedPrefixes = []
  let copied = 0
  let nested = 0

  for (const entry of production) {
    if (copiedPrefixes.some(prefix => entry.startsWith(prefix + sep))) continue
    const source = join(projectDir, entry)
    if (!existsSync(source)) continue
    const destination = join(targetRoot, entry)
    const depth = entry.split(sep).filter(part => part === 'node_modules').length

    // electron-builder already ships most top-level packages; only fill the
    // gaps (peer dependencies) and always restore the nested copies it drops.
    if (depth === 1 && existsSync(destination)) continue

    mkdirSync(join(destination, '..'), { recursive: true })
    cpSync(source, destination, { recursive: true, force: true })
    copiedPrefixes.push(entry)
    copied += 1
    if (depth > 1) nested += 1
  }
  console.log(`[after-pack] restored ${copied} dependency trees (${nested} nested)`)
}
