'use strict';

// ─── Config ───────────────────────────────────────────────────────
const CONFIG = {
  get title()    { return localStorage.getItem('blog_title')    || 'My Blog'; },
  get subtitle() { return localStorage.getItem('blog_subtitle') || '记录思考，分享生活'; },
  get about()    { return localStorage.getItem('blog_about')    || DEFAULT_ABOUT; },
  setAbout(v)    { localStorage.setItem('blog_about', v); },
};

const DEFAULT_ABOUT = `<h2>关于我</h2>
<p>你好，欢迎来到我的小角落。</p>
<p>这里记录了我的思考、阅读和生活片段。如果你也喜欢慢慢写、慢慢读，那我们或许会成为朋友。</p>
<h3>关于本站</h3>
<p>这是一个用 HTML / CSS / JavaScript 构建的极简博客，文章全部保存在浏览器本地，部署在 GitHub Pages 上。</p>
<blockquote>真正重要的事情，需要时间。</blockquote>
<p>点击下方按钮，可以编辑这段内容。</p>`;

// ─── Storage ──────────────────────────────────────────────────────
const Store = {
  getAll() {
    try { return JSON.parse(localStorage.getItem('blog_articles') || '[]'); }
    catch { return []; }
  },
  save(articles) { localStorage.setItem('blog_articles', JSON.stringify(articles)); },
  get(id) { return this.getAll().find(a => a.id === id) || null; },
  upsert(article) {
    const all = this.getAll();
    const i = all.findIndex(a => a.id === article.id);
    i >= 0 ? (all[i] = article) : all.unshift(article);
    this.save(all);
  },
  remove(id) { this.save(this.getAll().filter(a => a.id !== id)); },
};

// ─── Utilities ────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(iso, short = false) {
  const d = new Date(iso);
  return short
    ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || d.innerText || '';
}

