import type { Language } from '../../shared/types'

const zh = {
  'brand.name': 'DSH Studio',
  'brand.tagline': 'DeepSeek Harness 桌面工作台',
  'brand.version': 'Harness {version}',
  'language.label': '语言',

  'common.next': '下一步',
  'common.back': '返回',
  'common.start': '开始',
  'common.retry': '重试',
  'common.close': '关闭',
  'common.browse': '浏览…',
  'common.optional': '可选',
  'common.advanced': '高级选项',
  'common.advancedHide': '收起高级选项',
  'common.docs': '使用文档',
  'common.log': '服务日志',
  'common.dataDir': '数据目录',
  'common.loading': '正在加载…',
  'common.show': '显示',
  'common.hide': '隐藏',

  'step.model.title': '模型',
  'step.model.desc': '连接 DeepSeek',
  'step.workspace.title': '工作区',
  'step.workspace.desc': '选择项目目录',
  'step.ready.title': '就绪',
  'step.ready.desc': '确认并启动',

  'model.heading': '配置模型',
  'model.subheading': '填写 DeepSeek API Key，密钥只会保存在这台电脑上。',
  'model.keyLabel': 'DeepSeek API Key',
  'model.keyPlaceholder': 'sk-…',
  'model.keySaved': '已保存 {preview}，留空表示保持不变',
  'model.keyHint': '在 DeepSeek 开放平台创建，并以仅本人可读的权限保存在本机。',
  'model.getKey': '获取 API Key',
  'model.test': '测试连接',
  'model.testing': '正在连接…',
  'model.testOk': '连接正常 · {ms} ms',
  'model.testOkModels': '连接正常 · {ms} ms · {count} 个模型',
  'model.testFail': '连接失败：{message}',
  'model.testHint': '也可以先保存，之后在工作台里再验证。',
  'model.baseUrlLabel': 'API 地址',
  'model.baseUrlHint': '留空使用官方地址 https://api.deepseek.com，仅在使用代理或兼容网关时修改。',
  'model.baseUrlInvalid': '请输入合法的 http(s) 地址',
  'model.keyRequired': '请填写 API Key',
  'model.keyInvalid': 'API Key 不能包含空格或换行',
  'model.keyTooShort': 'API Key 太短，请检查是否复制完整',

  'workspace.heading': '选择工作区',
  'workspace.subheading': 'Agent 会在这个文件夹里读写文件，首次启动时会自动出现在侧边栏。',
  'workspace.pathLabel': '项目文件夹',
  'workspace.pathHint': '会话、任务与文件改动都以这里为根目录。',
  'workspace.pathRequired': '请选择工作区文件夹',
  'workspace.pick': '选择文件夹',
  'workspace.dataLabel': 'Harness 数据目录',
  'workspace.dataHint': '会话、凭据与配置存放的位置。默认位于应用数据目录，与命令行版相互隔离。',
  'workspace.portLabel': '本地服务端口',
  'workspace.portHint': '0 表示自动选择空闲端口。',
  'workspace.portInvalid': '端口需要在 1024–65535 之间，或填写 0',
  'workspace.advanced': '高级选项',
  'workspace.advancedHide': '收起高级选项',

  'ready.heading': '一切就绪',
  'ready.subheading': '确认下面的配置，然后启动你的本地工作台。',
  'ready.model': '模型',
  'ready.endpoint': 'API 地址',
  'ready.workspace': '工作区',
  'ready.data': '数据目录',
  'ready.port': '端口',
  'ready.portAuto': '自动分配',
  'ready.key': 'API Key',
  'ready.keyNotSet': '未设置',
  'ready.launch': '启动工作台',
  'ready.note': '启动后，应用会在后台运行 DeepSeek Harness 本地服务，仅监听 127.0.0.1。',
  'ready.restartNote': '保存后会重启本地服务，正在运行的任务会中断。',

  'settings.heading': '应用设置',
  'settings.subheading': '修改配置后会重启本地服务。',
  'settings.apply': '保存并重启',
  'settings.reset': '重置应用配置…',
  'settings.note': '正在运行的任务会中断。',
  'settings.backToWorkspace': '返回工作台',

  'boot.heading': '正在启动工作台',
  'boot.subheading': '首次启动需要初始化 Harness 配置，通常只需要几秒钟。',
  'boot.preparing': '准备中…',
  'boot.elapsed': '已等待 {s} 秒',
  'boot.errorHeading': '启动失败',
  'boot.errorSub': '请检查下面的信息，或打开日志查看完整输出。',
  'boot.viewLog': '打开日志',
  'boot.edit': '修改配置',
  'boot.retry': '重试',
  'boot.hint': '本地服务仅监听 127.0.0.1，其他设备无法访问。',

  'footer.security': '密钥与数据只保存在本机',
  'footer.version': '版本 {version}',

  'test.missing-key': '请先填写 API Key',
  'test.unauthorized': 'API Key 无效或已过期',
  'test.not-found': '未找到 /models 接口，请检查 API 地址',
  'test.rate-limited': '请求过于频繁，请稍后再试',
  'test.timeout': '连接超时，请检查网络或代理',
  'test.network': '无法连接，请检查网络或 API 地址',
  'test.server': '服务暂时不可用',
  'test.bad-response': '返回内容无法识别',

  'error.runtime': '运行时不可用',
  'error.unexpected': '发生未知错误',
  'error.detail': '技术详情',
  'error.log': '日志位置',
} as const

export type MessageKey = keyof typeof zh

