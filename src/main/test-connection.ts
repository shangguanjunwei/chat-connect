import type { ConnectionCode, TestConnectionInput, TestConnectionResult } from '../shared/types'
import { currentApiKey, loadSettings, normalizeBaseURL } from './settings'

const DEFAULT_ROOT = 'https://api.deepseek.com'

function result(
  code: ConnectionCode,
  message: string,
  extra: Partial<TestConnectionResult> = {},
): TestConnectionResult {
  return {
    ok: code === 'ok',
    code,
    status: null,
    latencyMs: 0,
    models: [],
    message,
    ...extra,
  }
}

/**
 * Validate an API key against the DeepSeek-compatible `/models` endpoint.
 * A missing key or an unavailable network never blocks saving; it only informs
 * the wizard.
 */
export async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
  const supplied = (input.apiKey ?? '').trim()
  const key = supplied !== '' ? supplied : currentApiKey()
  if (key === '') {
    return result('missing-key', '请先填写 API Key')
  }

  let root: string
  try {
    root = normalizeBaseURL(input.baseURL ?? loadSettings().baseURL) || DEFAULT_ROOT
  } catch (error) {
    return result('network', error instanceof Error ? error.message : String(error))
  }

  const url = `${root.replace(/\/+$/, '')}/models`
  const started = Date.now()

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    const latencyMs = Date.now() - started

    if (response.status === 401 || response.status === 403) {
      return result('unauthorized', 'API Key 无效或已过期', { status: response.status, latencyMs })
    }
    if (response.status === 404) {
      return result('not-found', '未找到 /models 接口，请检查 API 地址', {
        status: response.status,
        latencyMs,
      })
    }
    if (response.status === 429) {
      return result('rate-limited', '请求过于频繁，请稍后再试', {
        status: response.status,
        latencyMs,
      })
    }
    if (!response.ok) {
      return result('server', `服务返回 HTTP ${response.status}`, {
        status: response.status,
        latencyMs,
      })
    }

    let models: string[] = []
    try {
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>
        models?: Array<{ id?: unknown }>
      }
      const rows = payload.data ?? payload.models ?? []
      models = rows
        .map(row => (typeof row.id === 'string' ? row.id : ''))
        .filter((id): id is string => id !== '')
    } catch {
      // Some compatible endpoints answer 200 without a JSON model list.
    }

    return result('ok', '连接成功', { status: response.status, latencyMs, models })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return result('timeout', '连接超时（15 秒），请检查网络或代理')
    }
    return result(
      'network',
      `无法连接到 ${url}：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
