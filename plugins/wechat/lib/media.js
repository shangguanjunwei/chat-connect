/**
 * WeChat iLink inbound media downloader.
 *
 * iLink media is AES-128-ECB encrypted and referenced by an encrypted CDN
 * query parameter, not by a browser-usable URL. This module downloads,
 * decrypts, sniffs images, and writes one dated file per item under the
 * account's workspace so the DSH Agent and the user can both reach it.
 */
import { createDecipheriv } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const KIND_LABEL = {
  image: '图片',
  file: '文件',
  video: '视频',
  voice: '语音',
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.amr': 'audio/amr',
  '.silk': 'audio/silk',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.speex': 'audio/speex',
  '.pcm': 'audio/L16',
}

const VOICE_EXT_BY_ENCODE = {
  1: 'pcm',
  2: 'adpcm',
  3: 'bin',
  4: 'speex',
  5: 'amr',
  6: 'silk',
  7: 'mp3',
  8: 'ogg',
}

export class WechatMediaStore {
  constructor(options) {
    this.options = options
  }

  /**
   * Download every media item in a complete inbound message.
   * A failing item does not abort the other items; failures carry `error`.
   */
  async downloadAll(raw, signal) {
    const targets = collectTargets(raw)
    if (targets.length === 0) return []
    const date = formatDate(messageTimestamp(raw))
    const results = []
    for (const target of targets) {
      if (signal?.aborted) break
      results.push(await this.downloadOne(raw, target, date, signal))
    }
    return results
  }

