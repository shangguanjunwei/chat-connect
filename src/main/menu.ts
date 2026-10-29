import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { Language } from '../shared/types'

interface Labels {
  about: string
  settings: string
  restart: string
  openBrowser: string
  openLog: string
  openData: string
  reset: string
  quit: string
  file: string
  edit: string
  view: string
  window: string
  help: string
  docs: string
  repo: string
  reload: string
  devtools: string
  actualSize: string
  zoomIn: string
  zoomOut: string
  minimize: string
  zoom: string
  front: string
  close: string
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  selectAll: string
}

const DICTIONARIES: Record<Language, Labels> = {
  'zh-CN': {
    about: '关于 DSH Studio',
    settings: '设置…',
    restart: '重新启动本地服务',
    openBrowser: '在浏览器中打开',
    openLog: '打开服务日志',
    openData: '打开数据目录',
    reset: '重置应用配置…',
    quit: '退出 DSH Studio',
    file: '文件',
    edit: '编辑',
    view: '视图',
    window: '窗口',
    help: '帮助',
    docs: 'DeepSeek Harness 文档',
    repo: 'GitHub 项目主页',
    reload: '重新载入界面',
    devtools: '开发者工具',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    minimize: '最小化',
    zoom: '缩放',
    front: '前置全部窗口',
    close: '关闭窗口',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
  },
  'en-US': {
    about: 'About DSH Studio',
    settings: 'Settings…',
    restart: 'Restart Local Service',
    openBrowser: 'Open in Browser',
    openLog: 'Open Service Log',
    openData: 'Open Data Folder',
    reset: 'Reset App Configuration…',
    quit: 'Quit DSH Studio',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
    docs: 'DeepSeek Harness Documentation',
    repo: 'GitHub Repository',
    reload: 'Reload Interface',
    devtools: 'Developer Tools',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front',
    close: 'Close Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
  },
}

export interface MenuActions {
  openSettings: () => void
  restartServer: () => void
  openInBrowser: () => void
  openLog: () => void
  openDataDir: () => void
  reset: () => void
  quit: () => void
  openDocs: () => void
  openRepo: () => void
}

export function buildAppMenu(language: Language, actions: MenuActions): void {
  const labels = DICTIONARIES[language]
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { label: labels.about, role: 'about' },
            { type: 'separator' },
            {
              label: labels.settings,
              accelerator: 'CmdOrCtrl+,',
              click: actions.openSettings,
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { label: labels.quit, accelerator: 'Cmd+Q', click: actions.quit },
          ],
        },
      ]
    : []

  const fileMenu: MenuItemConstructorOptions = {
    label: labels.file,
    submenu: [
      {
        label: labels.settings,
        accelerator: 'CmdOrCtrl+,',
        click: actions.openSettings,
      },
      {
        label: labels.restart,
        accelerator: 'CmdOrCtrl+Shift+R',
        click: actions.restartServer,
      },
      { type: 'separator' },
      { label: labels.openBrowser, click: actions.openInBrowser },
      { label: labels.openLog, click: actions.openLog },
      { label: labels.openData, click: actions.openDataDir },
      { type: 'separator' },
      { label: labels.reset, click: actions.reset },
      ...(isMac
        ? ([{ type: 'separator' }, { role: 'close', label: labels.close }] as MenuItemConstructorOptions[])
        : ([
            { type: 'separator' },
            { label: labels.quit, accelerator: 'Ctrl+Q', click: actions.quit },
          ] as MenuItemConstructorOptions[])),
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    fileMenu,
    {
      label: labels.edit,
      submenu: [
        { label: labels.undo, role: 'undo' },
        { label: labels.redo, role: 'redo' },
        { type: 'separator' },
        { label: labels.cut, role: 'cut' },
        { label: labels.copy, role: 'copy' },
        { label: labels.paste, role: 'paste' },
        { label: labels.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: labels.view,
      submenu: [
        { label: labels.reload, role: 'reload' },
        { label: labels.devtools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: labels.actualSize, role: 'resetZoom' },
        { label: labels.zoomIn, role: 'zoomIn' },
        { label: labels.zoomOut, role: 'zoomOut' },
      ],
    },
    {
      label: labels.window,
      submenu: isMac
        ? [
            { label: labels.minimize, role: 'minimize' },
            { label: labels.zoom, role: 'zoom' },
            { type: 'separator' },
            { label: labels.front, role: 'front' },
          ]
        : [{ label: labels.minimize, role: 'minimize' }, { role: 'close' }],
    },
    {
      label: labels.help,
      submenu: [
        { label: labels.docs, click: actions.openDocs },
        { label: labels.repo, click: actions.openRepo },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function openDocumentation(): void {
  void shell.openExternal('https://deepseek-harness.github.io/deepseek-harness/')
}

export function openRepository(): void {
  void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')
}
