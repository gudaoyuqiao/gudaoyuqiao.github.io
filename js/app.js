'use strict';

// ─── Site Config (auto-detect + override) ─────────────────────────
const Config = {
  get title()    { return localStorage.getItem('blog_title')    || 'My Blog'; },
  get subtitle() { return localStorage.getItem('blog_subtitle') || '记录思考，分享生活'; },
  get about()    { return localStorage.getItem('blog_about')    || DEFAULT_ABOUT; },
  setAbout(v)    { localStorage.setItem('blog_about', v); },

  get token()    { return localStorage.getItem('gh_token') || ''; },
  set token(v)   { v ? localStorage.setItem('gh_token', v) : localStorage.removeItem('gh_token'); },
  get owner() {
    const stored = localStorage.getItem('gh_owner');
    if (stored) return stored;
    const host = location.hostname;
    if (host.endsWith('.github.io')) return host.split('.')[0];
    return '';
  },
  set owner(v) { v ? localStorage.setItem('gh_owner', v) : localStorage.removeItem('gh_owner'); },
  get repo() {
    const stored = localStorage.getItem('gh_repo');
    if (stored) return stored;
    const host = location.hostname;
    if (host.endsWith('.github.io')) return host;
    return '';
  },
  set repo(v)  { v ? localStorage.setItem('gh_repo', v) : localStorage.removeItem('gh_repo'); },
  get isOwner() { return !!this.token; },
};

const DEFAULT_ABOUT = `<h2>关于我</h2>
<p>你好，欢迎来到我的小角落。</p>
<p>这里记录了我的思考、阅读和生活片段。如果你也喜欢慢慢写、慢慢读，那我们或许会成为朋友。</p>
<h3>关于本站</h3>
<p>这是一个用 HTML / CSS / JavaScript 构建的极简博客，公开文章保存在 GitHub 仓库里。</p>
<blockquote>真正重要的事情，需要时间。</blockquote>`;

// ─── Remote (GitHub) ──────────────────────────────────────────────
const Remote = {
  cache: null,
  cacheSha: null,
  cacheLoaded: false,

  async fetchPublic() {
    try {
      const res = await fetch('data/public.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      this.cache = Array.isArray(data) ? data : [];
      this.cacheLoaded = true;
      return this.cache;
    } catch (e) {
      console.error('Failed to fetch public.json', e);
      this.cache = [];
      this.cacheLoaded = true;
      return [];
    }
  },

  // Push the full list of public articles to data/public.json via GitHub Contents API
  async commit(articles, message) {
    if (!Config.token) throw new Error('请先在「设置」里配置 GitHub Token');
    if (!Config.owner || !Config.repo) throw new Error('请先在「设置」里配置仓库信息');

    const apiUrl = `https://api.github.com/repos/${Config.owner}/${Config.repo}/contents/data/public.json`;

    // Always GET to fetch current sha (file may have been updated by another device)
    let sha = null;
    try {
      const r = await fetch(apiUrl, { headers: this.headers() });
      if (r.ok) sha = (await r.json()).sha;
      else if (r.status !== 404) {
        const t = await r.text();
        throw new Error(`读取 public.json 失败：${r.status} ${t.slice(0, 200)}`);
      }
    } catch (e) {
      if (e.message.includes('public.json 失败')) throw e;
      // Network error; keep going without sha (will fail if file exists)
    }

    const sorted = [...articles].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt));
    const json = JSON.stringify(sorted, null, 2);
    const content = btoa(unescape(encodeURIComponent(json)));

    const body = { message: message || 'Update articles', content };
    if (sha) body.sha = sha;

    const r2 = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r2.ok) {
      const errText = await r2.text();
      let hint = '';
      if (r2.status === 401) hint = ' Token 无效或已过期。';
      else if (r2.status === 403) hint = ' Token 权限不足，需要 Contents: read/write 权限。';
      else if (r2.status === 404) hint = ' 仓库或路径不存在，检查仓库名。';
      throw new Error(`GitHub 推送失败：${r2.status}.${hint}`);
    }

    this.cache = sorted;
    return r2.json();
  },

  headers() {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${Config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  },
};