  async downloadOne(raw, target, date, signal) {
    const label = KIND_LABEL[target.kind] || target.kind
    const displayName = target.fileName
      ? sanitizeFileName(target.fileName, `file-${target.index}.bin`)
      : undefined
    try {
      const url = resolveUrl(target, this.options.cdnBaseUrl)
      if (!url) throw new Error('消息里没有可用的 CDN 下载参数')
      const ciphertext = await fetchBuffer(url, this.options.timeoutMs, signal)
      const plaintext = target.keyValue
        ? decryptAesEcb(ciphertext, parseAesKey(target.keyValue))
        : ciphertext
      if (this.options.maxBytes > 0 && plaintext.length > this.options.maxBytes) {
        throw new Error(`媒体超过大小限制（${formatBytes(plaintext.length)} > ${formatBytes(this.options.maxBytes)}）`)
      }
      const file = buildFileInfo(raw, target, plaintext, displayName)
      const dateDir = join(this.options.dir, date)
      await mkdir(dateDir, { recursive: true, mode: 0o700 })
      const localPath = join(dateDir, file.name)
      await writeFile(localPath, plaintext, { mode: 0o600 })
      return {
        kind: target.kind,
        fileName: displayName ?? file.name,
        size: plaintext.length,
        mimeType: file.mime,
        durationMs: target.durationMs,
        localPath,
        data: plaintext,
      }
    } catch (error) {
      return {
        kind: target.kind,
        fileName: displayName,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function collectTargets(raw) {
  const items = Array.isArray(raw.item_list) ? raw.item_list : []
  const targets = []
  items.forEach((item, index) => {
    const image = item.image_item
    if (item.type === 2 || (item.type === undefined && image)) {
      const media = image?.media ?? image?.thumb_media
      targets.push({
        kind: 'image',
        index,
        media,
        directUrl: image?.url,
        keyValue: image?.aeskey ?? media?.aes_key,
      })
      return
    }

    const voice = item.voice_item
    if (item.type === 3 || (item.type === undefined && voice)) {
      // Always archive the audio file. The Agent still receives only the
      // server-side transcript (voice_item.text); the audio is never attached
      // as a model file block.
      if (voice?.media !== undefined) {
        targets.push({
          kind: 'voice',
          index,
          media: voice.media,
          keyValue: voice.media?.aes_key,
          voiceEncodeType: voice?.encode_type,
        })
      }
      return
    }

    const file = item.file_item
    if (item.type === 4 || (item.type === undefined && file)) {
      targets.push({
        kind: 'file',
        index,
        media: file?.media,
        keyValue: file?.media?.aes_key,
        fileName: file?.file_name,
      })
      return
    }

    const video = item.video_item
    if (item.type === 5 || (item.type === undefined && video)) {
      targets.push({
        kind: 'video',
        index,
        media: video?.media,
        keyValue: video?.media?.aes_key,
        durationMs: normalizeVideoDuration(video?.play_length),
      })
    }
  })
  return targets
}

function resolveUrl(target, cdnBaseUrl) {
  const fullUrl = target.media?.full_url?.trim() || target.directUrl?.trim()
  if (fullUrl) {
    if (/^https?:\/\//i.test(fullUrl)) return fullUrl
    if (fullUrl.startsWith('/')) return new URL(fullUrl, cdnBaseUrl).toString()
  }
  const param = target.media?.encrypt_query_param
  if (param) return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(param)}`
  return undefined
}

async function fetchBuffer(url, timeoutMs, signal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`CDN 下载失败: HTTP ${response.status} ${response.statusText}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer
  } catch (error) {
    if (timedOut) throw new Error(`CDN 下载超时（${timeoutMs}ms）`)
    if (signal?.aborted) throw new Error('下载已取消')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function parseAesKey(value) {
  const trimmed = String(value).trim()
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  const decoded = Buffer.from(trimmed, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(`AES 密钥格式不支持（解码后 ${decoded.length} 字节）`)
}

function decryptAesEcb(ciphertext, key) {
  if (key.length !== 16) throw new Error(`AES-128 密钥长度必须是 16 字节，实际 ${key.length}`)
  if (ciphertext.length === 0) return ciphertext
  if (ciphertext.length % 16 !== 0) throw new Error(`AES 密文长度不是 16 的倍数（${ciphertext.length}）`)
  try {
    const decipher = createDecipheriv('aes-128-ecb', key, null)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (error) {
    throw new Error('AES-128-ECB 解密失败（密钥不匹配或数据损坏）', { cause: error })
  }
}

function buildFileInfo(raw, target, plaintext, displayName) {
  const messageId = sanitizeSegment(String(raw.message_id ?? raw.seq ?? Date.now()))
  if (target.kind === 'image') {
    const image = sniffImage(plaintext)
    return { name: `${messageId}-${target.index}.${image.ext}`, mime: image.mime }
  }
  if (target.kind === 'video') {
    return { name: `${messageId}-${target.index}.mp4`, mime: 'video/mp4' }
  }
  if (target.kind === 'voice') {
    const ext = VOICE_EXT_BY_ENCODE[target.voiceEncodeType] || 'silk'
    return { name: `${messageId}-${target.index}.${ext}`, mime: MIME_BY_EXT[`.${ext}`] || 'application/octet-stream' }
  }
  const original = displayName ?? `file-${target.index}.bin`
  return { name: `${messageId}-${target.index}-${original}`, mime: mimeFromName(original) }
}

function sniffImage(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (data.length >= 3 && data.subarray(0, 3).toString('ascii') === 'GIF') {
    return { ext: 'gif', mime: 'image/gif' }
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return { ext: 'bin', mime: 'application/octet-stream' }
}

function mimeFromName(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_BY_EXT[name.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

function sanitizeFileName(name, fallback) {
  const raw = basename(String(name).replace(/\\/g, '/'))
  const clean = raw.replace(/[\u0000-\u001f<>:"/\\|?*`]/g, '_').trim()
  if (!clean || clean === '.' || clean === '..') return fallback
  return clean.slice(0, 120)
}

function sanitizeSegment(value) {
  const clean = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  return clean || 'msg'
}

function normalizeVideoDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value < 1000 ? value * 1000 : value)
}

function messageTimestamp(raw) {
  const value = raw.create_time_ms
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  return Date.now()
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