function excerpt(html, max = 140) {
  const t = stripTags(html).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Chinese ≈ 300 chars/min; English ≈ 200 words/min — approximate by char count
function readingTime(html) {
  const text = stripTags(html);
  const cjk = (text.match(/[一-龥　-〿]/g) || []).length;
  const other = text.replace(/[一-龥　-〿]/g, '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(cjk / 300 + other / 200));
  return `约 ${minutes} 分钟阅读`;
}

function allTagsWithCount() {
  const counts = new Map();
  Store.getAll().forEach(a => (a.tags || []).forEach(t => {
    counts.set(t, (counts.get(t) || 0) + 1);
  }));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function articlesByTag(tag) {
  return Store.getAll().filter(a => (a.tags || []).includes(tag));
}

// ─── Router ───────────────────────────────────────────────────────
function go(path) { window.location.hash = '#' + path; }

const ROUTES = [
  [/^\/$/,                       () => viewHome()],
  [/^\/article\/([^/]+)$/,       m => viewArticle(m[1])],
  [/^\/editor$/,                 () => viewEditor(null)],
  [/^\/editor\/([^/]+)$/,        m => viewEditor(m[1])],
  [/^\/archive$/,                () => viewArchive()],
  [/^\/tags$/,                   () => viewTags()],
  [/^\/tag\/(.+)$/,              m => viewTag(decodeURIComponent(m[1]))],
  [/^\/about$/,                  () => viewAbout()],
];

function route() {
  const path = window.location.hash.replace(/^#/, '') || '/';
  syncNavActive(path);
  for (const [rx, fn] of ROUTES) {
    const m = path.match(rx);
    if (m) { fn(m); window.scrollTo(0, 0); return; }
  }
  document.getElementById('app').innerHTML =
    `<div class="error-page"><h2>页面不存在</h2><a href="#/">← 返回首页</a></div>`;
}

function syncNavActive(path) {
  document.querySelectorAll('.nav-link').forEach(el => {
    const r = el.dataset.route;
    const active =
      (r === '/'        && path === '/') ||
      (r === '/archive' && path.startsWith('/archive')) ||
      (r === '/tags'    && (path.startsWith('/tags') || path.startsWith('/tag/'))) ||
      (r === '/about'   && path.startsWith('/about'));
    el.classList.toggle('active', active);
  });
}

window.addEventListener('hashchange', route);
window.addEventListener('load', () => {
  seedSample();
  document.getElementById('nav-brand').textContent = CONFIG.title;
  document.getElementById('footer-brand').textContent = CONFIG.title;
  initSearch();
  initKeyboard();
  route();
});

// ─── Sample Data ──────────────────────────────────────────────────
function seedSample() {
  if (Store.getAll().length > 0) return;
  const now = new Date();
  const days = (n) => new Date(now.getTime() - n * 86400000).toISOString();

  const samples = [
    {
      id: uid(),
      title: '欢迎来到我的博客',
      content: `<p>这是我的个人博客，用纯 HTML、CSS 和 JavaScript 构建，部署在 GitHub Pages 上。</p>
<h2>它能做什么</h2>
<ul>
<li>用网页内的富文本编辑器直接写文章</li>
<li>顶部菜单可以快速跳转到归档、标签、关于</li>
<li>右上角的搜索按钮可以全文搜索</li>
<li>每篇文章自动估算阅读时长</li>
</ul>
<blockquote>所有数据都保存在浏览器本地，刷新不会丢失。</blockquote>`,
      tags: ['指南', '介绍'],
      createdAt: days(0),
      updatedAt: days(0),
    },
    {
      id: uid(),
      title: '为什么我开始写博客',
      content: `<p>很多人写博客是为了被看见，而我写博客是为了把自己看清楚。</p>
<p>当一个想法只在脑子里翻滚时，它常常是模糊的、自我感觉良好的；但当你尝试把它写下来时，逻辑里的洞、表达上的笨拙、情绪里的躲闪，会一个个被照出来。</p>
<h2>写作是诚实的工具</h2>
<p>你不可能糊弄文字。你可以糊弄聊天，可以糊弄会议，但写作要求你把每个词都安放到位。这种安放本身就是一次思想的整理。</p>
<blockquote>我手写我心，心也因此越来越清晰。</blockquote>`,
      tags: ['随笔', '写作'],
      createdAt: days(3),
      updatedAt: days(3),
    },
    {
      id: uid(),
      title: '关于慢的力量',
      content: `<p>这是一个崇拜速度的时代。两倍速听播客，三天读一本书，五分钟看完一部电影。</p>
<p>但有些东西无法被加速：信任、理解、爱、深度的快乐。它们只能慢慢生长。</p>
<h2>慢不是落后</h2>
<p>慢是一种主动的选择。是当所有人都在抢答时，你愿意先听完问题。</p>`,
      tags: ['随笔', '思考'],
      createdAt: days(10),
      updatedAt: days(10),
    },
  ];

  samples.forEach(s => Store.upsert(s));
}

// ─── View: Home ───────────────────────────────────────────────────
function viewHome() {
  document.title = CONFIG.title;
  const articles = Store.getAll();
  const app = document.getElementById('app');

  const hero = `
    <div class="hero">
      <h1 class="hero-title">${esc(CONFIG.title)}</h1>
      <p class="hero-subtitle">${esc(CONFIG.subtitle)}</p>
    </div>`;

  if (!articles.length) {
    app.innerHTML = `
      <div class="page-home">
        ${hero}
        <div class="empty-state">
          <div class="empty-icon">✒</div>
          <p>还没有文章，来写第一篇吧</p>
          <a href="#/editor" class="btn btn-primary btn-lg">写第一篇文章</a>
        </div>
      </div>`;
    return;
  }

  const cards = articles.map(a => `
    <article class="card" onclick="go('/article/${a.id}')">
      <h2 class="card-title">${esc(a.title)}</h2>
      <p class="card-excerpt">${esc(excerpt(a.content))}</p>
      <div class="card-meta">
        <span class="meta-date">${fmtDate(a.createdAt)}</span>
        <span class="meta-dot"></span>
        <span class="meta-read">${readingTime(a.content)}</span>
        ${(a.tags || []).length ? `<span class="meta-dot"></span>` : ''}
        ${(a.tags || []).length
          ? `<div class="tag-list" onclick="event.stopPropagation()">
               ${a.tags.map(t => `<span class="tag" onclick="go('/tag/${encodeURIComponent(t)}')">${esc(t)}</span>`).join('')}
             </div>`
          : ''}
      </div>
    </article>`).join('');

  app.innerHTML = `
    <div class="page-home">
      ${hero}
      <div class="article-list">${cards}</div>
    </div>`;
}

// ─── View: Article ────────────────────────────────────────────────
function viewArticle(id) {
  const a = Store.get(id);
  const app = document.getElementById('app');

  if (!a) {
    app.innerHTML = `<div class="error-page"><h2>文章不存在</h2><a href="#/">← 返回首页</a></div>`;
    return;
  }

  document.title = `${a.title} — ${CONFIG.title}`;

  app.innerHTML = `
    <div class="page-article">
      <div class="article-topbar">
        <a href="#/" class="back-link">← 返回</a>
        <div class="article-btns">
          <button class="btn btn-ghost" onclick="go('/editor/${a.id}')">编辑</button>
          <button class="btn btn-ghost btn-danger" onclick="deleteArt('${a.id}')">删除</button>
        </div>
      </div>

      <article>
        <header class="art-header">
          <h1 class="art-title">${esc(a.title)}</h1>
          <div class="art-meta">
            <time>${fmtDate(a.createdAt)}</time>
            <span class="meta-dot"></span>
            <span>${readingTime(a.content)}</span>
            ${a.updatedAt !== a.createdAt
              ? `<span class="meta-dot"></span><span>编辑于 ${fmtDate(a.updatedAt)}</span>` : ''}
          </div>
          ${(a.tags || []).length
            ? `<div class="tag-list">${a.tags.map(t => `<span class="tag" onclick="go('/tag/${encodeURIComponent(t)}')">${esc(t)}</span>`).join('')}</div>`
            : ''}
        </header>
        <div class="art-body">${a.content}</div>
      </article>
    </div>`;
}

function deleteArt(id) {
  if (confirm('确定要删除这篇文章吗？此操作无法撤销。')) {
    Store.remove(id);
    go('/');
  }
}

// ─── View: Archive ────────────────────────────────────────────────
function viewArchive() {
  document.title = `归档 — ${CONFIG.title}`;
  const app = document.getElementById('app');
  const articles = Store.getAll().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!articles.length) {
    app.innerHTML = `
      <div class="page-archive">
        ${renderPageHeading('Archive', '归档', '按时间回顾所有文章')}
        <div class="empty-state"><div class="empty-icon">📚</div><p>暂时没有任何文章</p></div>
      </div>`;
    return;
  }

  const byYear = new Map();
  articles.forEach(a => {
    const y = new Date(a.createdAt).getFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(a);
  });

  const groups = [...byYear.entries()].map(([year, list]) => `
    <section class="archive-group">
      <h2 class="archive-year">${year}<span class="archive-year-count">${list.length} 篇</span></h2>
      ${list.map(a => `
        <div class="archive-item" onclick="go('/article/${a.id}')">
          <span class="archive-date">${fmtDate(a.createdAt, true)}</span>
          <span class="archive-item-title">${esc(a.title)}</span>
        </div>`).join('')}
    </section>`).join('');

  app.innerHTML = `
    <div class="page-archive">
      ${renderPageHeading('Archive', '归档', `共 ${articles.length} 篇文章`)}
      ${groups}
    </div>`;
}

// ─── View: Tags ───────────────────────────────────────────────────
function viewTags() {
  document.title = `标签 — ${CONFIG.title}`;
  const app = document.getElementById('app');
  const tags = allTagsWithCount();

  if (!tags.length) {
    app.innerHTML = `
      <div class="page-tags">
        ${renderPageHeading('Tags', '标签', '按主题浏览文章')}
        <div class="empty-state"><div class="empty-icon">🏷</div><p>暂时没有任何标签</p></div>
      </div>`;
    return;
  }

  const cloud = tags.map(([t, count]) => `
    <span class="tag-cloud-item" onclick="go('/tag/${encodeURIComponent(t)}')">
      ${esc(t)}<span class="tag-cloud-count">${count}</span>
    </span>`).join('');

  app.innerHTML = `
    <div class="page-tags">
      ${renderPageHeading('Tags', '标签', `共 ${tags.length} 个标签`)}
      <div class="tag-cloud">${cloud}</div>
    </div>`;
}

// ─── View: Tag (filtered) ─────────────────────────────────────────
function viewTag(tag) {
  document.title = `${tag} — ${CONFIG.title}`;
  const app = document.getElementById('app');
  const articles = articlesByTag(tag).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const heading = `
    <div class="page-heading">
      <div class="page-heading-eyebrow">Tag</div>
      <h1 class="page-heading-title">${esc(tag)}</h1>
      <p class="page-heading-desc">${articles.length} 篇文章 · <a href="#/tags" style="text-decoration:underline;text-underline-offset:3px">查看所有标签</a></p>
    </div>`;

  if (!articles.length) {
    app.innerHTML = `
      <div class="page-tag">
        ${heading}
        <div class="empty-state"><p>这个标签下还没有文章</p></div>
      </div>`;
    return;
  }

  const cards = articles.map(a => `
    <article class="card" onclick="go('/article/${a.id}')">
      <h2 class="card-title">${esc(a.title)}</h2>
      <p class="card-excerpt">${esc(excerpt(a.content))}</p>
      <div class="card-meta">
        <span class="meta-date">${fmtDate(a.createdAt)}</span>
        <span class="meta-dot"></span>
        <span class="meta-read">${readingTime(a.content)}</span>
      </div>
    </article>`).join('');

  app.innerHTML = `
    <div class="page-tag">
      ${heading}
      <div class="article-list">${cards}</div>
    </div>`;
}

// ─── View: About ──────────────────────────────────────────────────
function viewAbout() {
  document.title = `关于 — ${CONFIG.title}`;
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '关于', '一些不会过时的话')}
      <div class="about-content" id="about-content">${CONFIG.about}</div>
      <div class="about-edit-btn">
        <button class="btn btn-ghost" onclick="editAbout()">编辑这段内容</button>
      </div>
    </div>`;
}

function editAbout() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '编辑关于页面', '使用富文本编辑器')}
      <div class="rte-wrap" style="margin-top:1rem">
        <div class="toolbar" id="toolbar">
          <div class="tb-group">
            <button class="tb-btn" data-cmd="bold"><b>B</b></button>
            <button class="tb-btn" data-cmd="italic"><i>I</i></button>
            <button class="tb-btn" data-cmd="underline"><u>U</u></button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="h2">H2</button>
            <button class="tb-btn" data-cmd="h3">H3</button>
            <button class="tb-btn" data-cmd="p">¶</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="insertUnorderedList">• 列表</button>
            <button class="tb-btn" data-cmd="blockquote">引用</button>
            <button class="tb-btn" data-cmd="link">🔗</button>
          </div>
        </div>
        <div class="rte-area">
          <div id="rte" class="rte" contenteditable="true">${CONFIG.about}</div>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:1.25rem;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="go('/about')">取消</button>
        <button class="btn btn-primary" onclick="saveAbout()">保存</button>
      </div>
    </div>`;
  initEditor();
}

function saveAbout() {
  const content = document.getElementById('rte').innerHTML.trim();
  CONFIG.setAbout(content || DEFAULT_ABOUT);
  go('/about');
}

// ─── Helper: Page Heading ─────────────────────────────────────────
function renderPageHeading(eyebrow, title, desc) {
  return `
    <div class="page-heading">
      <div class="page-heading-eyebrow">${esc(eyebrow)}</div>
      <h1 class="page-heading-title">${esc(title)}</h1>
      ${desc ? `<p class="page-heading-desc">${desc}</p>` : ''}
    </div>`;
}

// ─── View: Editor ─────────────────────────────────────────────────
function viewEditor(id) {
  const a = id ? Store.get(id) : null;
  const app = document.getElementById('app');

  document.title = `${a ? '编辑文章' : '写文章'} — ${CONFIG.title}`;

  app.innerHTML = `
    <div class="page-editor">
      <div class="editor-topbar">
        <a href="${id ? '#/article/' + id : '#/'}" class="back-link">← 取消</a>
        <button class="btn btn-primary" onclick="saveArt('${id || ''}')">发布</button>
      </div>

      <input id="art-title" class="input-title" type="text"
        placeholder="文章标题…" value="${a ? esc(a.title) : ''}">

      <input id="art-tags" class="input-tags" type="text"
        placeholder="标签（用逗号分隔，如：技术, 生活, 随笔）"
        value="${a ? esc((a.tags || []).join(', ')) : ''}">

      <div class="rte-wrap">
        <div class="toolbar" id="toolbar">
          <div class="tb-group">
            <button class="tb-btn" data-cmd="bold"          title="粗体 Ctrl+B"><b>B</b></button>
            <button class="tb-btn" data-cmd="italic"        title="斜体 Ctrl+I"><i>I</i></button>
            <button class="tb-btn" data-cmd="underline"     title="下划线 Ctrl+U"><u>U</u></button>
            <button class="tb-btn" data-cmd="strikeThrough" title="删除线"><s>S</s></button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="h2"  title="二级标题">H2</button>
            <button class="tb-btn" data-cmd="h3"  title="三级标题">H3</button>
            <button class="tb-btn" data-cmd="p"   title="正文">¶</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="insertUnorderedList" title="无序列表">• 列表</button>
            <button class="tb-btn" data-cmd="insertOrderedList"   title="有序列表">1. 列表</button>
            <button class="tb-btn" data-cmd="blockquote"          title="引用块">引用</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="link"         title="插入链接">🔗</button>
            <button class="tb-btn" data-cmd="image"        title="插入图片">🖼</button>
            <button class="tb-btn" data-cmd="hr"           title="分隔线">—</button>
            <button class="tb-btn" data-cmd="removeFormat" title="清除格式">✕</button>
          </div>
          <span class="tb-sep"></span>
          <div class="tb-group">
            <button class="tb-btn" data-cmd="undo" title="撤销 Ctrl+Z">↩</button>
            <button class="tb-btn" data-cmd="redo" title="重做 Ctrl+Y">↪</button>
          </div>
        </div>

        <div class="rte-area">
          <div id="rte" class="rte" contenteditable="true">${a ? a.content : ''}</div>
          <div id="rte-ph" class="rte-ph" aria-hidden="true">在这里开始写作…</div>
        </div>
      </div>

      <div class="editor-footer">
        <span id="word-count" class="word-count">0 字</span>
      </div>
    </div>`;

  initEditor();
}

// ─── Editor Logic ─────────────────────────────────────────────────
function initEditor() {
  const toolbar = document.getElementById('toolbar');
  const rte     = document.getElementById('rte');
  const wcEl    = document.getElementById('word-count');
  if (!rte) return;

  function checkEmpty() {
    const empty = rte.innerText.replace(/[\n\r]/g, '').trim() === '';
    const ph = document.getElementById('rte-ph');
    if (ph) ph.classList.toggle('visible', empty);
  }

  function updateCount() {
    if (!wcEl) return;
    const n = rte.innerText.trim().replace(/\s+/g, '').length;
    wcEl.textContent = n + ' 字';
  }

  function updateStates() {
    const stateful = ['bold', 'italic', 'underline', 'strikeThrough',
                      'insertUnorderedList', 'insertOrderedList'];
    document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
      if (!stateful.includes(btn.dataset.cmd)) return;
      try { btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd)); }
      catch (_) {}
    });
  }

  toolbar.addEventListener('mousedown', e => {
    const btn = e.target.closest('.tb-btn');
    if (!btn) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;

    if (['h2', 'h3'].includes(cmd))      document.execCommand('formatBlock', false, cmd);
    else if (cmd === 'p')                 document.execCommand('formatBlock', false, 'p');
    else if (cmd === 'blockquote')        document.execCommand('formatBlock', false, 'blockquote');
    else if (cmd === 'link') {
      const url = prompt('请输入链接地址：', 'https://');
      if (url && url.trim()) document.execCommand('createLink', false, url.trim());
    } else if (cmd === 'image') {
      const url = prompt('请输入图片链接地址：', 'https://');
      if (url && url.trim()) document.execCommand('insertImage', false, url.trim());
    } else if (cmd === 'hr')              document.execCommand('insertHTML', false, '<hr>');
    else                                   document.execCommand(cmd, false, null);

    rte.focus();
    updateStates();
    updateCount();
  });

  rte.addEventListener('input',  () => { updateCount(); updateStates(); checkEmpty(); });
  rte.addEventListener('keyup',  updateStates);
  rte.addEventListener('mouseup', updateStates);

  rte.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  updateCount();
  requestAnimationFrame(checkEmpty);
}

