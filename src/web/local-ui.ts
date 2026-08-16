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
          <p class="muted" id="project-empty-text">还没有选择项目。</p>
        </div>
        <div class="card-actions">
          <button id="select-project-button" class="primary" type="button">选择项目</button>
          <button id="switch-project-button" class="secondary hidden" type="button">更换项目</button>
        </div>
      </article>

      <article class="card" id="ai-summary-card">
        <p class="label">AI 智能服务</p>
        <div id="ai-summary">
          <p class="muted">尚未配置。</p>
        </div>
        <div class="card-actions">
          <button id="open-provider-button" class="primary" type="button">配置 AI</button>
          <button id="test-connection-button" class="secondary hidden" type="button">测试连接</button>
        </div>
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

    <section id="boot-failure" class="notice error hidden" aria-live="polite">
      <p><strong>Workbench 没有完成启动。</strong></p>
      <p class="muted">页面没能和本地服务正常连接，请重新加载。如果仍然不行，重新选择项目。</p>
      <div class="card-actions">
        <button id="boot-reload-button" class="secondary" type="button">重新加载</button>
        <button id="boot-reselect-button" class="secondary hidden" type="button">重新选择项目</button>
      </div>
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
      <div id="diagnostics-content" class="advanced-content hidden"></div>
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

      <label class="field-label" for="provider-kind-select">模型服务</label>
      <select id="provider-kind-select">
        <option value="deepseek">DeepSeek 官方</option>
        <option value="custom">自定义（OpenAI 接口兼容）</option>
      </select>
      <p class="field-hint">选「自定义」可以使用任何 OpenAI 接口兼容的模型服务（SenseNova、StepFun、GLM 等）。</p>

      <label class="field-label hidden" for="base-url-input">接口地址（Base URL）</label>
      <input id="base-url-input" type="text" class="hidden" autocomplete="off" spellcheck="false" placeholder="https://token.sensenova.cn/v1" />
      <p class="field-hint hidden" id="base-url-hint">填到 /v1 这一级，例如 https://token.sensenova.cn/v1</p>

      <label class="field-label" for="model-input">模型</label>
      <input id="model-input" type="text" list="model-options" autocomplete="off" spellcheck="false" placeholder="deepseek-v4-pro" />
      <datalist id="model-options">
        <option value="deepseek-v4-pro"></option>
        <option value="deepseek-chat"></option>
      </datalist>
      <p class="field-hint">模型名称可以自己填写，Workbench 会原样交给模型服务。</p>

      <label class="field-label" for="provider-key-input">API Key</label>
      <input id="provider-key-input" type="password" autocomplete="off" placeholder="已保存的密钥会保留，留空表示不修改" />
      <p class="field-hint" id="provider-key-state">API Key 在 DeepSeek 开放平台（platform.deepseek.com）的「API Keys」页面创建。密钥只保存在本机系统安全存储中，Workbench 不会显示或记录它。</p>

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
.path-text { word-break: break-all; }
.model-line { font-weight: 800; font-size: 17px; margin: 0; }
.hint-line { margin-top: 8px; font-size: 12px; }
.ai-status-line { margin-top: 8px; font-weight: 700; }
.ai-status-line.ok { color: #19633f; }
.ai-status-line.warn { color: #805b0a; }
.ai-status-line.err { color: #963d35; }
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
let currentProjectPath = ''
let booted = false

const desktopState = {
  hasSecret: false,
  preferences: null,
  // AI truth model: hasSecret only means "已配置，待测试". Only a real
  // provider round trip may set 'connected'.
  aiStatus: 'unconfigured', // unconfigured | configured-untested | testing | connected | failed
  aiFailure: '',
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
    hint.className = 'muted hint-line'
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
  note.className = 'muted hint-line'
  note.textContent = '这是 Workbench 根据项目理解提出的建议范围，不是最终授权。确认后才会生成受边界约束的执行授权。'
  scopeArea.appendChild(note)
  approveButton.disabled = false
}

function renderProject(data) {
  const title = data.project?.title || '本地项目'
  const summary = $('project-summary')
  while (summary.firstChild) summary.removeChild(summary.firstChild)
  const name = document.createElement('h2')
  name.textContent = title
  summary.appendChild(name)
  if (data.projectPath) {
    currentProjectPath = data.projectPath
    const path = document.createElement('p')
    path.className = 'muted path-text'
    path.textContent = data.projectPath
    summary.appendChild(path)
  }
  $('advanced-content').textContent = data.aaopVersion
    ? '项目开发控制版本：' + data.aaopVersion
    : '当前没有需要你处理的技术信息。'
}

// Hard product invariant: whenever there is no usable selected project the
// [选择项目] button must be visible; with a project, [更换项目] is visible.
// No static shell may tell the user to pick a project without a button.
function renderProjectButtons(hasProject) {
  $('select-project-button').classList.toggle('hidden', Boolean(hasProject))
  $('switch-project-button').classList.toggle('hidden', !hasProject)
  // renderProject() clears #project-summary including the empty-text node;
  // once a project is rendered there is nothing left to toggle.
  $('project-empty-text')?.classList.toggle('hidden', Boolean(hasProject))
}

function renderGate() {
  const hasProject = currentProjectStatus === 'ready' || currentProjectStatus === 'setup-required'
  renderProjectButtons(hasProject)

  const pill = $('readiness-pill')
  const ai = desktopState.aiStatus

  // Single dominant next action (one CTA at a time).
  if (!hasProject) {
    pill.textContent = '先选择项目'
    pill.className = 'status-pill setup'
  } else if (ai === 'unconfigured') {
    pill.textContent = '需要配置 AI'
    pill.className = 'status-pill setup'
  } else if (ai === 'configured-untested') {
    pill.textContent = '待测试连接'
    pill.className = 'status-pill setup'
  } else if (ai === 'testing') {
    pill.textContent = '正在测试连接…'
    pill.className = 'status-pill setup'
  } else if (ai === 'failed') {
    pill.textContent = '连接失败'
    pill.className = 'status-pill blocked'
  } else {
    pill.textContent = '准备好了'
    pill.className = 'status-pill ready'
  }

  const ready = hasProject && ai === 'connected'
  const request = $('request')
  const intake = $('intake-button')
  request.disabled = !ready
  intake.disabled = !ready
  if (ready) {
    request.placeholder = '例如：看看这个项目现在做到哪里了，接下来最应该先做什么？'
    $('request-hint').textContent = '这一步只会读取项目，不会修改任何文件。'
  } else if (!hasProject) {
    request.placeholder = '先点击「选择项目」，选好后就这里告诉我你想做什么…'
  } else if (ai === 'unconfigured') {
    request.placeholder = '先点击「配置 AI」填好模型和 API Key，就可以开始了…'
  } else if (ai === 'failed') {
    request.placeholder = 'AI 连接失败，请打开「配置 AI」检查 API Key 后重新测试…'
  } else {
    request.placeholder = 'AI 已配置好，点击「测试连接」确认能用后即可开始…'
  }
  renderDiagnostics()
}

function renderDiagnostics() {
  const box = $('diagnostics-content')
  box.classList.remove('hidden')
  const lines = []
  lines.push('项目状态：' + (currentProjectStatus ?? '未知'))
  if (currentProjectPath) lines.push('项目路径：' + currentProjectPath)
  if (currentProjectMessage) lines.push('项目信息：' + currentProjectMessage)
  lines.push('AI 状态：' + desktopState.aiStatus)
  if (desktopState.preferences) lines.push('模型服务：' + providerLabel(desktopState.preferences))
  if (desktopState.preferences?.model) lines.push('模型：' + desktopState.preferences.model)
  box.textContent = lines.join('\\n')
}

function providerLabel(prefs) {
  if (!prefs) return ''
  if (prefs.baseUrl) {
    try {
      return '自定义 · ' + new URL(prefs.baseUrl).host
    } catch {
      return '自定义'
    }
  }
  return 'DeepSeek 官方'
}

function renderAiSummary() {
  const summary = $('ai-summary')
  while (summary.firstChild) summary.removeChild(summary.firstChild)
  const prefs = desktopState.preferences
  const modelLine = document.createElement('p')
  modelLine.className = 'model-line'
  modelLine.textContent = prefs && prefs.model ? prefs.model : '尚未配置'
  summary.appendChild(modelLine)
  const providerLine = document.createElement('p')
  providerLine.className = 'muted'
  providerLine.textContent = providerLabel(prefs)
  summary.appendChild(providerLine)
  const status = document.createElement('p')
  status.className = 'muted ai-status-line'
  const ai = desktopState.aiStatus
  if (ai === 'unconfigured') {
    status.textContent = '未配置'
    status.classList.add('warn')
  } else if (ai === 'configured-untested') {
    status.textContent = '已配置，待测试'
    status.classList.add('warn')
  } else if (ai === 'testing') {
    status.textContent = '正在测试连接…'
  } else if (ai === 'failed') {
    status.textContent = '连接失败'
    status.classList.add('err')
  } else {
    status.textContent = '🟢 连接成功'
    status.classList.add('ok')
  }
  summary.appendChild(status)

  $('test-connection-button').classList.toggle(
    'hidden',
    !(desktopState.hasSecret && ai !== 'testing'),
  )
  // Dominant CTA: with a project and no connection proof, [配置 AI] leads;
  // once a secret exists the panel's [测试连接] is one click away either way.
  $('open-provider-button').classList.toggle('primary', ai !== 'connected')
  $('open-provider-button').classList.toggle('secondary', ai === 'connected')
  renderGate()
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
    const ok = window.confirm('启用后，Workbench 会为这个项目加入开发控制文件（用于理解项目结构、划定安全边界）。不会修改业务功能，也不会自动安装第三方执行器。继续吗？')
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
  booted = true
  const { response, body } = await api('/api/project')
  if (!response.ok) {
    currentProjectStatus = null
    currentProjectMessage = body.message || '暂时无法读取项目状态。'
    setNotice(body.message || '暂时无法读取项目状态。', true)
    renderGate()
    return
  }
  currentProjectStatus = body.status
  currentProjectMessage = body.message || ''
  renderProject(body)
  renderSetupButton(body.status)
  renderGate()
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
  booted = true
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
  // hasSecret only proves "已配置，待测试". A previous session's connection
  // proof cannot be reused across processes, so restart never claims 已连接.
  desktopState.aiStatus = desktopState.hasSecret ? 'configured-untested' : 'unconfigured'
  renderAiSummary()
  renderGate()
}

function providerKindFromPrefs(prefs) {
  return prefs && prefs.baseUrl ? 'custom' : 'deepseek'
}

function applyProviderKind(kind) {
  const custom = kind === 'custom'
  for (const id of ['base-url-input']) {
    $(id).classList.toggle('hidden', !custom)
  }
  document.querySelector('label[for="base-url-input"]')?.classList.toggle('hidden', !custom)
  $('base-url-hint').classList.toggle('hidden', !custom)
  $('model-input').placeholder = custom ? '例如 glm-5.2 / step-3.7-flash / sensenova-6.8-flash-lite' : 'deepseek-v4-pro'
}

function openProviderPanel() {
  const prefs = desktopState.preferences || {}
  $('provider-kind-select').value = providerKindFromPrefs(prefs)
  applyProviderKind($('provider-kind-select').value)
  $('base-url-input').value = prefs.baseUrl || ''
  $('model-input').value = prefs.model || ''
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
  const kind = $('provider-kind-select').value
  const baseUrl = kind === 'custom' ? $('base-url-input').value.trim() : ''
  const model = $('model-input').value.trim()
  const key = $('provider-key-input').value.trim()

  if (kind === 'custom' && !/^https?:\\/\\//i.test(baseUrl)) {
    status.textContent = '自定义服务需要填写接口地址（以 http:// 或 https:// 开头）。'
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
    const prefsRes = await window.mingWorkbench.setProviderPreferences({
      provider: 'deepseek-official',
      model,
      baseUrl,
    })
    if (!prefsRes || !prefsRes.ok) {
      status.textContent = prefsRes?.message || '配置保存失败，请稍后重试。'
      status.className = 'provider-status error'
      return
    }
    // Saving a configuration only proves it is stored; it never claims the
    // AI is connected. The user must run a real connection test.
    desktopState.hasSecret = desktopState.hasSecret || Boolean(key)
    desktopState.preferences = { provider: 'deepseek-official', model, baseUrl }
    desktopState.aiStatus = desktopState.hasSecret ? 'configured-untested' : 'unconfigured'
    status.textContent = '已保存。现在点击「测试连接」确认 AI 真的能用。'
    status.className = 'provider-status ok'
    renderAiSummary()
    renderGate()
  } catch {
    status.textContent = '保存失败，请稍后重试。'
    status.className = 'provider-status error'
  } finally {
    button.disabled = false
  }
}

function reportAiTest(message, ok) {
  const panelOpen = !$('provider-panel').classList.contains('hidden')
  const status = $('provider-panel-status')
  status.textContent = message
  status.className = 'provider-status' + (ok ? ' ok' : ' error')
  if (!panelOpen) setNotice(message, !ok)
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
  desktopState.aiStatus = 'testing'
  status.textContent = '正在连接模型服务…'
  status.className = 'provider-status'
  renderAiSummary()
  try {
    const { response, body } = await api('/api/test-provider-connection', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!response.ok) {
      desktopState.aiStatus = 'failed'
      desktopState.aiFailure = body.message || '连接测试没有完成。'
      reportAiTest(desktopState.aiFailure, false)
      renderAiSummary()
      return
    }
    if (body.ok) {
      desktopState.aiStatus = 'connected'
      reportAiTest('🟢 连接成功：' + (body.model || '') + '（' + (body.provider || '') + '）', true)
      renderAiSummary()
    } else {
      desktopState.aiStatus = 'failed'
      desktopState.aiFailure = body.message || '未知原因。'
      reportAiTest('连接失败：' + desktopState.aiFailure, false)
      renderAiSummary()
    }
  } catch {
    desktopState.aiStatus = 'failed'
    desktopState.aiFailure = '无法访问本地服务。'
    reportAiTest('连接测试失败：无法访问本地服务。', false)
    renderAiSummary()
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
    desktopState.aiStatus = 'unconfigured'
    status.textContent = '已移除密钥。'
    status.className = 'provider-status ok'
    renderAiSummary()
    renderGate()
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
$('provider-kind-select').addEventListener('change', () => {
  applyProviderKind($('provider-kind-select').value)
})
$('provider-save-button').addEventListener('click', saveProviderConfig)
$('provider-test-button').addEventListener('click', testProviderConnection)
$('provider-clear-button').addEventListener('click', clearProviderKey)
$('test-connection-button').addEventListener('click', testProviderConnection)
$('boot-reload-button').addEventListener('click', () => { window.location.reload() })
$('boot-reselect-button').addEventListener('click', switchProject)
$('provider-panel').addEventListener('click', (event) => {
  if (event.target === $('provider-panel')) closeProviderPanel()
})

// Startup dead-end guard: if the renderer bootstrap has not completed within
// a reasonable time, the product must say so explicitly instead of leaving a
// static shell that looks fine but can do nothing.
const BOOT_TIMEOUT_MS = 15000
setTimeout(() => {
  if (booted) return
  const failure = $('boot-failure')
  failure.classList.remove('hidden')
  const reselect = $('boot-reselect-button')
  reselect.classList.toggle('hidden', !window.mingWorkbench?.selectProject)
  $('readiness-pill').textContent = '启动未完成'
  $('readiness-pill').className = 'status-pill blocked'
}, BOOT_TIMEOUT_MS)

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
  const ok = window.confirm('Workbench 准备修改以下文件：\\n\\n  ' + filePaths.join('\\n  ') + '\\n\\n确认允许这次修改吗？')
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
