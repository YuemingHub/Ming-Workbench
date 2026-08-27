function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const HUMAN_FIRST_CSS = `
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #f5f7fb;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top left, #ffffff 0, #f5f7fb 42%, #eef2f8 100%);
}
main {
  width: min(720px, calc(100% - 40px));
  margin: 0 auto;
  padding: 48px 0 64px;
}
.hidden { display: none !important; }
.eyebrow {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: #667085;
}
h1, h2, h3, p { margin-top: 0; }
h1 { font-size: clamp(28px, 5vw, 42px); line-height: 1.12; letter-spacing: -.03em; }
h2 { font-size: 22px; line-height: 1.25; letter-spacing: -.02em; }
.lede { color: #596579; font-size: 16px; line-height: 1.7; max-width: 560px; }
.lede p { margin: 0 0 14px; }
.card {
  background: #ffffff;
  border: 1px solid #e6eaf2;
  border-radius: 16px;
  padding: 22px;
  margin-top: 18px;
  box-shadow: 0 1px 2px rgba(23,32,51,.04);
}
.primary, .secondary, .choice {
  border-radius: 12px;
  padding: 12px 20px;
  font: 700 15px/1.3 Inter, ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  border: 1px solid transparent;
}
.primary { background: #172033; color: #fff; }
.primary:hover { background: #26324d; }
.primary:disabled { opacity: .55; cursor: wait; }
.secondary { background: #fff; color: #172033; border-color: #d8deea; }
.secondary:hover { background: #f2f5fa; }
.choice {
  display: block;
  width: 100%;
  text-align: left;
  margin-top: 10px;
  background: #fff;
  color: #172033;
  border-color: #d8deea;
}
.choice:hover { border-color: #172033; background: #f7f9fc; }
.chat { display: flex; flex-direction: column; gap: 12px; }
.bubble {
  max-width: 82%;
  padding: 12px 15px;
  border-radius: 14px;
  line-height: 1.6;
  font-size: 15px;
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble.human { align-self: flex-end; background: #172033; color: #fff; }
.bubble.workbench { align-self: flex-start; background: #eef2f8; color: #172033; }
.compose { display: flex; gap: 10px; margin-top: 16px; }
.compose textarea {
  flex: 1;
  resize: none;
  border: 1px solid #d8deea;
  border-radius: 12px;
  padding: 12px 14px;
  font: 15px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
  color: #172033;
  background: #fff;
}
.compose textarea:focus { outline: 2px solid #b9c3d4; border-color: transparent; }
.review-block { margin-top: 14px; }
.review-block h3 { margin: 0 0 6px; font-size: 14px; color: #172033; }
.review-block p, .review-block li { color: #43506a; font-size: 15px; line-height: 1.6; }
.review-block ul { margin: 0; padding-left: 20px; }
.actions { margin-top: 18px; display: flex; gap: 10px; align-items: center; }
.muted { color: #8a94a8; font-size: 13px; }
.status { margin-top: 14px; font-size: 14px; color: #43506a; }
.provider-cta { margin-top: 14px; padding: 14px 16px; background: #fff7df; border: 1px solid #f1dfaa; border-radius: 12px; color: #6f5111; font-size: 14px; line-height: 1.6; }
.provider-cta .link { color: #963d35; font-weight: 700; cursor: pointer; text-decoration: underline; }
.provider-panel-overlay { position: fixed; inset: 0; background: rgba(23, 32, 51, .42); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; z-index: 50; overflow-y: auto; }
.provider-panel { position: relative; width: min(480px, 100%); background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 24px 64px rgba(23, 32, 51, .18); }
.provider-panel h3 { margin: 0 0 4px; font-size: 18px; }
.provider-panel .panel-desc { margin: 0 0 16px; color: #596579; font-size: 14px; line-height: 1.6; }
.provider-panel .field-label { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #667085; }
.provider-panel input { width: 100%; padding: 11px 12px; border: 1px solid #d8deea; border-radius: 10px; background: #fbfcfe; color: #172033; outline: none; font: inherit; }
.provider-panel input:focus { border-color: #8da2c6; box-shadow: 0 0 0 4px rgba(103, 132, 184, .11); }
.provider-panel .field-hint { margin: 6px 0 0; font-size: 12px; color: #8a94a8; }
.provider-panel .panel-actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
.provider-panel .panel-status { margin-top: 12px; font-size: 13px; color: #43506a; }
.provider-panel .panel-status.ok { color: #19633f; }
.provider-panel .panel-status.error { color: #963d35; }
.provider-panel .panel-close { position: absolute; top: 12px; right: 16px; background: none; border: none; font-size: 20px; color: #8a94a8; cursor: pointer; }
.ai-service-entry { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 14px; background: #f5f7fb; border: 1px solid #d8deea; border-radius: 10px; color: #43506a; font-size: 13px; cursor: pointer; }
.ai-service-entry:hover { background: #eaf0f7; border-color: #b9c3d4; }
.ai-service-entry .dot { width: 8px; height: 8px; border-radius: 50%; background: #19633f; }
`