function saveArt(id) {
  const title   = document.getElementById('art-title').value.trim();
  const tagsRaw = document.getElementById('art-tags').value.trim();
  const content = document.getElementById('rte').innerHTML.trim();

  if (!title) { alert('请输入文章标题'); document.getElementById('art-title').focus(); return; }
  if (!content || content === '<br>') {
    alert('请输入文章内容'); document.getElementById('rte').focus(); return;
  }

  const tags      = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const now       = new Date().toISOString();
  const existing  = id ? Store.get(id) : null;
  const articleId = id || uid();

  Store.upsert({
    id: articleId,
    title, content, tags,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  });

  go('/article/' + articleId);
}

// ─── Search Modal ─────────────────────────────────────────────────
let searchFocusIdx = -1;
let searchHits = [];

function initSearch() {
  const modal   = document.getElementById('search-modal');
  const input   = document.getElementById('search-input');
  const btn     = document.getElementById('search-btn');
  const results = document.getElementById('search-results');

  btn.addEventListener('click', openSearch);

  modal.addEventListener('click', e => {
    if (e.target.dataset.close !== undefined) closeSearch();
  });

  input.addEventListener('input', () => {
    runSearch(input.value);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearch(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchFocusIdx = Math.min(searchFocusIdx + 1, searchHits.length - 1);
      paintFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchFocusIdx = Math.max(searchFocusIdx - 1, 0);
      paintFocus();
    } else if (e.key === 'Enter') {
      if (searchHits[searchFocusIdx]) {
        const id = searchHits[searchFocusIdx].id;
        closeSearch();
        go('/article/' + id);
      }
    }
  });

  function paintFocus() {
    results.querySelectorAll('.search-item').forEach((el, i) => {
      el.classList.toggle('focused', i === searchFocusIdx);
    });
    const focused = results.querySelector('.search-item.focused');
    if (focused) focused.scrollIntoView({ block: 'nearest' });
  }
}