// ─── Store (local + remote merge) ─────────────────────────────────
const Store = {
  getLocal() {
    try { return JSON.parse(localStorage.getItem('blog_articles') || '[]'); }
    catch { return []; }
  },

  saveLocal(articles) { localStorage.setItem('blog_articles', JSON.stringify(articles)); },

  // Sync remote public → local for owner: ensures local has all published articles
  async syncRemoteIntoLocal() {
    if (!Config.isOwner) return;
    if (!Remote.cacheLoaded) await Remote.fetchPublic();
    const remote = Remote.cache || [];
    const local = this.getLocal();
    const byId = new Map(local.map(a => [a.id, a]));

    let changed = false;
    remote.forEach(r => {
      const tagged = { ...r, visibility: 'public' };
      const existing = byId.get(r.id);
      if (!existing) {
        local.push(tagged);
        changed = true;
      } else if (new Date(r.updatedAt) > new Date(existing.updatedAt)) {
        Object.assign(existing, tagged);
        changed = true;
      }
    });
    if (changed) this.saveLocal(local);
  },

  // The merged view shown to the user (depending on isOwner)
  async getAll() {
    if (!Remote.cacheLoaded) await Remote.fetchPublic();

    if (Config.isOwner) {
      await this.syncRemoteIntoLocal();
      const local = this.getLocal();
      // Normalize missing visibility → treat as private (safe default)
      local.forEach(a => { if (!a.visibility) a.visibility = 'private'; });
      return [...local].sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt));
    }

    return [...(Remote.cache || [])].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt));
  },

  async get(id) {
    const all = await this.getAll();
    return all.find(a => a.id === id) || null;
  },

  // Save (insert or update) — handles remote sync if needed
  async upsert(article) {
    const local = this.getLocal();
    const prev = local.find(a => a.id === article.id);
    const wasPublic = prev && prev.visibility === 'public';

    const i = local.findIndex(a => a.id === article.id);
    if (i >= 0) local[i] = article;
    else local.unshift(article);
    this.saveLocal(local);

    const isPublic = article.visibility === 'public';
    // Sync when: now public, or was public (transitioning to private requires remote removal)
    if ((isPublic || wasPublic) && Config.isOwner) {
      await this.syncPublic();
    }
  },

  async remove(id) {
    const local = this.getLocal();
    const target = local.find(a => a.id === id);
    const wasPublic = target && target.visibility === 'public';

    this.saveLocal(local.filter(a => a.id !== id));

    if (wasPublic && Config.isOwner) await this.syncPublic();
  },

  // Push all local visibility=public articles to data/public.json
  async syncPublic() {
    const publics = this.getLocal().filter(a => a.visibility === 'public');
    await Remote.commit(publics, `Update articles (${publics.length})`);
  },
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