export const HUMAN_FIRST_APP_JS = `
(function () {
  var TOKEN = document.querySelector('meta[name="ming-workbench-token"]').getAttribute('content');
  var STATE = null;
  var PROVIDER_STATE = { hasSecret: false, preferences: null, loaded: false };

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': TOKEN },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      if (!response.ok) throw new Error('request failed');
      return response.json();
    });
  }

  function httpGet(path) {
    return fetch(path, {
      headers: { 'x-workbench-token': TOKEN },
    }).then(function (response) {
      if (!response.ok) throw new Error('request failed');
      return response.json();
    });
  }

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).classList.remove('hidden'); }
  function hide(id) { el(id).classList.add('hidden'); }

  function escapeText(value) {
    var div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  }

  function isDesktopMode() {
    return typeof window.mingWorkbench !== 'undefined' && window.mingWorkbench !== null;
  }

  async function loadProviderState() {
    if (!isDesktopMode()) {
      try {
        var result = await httpGet('/api/provider/state');
        if (result && result.status === 'ok') {
          return {
            hasSecret: result.hasSecret === true,
            preferences: result.preferences || null,
            loaded: true,
          };
        }
      } catch (e) {}
      return { hasSecret: false, preferences: null, loaded: false };
    }
    try {
      var hasSecretResult = await window.mingWorkbench.hasProviderSecret();
      var prefsResult = await window.mingWorkbench.getProviderPreferences();
      return {
        hasSecret: hasSecretResult.hasSecret === true,
        preferences: prefsResult.ok ? prefsResult.preferences : null,
        loaded: true,
      };
    } catch (e) {
      return { hasSecret: false, preferences: null, loaded: false };
    }
  }

  function showProviderCta() {
    var cta = el('provider-cta');
    if (cta) cta.classList.remove('hidden');
  }

  function hideProviderCta() {
    var cta = el('provider-cta');
    if (cta) cta.classList.add('hidden');
  }

  function showProviderEntry() {
    var entry = el('ai-service-entry');
    if (entry) entry.classList.remove('hidden');
  }

  function hideProviderEntry() {
    var entry = el('ai-service-entry');
    if (entry) entry.classList.add('hidden');
  }

  function updateProviderCta() {
    if (STATE && STATE.providerRequired && PROVIDER_STATE.loaded && !PROVIDER_STATE.hasSecret) {
      showProviderCta();
      hideProviderEntry();
    } else if (PROVIDER_STATE.loaded && PROVIDER_STATE.hasSecret) {
      hideProviderCta();
      showProviderEntry();
    } else {
      hideProviderCta();
      hideProviderEntry();
    }
  }

  var PROVIDER_PANEL_TEMPLATE = '<div id="provider-panel-overlay" class="provider-panel-overlay">' +
    '<div class="provider-panel">' +
    '<button class="panel-close" data-action="close-provider-panel" aria-label="关闭">×</button>' +
    '<h3>连接 AI 服务</h3>' +
    '<p class="panel-desc">输入你的服务商信息和密钥，以便 Workbench 帮你处理想法。密钥会加密保存在你的设备上。</p>' +
    '<div class="field-label">接口地址（可选）</div>' +
    '<input id="provider-base-url" type="text" placeholder="留空使用默认，或填写自定义接口地址" />' +
    '<div class="field-hint">支持任何 OpenAI 兼容的接口地址</div>' +
    '<div class="field-label">模型名称</div>' +
    '<input id="provider-model" type="text" placeholder="deepseek-v4-pro" />' +
    '<div class="field-hint">模型名称需与服务商提供的一致</div>' +
    '<div class="field-label">密钥</div>' +
    '<input id="provider-key-input" type="password" placeholder="sk-..." />' +
    '<div class="field-hint">密钥加密存储在本机，不会上传或写入项目文件</div>' +
    '<div class="panel-actions">' +
    '<button id="provider-save-button" class="primary" type="button" data-action="save-provider-config">保存</button>' +
    '<button class="secondary" type="button" data-action="close-provider-panel">取消</button>' +
    '<button id="provider-clear-button" class="secondary hidden" type="button" data-action="clear-provider-secret">移除密钥</button>' +
    '</div>' +
    '<div id="provider-panel-status" class="panel-status"></div>' +
    '</div>' +
    '</div>';

  function mountProviderPanel() {
    var existing = el('provider-panel-overlay');
    if (existing) return existing;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = PROVIDER_PANEL_TEMPLATE;
    var panel = wrapper.firstChild;
    document.body.appendChild(panel);
    return panel;
  }

  function unmountProviderPanel() {
    var overlay = el('provider-panel-overlay');
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function openProviderPanel() {
    mountProviderPanel();
    prefillProviderPanel();
  }

  function closeProviderPanel() {
    unmountProviderPanel();
  }

  async function prefillProviderPanel() {
    try {
      var prefs = null;
      var hasSecret = false;
      if (!isDesktopMode()) {
        var httpResult = await httpGet('/api/provider/state');
        if (httpResult && httpResult.status === 'ok') {
          prefs = httpResult.preferences || null;
          hasSecret = httpResult.hasSecret === true;
        }
      } else {
        var prefsResult = await window.mingWorkbench.getProviderPreferences();
        if (prefsResult && prefsResult.ok) {
          prefs = prefsResult.preferences || null;
        }
        var hasSecretResult = await window.mingWorkbench.hasProviderSecret();
        hasSecret = hasSecretResult.hasSecret === true;
      }
      if (prefs) {
        el('provider-base-url').value = prefs.baseUrl || '';
        el('provider-model').value = prefs.model || '';
      } else {
        el('provider-base-url').value = '';
        el('provider-model').value = '';
      }
      el('provider-key-input').value = '';
      var status = el('provider-panel-status');
      status.textContent = hasSecret ? '✓ 已保存密钥（留空保留）' : '尚未保存密钥';
      status.className = 'panel-status' + (hasSecret ? ' ok' : '');
      el('provider-clear-button').classList.toggle('hidden', !hasSecret);
    } catch (e) {}
  }

  async function saveProviderConfig() {
    var baseUrl = el('provider-base-url').value.trim();
    var model = el('provider-model').value.trim();
    var key = el('provider-key-input').value.trim();
    var status = el('provider-panel-status');
    var saveBtn = el('provider-save-button');

    if (!model) {
      status.textContent = '请填写模型名称。';
      status.className = 'panel-status error';
      return;
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      status.textContent = '接口地址需要以 http:// 或 https:// 开头。';
      status.className = 'panel-status error';
      return;
    }

    saveBtn.disabled = true;
    status.textContent = '正在保存并应用…';
    status.className = 'panel-status';

    try {
      var result;
      if (!isDesktopMode()) {
        var httpBody = {
          provider: 'deepseek-official',
          model: model,
          baseUrl: baseUrl,
        };
        if (key) httpBody.key = key;
        result = await post('/api/provider/save', httpBody);
        if (!result || result.status !== 'ok') {
          status.textContent = (result && result.message) || '配置保存失败。';
          status.className = 'panel-status error';
          saveBtn.disabled = false;
          return;
        }
      } else {
        if (key) {
          var secretResult = await window.mingWorkbench.setProviderSecret(key);
          if (!secretResult || !secretResult.ok) {
            status.textContent = '密钥保存失败，请稍后重试。';
            status.className = 'panel-status error';
            saveBtn.disabled = false;
            return;
          }
        }
        var prefsResult = await window.mingWorkbench.setProviderPreferences({
          provider: 'deepseek-official',
          model: model,
          baseUrl: baseUrl,
        });
        if (!prefsResult || !prefsResult.ok) {
          status.textContent = prefsResult ? prefsResult.message : '配置保存失败，请稍后重试。';
          status.className = 'panel-status error';
          saveBtn.disabled = false;
          return;
        }
      }
      status.textContent = '已保存，正在重新连接…';
      status.className = 'panel-status ok';
      PROVIDER_STATE.hasSecret = true;
      PROVIDER_STATE.preferences = { provider: 'deepseek-official', model: model, baseUrl: baseUrl };
      PROVIDER_STATE.loaded = true;
      hideProviderCta();
      setTimeout(function () {
        closeProviderPanel();
      }, 800);
    } catch (e) {
      status.textContent = '保存失败：' + (e.message || '请稍后重试。');
      status.className = 'panel-status error';
      saveBtn.disabled = false;
    }
  }

  async function clearProviderSecretAction() {
    if (!confirm('确定要移除已保存的密钥吗？')) return;
    try {
      if (!isDesktopMode()) {
        await post('/api/provider/clear');
      } else {
        await window.mingWorkbench.clearProviderSecret();
      }
      PROVIDER_STATE.hasSecret = false;
      closeProviderPanel();
      updateProviderCta();
    } catch (e) {}
  }

  function renderChat(idea) {
    var log = el('chat-log');
    log.innerHTML = '';
    (idea.turns || []).forEach(function (turn) {
      var bubble = document.createElement('div');
      bubble.className = 'bubble ' + (turn.role === 'human' ? 'human' : 'workbench');
      bubble.textContent = turn.text;
      log.appendChild(bubble);
    });
    log.scrollTop = log.scrollHeight;
  }

  function fillList(containerId, items) {
    var list = el(containerId);
    list.innerHTML = '';
    (items || []).forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
  }

  function setView(name) {
    ['letter-view', 'entry-view', 'conversation-view', 'review-view', 'agreement-view', 'confirmed-view']
      .forEach(function (id) { if (id === name + '-view') show(id); else hide(id); });
  }

  function renderIdea(idea) {
    STATE = idea;
    setView(idea.stage);
    if (idea.stage === 'conversation') renderChat(idea);
    if (idea.stage === 'review' || idea.stage === 'agreement' || idea.stage === 'confirmed') {
      renderChat(idea);
      if (idea.synthesis) {
        el('review-desired').textContent = idea.synthesis.desiredReality;
        fillList('review-strengths', idea.synthesis.strengths);
        fillList('review-path', idea.synthesis.path);
        el('review-recommendation').textContent = idea.synthesis.recommendation;
      }
    }
    if (idea.stage === 'agreement' || idea.stage === 'confirmed') {
      if (idea.agreement) {
        el('agreement-willget').textContent = idea.agreement.willGet;
        el('agreement-solves').textContent = idea.agreement.solves;
        el('agreement-wheresee').textContent = idea.agreement.whereSee;
        el('agreement-notdoing').textContent = idea.agreement.notDoing;
      }
    }
    if (idea.stage === 'confirmed') {
      el('confirmed-recommendation').textContent = idea.synthesis ? idea.synthesis.recommendation : '';
      if (idea.agreement) {
        el('confirmed-willget').textContent = idea.agreement.willGet;
        el('confirmed-solves').textContent = idea.agreement.solves;
        el('confirmed-wheresee').textContent = idea.agreement.whereSee;
        el('confirmed-notdoing').textContent = idea.agreement.notDoing;
      }
    }
    updateProviderCta();
  }

  async function boot() {
    console.error('[HF-UI-DEBUG] boot() starting, isDesktopMode=' + isDesktopMode() + ', TOKEN=' + (TOKEN ? TOKEN.substring(0,8) + '...' : 'MISSING'));
    PROVIDER_STATE = await loadProviderState();
    console.error('[HF-UI-DEBUG] boot() loadProviderState done, hasSecret=' + PROVIDER_STATE.hasSecret);

    // Event delegation: handle all data-action clicks (replaces inline onclick handlers
    // which don't work reliably with contextIsolation: true in Electron)
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.getAttribute('data-action');
      switch (action) {
        case 'open-provider-panel': openProviderPanel(); break;
        case 'close-provider-panel': closeProviderPanel(); break;
        case 'save-provider-config': saveProviderConfig(); break;
        case 'clear-provider-secret': clearProviderSecretAction(); break;
      }
    });

    fetch('/api/idea/state', { headers: { 'x-workbench-token': TOKEN } })
      .then(function (r) { return r.json(); })
      .then(function (data) { renderIdea(data.idea); })
      .catch(function () {
        el('boot-failure').classList.remove('hidden');
      });

    el('start-button').addEventListener('click', function () {
      el('start-button').disabled = true;
      post('/api/idea/start').then(function (data) {
        renderIdea(data.idea);
      }).catch(function () { el('start-button').disabled = false; });
    });

    el('entry-1').addEventListener('click', function () { pickEntry(this.dataset.entry); });
    el('entry-2').addEventListener('click', function () { pickEntry(this.dataset.entry); });
    el('entry-3').addEventListener('click', function () { pickEntry(this.dataset.entry); });

    function pickEntry(entry) {
      post('/api/idea/entry', { entry: entry }).then(function (data) { renderIdea(data.idea); });
    }

    function send() {
      var input = el('message-input');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      var sendButton = el('send-button');
      sendButton.disabled = true;
      post('/api/idea/message', { text: text }).then(function (data) {
        renderIdea(data.idea);
      }).finally(function () { sendButton.disabled = false; });
    }
    el('send-button').addEventListener('click', send);
    el('message-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });

    el('review-next-button').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      post('/api/idea/agreement').then(function (data) {
        renderIdea(data.idea);
      }).finally(function () { button.disabled = false; });
    });

    el('agreement-confirm-button').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      post('/api/idea/confirm').then(function (data) { renderIdea(data.idea); })
        .catch(function () { button.disabled = false; });
    });

    el('agreement-back-button').addEventListener('click', function () {
      if (STATE && STATE.synthesis) setView('review');
    });

    el('continue-conversation-button').addEventListener('click', function () {
      setView('conversation');
      updateProviderCta();
    });
  }

  window.openProviderPanel = openProviderPanel;
  window.closeProviderPanel = closeProviderPanel;
  window.saveProviderConfig = saveProviderConfig;
  window.clearProviderSecret = clearProviderSecretAction;
  window.getState = function() { return STATE; };
  window.getProviderState = function() { return PROVIDER_STATE; };
  window.reloadProviderState = async function() {
    PROVIDER_STATE = await loadProviderState();
    updateProviderCta();
    return PROVIDER_STATE;
  };

  // Regular <script> (not type=module) is blocking — by the time it executes,
  // the DOM is fully parsed and DOMContentLoaded has already fired.
  boot().catch(function (e) { console.error('boot failed:', e); });
})();
`