const en: Record<MessageKey, string> = {
  'brand.name': 'DSH Studio',
  'brand.tagline': 'DeepSeek Harness desktop workspace',
  'brand.version': 'Harness {version}',
  'language.label': 'Language',

  'common.next': 'Continue',
  'common.back': 'Back',
  'common.start': 'Start',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.browse': 'Browse…',
  'common.optional': 'Optional',
  'common.advanced': 'Advanced options',
  'common.advancedHide': 'Hide advanced options',
  'common.docs': 'Documentation',
  'common.log': 'Service log',
  'common.dataDir': 'Data folder',
  'common.loading': 'Loading…',
  'common.show': 'Show',
  'common.hide': 'Hide',

  'step.model.title': 'Model',
  'step.model.desc': 'Connect DeepSeek',
  'step.workspace.title': 'Workspace',
  'step.workspace.desc': 'Choose a project folder',
  'step.ready.title': 'Ready',
  'step.ready.desc': 'Review and launch',

  'model.heading': 'Configure the model',
  'model.subheading': 'Enter a DeepSeek API key. The key stays on this computer.',
  'model.keyLabel': 'DeepSeek API key',
  'model.keyPlaceholder': 'sk-…',
  'model.keySaved': 'Saved as {preview}. Leave blank to keep it.',
  'model.keyHint': 'Create one on the DeepSeek platform. It is stored in a file only you can read.',
  'model.getKey': 'Get an API key',
  'model.test': 'Test connection',
  'model.testing': 'Connecting…',
  'model.testOk': 'Connected · {ms} ms',
  'model.testOkModels': 'Connected · {ms} ms · {count} models',
  'model.testFail': 'Connection failed: {message}',
  'model.testHint': 'You can also save now and verify later inside the workspace.',
  'model.baseUrlLabel': 'API endpoint',
  'model.baseUrlHint':
    'Leave blank to use https://api.deepseek.com. Change it only for a proxy or compatible gateway.',
  'model.baseUrlInvalid': 'Enter a valid http(s) URL',
  'model.keyRequired': 'Enter an API key',
  'model.keyInvalid': 'The API key cannot contain spaces or line breaks',
  'model.keyTooShort': 'This key looks too short — check that you copied all of it',

  'workspace.heading': 'Choose a workspace',
  'workspace.subheading':
    'The agent reads and writes inside this folder. It appears in the sidebar on first launch.',
  'workspace.pathLabel': 'Project folder',
  'workspace.pathHint': 'Sessions, tasks, and file changes are rooted here.',
  'workspace.pathRequired': 'Choose a workspace folder',
  'workspace.pick': 'Choose folder',
  'workspace.dataLabel': 'Harness data folder',
  'workspace.dataHint':
    'Sessions, credentials, and configuration live here. The default is isolated from the CLI edition.',
  'workspace.portLabel': 'Local service port',
  'workspace.portHint': '0 picks a free port automatically.',
  'workspace.portInvalid': 'Use a port between 1024 and 65535, or 0',
  'workspace.advanced': 'Advanced options',
  'workspace.advancedHide': 'Hide advanced options',

  'ready.heading': 'Everything is ready',
  'ready.subheading': 'Review the configuration and launch your local workspace.',
  'ready.model': 'Model',
  'ready.endpoint': 'API endpoint',
  'ready.workspace': 'Workspace',
  'ready.data': 'Data folder',
  'ready.port': 'Port',
  'ready.portAuto': 'Automatic',
  'ready.key': 'API key',
  'ready.keyNotSet': 'Not set',
  'ready.launch': 'Launch workspace',
  'ready.note':
    'The app runs the DeepSeek Harness local service in the background, bound to 127.0.0.1 only.',
  'ready.restartNote': 'Saving restarts the local service and interrupts running tasks.',

  'settings.heading': 'App settings',
  'settings.subheading': 'Changing these settings restarts the local service.',
  'settings.apply': 'Save and restart',
  'settings.reset': 'Reset app configuration…',
  'settings.note': 'Running tasks will be interrupted.',
  'settings.backToWorkspace': 'Back to workspace',

  'boot.heading': 'Starting your workspace',
  'boot.subheading': 'The first launch initializes the Harness profile. This usually takes a moment.',
  'boot.preparing': 'Preparing…',
  'boot.elapsed': 'Waiting {s}s',
  'boot.errorHeading': 'Launch failed',
  'boot.errorSub': 'Check the message below, or open the log for the complete output.',
  'boot.viewLog': 'Open log',
  'boot.edit': 'Edit settings',
  'boot.retry': 'Retry',
  'boot.hint': 'The local service listens on 127.0.0.1 only — other devices cannot reach it.',

  'footer.security': 'Keys and data stay on this computer',
  'footer.version': 'Version {version}',

  'test.missing-key': 'Enter an API key first',
  'test.unauthorized': 'The API key is invalid or expired',
  'test.not-found': 'No /models endpoint found — check the API endpoint',
  'test.rate-limited': 'Too many requests — try again shortly',
  'test.timeout': 'Connection timed out — check your network or proxy',
  'test.network': 'Cannot connect — check your network or API endpoint',
  'test.server': 'The service is temporarily unavailable',
  'test.bad-response': 'The response could not be understood',

  'error.runtime': 'Runtime unavailable',
  'error.unexpected': 'Unexpected error',
  'error.detail': 'Technical details',
  'error.log': 'Log file',
}

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = {
  'zh-CN': zh,
  'en-US': en,
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

export function createTranslator(language: Language): Translate {
  const dictionary = DICTIONARIES[language] ?? zh
  return (key, vars) => {
    let text: string = dictionary[key] ?? zh[key] ?? key
    if (vars !== undefined) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

export function detectLanguage(value: string | null | undefined): Language {
  return (value ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}