function readingTime(html) {
  const text = stripTags(html);
  const cjk = (text.match(/[一-龥　-〿]/g) || []).length;
  const other = text.replace(/[一-龥　-〿]/g, '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(cjk / 300 + other / 200));
  return `约 ${minutes} 分钟阅读`;
}

async function allTagsWithCount() {
  const counts = new Map();
  (await Store.getAll()).forEach(a =>
    (a.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function lockBadge(visibility) {
  return visibility === 'private'
    ? `<span class="lock-badge">🔒 仅自己可见</span>`
    : '';
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
  [/^\/settings$/,               () => viewSettings()],
];

async function route() {
  const path = window.location.hash.replace(/^#/, '') || '/';
  syncNavActive(path);
  syncOwnerUI();

  // Show loading while routing async views
  const app = document.getElementById('app');
  for (const [rx, fn] of ROUTES) {
    const m = path.match(rx);
    if (m) {
      try {
        if (!Remote.cacheLoaded) {
          app.innerHTML = `<div class="loading">加载中…</div>`;
        }
        await fn(m);
      } catch (err) {
        console.error(err);
        app.innerHTML = `
          <div class="error-page">
            <h2>出错了</h2>
            <p>${esc(err.message || String(err))}</p>
            <a href="#/">← 返回首页</a>
          </div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML =
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

function syncOwnerUI() {
  const writeBtn = document.getElementById('write-btn');
  if (writeBtn) writeBtn.hidden = !Config.isOwner;
}

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  document.getElementById('nav-brand').textContent = Config.title;
  document.getElementById('footer-brand').textContent = Config.title;
  initSearch();
  initKeyboard();
  // Pre-fetch public articles so search and routing have data
  await Remote.fetchPublic();
  await route();
});

// ─── View: Home ───────────────────────────────────────────────────
async function viewHome() {
  document.title = Config.title;
  const articles = await Store.getAll();
  const app = document.getElementById('app');

  const hero = `
    <div class="hero">
      <h1 class="hero-title">${esc(Config.title)}</h1>
      <p class="hero-subtitle">${esc(Config.subtitle)}</p>
    </div>`;

  if (!articles.length) {
    app.innerHTML = `
      <div class="page-home">
        ${hero}
        <div class="empty-state">
          <div class="empty-icon">✒</div>
          <p>${Config.isOwner ? '还没有文章，来写第一篇吧' : '博主还没有发布任何文章'}</p>
          ${Config.isOwner
            ? `<a href="#/editor" class="btn btn-primary btn-lg">写第一篇文章</a>`
            : ''}
        </div>
      </div>`;
    return;
  }

  const cards = articles.map(a => `
    <article class="card" onclick="go('/article/${a.id}')">
      <h2 class="card-title">${esc(a.title)}${lockBadge(a.visibility)}</h2>
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
async function viewArticle(id) {
  const a = await Store.get(id);
  const app = document.getElementById('app');

  if (!a) {
    app.innerHTML = `<div class="error-page"><h2>文章不存在</h2><a href="#/">← 返回首页</a></div>`;
    return;
  }

  document.title = `${a.title} — ${Config.title}`;

  const ownerActions = Config.isOwner ? `
    <div class="article-btns">
      <button class="btn btn-ghost" onclick="go('/editor/${a.id}')">编辑</button>
      <button class="btn btn-ghost btn-danger" onclick="deleteArt('${a.id}')">删除</button>
    </div>` : `<div></div>`;

  app.innerHTML = `
    <div class="page-article">
      <div class="article-topbar">
        <a href="#/" class="back-link">← 返回</a>
        ${ownerActions}
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
          ${a.visibility === 'private' ? lockBadge('private') : ''}
        </header>
        <div class="art-body">${a.content}</div>
      </article>
    </div>`;
}

async function deleteArt(id) {
  if (!confirm('确定要删除这篇文章吗？此操作无法撤销。')) return;
  const target = (await Store.getAll()).find(a => a.id === id);
  const willPushRemote = target && target.visibility === 'public';

  try {
    if (willPushRemote) {
      // Show in-page loading by replacing the article view
      document.getElementById('app').innerHTML = `<div class="loading">正在从 GitHub 删除…</div>`;
    }
    await Store.remove(id);
    go('/');
  } catch (err) {
    alert('删除失败：' + (err.message || err));
    route();
  }
}

// ─── View: Archive ────────────────────────────────────────────────
async function viewArchive() {
  document.title = `归档 — ${Config.title}`;
  const app = document.getElementById('app');
  const articles = (await Store.getAll()).sort(
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
          <span class="archive-item-title">${esc(a.title)}${lockBadge(a.visibility)}</span>
        </div>`).join('')}
    </section>`).join('');

  app.innerHTML = `
    <div class="page-archive">
      ${renderPageHeading('Archive', '归档', `共 ${articles.length} 篇文章`)}
      ${groups}
    </div>`;
}

// ─── View: Tags ───────────────────────────────────────────────────
async function viewTags() {
  document.title = `标签 — ${Config.title}`;
  const app = document.getElementById('app');
  const tags = await allTagsWithCount();

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
async function viewTag(tag) {
  document.title = `${tag} — ${Config.title}`;
  const app = document.getElementById('app');
  const articles = (await Store.getAll())
    .filter(a => (a.tags || []).includes(tag))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
      <h2 class="card-title">${esc(a.title)}${lockBadge(a.visibility)}</h2>
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
  document.title = `关于 — ${Config.title}`;
  const app = document.getElementById('app');

  const editBtn = Config.isOwner
    ? `<div class="about-edit-btn"><button class="btn btn-ghost" onclick="editAbout()">编辑这段内容</button></div>`
    : '';

  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '关于', '一些不会过时的话')}
      <div class="about-content" id="about-content">${Config.about}</div>
      ${editBtn}
    </div>`;
}

function editAbout() {
  if (!Config.isOwner) return;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '编辑关于页面', '使用富文本编辑器')}
      <div class="rte-wrap" style="margin-top:1rem">
        ${renderToolbar()}
        <div class="rte-area">
          <div id="rte" class="rte" contenteditable="true">${Config.about}</div>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:1.25rem;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="go('/about')">取消</button>
        <button class="btn btn-primary" onclick="saveAbout()">保存（仅本设备）</button>
      </div>
      <p class="settings-help" style="margin-top:1rem">「关于」页面内容只保存在你这台浏览器，访客看到的是默认版本。如需让访客也看到，需要直接修改源代码里的 <code>DEFAULT_ABOUT</code>。</p>
    </div>`;
  initEditor();
}

function saveAbout() {
  const content = document.getElementById('rte').innerHTML.trim();
  Config.setAbout(content || DEFAULT_ABOUT);
  go('/about');
}

// ─── View: Settings ───────────────────────────────────────────────
function viewSettings() {
  document.title = `设置 — ${Config.title}`;
  const app = document.getElementById('app');

  const isOwner = Config.isOwner;
  const identity = isOwner
    ? `<div class="identity-card">
         <div class="identity-dot owner"></div>
         <div class="identity-text">
           <div class="identity-role">主人模式</div>
           <div class="identity-sub">你可以写、编辑、发布文章</div>
         </div>
       </div>`
    : `<div class="identity-card">
         <div class="identity-dot visitor"></div>
         <div class="identity-text">
           <div class="identity-role">访客模式</div>
           <div class="identity-sub">只能阅读公开文章。配置 Token 即可解锁写作功能</div>
         </div>
       </div>`;

  app.innerHTML = `
    <div class="page-settings">
      ${renderPageHeading('Settings', '设置', '配置仓库连接与身份')}

      ${identity}

      <section class="settings-section">
        <label class="settings-label">GitHub 用户名</label>
        <input type="text" class="settings-input" id="cfg-owner"
          value="${esc(Config.owner)}" placeholder="例如：gudaoyuqiao">
        <p class="settings-help">部署仓库的 GitHub 账号。</p>
      </section>

      <section class="settings-section">
        <label class="settings-label">仓库名</label>
        <input type="text" class="settings-input" id="cfg-repo"
          value="${esc(Config.repo)}" placeholder="例如：gudaoyuqiao.github.io">
        <p class="settings-help">公开文章会被写入这个仓库的 <code>data/public.json</code>。</p>
      </section>

      <section class="settings-section">
        <label class="settings-label">Personal Access Token</label>
        <input type="password" class="settings-input" id="cfg-token"
          value="${esc(Config.token)}" placeholder="ghp_… 或 github_pat_…" autocomplete="off">
        <p class="settings-help">Token 只保存在你这台浏览器，不会上传到任何地方。</p>

        <details style="margin-top:1rem">
          <summary style="cursor:pointer;font-size:.88rem;color:var(--accent)">如何生成 Token？（点击展开步骤）</summary>
          <ol class="guide-list" style="margin-top:.75rem">
            <li>打开 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
            <li><b>Token name</b>：随便填，比如 <code>blog</code></li>
            <li><b>Expiration</b>：建议 90 天或自定义</li>
            <li><b>Repository access</b>：选 <code>Only select repositories</code> → 选 <code>${esc(Config.repo || '你的仓库')}</code></li>
            <li><b>Permissions → Repository permissions</b>：找到 <code>Contents</code>，改为 <code>Read and write</code></li>
            <li>点底部 <code>Generate token</code>，复制得到的字符串粘到上面的输入框</li>
          </ol>
        </details>
      </section>

      <div class="settings-actions">
        <button class="btn btn-primary" onclick="saveSettings()">保存设置</button>
        ${isOwner
          ? `<button class="btn btn-ghost btn-danger" onclick="logoutOwner()">登出（清除 Token）</button>`
          : ''}
      </div>

      <div id="settings-banner"></div>
    </div>`;
}

async function saveSettings() {
  const owner = document.getElementById('cfg-owner').value.trim();
  const repo  = document.getElementById('cfg-repo').value.trim();
  const token = document.getElementById('cfg-token').value.trim();
  const banner = document.getElementById('settings-banner');

  Config.owner = owner;
  Config.repo  = repo;
  Config.token = token;

  if (!token) {
    banner.innerHTML = `<div class="banner banner-info">设置已保存（未配置 Token，当前是访客模式）。</div>`;
    syncOwnerUI();
    return;
  }

  // Validate token by trying to access the repo
  banner.innerHTML = `<div class="banner banner-info">正在验证 Token…</div>`;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: Remote.headers(),
    });
    if (!r.ok) {
      if (r.status === 401) throw new Error('Token 无效或已过期');
      if (r.status === 404) throw new Error('仓库不存在或 Token 没有访问权限');
      throw new Error(`验证失败：${r.status}`);
    }
    const data = await r.json();
    if (!data.permissions || !data.permissions.push) {
      throw new Error('Token 缺少 Contents: read/write 权限');
    }
    banner.innerHTML = `<div class="banner banner-success">✓ 验证通过！现在你处于主人模式，可以写文章了。</div>`;
    syncOwnerUI();
    // Re-run viewSettings to refresh identity card
    setTimeout(() => viewSettings(), 800);
  } catch (err) {
    banner.innerHTML = `<div class="banner banner-error">${esc(err.message)}</div>`;
  }
}

function logoutOwner() {
  if (!confirm('登出后将无法再写或发布文章。继续吗？')) return;
  Config.token = '';
  syncOwnerUI();
  viewSettings();
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

function renderToolbar() {
  return `
    <div class="toolbar" id="toolbar">
      <div class="tb-group">
        <button class="tb-btn" data-cmd="bold"          title="粗体"><b>B</b></button>
        <button class="tb-btn" data-cmd="italic"        title="斜体"><i>I</i></button>
        <button class="tb-btn" data-cmd="underline"     title="下划线"><u>U</u></button>
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
        <button class="tb-btn" data-cmd="link"  title="插入链接">🔗</button>
        <button class="tb-btn" data-cmd="image" title="插入图片">🖼</button>
        <button class="tb-btn" data-cmd="hr"    title="分隔线">—</button>
        <button class="tb-btn" data-cmd="removeFormat" title="清除格式">✕</button>
      </div>
      <span class="tb-sep"></span>
      <div class="tb-group">
        <button class="tb-btn" data-cmd="undo" title="撤销">↩</button>
        <button class="tb-btn" data-cmd="redo" title="重做">↪</button>
      </div>
    </div>`;
}

// ─── View: Editor ─────────────────────────────────────────────────
async function viewEditor(id) {
  if (!Config.isOwner) {
    document.getElementById('app').innerHTML = `
      <div class="error-page">
        <h2>需要主人模式</h2>
        <p>请先到 <a href="#/settings" style="color:var(--accent);text-decoration:underline">设置</a> 配置 GitHub Token 后再写文章。</p>
      </div>`;
    return;
  }

  const a = id ? await Store.get(id) : null;
  const app = document.getElementById('app');
  const currentVis = a?.visibility || 'public';

  document.title = `${a ? '编辑文章' : '写文章'} — ${Config.title}`;

  app.innerHTML = `
    <div class="page-editor">
      <div class="editor-topbar">
        <a href="${id ? '#/article/' + id : '#/'}" class="back-link">← 取消</a>
        <button class="btn btn-primary" id="publish-btn" onclick="saveArt('${id || ''}')">发布</button>
      </div>

      <input id="art-title" class="input-title" type="text"
        placeholder="文章标题…" value="${a ? esc(a.title) : ''}">

      <input id="art-tags" class="input-tags" type="text"
        placeholder="标签（用逗号分隔，如：技术, 生活, 随笔）"
        value="${a ? esc((a.tags || []).join(', ')) : ''}">

      <div class="visibility-row">
        <span class="visibility-label">可见性</span>
        <div class="vis-toggle">
          <input type="radio" id="vis-public"  name="visibility" value="public" ${currentVis === 'public' ? 'checked' : ''}>
          <label for="vis-public">🌐 公开</label>
          <input type="radio" id="vis-private" name="visibility" value="private" ${currentVis === 'private' ? 'checked' : ''}>
          <label for="vis-private">🔒 仅自己</label>
        </div>
        <span class="vis-hint" id="vis-hint"></span>
      </div>

      <div class="rte-wrap">
        ${renderToolbar()}
        <div class="rte-area">
          <div id="rte" class="rte" contenteditable="true">${a ? a.content : ''}</div>
          <div id="rte-ph" class="rte-ph" aria-hidden="true">在这里开始写作…</div>
        </div>
      </div>

      <div class="editor-footer">
        <span id="word-count" class="word-count">0 字</span>
      </div>

      <div id="editor-banner"></div>
    </div>`;

  initEditor();

  // Visibility hint
  const updateHint = () => {
    const v = document.querySelector('input[name="visibility"]:checked').value;
    document.getElementById('vis-hint').textContent =
      v === 'public' ? '将提交到 GitHub，所有人可见' : '只保存在本设备，不会同步到 GitHub';
  };
  document.querySelectorAll('input[name="visibility"]')
    .forEach(el => el.addEventListener('change', updateHint));
  updateHint();
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

async function saveArt(id) {
  const title   = document.getElementById('art-title').value.trim();
  const tagsRaw = document.getElementById('art-tags').value.trim();
  const content = document.getElementById('rte').innerHTML.trim();
  const visibility = document.querySelector('input[name="visibility"]:checked').value;
  const banner = document.getElementById('editor-banner');
  const publishBtn = document.getElementById('publish-btn');

  if (!title) { alert('请输入文章标题'); document.getElementById('art-title').focus(); return; }
  if (!content || content === '<br>') {
    alert('请输入文章内容'); document.getElementById('rte').focus(); return;
  }

  const tags      = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const now       = new Date().toISOString();
  const existing  = id ? await Store.get(id) : null;
  const articleId = id || uid();

  const article = {
    id: articleId,
    title, content, tags, visibility,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  publishBtn.disabled = true;
  publishBtn.textContent = visibility === 'public' ? '推送到 GitHub…' : '保存中…';
  banner.innerHTML = '';

  try {
    await Store.upsert(article);
    go('/article/' + articleId);
  } catch (err) {
    banner.innerHTML = `<div class="banner banner-error">发布失败：${esc(err.message || String(err))}<br><br>文章已保存到本地，可以稍后重试。如果是 Token 问题，请到「设置」检查。</div>`;
    publishBtn.disabled = false;
    publishBtn.textContent = '重试发布';
  }
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

  input.addEventListener('input', () => runSearch(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch();
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
    results.querySelectorAll('.search-item').forEach((el, i) =>
      el.classList.toggle('focused', i === searchFocusIdx));
    const focused = results.querySelector('.search-item.focused');
    if (focused) focused.scrollIntoView({ block: 'nearest' });
  }
}

async function openSearch() {
  const modal = document.getElementById('search-modal');
  const input = document.getElementById('search-input');
  modal.hidden = false;
  input.value = '';
  searchFocusIdx = -1;
  searchHits = [];
  await runSearch('');
  setTimeout(() => input.focus(), 50);
}

function closeSearch() {
  document.getElementById('search-modal').hidden = true;
}

async function runSearch(q) {
  const results = document.getElementById('search-results');
  const query = q.trim().toLowerCase();
  const all = await Store.getAll();

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
      <div class="search-item-title">${highlight(a.title, query)}${a.visibility === 'private' ? ' 🔒' : ''}</div>
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape' &&
               !document.getElementById('search-modal').hidden) {
      closeSearch();
    }
  });
}
