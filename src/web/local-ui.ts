function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderLocalWorkbenchHtml(requestToken: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="ming-workbench-token" content="${escapeHtml(requestToken)}">
  <title>Ming Workbench</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">MING WORKBENCH</p>
        <h1>把一句想法，变成看得见的工作。</h1>
        <p class="lede">先理解项目，再决定下一步。你不需要先学开发框架、执行工具或内部协议。</p>
      </div>
      <div class="status-pill" id="readiness-pill">正在准备…</div>
    </header>

    <section class="home-grid" aria-live="polite">
      <article class="card" id="project-summary-card">
        <p class="label">当前项目</p>
        <div id="project-summary">
          <p class="muted">还没有选择项目。</p>
        </div>
        <div class="card-actions">
          <button id="select-project-button" class="primary hidden" type="button">选择项目</button>
          <button id="switch-project-button" class="secondary hidden" type="button">更换项目</button>
        </div>
      </article>

      <article class="card" id="ai-summary-card">
        <p class="label">AI 模型</p>
        <div id="ai-summary">
          <p class="muted">尚未配置。</p>
        </div>
        <div class="card-actions">
          <button id="open-provider-button" class="secondary" type="button">配置 AI</button>
          <button id="test-connection-button" class="secondary hidden" type="button">测试连接</button>
        </div>
      </article>

      <article class="card span-two" id="readiness-card">
        <p class="label">运行准备</p>
        <ul class="checklist" id="readiness-checklist">
          <li data-item="project">项目可用</li>
          <li data-item="git">Git 可用</li>
          <li data-item="harness">Harness 已准备</li>
          <li data-item="ai">AI 已连接</li>
        </ul>
      </article>

      <article class="card span-two" id="next-step-card">
        <p class="label">下一步</p>
        <p class="next-step" id="next-step-text">选择一个项目开始。</p>
      </article>
    </section>

    <details class="intro card" id="how-it-works" open>
      <summary>Ming Workbench 是怎么工作的？</summary>
      <div class="intro-content">
        <p>你说目标 → Workbench 先理解项目 → 给你看准备做什么 → 你确认 → 它才动手 → 最后给你证据。</p>
        <p class="muted">在每一步确认之前，Workbench 不会修改你的任何文件。</p>
      </div>
    </details>

    <section class="request-card card">
      <label for="request" class="label">你现在想做什么？</label>
      <textarea id="request" rows="5" disabled placeholder="先完成上面的准备步骤，就可以开始…"></textarea>
      <div class="request-actions">
        <p class="muted" id="request-hint">这一步只会读取项目，不会修改任何文件。</p>
        <button id="intake-button" class="primary" type="button" disabled>开始理解</button>
      </div>
    </section>

    <section class="execute-card card hidden" id="execute-card" aria-live="polite">
      <p class="label">执行变更</p>
      <p class="muted" id="execute-message">只读理解已完成。请查看 Workbench 建议的修改范围。</p>
      <div class="execute-scope" id="execute-scope-area">
        <p class="muted">Workbench 正在分析建议的修改范围…</p>
      </div>
      <div class="execute-actions">
        <button id="execute-approve-button" class="primary" type="button" disabled>允许这次修改</button>
        <button id="execute-cancel-button" class="secondary" type="button">取消</button>
      </div>
      <p class="execute-status" id="execute-status"></p>
    </section>

    <section id="resume-card" class="resume-card card hidden" aria-live="polite">
      <p class="label">恢复工作</p>
      <p class="muted" id="resume-status">正在恢复上一次的工作单元…</p>
      <p class="resume-workunit-id" id="resume-workunit-id"></p>
    </section>

    <section id="notice" class="notice hidden" aria-live="polite"></section>

    <section id="result" class="result-grid hidden" aria-live="polite">
      <article class="card span-two">
        <p class="label">现在在做什么</p>
        <h2 id="work-title"></h2>
        <p id="work-outcome"></p>
      </article>

      <article class="card">
        <p class="label">当前状态</p>
        <div id="work-state" class="big-status"></div>
      </article>

      <article class="card">
        <p class="label">下一步</p>
        <p id="next-frontier"></p>
      </article>

      <article class="card span-two" id="human-gate-card">
        <p class="label">需要你吗？</p>
        <p id="human-gate"></p>
      </article>

      <article class="card span-two">
        <p class="label">我看到了什么</p>
        <ul id="evidence-list" class="evidence-list"></ul>
      </article>

      <article class="card span-two">
        <p class="label">项目理解</p>
        <p id="route-summary"></p>
        <ul id="project-evidence" class="evidence-list"></ul>
      </article>
    </section>

    <section id="update-notice" class="update-notice hidden" aria-live="polite">
      <div class="update-content">
        <p id="update-message"></p>
        <div class="update-actions">
          <button id="update-download-button" class="primary" type="button">下载更新</button>
          <button id="update-restart-button" class="primary hidden" type="button">重新启动并更新</button>
          <button id="update-later-button" class="secondary" type="button">稍后</button>
        </div>
      </div>
    </section>

    <details class="advanced card">
      <summary>更多信息</summary>
      <div id="advanced-content" class="advanced-content">当前没有需要你处理的技术信息。</div>
    </details>
  </main>

  <div id="provider-panel" class="panel-overlay hidden" aria-live="polite">
    <div class="panel card" role="dialog" aria-modal="true" aria-labelledby="provider-panel-title">
      <div class="panel-head">
        <div>
          <p class="label">配置 AI</p>
          <h2 id="provider-panel-title">连接你的模型服务</h2>
        </div>
        <button id="provider-panel-close" class="icon-button secondary" type="button" aria-label="关闭">✕</button>
      </div>

      <label class="field-label" for="provider-input">Provider</label>
      <input id="provider-input" type="text" list="provider-options" autocomplete="off" spellcheck="false" placeholder="deepseek-official" />
      <datalist id="provider-options">
        <option value="deepseek-official"></option>
      </datalist>

      <label class="field-label" for="model-input">模型</label>
      <input id="model-input" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-v4-pro" />
      <p class="field-hint">模型名称可以自己填写，Workbench 会原样交给模型服务。</p>

      <label class="field-label" for="provider-key-input">API Key</label>
      <input id="provider-key-input" type="password" autocomplete="off" placeholder="已保存的密钥会保留，留空表示不修改" />
      <p class="field-hint" id="provider-key-state">密钥只保存在本机系统安全存储中，Workbench 不会显示或记录它。</p>

      <details class="advanced-inline">
        <summary>高级设置</summary>
        <label class="field-label" for="base-url-input">Base URL（可选）</label>
        <input id="base-url-input" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com" />
      </details>

      <div class="panel-actions">
        <button id="provider-save-button" class="primary" type="button">保存</button>
        <button id="provider-test-button" class="secondary" type="button">测试连接</button>
        <button id="provider-clear-button" class="link-button hidden" type="button">移除已保存的密钥</button>
      </div>
      <p class="provider-status" id="provider-panel-status"></p>
    </div>
  </div>

  <script src="/app.js" type="module"></script>
</body>
</html>`
}

export const LOCAL_WORKBENCH_CSS = `
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #f5f7fb;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #ffffff 0, #f5f7fb 42%, #eef2f8 100%); }
button, textarea, input { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: wait; opacity: .55; }
.shell { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0 72px; }
.hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; }
.eyebrow, .label { margin: 0 0 8px; font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; color: #667085; }
h1 { max-width: 720px; margin: 0; font-size: clamp(36px, 7vw, 64px); line-height: 1.04; letter-spacing: -.045em; }
h2 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
p { line-height: 1.65; }
.lede { max-width: 680px; margin: 18px 0 0; color: #596579; font-size: 17px; }
.card { border: 1px solid rgba(116, 130, 154, .18); background: rgba(255,255,255,.88); box-shadow: 0 18px 60px rgba(43, 55, 78, .07); border-radius: 20px; padding: 22px; backdrop-filter: blur(16px); }
.home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 18px; }
.span-two { grid-column: span 2; }
.card-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.checklist { margin: 6px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
.checklist li { color: #43506a; }
.checklist li::before { content: "○"; margin-right: 8px; color: #a0aabd; }
.checklist li.ok { color: #19633f; }
.checklist li.ok::before { content: "✓"; color: #19633f; }
.checklist li.missing { color: #805b0a; }
.checklist li.missing::before { content: "•"; color: #805b0a; }
.next-step { margin: 0; font-size: 17px; font-weight: 700; color: #172033; }
.intro { margin-bottom: 18px; color: #596579; }
.intro summary { cursor: pointer; font-weight: 700; color: #364258; }
.intro-content { margin-top: 10px; }
.intro-content p { margin: 0 0 6px; }
.request-card { margin-bottom: 18px; }
textarea { width: 100%; resize: vertical; min-height: 132px; border: 1px solid #d8deea; border-radius: 14px; padding: 16px; outline: none; background: #fbfcfe; color: #172033; }
textarea:focus { border-color: #8da2c6; box-shadow: 0 0 0 4px rgba(103, 132, 184, .11); }
textarea:disabled { background: #f2f4f9; color: #8a94a8; cursor: not-allowed; }
.request-actions { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-top: 14px; }
.muted { color: #6c778b; margin: 8px 0 0; }
.primary, .secondary { border-radius: 12px; padding: 11px 16px; border: 1px solid transparent; font-weight: 700; white-space: nowrap; }
.primary { background: #172033; color: white; }
.secondary { background: white; color: #172033; border-color: #cfd7e5; }
.link-button { background: none; border: none; color: #963d35; font-weight: 700; padding: 6px 4px; }
.status-pill { flex: none; border-radius: 999px; padding: 9px 13px; background: #e8edf5; color: #43506a; font-size: 13px; font-weight: 700; }
.status-pill.ready { background: #e8f6ef; color: #19633f; }
.status-pill.setup { background: #fff5dc; color: #805b0a; }
.status-pill.blocked { background: #feeceb; color: #963d35; }
.notice { margin: 18px 0; border-radius: 16px; padding: 15px 17px; background: #fff7df; color: #6f5111; border: 1px solid #f1dfaa; }
.notice.error { background: #fff0ef; color: #8d3933; border-color: #efc8c5; }
.result-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.big-status { font-size: 22px; font-weight: 800; }
.evidence-list { margin: 8px 0 0; padding-left: 20px; color: #43506a; }
.evidence-list li + li { margin-top: 8px; }
.advanced { margin-top: 18px; color: #596579; }
.advanced summary { cursor: pointer; font-weight: 700; color: #364258; }
.advanced-content { margin-top: 12px; white-space: pre-wrap; }
.hidden { display: none !important; }
.update-notice { margin: 18px 0; border-radius: 16px; padding: 15px 17px; background: #e8f6ef; color: #19633f; border: 1px solid #b4e6cf; }
.update-content { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.update-actions { display: flex; gap: 8px; align-items: center; }
.panel-overlay { position: fixed; inset: 0; background: rgba(23, 32, 51, .42); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; z-index: 50; overflow-y: auto; }
.panel { width: min(520px, 100%); }
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.icon-button { border-radius: 999px; padding: 6px 10px; line-height: 1; }
.field-label { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: #667085; }
.field-hint { margin: 6px 0 0; font-size: 12px; color: #8a94a8; }
.panel input { width: 100%; padding: 11px 12px; border: 1px solid #d8deea; border-radius: 10px; background: #fbfcfe; color: #172033; outline: none; }
.panel input:focus { border-color: #8da2c6; box-shadow: 0 0 0 4px rgba(103, 132, 184, .11); }
.advanced-inline { margin-top: 14px; }
.advanced-inline summary { cursor: pointer; font-weight: 700; color: #364258; font-size: 13px; }
.panel-actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
.provider-status { margin: 12px 0 0; font-size: 13px; color: #43506a; }
.provider-status.ok { color: #19633f; }
.provider-status.error { color: #963d35; }
.execute-card { margin-top: 18px; }
.execute-actions { margin-top: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.execute-scope { margin: 12px 0; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
.execute-scope ul { margin: 6px 0 0; padding-left: 20px; color: #43506a; }
.execute-scope ul li + li { margin-top: 4px; }
.execute-status { margin: 10px 0 0; font-size: 13px; color: #43506a; }
.execute-status.ok { color: #19633f; }
.execute-status.error { color: #963d35; }
.resume-card { margin-bottom: 18px; }
.resume-status { margin: 8px 0 0; font-size: 13px; color: #43506a; }
.resume-status.ok { color: #19633f; }
.resume-status.changed { color: #805b0a; }
.resume-workunit-id { margin: 4px 0 0; font-size: 12px; color: #667085; font-family: ui-monospace, monospace; }
@media (max-width: 720px) {
  .shell { width: min(100% - 22px, 980px); padding-top: 28px; }
  .hero, .request-actions, .execute-actions { flex-direction: column; align-items: stretch; }
  .status-pill { align-self: flex-start; }
  .home-grid { grid-template-columns: 1fr; }
  .span-two { grid-column: span 1; }
  .request-actions .primary, .card-actions .primary, .card-actions .secondary { width: 100%; }
}
`

export const LOCAL_WORKBENCH_APP_JS = `
const token = document.querySelector('meta[name="ming-workbench-token"]')?.content || ''
const $ = (id) => document.getElementById(id)

const routeNames = {
  'idea-to-build': '从想法走向可验证实现',
  'repo-recovery': '先看清这个已有项目',
  'bug-fix': '定位并修复问题',
  'feature-change': '实现或调整功能',
  'understand-review': '理解、审查与判断',
  'release-operations': '发布与运行环境工作',
}
const stateNames = {
  intake: '正在理解',
  ready: '可以继续',
  running: '正在执行',
  'needs-human': '需要你决定一件事',
  blocked: '当前有阻塞',
  verifying: '正在验证',
  done: '已完成并有证据',
}

let currentWorkUnitId = null
let isDesktop = typeof window !== 'undefined' && window.mingWorkbench?.isDesktop === true
let currentProjectStatus = null
let currentProjectMessage = ''

const desktopState = {
  hasSecret: false,
  preferences: null,
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      'x-ming-workbench-token': token,
      ...(options.headers || {}),
    },
  })
  let body
  try { body = await response.json() } catch { body = { status: 'error', message: 'Workbench 返回了无法读取的结果。' } }
  return { response, body }
}

function setNotice(message = '', error = false) {
  const node = $('notice')
  if (!message) {
    node.className = 'notice hidden'
    node.textContent = ''
    return
  }
  node.className = error ? 'notice error' : 'notice'
  node.textContent = message
}

// Safe DOM rendering for the proposed mutation scope. Git filenames are
// project-controlled input and must be rendered as text only, never as HTML.
function renderProposedScope(proposed) {
  const scopeArea = $('execute-scope-area')
  const approveButton = $('execute-approve-button')
  while (scopeArea.firstChild) scopeArea.removeChild(scopeArea.firstChild)
  const items = (proposed && proposed.items) || []
  window.__mingProposedScope = items.map((item) => item.path)
  if (items.length === 0) {
    const note = document.createElement('p')
    note.className = 'muted'
    note.textContent = '我现在还不能确定安全的修改范围，需要再理解一下项目。'
    scopeArea.appendChild(note)
    const hint = document.createElement('p')
    hint.className = 'muted'
    hint.setAttribute('style', 'margin-top:8px;font-size:12px;')
    hint.textContent = '在确定修改范围之前，Workbench 只会保持只读，不会修改任何文件。'
    scopeArea.appendChild(hint)
    approveButton.disabled = true
    return
  }
  const intro = document.createElement('p')
  intro.className = 'muted'
  intro.textContent = 'Workbench 准备修改：'
  scopeArea.appendChild(intro)
  const list = document.createElement('ul')
  for (const item of items) {
    const li = document.createElement('li')
    li.textContent = item.path
    list.appendChild(li)
  }
  scopeArea.appendChild(list)
  const note = document.createElement('p')
  note.className = 'muted'
  note.setAttribute('style', 'margin-top:8px;font-size:12px;')
  note.textContent = '这是 Workbench 根据项目理解提出的建议范围，不是最终授权。确认后才会生成受边界约束的执行授权。'
  scopeArea.appendChild(note)
  approveButton.disabled = false
}

function renderProject(data) {
  const title = data.project?.title || '本地项目'
  $('project-title')?.setAttribute?.('data-title', title)
  const summary = $('project-summary')
  while (summary.firstChild) summary.removeChild(summary.firstChild)
  const name = document.createElement('h2')
  name.textContent = title
  summary.appendChild(name)
  if (data.projectPath) {
    const path = document.createElement('p')
    path.className = 'muted'
    path.setAttribute('style', 'word-break:break-all;')
    path.textContent = data.projectPath
    summary.appendChild(path)
  }
  $('advanced-content').textContent = data.aaopVersion
    ? '项目开发控制版本：' + data.aaopVersion
    : '当前没有需要你处理的技术信息。'
}

function renderReadiness(projectStatus, projectMessage) {
  const ready = projectStatus === 'ready' && desktopState.hasSecret
  const items = [
    ['project', projectStatus === 'ready' ? 'ok' : projectStatus === 'setup-required' ? 'missing' : 'missing', '项目可用'],
    ['git', projectStatus === 'ready' ? 'ok' : 'missing', 'Git 可用'],
    ['harness', projectStatus === 'ready' ? 'ok' : 'missing', 'Harness 已准备'],
    ['ai', desktopState.hasSecret ? 'ok' : 'missing', 'AI 已连接'],
  ]
  const list = $('readiness-checklist')
  list.innerHTML = ''
  for (const [key, state, label] of items) {
    const li = document.createElement('li')
    li.dataset.item = key
    li.className = state
    li.textContent = label
    list.appendChild(li)
  }

  const pill = $('readiness-pill')
  if (ready) {
    pill.textContent = '准备好了'
    pill.className = 'status-pill ready'
  } else {
    const missing = items.filter(([, state]) => state !== 'ok').length
    pill.textContent = '还差 ' + missing + ' 步'
    pill.className = 'status-pill setup'
  }

  const next = $('next-step-text')
  const request = $('request')
  const intake = $('intake-button')
  if (projectStatus === null) {
    next.textContent = '先选择一个你想交给 Ming Workbench 的项目。'
  } else if (projectStatus === 'setup-required') {
    next.textContent = '这个项目需要先启用，点击下方「启用这个项目」。'
  } else if (projectStatus === 'blocked') {
    next.textContent = projectMessage || 'Workbench 暂时不能安全接管这个项目。'
  } else if (!desktopState.hasSecret) {
    next.textContent = '还差 1 步：配置 AI。'
  } else {
    next.textContent = '准备好了。告诉我你现在想做什么。'
  }

  const canUse = ready
  request.disabled = !canUse
  intake.disabled = !canUse
  if (canUse) {
    request.placeholder = '例如：看看这个项目现在做到哪里了，接下来最应该先做什么？'
    $('request-hint').textContent = '这一步只会读取项目，不会修改任何文件。'
  } else {
    request.placeholder = '先完成上面的准备步骤，就可以开始…'
  }
}

function renderAiSummary() {
  const summary = $('ai-summary')
  while (summary.firstChild) summary.removeChild(summary.firstChild)
  const prefs = desktopState.preferences
  const modelLine = document.createElement('p')
  modelLine.setAttribute('style', 'font-weight:800;font-size:17px;margin:0;')
  modelLine.textContent = prefs && prefs.model ? prefs.model : '尚未配置'
  summary.appendChild(modelLine)
  const providerLine = document.createElement('p')
  providerLine.className = 'muted'
  providerLine.textContent = prefs && prefs.provider ? prefs.provider : ''
  summary.appendChild(providerLine)
  const status = document.createElement('p')
  status.className = 'muted'
  status.setAttribute('style', 'margin-top:8px;font-weight:700;')
  status.textContent = desktopState.hasSecret ? '🟢 已连接' : '未配置'
  status.style.color = desktopState.hasSecret ? '#19633f' : '#805b0a'
  summary.appendChild(status)

  $('test-connection-button').classList.toggle('hidden', !desktopState.hasSecret)
}

function renderSetupButton(projectStatus) {
  $('setup-button')?.remove?.()
  if (projectStatus !== 'setup-required') return
  const button = document.createElement('button')
  button.id = 'setup-button'
  button.className = 'primary'
  button.type = 'button'
  button.textContent = '启用这个项目'
  button.addEventListener('click', async () => {
    const ok = window.confirm('启用后，Workbench 会使用 AAOP 官方稳定版本为这个项目加入开发控制文件。不会因此修改业务功能，也不会自动安装第三方执行器。继续吗？')
    if (!ok) return
    button.disabled = true
    setNotice('正在启用项目，请稍候…')
    try {
      const { response, body } = await api('/api/setup', {
        method: 'POST',
        body: JSON.stringify({ authorize: true }),
      })
      if (!response.ok) {
        setNotice(body.message || '项目暂时没有启用成功，可以稍后重试。', true)
        return
      }
      setNotice('项目已启用。现在可以先让 Workbench 理解它。')
      await refreshProject()
    } finally {
      button.disabled = false
    }
  })
  const actions = $('project-summary-card').querySelector('.card-actions')
  actions.appendChild(button)
}

function renderWorkResult(data) {
  if (data.status === 'setup-required') {
    setNotice(data.setup?.summary || '这个项目需要先启用。')
    renderSetupButton('setup-required')
    return
  }
  if (data.status === 'blocked') {
    setNotice(data.blocker || '当前有一个阻塞需要先处理。', true)
    return
  }

  setNotice('')
  $('result').classList.remove('hidden')
  $('work-title').textContent = data.workUnit.title
  $('work-outcome').textContent = data.workUnit.outcome
  $('work-state').textContent = stateNames[data.workUnit.state] || data.workUnit.state
  $('next-frontier').textContent = data.workUnit.nextFrontier || '等待新的有效证据。'

  const gate = data.workUnit.gate
  $('human-gate').textContent = gate?.open
    ? (gate.summary || '这里有一件必须由你决定的事。')
    : '现在不需要你做技术选择，Workbench 可以继续。'

  const evidenceList = $('evidence-list')
  evidenceList.innerHTML = ''
  for (const evidence of data.workUnit.evidence || []) {
    const item = document.createElement('li')
    item.textContent = evidence.summary
    evidenceList.appendChild(item)
  }
  if (!evidenceList.children.length) {
    const item = document.createElement('li')
    item.textContent = '这一轮还没有足够的结果证据。'
    evidenceList.appendChild(item)
  }

  const route = data.intake?.route
  $('route-summary').textContent = route
    ? (routeNames[route] || '已根据当前证据选择下一条开发路径。')
    : '正在根据当前证据选择下一条开发路径。'
  const projectEvidence = $('project-evidence')
  projectEvidence.innerHTML = ''
  for (const evidence of data.intake?.projectEvidenceSummary || []) {
    const item = document.createElement('li')
    item.textContent = evidence
    projectEvidence.appendChild(item)
  }
}

function renderResume(data) {
  if (data.status === 'ok' && data.workUnit) {
    currentWorkUnitId = data.workUnit.id
    $('result').classList.remove('hidden')
    $('work-title').textContent = data.workUnit.title
    $('work-outcome').textContent = data.workUnit.outcome
    $('work-state').textContent = stateNames[data.workUnit.state] || data.workUnit.state
    $('next-frontier').textContent = data.workUnit.nextFrontier || '等待新的有效证据。'

    const gate = data.workUnit.gate
    $('human-gate').textContent = gate?.open
      ? (gate.summary || '这里有一件必须由你决定的事。')
      : '现在不需要你做技术选择，Workbench 可以继续。'

    const evidenceList = $('evidence-list')
    evidenceList.innerHTML = ''
    for (const evidence of data.workUnit.evidence || []) {
      const item = document.createElement('li')
      item.textContent = evidence.summary
      evidenceList.appendChild(item)
    }
    if (!evidenceList.children.length) {
      const item = document.createElement('li')
      item.textContent = '这一轮还没有足够的结果证据。'
      evidenceList.appendChild(item)
    }

    if (data.factsChanged) {
      setNotice('项目情况发生变化，Workbench 正在重新确认。旧的授权不能直接复用。', true)
      $('resume-status').textContent = '项目情况发生变化，需要重新确认。'
      $('resume-status').className = 'resume-status changed'
    } else {
      setNotice('已恢复上一次的工作单元。项目情况没有变化，可以继续。')
      $('resume-status').textContent = '项目情况没有变化，可以继续当前工作。'
      $('resume-status').className = 'resume-status ok'
    }
    $('resume-card').classList.remove('hidden')
    $('resume-workunit-id').textContent = data.workUnit.id

    // Show execute card only when gate is not open and facts unchanged.
    const executeCard = $('execute-card')
    if (!gate?.open && !data.factsChanged) {
      executeCard.classList.remove('hidden')
      renderProposedScope(data.proposedMutation)
    } else {
      executeCard.classList.add('hidden')
    }
  } else {
    $('resume-card').classList.add('hidden')
  }
}

async function refreshProject() {
  const { response, body } = await api('/api/project')
  if (!response.ok) {
    currentProjectStatus = null
    currentProjectMessage = body.message || '暂时无法读取项目状态。'
    renderReadiness(null, currentProjectMessage)
    setNotice(body.message || '暂时无法读取项目状态。', true)
    return
  }
  currentProjectStatus = body.status
  currentProjectMessage = body.message || ''
  renderProject(body)
  renderSetupButton(body.status)
  renderReadiness(body.status, currentProjectMessage)
}

async function loadResume() {
  const { response, body } = await api('/api/workunits')
  if (!response.ok) return
  if (body.workUnits && body.workUnits.length > 0) {
    const latest = body.workUnits[0]
    const { response: resumeRes, body: resumeBody } = await api('/api/resume', {
      method: 'POST',
      body: JSON.stringify({ workUnitId: latest.id }),
    })
    if (resumeRes.ok) {
      renderResume(resumeBody)
    }
  }
}

async function refreshDesktopState() {
  if (!isDesktop) return
  try {
    const { hasSecret } = await window.mingWorkbench.hasProviderSecret()
    desktopState.hasSecret = Boolean(hasSecret)
  } catch {
    desktopState.hasSecret = false
  }
  try {
    const prefs = await window.mingWorkbench.getProviderPreferences()
    if (prefs && prefs.ok) desktopState.preferences = prefs.preferences
  } catch {
    desktopState.preferences = null
  }
  renderAiSummary()
  renderReadiness(currentProjectStatus, currentProjectMessage)
}

function openProviderPanel() {
  const prefs = desktopState.preferences || {}
  $('provider-input').value = prefs.provider || 'deepseek-official'
  $('model-input').value = prefs.model || ''
  $('base-url-input').value = prefs.baseUrl || ''
  $('provider-key-input').value = ''
  $('provider-panel-status').textContent = desktopState.hasSecret ? '✓ 已保存密钥（留空保留）' : '尚未保存密钥'
  $('provider-panel-status').className = 'provider-status' + (desktopState.hasSecret ? ' ok' : '')
  $('provider-clear-button').classList.toggle('hidden', !desktopState.hasSecret)
  $('provider-panel').classList.remove('hidden')
  $('provider-key-input').focus()
}

function closeProviderPanel() {
  $('provider-panel').classList.add('hidden')
  $('provider-panel-status').textContent = ''
}

async function saveProviderConfig() {
  const button = $('provider-save-button')
  const status = $('provider-panel-status')
  const provider = $('provider-input').value.trim()
  const model = $('model-input').value.trim()
  const baseUrl = $('base-url-input').value.trim()
  const key = $('provider-key-input').value.trim()

  if (!provider) {
    status.textContent = '请填写 Provider。'
    status.className = 'provider-status error'
    return
  }
  if (!model) {
    status.textContent = '请填写模型名称。'
    status.className = 'provider-status error'
    return
  }

  button.disabled = true
  status.textContent = '正在保存并应用…'
  status.className = 'provider-status'
  try {
    if (key) {
      const saved = await window.mingWorkbench.setProviderSecret(key)
      if (!saved || !saved.ok) {
        status.textContent = '密钥保存失败，请稍后重试。'
        status.className = 'provider-status error'
        return
      }
    }
    const prefsRes = await window.mingWorkbench.setProviderPreferences({ provider, model, baseUrl })
    if (!prefsRes || !prefsRes.ok) {
      status.textContent = prefsRes?.message || '配置保存失败，请稍后重试。'
      status.className = 'provider-status error'
      return
    }
    status.textContent = '已保存。页面马上刷新，新的模型配置即将生效。'
    status.className = 'provider-status ok'
    // The main process restarts the backend with the new configuration; the
    // window reloads and the UI re-reads the persisted state.
    setTimeout(() => { window.location.reload() }, 600)
  } catch {
    status.textContent = '保存失败，请稍后重试。'
    status.className = 'provider-status error'
  } finally {
    button.disabled = false
  }
}

async function testProviderConnection() {
  const button = $('provider-test-button')
  const status = $('provider-panel-status')
  if (!desktopState.hasSecret) {
    status.textContent = '请先保存 API Key 再测试连接。'
    status.className = 'provider-status error'
    return
  }
  button.disabled = true
  status.textContent = '正在连接模型服务…'
  status.className = 'provider-status'
  try {
    const { response, body } = await api('/api/test-provider-connection', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!response.ok) {
      status.textContent = body.message || '连接测试没有完成。'
      status.className = 'provider-status error'
      return
    }
    if (body.ok) {
      status.textContent = '🟢 连接成功：' + (body.model || '') + '（' + (body.provider || '') + '）'
      status.className = 'provider-status ok'
    } else {
      status.textContent = '连接失败：' + (body.message || '未知原因。')
      status.className = 'provider-status error'
    }
  } catch {
    status.textContent = '连接测试失败：无法访问本地服务。'
    status.className = 'provider-status error'
  } finally {
    button.disabled = false
  }
}

async function clearProviderKey() {
  const ok = window.confirm('确定要移除已保存的 API Key 吗？移除后 AI 将无法连接。')
  if (!ok) return
  const status = $('provider-panel-status')
  status.textContent = '正在移除…'
  status.className = 'provider-status'
  try {
    await window.mingWorkbench.clearProviderSecret()
    desktopState.hasSecret = false
    status.textContent = '已移除。页面马上刷新。'
    status.className = 'provider-status ok'
    setTimeout(() => { window.location.reload() }, 600)
  } catch {
    status.textContent = '移除失败，请稍后重试。'
    status.className = 'provider-status error'
  }
}

async function switchProject() {
  const button = $('switch-project-button') || $('select-project-button')
  if (!button) return
  button.disabled = true
  try {
    const result = await window.mingWorkbench.selectProject()
    if (result && !result.canceled && result.url) {
      window.location.href = result.url
    }
  } finally {
    button.disabled = false
  }
}

$('select-project-button').addEventListener('click', switchProject)
$('switch-project-button').addEventListener('click', switchProject)
$('open-provider-button').addEventListener('click', openProviderPanel)
$('provider-panel-close').addEventListener('click', closeProviderPanel)
$('provider-save-button').addEventListener('click', saveProviderConfig)
$('provider-test-button').addEventListener('click', testProviderConnection)
$('provider-clear-button').addEventListener('click', clearProviderKey)
$('test-connection-button').addEventListener('click', () => {
  openProviderPanel()
  setTimeout(testProviderConnection, 50)
})
$('provider-panel').addEventListener('click', (event) => {
  if (event.target === $('provider-panel')) closeProviderPanel()
})

// First-run single-screen explanation: auto-open only once per browser profile.
try {
  if (localStorage.getItem('ming-workbench-intro-seen')) {
    $('how-it-works').open = false
  } else {
    localStorage.setItem('ming-workbench-intro-seen', '1')
  }
} catch {
  // localStorage may be unavailable; the intro simply stays open.
}

$('intake-button').addEventListener('click', async () => {
  const request = $('request').value.trim()
  if (!request) {
    setNotice('先告诉我你现在想完成什么。')
    $('request').focus()
    return
  }
  const button = $('intake-button')
  button.disabled = true
  setNotice('正在只读理解项目和你的目标…')
  try {
    const { response, body } = await api('/api/intake', {
      method: 'POST',
      body: JSON.stringify({ request }),
    })
    if (response.status === 503 && body.status === 'intake-unavailable') {
      setNotice(body.message || '当前无法完成理解。你的原话已保留，可以稍后重试。', true)
      return
    }
    if (!response.ok) {
      setNotice(body.message || '这一轮没有成功完成，可以稍后再试。', true)
      return
    }
    renderWorkResult(body)
    currentWorkUnitId = body.workUnit?.id || null
    const executeCard = $('execute-card')
    if (body.status === 'ready' && !body.workUnit?.gate?.open) {
      executeCard.classList.remove('hidden')
      renderProposedScope(body.proposedMutation)
    } else {
      executeCard.classList.add('hidden')
    }
    await refreshProject()
  } finally {
    button.disabled = false
  }
})

$('execute-approve-button').addEventListener('click', async () => {
  const button = $('execute-approve-button')
  const status = $('execute-status')
  if (!currentWorkUnitId) {
    status.textContent = '请先完成项目理解。'
    status.className = 'execute-status error'
    return
  }
  const filePaths = window.__mingProposedScope || []
  if (filePaths.length === 0) {
    status.textContent = 'Workbench 尚未确定安全的修改范围，请稍后再试。'
    status.className = 'execute-status error'
    return
  }
  const ok = window.confirm('Workbench 准备修改以下文件：\n\n  ' + filePaths.join('\n  ') + '\n\n确认允许这次修改吗？')
  if (!ok) return
  button.disabled = true
  $('execute-cancel-button').disabled = true
  status.textContent = '正在请求执行授权…'
  status.className = 'execute-status'
  try {
    const authRes = await api('/api/authorize', {
      method: 'POST',
      body: JSON.stringify({
        workUnitId: currentWorkUnitId,
        authorize: true,
        filePaths,
      }),
    })
    if (!authRes.response.ok) {
      status.textContent = authRes.body.message || '授权失败。'
      status.className = 'execute-status error'
      return
    }
    status.textContent = '授权已获取，正在执行…'
    const execRes = await api('/api/execute', {
      method: 'POST',
      body: JSON.stringify({ workUnitId: currentWorkUnitId }),
    })
    if (!execRes.response.ok) {
      status.textContent = execRes.body?.message || '执行失败。'
      status.className = 'execute-status error'
      return
    }
    const execBody = execRes.body
    currentWorkUnitId = execBody.workUnit?.id || currentWorkUnitId
    renderWorkResult({
      status: 'executed',
      workUnit: execBody.workUnit,
      intake: { route: null, projectEvidenceSummary: [] },
    })
    status.textContent = '执行完成。请查看下方证据。'
    status.className = 'execute-status ok'
    await refreshProject()
  } finally {
    button.disabled = false
    $('execute-cancel-button').disabled = false
  }
})

$('execute-cancel-button').addEventListener('click', () => {
  $('execute-card').classList.add('hidden')
  $('execute-status').textContent = ''
})

if (isDesktop) {
  // Auto-update UI
  if (window.mingWorkbench?.onUpdateAvailable) {
    window.mingWorkbench.onUpdateAvailable((info) => {
      const notice = $('update-notice')
      const msg = $('update-message')
      msg.textContent = '发现新版本 ' + info.version + '。'
      $('update-download-button').classList.remove('hidden')
      $('update-restart-button').classList.add('hidden')
      notice.classList.remove('hidden')
    })
  }
  if (window.mingWorkbench?.onUpdateReady) {
    window.mingWorkbench.onUpdateReady((info) => {
      const notice = $('update-notice')
      const msg = $('update-message')
      msg.textContent = '新版本 ' + info.version + ' 已经准备好。'
      $('update-download-button').classList.add('hidden')
      $('update-restart-button').classList.remove('hidden')
      notice.classList.remove('hidden')
    })
  }
  if (window.mingWorkbench?.onUpdateProgress) {
    window.mingWorkbench.onUpdateProgress((info) => {
      const msg = $('update-message')
      msg.textContent = '正在下载更新… ' + Math.round(info.percent) + '%'
    })
  }
  if ($('update-download-button')) {
    $('update-download-button').addEventListener('click', async () => {
      $('update-download-button').disabled = true
      await window.mingWorkbench?.downloadUpdate()
    })
  }
  if ($('update-restart-button')) {
    $('update-restart-button').addEventListener('click', async () => {
      await window.mingWorkbench?.installUpdate()
    })
  }
  if ($('update-later-button')) {
    $('update-later-button').addEventListener('click', () => {
      $('update-notice').classList.add('hidden')
    })
  }
}

refreshProject().catch(() => setNotice('暂时无法读取项目状态。', true))
loadResume().catch(() => {})
if (isDesktop) {
  refreshDesktopState().catch(() => {})
}
`
