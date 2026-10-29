import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

interface SeedResult {
  seeded: boolean
  path: string
}

/**
 * Give a brand-new Harness home the workspace the user picked in the setup
 * wizard, so the first screen already has a project instead of an empty
 * sidebar.
 *
 * The on-disk unit is the pinned release's `workspace` domain (version 2). The
 * function refuses to touch any home that already has workspace records or
 * sessions, so it can never rewrite real user data.
 */
export function seedWorkspace(dshHome: string, workspacePath: string): SeedResult {
  const storages = join(dshHome, 'storages')
  const unitPath = join(storages, 'workspace.json')
  const sessions = join(dshHome, 'sessions')

  if (existsSync(unitPath)) return { seeded: false, path: workspacePath }
  if (existsSync(sessions)) {
    try {
      if (readdirSync(sessions).length > 0) return { seeded: false, path: workspacePath }
    } catch {
      return { seeded: false, path: workspacePath }
    }
  }

  mkdirSync(workspacePath, { recursive: true, mode: 0o700 })
  const canonical = realpathSync(workspacePath)
  const id = randomUUID()
  const now = new Date().toISOString()
  const document = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: id,
      workspaceIds: [id],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        [id]: {
          path: canonical,
          title: basename(canonical) || 'Workspace',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }

  mkdirSync(storages, { recursive: true, mode: 0o700 })
  const temp = `${unitPath}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, unitPath)
  try {
    chmodSync(unitPath, 0o600)
  } catch {
    // Best effort.
  }
  return { seeded: true, path: canonical }
}
