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
      <div class="status-pill" id="project-status">正在读取项目…</div>
    </header>

    <section class="project-card card" aria-live="polite">
      <div>
        <p class="label">当前项目</p>
        <h2 id="project-title">正在打开…</h2>
        <p class="muted" id="project-message">Workbench 正在确认这个项目现在可以做什么。</p>
      </div>
      <button id="setup-button" class="secondary hidden" type="button">启用这个项目</button>
    </section>

    <section class="request-card card">
      <label for="request" class="label">你现在想做什么？</label>
      <textarea id="request" rows="5" placeholder="例如：看看这个项目现在做到哪了，接下来最应该先做什么？"></textarea>
      <div class="request-actions">
        <p class="muted">第一步只做只读理解，不会因为一句话就修改项目。</p>
        <button id="intake-button" class="primary" type="button">先理解项目</button>
      </div>
    </section>

    <section id="provider-card" class="provider-card card hidden" aria-live="polite">
      <p class="label">模型服务</p>
      <p class="muted" id="provider-message">Workbench 需要一个模型服务密钥才能完成真正的项目理解。</p>
      <div class="provider-actions">
        <input id="provider-key-input" type="password" placeholder="输入 API Key" autocomplete="off" />
        <button id="provider-save-button" class="secondary" type="button">保存密钥</button>
      </div>
      <p class="provider-status" id="provider-status">未配置</p>
    </section>

    <section class="execute-card card hidden" id="execute-card" aria-live="polite">
      <p class="label">执行变更</p>
      <p class="muted" id="execute-message">只读理解已完成。如果你确认要执行，Workbench 会先做一次仓库冲突检查。</p>
      <div class="execute-actions">
        <button id="execute-button" class="primary" type="button">执行这个变更</button>
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

    <details class="advanced card">
      <summary>更多信息</summary>
      <div id="advanced-content" class="advanced-content">当前没有需要你处理的技术信息。</div>
    </details>
  </main>
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
button, textarea { font: inherit; }
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
.project-card { display: flex; justify-content: space-between; gap: 24px; align-items: center; margin-bottom: 18px; }
.request-card { margin-bottom: 18px; }
.provider-card { margin-bottom: 18px; }
.provider-actions { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.provider-actions input { flex: 1; padding: 10px 12px; border: 1px solid #d8deea; border-radius: 10px; background: #fbfcfe; color: #172033; }
.provider-status { margin: 8px 0 0; font-size: 13px; color: #43506a; }
.provider-status.ok { color: #19633f; }
.provider-status.error { color: #963d35; }
.resume-card { margin-bottom: 18px; }
.resume-status { margin: 8px 0 0; font-size: 13px; color: #43506a; }
.resume-status.ok { color: #19633f; }
.resume-status.changed { color: #805b0a; }
.resume-workunit-id { margin: 4px 0 0; font-size: 12px; color: #667085; font-family: ui-monospace, monospace; }
textarea { width: 100%; resize: vertical; min-height: 132px; border: 1px solid #d8deea; border-radius: 14px; padding: 16px; outline: none; background: #fbfcfe; color: #172033; }
textarea:focus { border-color: #8da2c6; box-shadow: 0 0 0 4px rgba(103, 132, 184, .11); }
.request-actions { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-top: 14px; }
.muted { color: #6c778b; margin: 8px 0 0; }
.primary, .secondary { border-radius: 12px; padding: 11px 16px; border: 1px solid transparent; font-weight: 700; white-space: nowrap; }
.primary { background: #172033; color: white; }
.secondary { background: white; color: #172033; border-color: #cfd7e5; }
.status-pill { flex: none; border-radius: 999px; padding: 9px 13px; background: #e8edf5; color: #43506a; font-size: 13px; font-weight: 700; }
.status-pill.ready { background: #e8f6ef; color: #19633f; }
.status-pill.setup { background: #fff5dc; color: #805b0a; }
.status-pill.blocked { background: #feeceb; color: #963d35; }
.notice { margin: 18px 0; border-radius: 16px; padding: 15px 17px; background: #fff7df; color: #6f5111; border: 1px solid #f1dfaa; }
.notice.error { background: #fff0ef; color: #8d3933; border-color: #efc8c5; }
.result-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
.span-two { grid-column: span 2; }
.big-status { font-size: 22px; font-weight: 800; }
.evidence-list { margin: 8px 0 0; padding-left: 20px; color: #43506a; }
.evidence-list li + li { margin-top: 8px; }
.advanced { margin-top: 18px; color: #596579; }
.advanced summary { cursor: pointer; font-weight: 700; color: #364258; }
.advanced-content { margin-top: 12px; white-space: pre-wrap; }
.hidden { display: none !important; }
@media (max-width: 720px) {
  .shell { width: min(100% - 22px, 980px); padding-top: 28px; }
  .hero, .project-card, .request-actions { flex-direction: column; align-items: stretch; }
  .status-pill { align-self: flex-start; }
  .result-grid { grid-template-columns: 1fr; }
  .span-two { grid-column: span 1; }
  .request-actions .primary, .project-card button { width: 100%; }
.execute-card { margin-top: 18px; }
.execute-actions { margin-top: 12px; }
.execute-status { margin: 10px 0 0; font-size: 13px; color: #43506a; }
.execute-status.ok { color: #19633f; }
.execute-status.error { color: #963d35; }
@media (max-width: 720px) {
  .shell { width: min(100% - 22px, 980px); padding-top: 28px; }
  .hero, .project-card, .request-actions, .execute-actions { flex-direction: column; align-items: stretch; }
  .status-pill { align-self: flex-start; }
  .result-grid { grid-template-columns: 1fr; }
  .span-two { grid-column: span 1; }
}
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

function renderProject(data) {
  $('project-title').textContent = data.project?.title || '本地项目'
  $('advanced-content').textContent = data.aaopVersion
    ? '项目开发控制版本：' + data.aaopVersion
    : '当前没有需要你处理的技术信息。'
  const status = $('project-status')
  const setup = $('setup-button')
  setup.classList.add('hidden')
  if (data.status === 'ready') {
    status.textContent = '项目已准备'
    status.className = 'status-pill ready'
    $('project-message').textContent = '可以先做只读理解，再决定是否进入执行。'
  } else if (data.status === 'setup-required') {
    status.textContent = '需要启用'
    status.className = 'status-pill setup'
    $('project-message').textContent = '这个项目还没有启用 Workbench 的开发控制。启用后会先从只读理解开始。'
    setup.classList.remove('hidden')
  } else {
    status.textContent = '需要检查'
    status.className = 'status-pill blocked'
    $('project-message').textContent = data.message || 'Workbench 暂时不能安全接管这个项目。'
  }
}

function renderWorkResult(data) {
  if (data.status === 'setup-required') {
    setNotice(data.setup?.summary || '这个项目需要先启用。')
    $('setup-button').classList.remove('hidden')
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
    setNotice(body.message || '暂时无法读取项目状态。', true)
    return
  }
  renderProject(body)
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

async function checkProviderStatus() {
  if (!isDesktop) return
  try {
    const { response, body } = await api('/api/provider/status')
    if (response.ok) {
      updateProviderUI(body.hasSecret)
    }
  } catch {
    // Ignore.
  }
}

function updateProviderUI(hasSecret) {
  const card = $('provider-card')
  const msg = $('provider-message')
  const input = $('provider-key-input')
  const button = $('provider-save-button')
  const status = $('provider-status')

  if (hasSecret) {
    card.classList.add('hidden')
    msg.textContent = '模型服务密钥已配置。'
    status.textContent = '已配置'
    status.className = 'provider-status ok'
  } else {
    card.classList.remove('hidden')
    msg.textContent = 'Workbench 需要一个模型服务密钥才能完成真正的项目理解。'
    status.textContent = '未配置'
    status.className = 'provider-status'
    input.disabled = false
    button.disabled = false
  }
}

async function saveProviderSecret() {
  const input = $('provider-key-input')
  const button = $('provider-save-button')
  const status = $('provider-status')
  const secret = input.value.trim()
  if (!secret) {
    status.textContent = '请输入有效的 API Key。'
    status.className = 'provider-status error'
    return
  }
  button.disabled = true
  status.textContent = '正在保存…'
  status.className = 'provider-status'
  try {
    await window.mingWorkbench.setProviderSecret(secret)
    input.value = ''
    status.textContent = '密钥已保存'
    status.className = 'provider-status ok'
    await checkProviderStatus()
  } catch {
    status.textContent = '保存失败，请稍后重试。'
    status.className = 'provider-status error'
  } finally {
    button.disabled = false
  }
}

$('setup-button').addEventListener('click', async () => {
  const ok = window.confirm('启用后，Workbench 会使用 AAOP 官方稳定版本为这个项目加入开发控制文件。不会因此修改业务功能，也不会自动安装第三方执行器。继续吗？')
  if (!ok) return
  const button = $('setup-button')
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
    } else {
      executeCard.classList.add('hidden')
    }
    await refreshProject()
  } finally {
    button.disabled = false
  }
})

$('execute-button').addEventListener('click', async () => {
  const button = $('execute-button')
  const status = $('execute-status')
  if (!currentWorkUnitId) {
    status.textContent = '请先完成项目理解。'
    status.className = 'execute-status error'
    return
  }
  const ok = window.confirm('Workbench 将在当前项目授权范围内执行这项变更。确认吗？')
  if (!ok) return
  button.disabled = true
  status.textContent = '正在请求执行授权…'
  status.className = 'execute-status'
  try {
    const authRes = await api('/api/authorize', {
      method: 'POST',
      body: JSON.stringify({ workUnitId: currentWorkUnitId, authorize: true }),
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
  }
})

if (isDesktop) {
  $('provider-save-button').addEventListener('click', saveProviderSecret)
  checkProviderStatus().catch(() => {})
}

refreshProject().catch(() => setNotice('暂时无法读取项目状态。', true))
loadResume().catch(() => {})
`
