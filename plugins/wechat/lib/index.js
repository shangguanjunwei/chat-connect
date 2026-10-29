import Schema from '@deepseek-ai/schemastery'
import { WechatService } from './service.js'

export const name = 'chat-connect-wechat'
export const inject = ['agents', 'agentDefaultModel', 'webServer', 'attachments']

export const Config = Schema.object({
  dataDir: Schema.string().default('./.data'),
  workspaceRoot: Schema.string().default(''),
  baseUrl: Schema.string().default('https://ilinkai.weixin.qq.com'),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  autoReply: Schema.boolean().default(true),
  cdnBaseUrl: Schema.string().default('https://novac2c.cdn.weixin.qq.com/c2c'),
  mediaMaxBytes: Schema.number().default(100 * 1024 * 1024),
  mediaTimeoutMs: Schema.number().default(60_000),
})

export function apply(ctx, config) {
  const service = new WechatService(ctx, {
    ...config,
    workspaceRoot: config.workspaceRoot || '',
  })
  ctx.effect(() => {
    void service.install().catch((error) => {
      ctx.logger.error(
        `Chat Connect 微信插件启动失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return () => service.dispose()
  }, 'chat-connect-wechat')
}
