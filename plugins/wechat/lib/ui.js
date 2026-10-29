/**
 * Injected workspace panel for WeChat account management.
 *
 * The script is served from the DSH Web host and runs inside a shadow root so
 * the workspace's global CSS cannot collide with the panel. It talks only to
 * the same-origin `/wechat-api` control routes.
 */
export const WECHAT_UI_JS = String.raw`
(function () {
  if (window.__CHAT_CONNECT_WECHAT_UI__) return
  window.__CHAT_CONNECT_WECHAT_UI__ = true

  var tokenMeta = document.querySelector('meta[name="chat-connect-wechat-token"]')
  var langMeta = document.querySelector('meta[name="chat-connect-wechat-lang"]')
  var config = window.__CHAT_CONNECT_WECHAT__
  var token = (config && config.token) || (tokenMeta ? tokenMeta.getAttribute('content') : '')
  var lang = (langMeta && langMeta.getAttribute('content')) || document.documentElement.lang || navigator.language || ''
  var zh = lang.toLowerCase().indexOf('zh') === 0
  var text = zh
    ? {
        title: '微信连接',
        subtitle: '扫码接入微信；文字、图片、文件和语音转写自动进入 Agent',
        addPlaceholder: '账号备注，例如：爸爸',
        add: '添加微信账号',
        workspaceRoot: '工作区根目录',
        workspaceHint: '每个账号默认使用根目录下的账号子目录；单独设置过工作区的账号不受影响。',
        workspace: '工作区',
        workspacePrompt: '输入该账号的工作区绝对路径；留空恢复默认',
        workspaceRootPrompt: '输入微信工作区根目录的绝对路径',
        workspaceConfirm: '修改工作区会断开在线账号，并为受影响的账号使用新的 DSH session（旧 session 保留）。继续？',
        pendingAccount: '将账号「{label}」的工作区改为：',
        pendingRoot: '将微信工作区根目录改为：',
        pendingWarning: '修改后会断开在线账号，并使用新的 DSH session；旧 session 保留。',
        fullAccessHint: '微信会话固定使用完全权限（danger-full-access），不再询问审批；请只绑定可信微信。',
        save: '保存',
        reset: '默认',
        pickFolder: '选择目录',
        skills: '技能',
        confirmChange: '确认修改',
        cancel: '取消',
        empty: '还没有微信账号，先添加一个，再点「连接」扫码。',
        connect: '连接',
        disconnect: '断开',
        login: '重新扫码',
        rename: '改名',
        renamePrompt: '输入新的账号备注',
        remove: '删除',
        copy: '复制二维码链接',
        copied: '链接已复制',
        online: '在线',
        count: '个账号在线',
        messages: '条消息',
        noLogin: '未登录',
        loggedIn: '已登录',
        status: {
          idle: '未连接',
          waiting_qr: '等待扫码',
          scaned: '已扫码，等待确认',
          connecting: '连接中',
          online: '在线',
          error: '连接异常'
        },
        loginStatus: {
          wait: '请用微信扫描二维码',
          scaned: '已扫描，请在手机上确认',
          confirmed: '登录成功，正在连接…',
          expired: '二维码已过期',
          error: '获取二维码失败',
          none: '未开始扫码'
        },
        confirmDelete: '删除后该账号的登录凭据和游标会清除，聊天记录保留。继续？',
        close: '关闭'
      }
    : {
        title: 'WeChat',
        subtitle: 'Scan to connect; text, images, files and voice go to the Agent',
        addPlaceholder: 'Account label, e.g. Dad',
        add: 'Add WeChat account',
        workspaceRoot: 'Workspace root',
        workspaceHint: 'Each account uses a subfolder by default; accounts with a custom workspace are not affected.',
        workspace: 'Workspace',
        workspacePrompt: 'Absolute workspace path for this account; leave empty to use the default',
        workspaceRootPrompt: 'Absolute path for the WeChat workspace root',
        workspaceConfirm: 'Changing the workspace disconnects online accounts and starts a new DSH session for affected accounts (the old session is kept). Continue?',
        pendingAccount: 'Change the workspace for "{label}" to:',
        pendingRoot: 'Change the WeChat workspace root to:',
        pendingWarning: 'Online accounts will be disconnected and a new DSH session will be used; the old session is kept.',
        fullAccessHint: 'WeChat sessions use full access (danger-full-access) and never ask for approval. Only bind trusted WeChat accounts.',
        save: 'Save',
        reset: 'Default',
        pickFolder: 'Choose folder',
        skills: 'Skills',
        confirmChange: 'Confirm',
        cancel: 'Cancel',
        empty: 'No WeChat account yet. Add one, then click Connect to scan.',
        connect: 'Connect',
        disconnect: 'Disconnect',
        login: 'Scan again',
        rename: 'Rename',
        renamePrompt: 'New account label',
        remove: 'Remove',
        copy: 'Copy QR link',
        copied: 'Copied',
        online: 'Online',
        count: 'accounts online',
        messages: 'messages',
        noLogin: 'Not signed in',
        loggedIn: 'Signed in',
        status: {
          idle: 'Disconnected',
          waiting_qr: 'Waiting for scan',
          scaned: 'Scanned',
          connecting: 'Connecting',
          online: 'Online',
          error: 'Error'
        },
        loginStatus: {
          wait: 'Scan the QR code with WeChat',
          scaned: 'Scanned. Confirm on your phone.',
          confirmed: 'Signed in. Connecting…',
          expired: 'QR code expired',
          error: 'Could not get a QR code',
          none: 'Not started'
        },
        confirmDelete: 'This removes the saved credentials and cursor for this account. Chat logs are kept. Continue?',
        close: 'Close'
      }

  var state = {
    open: false,
    busy: '',
    error: '',
    accounts: [],
    online: 0,
    settings: null,
    rootInput: null,
    pending: null,
    pendingBox: null,
    pendingText: null,
    timer: null,
    launcher: null,
    overlay: null,
    list: null,
    addInput: null,
    errorBox: null,
    onlinePill: null,
    host: null,
    root: null
  }

  var CSS = [
    ':host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;font-size:13px;line-height:1.5;color:#111827}',
    ':host([data-theme="dark"]){color:#e8eeff}',
    '*{box-sizing:border-box}',
    '.ccw-launcher{pointer-events:auto;position:fixed;right:22px;bottom:22px;display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 15px 0 11px;border:0;border-radius:999px;background:linear-gradient(135deg,#07c160,#10a95a);color:#fff;font:inherit;font-size:12.5px;font-weight:600;box-shadow:0 10px 30px rgba(7,193,96,.36),0 2px 8px rgba(0,0,0,.18);cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}',
    '.ccw-launcher:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(7,193,96,.42),0 2px 8px rgba(0,0,0,.18)}',
    '.ccw-glyph{width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:12px;font-weight:700}',
    '.ccw-count{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#fff;color:#079b4f;font-size:10px;display:grid;place-items:center}',
    '.ccw-count[hidden]{display:none}',
    '.ccw-overlay{pointer-events:auto;position:fixed;inset:0;background:rgba(4,8,16,.48);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px}',
    '.ccw-overlay[hidden]{display:none}',
    '.ccw-panel{width:min(720px,94vw);max-height:min(82vh,760px);display:flex;flex-direction:column;overflow:hidden;border-radius:20px;border:1px solid rgba(148,163,184,.2);background:#fff;box-shadow:0 30px 90px rgba(0,0,0,.32)}',
    ':host([data-theme="dark"]) .ccw-panel{background:#15171d;border-color:rgba(148,163,184,.22);box-shadow:0 30px 90px rgba(0,0,0,.55)}',
    '.ccw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 16px;border-bottom:1px solid rgba(148,163,184,.16)}',
    '.ccw-head h2{margin:0 0 3px;font-size:18px;font-weight:650;letter-spacing:-.02em}',
    '.ccw-head p{margin:0;font-size:12px;color:#6b7280}',
    ':host([data-theme="dark"]) .ccw-head p{color:#98a4bd}',
    '.ccw-close{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#6b7280;font-size:18px;cursor:pointer;display:grid;place-items:center}',
    '.ccw-close:hover{background:rgba(148,163,184,.12);color:inherit}',
    '.ccw-body{padding:16px 22px 22px;overflow:auto}',
    '.ccw-add{display:flex;gap:10px;align-items:center;margin-bottom:14px}',
    '.ccw-add input,.ccw-settings input{flex:1;min-width:0;height:38px;padding:0 12px;border-radius:10px;border:1px solid rgba(148,163,184,.32);background:rgba(248,250,252,.8);color:inherit;font:inherit;font-size:12.5px;outline:0}',
    ':host([data-theme="dark"]) .ccw-add input,:host([data-theme="dark"]) .ccw-settings input{background:#0e1117;border-color:rgba(148,163,184,.24)}',
    '.ccw-add input:focus,.ccw-settings input:focus{border-color:#07c160;box-shadow:0 0 0 3px rgba(7,193,96,.14)}',
    '.ccw-btn{height:34px;padding:0 12px;border-radius:9px;border:1px solid rgba(148,163,184,.28);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.ccw-btn:hover{background:rgba(148,163,184,.12)}',
    '.ccw-btn[disabled]{opacity:.45;cursor:default}',
    '.ccw-btn.primary{background:#07c160;border-color:#07c160;color:#fff}',
    '.ccw-btn.primary:hover{background:#06ad56}',
    '.ccw-btn.danger{color:#dc2626;border-color:rgba(220,38,38,.28)}',
    ':host([data-theme="dark"]) .ccw-btn.danger{color:#fca5a5;border-color:rgba(248,113,113,.28)}',
    '.ccw-settings{margin-bottom:14px;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,.2);background:rgba(248,250,252,.45)}',
    ':host([data-theme="dark"]) .ccw-settings{background:rgba(255,255,255,.025);border-color:rgba(148,163,184,.18)}',
    '.ccw-settings-title{font-size:11px;font-weight:600;margin-bottom:7px;color:#374151}',
    ':host([data-theme="dark"]) .ccw-settings-title{color:#c7d2e5}',
    '.ccw-settings-row{display:flex;gap:8px;align-items:center}',
    '.ccw-hint{margin-top:6px;font-size:10px;line-height:1.45;color:#6b7280}',
    ':host([data-theme="dark"]) .ccw-hint{color:#98a4bd}',
    '.ccw-warn{color:#b45309}',
    ':host([data-theme="dark"]) .ccw-warn{color:#fcd34d}',
    '.ccw-workspace-path{margin-top:3px;font-size:10.5px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ':host([data-theme="dark"]) .ccw-workspace-path{color:#98a4bd}',
    '.ccw-confirm{margin-bottom:12px;padding:11px 12px;border-radius:12px;border:1px solid rgba(7,193,96,.35);background:rgba(7,193,96,.08)}',
    '.ccw-confirm-text{font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all}',
    '.ccw-confirm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:9px}',
    '.ccw-error{margin-bottom:12px;padding:10px 12px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.24);color:#b91c1c;font-size:11.5px;white-space:pre-wrap}',
    ':host([data-theme="dark"]) .ccw-error{color:#fecaca}',
    '.ccw-list{display:flex;flex-direction:column;gap:10px}',
    '.ccw-empty{padding:26px 12px;text-align:center;color:#6b7280;font-size:12.5px;border:1px dashed rgba(148,163,184,.32);border-radius:14px}',
    ':host([data-theme="dark"]) .ccw-empty{color:#98a4bd}',
    '.ccw-account{border:1px solid rgba(148,163,184,.22);border-radius:14px;padding:13px 14px;background:rgba(248,250,252,.55)}',
    ':host([data-theme="dark"]) .ccw-account{background:rgba(255,255,255,.025);border-color:rgba(148,163,184,.18)}',
    '.ccw-account-top{display:flex;align-items:center;gap:10px}',
    '.ccw-avatar{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#07c160,#22d3ee);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}',
    '.ccw-account-copy{flex:1;min-width:0}',
    '.ccw-account-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ccw-account-meta{margin-top:1px;font-size:10.5px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ':host([data-theme="dark"]) .ccw-account-meta{color:#98a4bd}',
    '.ccw-pill{flex:none;padding:3px 8px;border-radius:999px;font-size:10px;border:1px solid rgba(148,163,184,.24);color:#6b7280;background:rgba(148,163,184,.08)}',
    '.ccw-pill.online{color:#047857;border-color:rgba(5,150,105,.3);background:rgba(5,150,105,.1)}',
    ':host([data-theme="dark"]) .ccw-pill.online{color:#a7f3d0}',
    '.ccw-pill.warn{color:#b45309;border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.1)}',
    ':host([data-theme="dark"]) .ccw-pill.warn{color:#fcd34d}',
    '.ccw-pill.error{color:#b91c1c;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08)}',
    ':host([data-theme="dark"]) .ccw-pill.error{color:#fca5a5}',
    '.ccw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}',
    '.ccw-qr{margin-top:12px;padding:12px;border-radius:12px;border:1px solid rgba(148,163,184,.2);background:#fff;display:flex;flex-direction:column;align-items:center;gap:8px}',
    ':host([data-theme="dark"]) .ccw-qr{background:#0e1117;border-color:rgba(148,163,184,.18)}',
    '.ccw-qr img{width:210px;height:210px;display:block;border-radius:6px}',
    '.ccw-qr-note{font-size:11px;color:#6b7280;text-align:center;max-width:100%;word-break:break-all}',
    ':host([data-theme="dark"]) .ccw-qr-note{color:#98a4bd}',
    '.ccw-qr-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}',
    '.ccw-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 22px 16px;border-top:1px solid rgba(148,163,184,.14);font-size:11px;color:#6b7280}',
    ':host([data-theme="dark"]) .ccw-foot{color:#98a4bd}',
    '@media (max-width:640px){.ccw-overlay{padding:10px}.ccw-panel{max-height:92vh}.ccw-body{padding:14px 14px 18px}.ccw-head{padding:16px 16px 12px}.ccw-foot{padding:10px 16px 12px}}'
  ].join('\n')

  var HTML = [
    '<button class="ccw-launcher" type="button" title="' + text.title + '">',
    '  <span class="ccw-glyph">微</span><span>' + text.title + '</span><span class="ccw-count" hidden>0</span>',
    '</button>',
    '<div class="ccw-overlay" hidden>',
    '  <section class="ccw-panel" role="dialog" aria-modal="true" aria-label="' + text.title + '">',
    '    <header class="ccw-head">',
    '      <div><h2>' + text.title + '</h2><p>' + text.subtitle + '</p></div>',
    '      <button class="ccw-close" type="button" aria-label="' + text.close + '">×</button>',
    '    </header>',
    '    <div class="ccw-body">',
    '      <div class="ccw-add"><input type="text" maxlength="40" placeholder="' + text.addPlaceholder + '"><button class="ccw-btn primary" type="button" data-add>' + text.add + '</button></div>',
    '      <div class="ccw-settings">',
    '        <div class="ccw-settings-title">' + text.workspaceRoot + '</div>',
    '        <div class="ccw-settings-row"><input type="text" data-root placeholder="' + text.workspaceRootPrompt + '"><button class="ccw-btn" type="button" data-pick-root>' + text.pickFolder + '</button><button class="ccw-btn" type="button" data-save-root>' + text.save + '</button><button class="ccw-btn" type="button" data-reset-root>' + text.reset + '</button></div>',
    '        <div class="ccw-hint">' + text.workspaceHint + '</div>',
    '        <div class="ccw-hint ccw-warn">' + text.fullAccessHint + '</div>',
    '      </div>',
    '      <div class="ccw-error" hidden></div>',
    '      <div class="ccw-confirm" hidden><div class="ccw-confirm-text" data-pending-text></div><div class="ccw-confirm-actions"><button class="ccw-btn primary" type="button" data-confirm-workspace>' + text.confirmChange + '</button><button class="ccw-btn" type="button" data-cancel-workspace>' + text.cancel + '</button></div></div>',
    '      <div class="ccw-list"></div>',
    '    </div>',
    '    <footer class="ccw-foot"><span data-online></span><span>' + text.subtitle + '</span></footer>',
    '  </section>',
    '</div>'
  ].join('\n')

  function statusClass(status) {
    if (status === 'online') return 'online'
    if (status === 'error') return 'error'
    if (status === 'waiting_qr' || status === 'scaned' || status === 'connecting') return 'warn'
    return ''
  }

  function api(path, options) {
    var opts = options || {}
    var headers = { 'x-chat-connect-token': token }
    if (opts.body) headers['content-type'] = 'application/json'
    return fetch('/wechat-api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (response) {
      return response.text().then(function (body) {
        var data = {}
        try { data = body ? JSON.parse(body) : {} } catch (error) { data = {} }
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status))
        return data
      })
    })
  }

  function renderLauncher() {
    if (!state.launcher) return
    var count = state.launcher.querySelector('.ccw-count')
    if (!count) return
    if (state.online > 0) {
      count.hidden = false
      count.textContent = String(state.online)
    } else {
      count.hidden = true
    }
  }

  function applyState(data) {
    state.accounts = Array.isArray(data.accounts) ? data.accounts : []
    state.online = Number(data.online) || 0
    state.settings = data.settings || state.settings
    if (state.rootInput && state.settings && (!state.root || state.root.activeElement !== state.rootInput)) {
      state.rootInput.value = state.settings.workspaceRoot || ''
    }
    state.error = ''
    render()
  }

  function showError(message) {
    state.error = message
    if (state.errorBox) {
      state.errorBox.hidden = message === ''
      state.errorBox.textContent = message
    }
  }

  function render() {
    if (!state.list) return
    renderPending()
    state.host.setAttribute('data-theme', document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')
    renderLauncher()
    if (state.onlinePill) state.onlinePill.textContent = state.online + ' ' + text.count
    state.list.textContent = ''
    if (state.accounts.length === 0) {
      var empty = document.createElement('div')
      empty.className = 'ccw-empty'
      empty.textContent = text.empty
      state.list.appendChild(empty)
      return
    }
    for (var i = 0; i < state.accounts.length; i += 1) {
      state.list.appendChild(renderAccount(state.accounts[i]))
    }
  }

  function renderAccount(account) {
    var card = document.createElement('div')
    card.className = 'ccw-account'
    var top = document.createElement('div')
    top.className = 'ccw-account-top'
    var avatar = document.createElement('div')
    avatar.className = 'ccw-avatar'
    avatar.textContent = (account.label || '?').slice(0, 1)
    var copy = document.createElement('div')
    copy.className = 'ccw-account-copy'
    var name = document.createElement('div')
    name.className = 'ccw-account-name'
    name.textContent = account.label
    var meta = document.createElement('div')
    meta.className = 'ccw-account-meta'
    meta.textContent = (account.hasCredentials ? text.loggedIn : text.noLogin) + ' · ' + account.messageCount + ' ' + text.messages
    copy.appendChild(name)
    copy.appendChild(meta)
    var workspacePath = document.createElement('div')
    workspacePath.className = 'ccw-workspace-path'
    workspacePath.textContent = text.workspace + ': ' + (account.workspace || '')
    workspacePath.title = account.workspace || ''
    copy.appendChild(workspacePath)
    var skillPath = document.createElement('div')
    skillPath.className = 'ccw-workspace-path'
    skillPath.textContent = text.skills + ': ' + (account.skillPath || '')
    skillPath.title = account.skillPath || ''
    copy.appendChild(skillPath)
    var pill = document.createElement('span')
    pill.className = 'ccw-pill ' + statusClass(account.status)
    pill.textContent = text.status[account.status] || account.status
    top.appendChild(avatar)
    top.appendChild(copy)
    top.appendChild(pill)
    card.appendChild(top)

    var actions = document.createElement('div')
    actions.className = 'ccw-actions'
    var primary = document.createElement('button')
    primary.className = 'ccw-btn primary'
    primary.type = 'button'
    primary.setAttribute('data-action', account.status === 'online' ? 'disconnect' : 'connect')
    primary.setAttribute('data-id', account.id)
    primary.textContent = account.status === 'online' ? text.disconnect : text.connect
    if (state.busy === account.id) primary.disabled = true
    actions.appendChild(primary)
    if (account.status !== 'online') {
      var login = document.createElement('button')
      login.className = 'ccw-btn'
      login.type = 'button'
      login.setAttribute('data-action', 'login')
      login.setAttribute('data-id', account.id)
      login.textContent = text.login
      if (state.busy === account.id) login.disabled = true
      actions.appendChild(login)
    }
    var workspace = document.createElement('button')
    workspace.className = 'ccw-btn'
    workspace.type = 'button'
    workspace.setAttribute('data-action', 'workspace')
    workspace.setAttribute('data-id', account.id)
    workspace.textContent = text.workspace
    if (state.busy === account.id) workspace.disabled = true
    actions.appendChild(workspace)
    var skills = document.createElement('button')
    skills.className = 'ccw-btn'
    skills.type = 'button'
    skills.setAttribute('data-action', 'skills')
    skills.setAttribute('data-id', account.id)
    skills.setAttribute('title', account.skillPath || '')
    skills.textContent = text.skills
    if (state.busy === account.id) skills.disabled = true
    actions.appendChild(skills)
    if (account.customWorkspace) {
      var resetWs = document.createElement('button')
      resetWs.className = 'ccw-btn'
      resetWs.type = 'button'
      resetWs.setAttribute('data-action', 'reset-workspace')
      resetWs.setAttribute('data-id', account.id)
      resetWs.textContent = text.reset
      if (state.busy === account.id) resetWs.disabled = true
      actions.appendChild(resetWs)
    }
    var rename = document.createElement('button')
    rename.className = 'ccw-btn'
    rename.type = 'button'
    rename.setAttribute('data-action', 'rename')
    rename.setAttribute('data-id', account.id)
    rename.textContent = text.rename
    if (state.busy === account.id) rename.disabled = true
    actions.appendChild(rename)
    var remove = document.createElement('button')
    remove.className = 'ccw-btn danger'
    remove.type = 'button'
    remove.setAttribute('data-action', 'remove')
    remove.setAttribute('data-id', account.id)
    remove.textContent = text.remove
    if (state.busy === account.id) remove.disabled = true
    actions.appendChild(remove)
    card.appendChild(actions)

    if (account.login && account.login.image) {
      var qr = document.createElement('div')
      qr.className = 'ccw-qr'
      var image = document.createElement('img')
      image.src = account.login.image
      image.alt = text.title
      var note = document.createElement('div')
      note.className = 'ccw-qr-note'
      note.textContent = text.loginStatus[account.login.status] || account.login.status
      qr.appendChild(image)
      qr.appendChild(note)
      if (account.login.error) {
        var errorNote = document.createElement('div')
        errorNote.className = 'ccw-qr-note'
        errorNote.textContent = account.login.error
        qr.appendChild(errorNote)
      }
      var qrActions = document.createElement('div')
      qrActions.className = 'ccw-qr-actions'
      var copyButton = document.createElement('button')
      copyButton.className = 'ccw-btn'
      copyButton.type = 'button'
      copyButton.setAttribute('data-action', 'copy')
      copyButton.setAttribute('data-id', account.id)
      copyButton.setAttribute('data-content', account.login.content || '')
      copyButton.textContent = text.copy
      qrActions.appendChild(copyButton)
      if (account.login.status === 'expired' || account.login.status === 'error') {
        var retry = document.createElement('button')
        retry.className = 'ccw-btn primary'
        retry.type = 'button'
        retry.setAttribute('data-action', 'login')
        retry.setAttribute('data-id', account.id)
        retry.textContent = text.login
        qrActions.appendChild(retry)
      }
      qr.appendChild(qrActions)
      card.appendChild(qr)
    }
    if (account.lastError && account.status === 'error' && !(account.login && account.login.error)) {
      var error = document.createElement('div')
      error.className = 'ccw-error'
      error.textContent = account.lastError
      card.appendChild(error)
    }
    return card
  }

  async function refresh() {
    try {
      applyState(await api('/state'))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  async function run(accountId, action) {
    state.busy = accountId
    showError('')
    render()
    try {
      var result = await api('/accounts/' + encodeURIComponent(accountId) + '/' + action, { method: 'POST' })
      applyState(result)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
      void refresh()
    }
  }

  async function addAccount() {
    var label = state.addInput ? state.addInput.value.trim() : ''
    state.busy = 'add'
    showError('')
    try {
      var result = await api('/accounts', { method: 'POST', body: { label: label } })
      if (state.addInput) state.addInput.value = ''
      applyState(result)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  function renderPending() {
    if (!state.pendingBox) return
    if (!state.pending) {
      state.pendingBox.hidden = true
      return
    }
    state.pendingBox.hidden = false
    var pending = state.pending
    var head = pending.kind === 'root'
      ? text.pendingRoot
      : text.pendingAccount.replace('{label}', pending.label || '')
    if (state.pendingText) {
      state.pendingText.textContent = head + '\n' + pending.path + '\n\n' + text.pendingWarning
    }
  }

  function setPending(pending) {
    state.pending = pending
    renderPending()
  }

  function clearPending() {
    state.pending = null
    renderPending()
  }

  async function saveWorkspaceRoot(value, skipConfirm) {
    if (!state.settings) return
    if (!skipConfirm && state.online > 0 && value !== state.settings.workspaceRoot && !window.confirm(text.workspaceConfirm)) return
    state.busy = 'settings'
    showError('')
    try {
      applyState(await api('/settings', { method: 'PUT', body: { workspaceRoot: value } }))
      clearPending()
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  async function resetWorkspaceRoot() {
    if (!state.settings || !state.rootInput) return
    state.rootInput.value = state.settings.defaultWorkspaceRoot || ''
    await saveWorkspaceRoot(state.rootInput.value)
  }

  async function pickDirectory(kind, accountId, currentPath, online, label) {
    state.busy = kind === 'root' ? 'settings' : accountId
    showError('')
    render()
    try {
      var data = await api('/pick-directory', { method: 'POST' })
      if (!data || !data.path) return
      if (kind === 'root') {
        if (state.rootInput) state.rootInput.value = data.path
        setPending({ kind: 'root', path: data.path })
      } else {
        setPending({ kind: 'account', accountId: accountId, path: data.path, online: online, label: label })
      }
    } catch (error) {
      var message = error instanceof Error ? error.message : String(error)
      if (kind === 'account' && /原生|native|browse|目录选择器/i.test(message)) {
        var manual = window.prompt(text.workspacePrompt, currentPath || '')
        if (manual !== null) {
          setPending({ kind: 'account', accountId: accountId, path: manual.trim(), online: online, label: label })
        }
      } else {
        showError(message)
      }
    } finally {
      state.busy = ''
      render()
    }
  }

  async function resetAccountWorkspace(accountId, online) {
    if (online && !window.confirm(text.workspaceConfirm)) return
    state.busy = accountId
    showError('')
    try {
      applyState(await api('/accounts/' + encodeURIComponent(accountId), {
        method: 'PATCH',
        body: { workspace: '' },
      }))
      clearPending()
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  async function openSkills(accountId) {
    try {
      await api('/accounts/' + encodeURIComponent(accountId) + '/open-skills', { method: 'POST' })
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  async function confirmPending() {
    if (!state.pending) return
    var pending = state.pending
    if (pending.kind === 'root') {
      await saveWorkspaceRoot(pending.path, true)
      return
    }
    state.busy = pending.accountId
    showError('')
    try {
      applyState(await api('/accounts/' + encodeURIComponent(pending.accountId), {
        method: 'PATCH',
        body: { workspace: pending.path },
      }))
      clearPending()
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  function cancelPending() {
    if (state.pending && state.pending.kind === 'root' && state.rootInput && state.settings) {
      state.rootInput.value = state.settings.workspaceRoot || ''
    }
    clearPending()
  }

  async function renameAccount(accountId, currentLabel) {
    var next = window.prompt(text.renamePrompt, currentLabel || '')
    if (next === null) return
    var label = next.trim()
    if (!label) return
    state.busy = accountId
    showError('')
    try {
      applyState(await api('/accounts/' + encodeURIComponent(accountId), { method: 'PATCH', body: { label: label } }))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  async function removeAccount(accountId) {
    if (!window.confirm(text.confirmDelete)) return
    state.busy = accountId
    try {
      applyState(await api('/accounts/' + encodeURIComponent(accountId), { method: 'DELETE' }))
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = ''
      render()
    }
  }

  async function copyContent(button) {
    var content = button.getAttribute('data-content') || ''
    try {
      await navigator.clipboard.writeText(content)
      button.textContent = text.copied
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  function openPanel() {
    state.open = true
    state.overlay.hidden = false
    state.host.setAttribute('data-theme', document.body && document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')
    void refresh()
    if (state.timer === null) {
      state.timer = window.setInterval(function () {
        if (state.open) void refresh()
      }, 2500)
    }
  }

  function closePanel() {
    state.open = false
    state.overlay.hidden = true
    if (state.timer !== null) {
      window.clearInterval(state.timer)
      state.timer = null
    }
  }

  function boot() {
    if (document.getElementById('chat-connect-wechat-host')) return
    var host = document.createElement('div')
    host.id = 'chat-connect-wechat-host'
    document.body.appendChild(host)
    var root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<style>' + CSS + '</style>' + HTML
    state.host = host
    state.root = root
    state.launcher = root.querySelector('.ccw-launcher')
    state.overlay = root.querySelector('.ccw-overlay')
    state.list = root.querySelector('.ccw-list')
    state.addInput = root.querySelector('.ccw-add input')
    state.errorBox = root.querySelector('.ccw-error')
    state.onlinePill = root.querySelector('[data-online]')

    state.launcher.addEventListener('click', openPanel)
    root.querySelector('.ccw-close').addEventListener('click', closePanel)
    state.overlay.addEventListener('click', function (event) {
      if (event.target === state.overlay) closePanel()
    })
    root.querySelector('[data-add]').addEventListener('click', addAccount)
    state.rootInput = root.querySelector('[data-root]')
    state.pendingBox = root.querySelector('.ccw-confirm')
    state.pendingText = root.querySelector('[data-pending-text]')
    root.querySelector('[data-pick-root]').addEventListener('click', function () {
      void pickDirectory('root')
    })
    root.querySelector('[data-confirm-workspace]').addEventListener('click', function () {
      void confirmPending()
    })
    root.querySelector('[data-cancel-workspace]').addEventListener('click', function () {
      cancelPending()
    })
    root.querySelector('[data-save-root]').addEventListener('click', function () {
      if (state.rootInput) void saveWorkspaceRoot(state.rootInput.value.trim())
    })
    root.querySelector('[data-reset-root]').addEventListener('click', function () {
      void resetWorkspaceRoot()
    })
    state.rootInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') void saveWorkspaceRoot(state.rootInput.value.trim())
    })
    state.addInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') addAccount()
    })
    state.list.addEventListener('click', function (event) {
      var target = event.target
      var button = target && target.closest ? target.closest('button[data-action]') : null
      if (!button) return
      var action = button.getAttribute('data-action')
      var accountId = button.getAttribute('data-id')
      if (action === 'copy') { void copyContent(button); return }
      if (action === 'remove') { void removeAccount(accountId); return }
      if (action === 'rename') {
        var account = state.accounts.filter(function (item) { return item.id === accountId })[0]
        void renameAccount(accountId, account ? account.label : '')
        return
      }
      if (action === 'workspace') {
        var wsAccount = state.accounts.filter(function (item) { return item.id === accountId })[0]
        void pickDirectory(
          'account',
          accountId,
          wsAccount ? wsAccount.workspace : '',
          wsAccount ? wsAccount.status === 'online' : false,
          wsAccount ? wsAccount.label : ''
        )
        return
      }
      if (action === 'skills') {
        void openSkills(accountId)
        return
      }
      if (action === 'reset-workspace') {
        var resetAccount = state.accounts.filter(function (item) { return item.id === accountId })[0]
        void resetAccountWorkspace(accountId, resetAccount ? resetAccount.status === 'online' : false)
        return
      }
      if (action === 'connect' || action === 'disconnect' || action === 'login') {
        void run(accountId, action)
      }
    })
    state.overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePanel()
    })
    render()
    refresh()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
`
