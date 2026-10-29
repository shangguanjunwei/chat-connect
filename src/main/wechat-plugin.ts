import { app } from 'electron'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const PLUGIN_NAME = 'chat-connect-wechat'
const PLUGIN_VERSION = '1.0.0'

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}

export interface WechatPluginInstall {
  pluginSource: string
  profileDir: string
}

function pluginSourcePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', PLUGIN_NAME)
  }
  return join(app.getAppPath(), 'plugins', 'wechat')
}

function readManifest(path: string): ProfileManifest {
  if (!existsSync(path)) {
    return {
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProfileManifest
  } catch (error) {
    throw new Error(`无法解析 Harness web profile：${String(error)}`)
  }
}

function writeIfMissing(path: string, content: string, mode = 0o600): void {
  if (!existsSync(path)) writeFileSync(path, content, { mode })
}

function ensureLink(target: string, link: string): void {
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false }) !== undefined) {
    try {
      if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === target) return
    } catch {
      // Recreate below.
    }
    rmSync(link, { recursive: true, force: true })
  }
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Make the bundled WeChat plugin part of the web profile before the Harness
 * Host starts.
 *
 * The profile is normally created by `dsh web` on first boot. We pre-create the
 * same four files, add the plugin as a profile bundle, and link the package
 * into the profile's node_modules. The link's real path stays inside the app
 * runtime, so the plugin can resolve its DSH peer packages and `qrcode` without
 * installing anything into the user's profile.
 */
export function ensureWechatPlugin(dshHome: string): WechatPluginInstall {
  const pluginSource = pluginSourcePath()
  if (!existsSync(join(pluginSource, 'package.json'))) {
    throw new Error(`未找到内置微信插件：${pluginSource}`)
  }

  const profileDir = join(dshHome, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })

  const manifestPath = join(profileDir, 'package.json')
  const manifest = readManifest(manifestPath)
  manifest.name ??= 'dsh-profile-web'
  manifest.private = true
  manifest.dependencies = {
    ...(manifest.dependencies ?? {}),
    [PLUGIN_NAME]: PLUGIN_VERSION,
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  manifest.dsh = {
    ...manifest.dsh,
    profile: {
      ...manifest.dsh?.profile,
      bundles: bundles.includes(PLUGIN_NAME) ? bundles : [...bundles, PLUGIN_NAME],
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })

  writeIfMissing(join(profileDir, 'cordis.yml'), '# dsh profile root\n[]\n')
  writeIfMissing(join(profileDir, 'cordis.patch.yml'), '# Chat Connect local patches\n[]\n')
  writeIfMissing(join(profileDir, 'pnpm-workspace.yaml'), 'packages: []\n')

  const nodeModules = join(profileDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true, mode: 0o700 })
  ensureLink(pluginSource, join(nodeModules, PLUGIN_NAME))

  return { pluginSource, profileDir }
}
