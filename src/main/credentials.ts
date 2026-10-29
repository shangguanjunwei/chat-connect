import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dump, load } from 'js-yaml'

export const DEEPSEEK_KEY_REF = 'DEEPSEEK_API_KEY'

interface CredentialsDocument {
  version: number
  refs?: Record<string, string>
  records?: Record<string, unknown>
  [key: string]: unknown
}

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialsError'
  }
}

export function credentialsPath(dshHome: string): string {
  return join(dshHome, '.credentials.yaml')
}

function readDocument(path: string): CredentialsDocument {
  if (!existsSync(path)) return { version: 1, refs: {} }
  const raw = readFileSync(path, 'utf8')
  if (raw.trim() === '') return { version: 1, refs: {} }
  let parsed: unknown
  try {
    parsed = load(raw)
  } catch (error) {
    throw new CredentialsError(`凭据文件无法解析：${String(error)}`)
  }
  if (parsed === null || parsed === undefined) return { version: 1, refs: {} }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CredentialsError('凭据文件格式不正确')
  }
  const document = parsed as CredentialsDocument
  if (document.version !== 1) {
    throw new CredentialsError(`不支持的凭据文件版本：${String(document.version)}`)
  }
  if (document.refs !== undefined && (typeof document.refs !== 'object' || document.refs === null)) {
    throw new CredentialsError('凭据文件中的 refs 字段格式不正确')
  }
  return document
}

function writeDocument(path: string, document: CredentialsDocument): void {
  const temp = `${path}.tmp-${process.pid}`
  const body = dump(document, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  })
  writeFileSync(temp, body, { mode: 0o600 })
  renameSync(temp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

/**
 * Store the DeepSeek API key in the Harness credential file so the Web UI's
 * Models settings and the running Host agree on one source of truth.
 */
export function writeDeepSeekKey(dshHome: string, apiKey: string): void {
  const path = credentialsPath(dshHome)
  mkdirSync(dshHome, { recursive: true, mode: 0o700 })
  const document = readDocument(path)
  const refs = { ...(document.refs ?? {}) }
  if (apiKey === '') {
    delete refs[DEEPSEEK_KEY_REF]
  } else {
    refs[DEEPSEEK_KEY_REF] = apiKey
  }
  writeDocument(path, { ...document, version: 1, refs })
}

export function hasStoredDeepSeekKey(dshHome: string): boolean {
  try {
    const document = readDocument(credentialsPath(dshHome))
    return (document.refs?.[DEEPSEEK_KEY_REF] ?? '') !== ''
  } catch {
    return false
  }
}