export function renderHumanFirstHtml(requestToken: string): string {
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
  <main>
    <section id="letter-view">
      <p class="eyebrow">MING WORKBENCH</p>
      <h1>你好。</h1>
      <div class="lede">
        <p>如果你心里有一件想做成的小事——不管是清楚的、有点模糊的，还是只有一个影子——都可以从这里开始。</p>
        <p>不需要准备任何东西，也不需要懂技术。我们先花几分钟，把你想做成的那件事说清楚，然后一起定下：这一轮我们先做到哪一件小事、你会看到什么。</p>
        <p>说好了，才开始动手。</p>
      </div>
      <button id="start-button" class="primary" type="button">开始</button>
    </section>

    <section id="entry-view" class="hidden">
      <p class="eyebrow">MING WORKBENCH</p>
      <h2>我们从一个地方开始。</h2>
      <p class="lede">你现在最接近哪一种？</p>
      <button id="entry-1" class="choice" type="button" data-entry="我已经有一个想法">我已经有一个想法</button>
      <button id="entry-2" class="choice" type="button" data-entry="我只有一点模糊念头">我只有一点模糊念头</button>
      <button id="entry-3" class="choice" type="button" data-entry="我现在也不知道想做什么">我现在也不知道想做什么</button>
    </section>

    <section id="conversation-view" class="hidden">
      <p class="eyebrow">MING WORKBENCH</p>
      <h2>说说你的想法。</h2>
      <div class="card chat" id="chat-log"></div>
      <div id="provider-cta" class="provider-cta hidden" data-action="open-provider-panel">
        需要连接 AI 服务才能继续。<span class="link">连接我的 AI 服务</span>
      </div>
      <div id="ai-service-entry" class="ai-service-entry hidden" data-action="open-provider-panel" title="管理你的 AI 服务">
        <span class="dot"></span>AI 服务
      </div>
      <div class="compose">
        <textarea id="message-input" rows="2" placeholder="用你自己的话说就行，想到哪里说到哪里"></textarea>
        <button id="send-button" class="primary" type="button">发送</button>
      </div>
    </section>

    <section id="review-view" class="hidden">
      <p class="eyebrow">MING WORKBENCH</p>
      <h2>我把你刚才说的，整理成了下面这些。</h2>
      <p class="lede">你看对不对。哪里不对，我们接着聊。</p>
      <div class="card">
        <div class="review-block">
          <h3>我理解的你想去的地方</h3>
          <p id="review-desired"></p>
        </div>
        <div class="review-block">
          <h3>你已经带来的东西</h3>
          <ul id="review-strengths"></ul>
        </div>
        <div class="review-block">
          <h3>我们可以怎么一步步走到那里</h3>
          <ul id="review-path"></ul>
        </div>
        <div class="review-block">
          <h3>我建议先做到这一件事</h3>
          <p id="review-recommendation"></p>
        </div>
      </div>
      <div class="actions">
        <button id="review-next-button" class="primary" type="button">再看看这一轮要做什么</button>
      </div>
      <p class="muted">这一页只是我们聊出来的，还没有开始做任何事。</p>
    </section>

    <section id="agreement-view" class="hidden">
      <p class="eyebrow">MING WORKBENCH</p>
      <h2>这一轮，我们这样开始。</h2>
      <div class="card">
        <div class="review-block">
          <h3>这一轮会得到什么</h3>
          <p id="agreement-willget"></p>
        </div>
        <div class="review-block">
          <h3>它解决什么问题</h3>
          <p id="agreement-solves"></p>
        </div>
        <div class="review-block">
          <h3>你会在哪里看到 / 怎么使用它</h3>
          <p id="agreement-wheresee"></p>
        </div>
        <div class="review-block">
          <h3>这一轮明确不做什么</h3>
          <p id="agreement-notdoing"></p>
        </div>
      </div>
      <div class="actions">
        <button id="agreement-confirm-button" class="primary" type="button">对，就是这个，开始吧</button>
        <button id="agreement-back-button" class="secondary" type="button">再想一想</button>
      </div>
      <p class="muted">在你确认之前，我们不会开始做任何事。</p>
    </section>

    <section id="confirmed-view" class="hidden">
      <p class="eyebrow">MING WORKBENCH</p>
      <h2>说好了。</h2>
      <div class="card">
        <div class="review-block">
          <h3>这一轮我们决定先做这一件事</h3>
          <p id="confirmed-recommendation"></p>
        </div>
        <div class="review-block">
          <h3>这一轮会得到什么</h3>
          <p id="confirmed-willget"></p>
        </div>
        <div class="review-block">
          <h3>它解决什么问题</h3>
          <p id="confirmed-solves"></p>
        </div>
        <div class="review-block">
          <h3>你会在哪里看到 / 怎么使用它</h3>
          <p id="confirmed-wheresee"></p>
        </div>
        <div class="review-block">
          <h3>这一轮明确不做什么</h3>
          <p id="confirmed-notdoing"></p>
        </div>
      </div>
      <p class="status">这件事已经说好并记下了。真正开始的时候，我们会先告诉你每一步。</p>
      <div class="actions">
        <button id="continue-conversation-button" class="primary" type="button">继续对话</button>
      </div>
    </section>

    <section id="boot-failure" class="card hidden">
      <h3>没连上。</h3>
      <p class="muted">页面没能和本地服务正常连接，请重新打开一次。</p>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}
