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
`

export const HUMAN_FIRST_APP_JS = `
(function () {
  var TOKEN = document.querySelector('meta[name="ming-workbench-token"]').getAttribute('content');
  var STATE = null;

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

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).classList.remove('hidden'); }
  function hide(id) { el(id).classList.add('hidden'); }

  function escapeText(value) {
    var div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
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
    }
  }

  function boot() {
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
  }

  document.addEventListener('DOMContentLoaded', boot);
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
      <p class="status">这件事已经说好并记下了。真正开始的时候，我们会先告诉你每一步。</p>
    </section>

    <section id="boot-failure" class="card hidden">
      <h3>没连上。</h3>
      <p class="muted">页面没能和本地服务正常连接，请重新打开一次。</p>
    </section>
  </main>
  <script src="/app.js" type="module"></script>
</body>
</html>`
}