function openSearch() {
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-input');
  modal.hidden = false;
  input.value = '';
  searchFocusIdx = -1;
  searchHits = [];
  runSearch('');
  setTimeout(() => input.focus(), 50);
}

function closeSearch() {
  document.getElementById('search-modal').hidden = true;
}

function runSearch(q) {
  const results = document.getElementById('search-results');
  const query = q.trim().toLowerCase();
  const all = Store.getAll();

  if (!query) {
    searchHits = all.slice(0, 8);
    results.innerHTML = searchHits.length
      ? searchHits.map(a => renderSearchItem(a, '')).join('')
      : `<div class="search-empty">还没有文章</div>`;
    searchFocusIdx = searchHits.length ? 0 : -1;
    return;
  }

  searchHits = all.filter(a => {
    const hay = (a.title + ' ' + stripTags(a.content) + ' ' + (a.tags || []).join(' ')).toLowerCase();
    return hay.includes(query);
  });

  if (!searchHits.length) {
    results.innerHTML = `<div class="search-empty">没有找到与「${esc(q)}」相关的文章</div>`;
    searchFocusIdx = -1;
    return;
  }

  results.innerHTML = searchHits.slice(0, 20).map(a => renderSearchItem(a, query)).join('');
  searchFocusIdx = 0;
  results.querySelector('.search-item')?.classList.add('focused');
}

function renderSearchItem(a, query) {
  return `
    <div class="search-item" onclick="closeSearch();go('/article/${a.id}')">
      <div class="search-item-title">${highlight(a.title, query)}</div>
      <div class="search-item-snippet">${highlight(excerpt(a.content, 90), query)}</div>
    </div>`;
}

function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(rx, m => `<span class="search-hit">${m}</span>`);
}

// ─── Keyboard ─────────────────────────────────────────────────────
function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Cmd/Ctrl+K opens search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape' &&
               !document.getElementById('search-modal').hidden) {
      closeSearch();
    }
  });
}
