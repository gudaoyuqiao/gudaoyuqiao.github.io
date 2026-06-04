// ─── Firebase imports ─────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import {
  getAuth, signInWithPopup, GithubAuthProvider, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import {
  getFirestore, collection, doc, query, where, orderBy, limit,
  getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

// ─── Firebase init ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA9_hLxZ1cRuPqkUyq0V6337Fo8zbMAA-Q",
  authDomain: "gudaoyuqiao-blog.firebaseapp.com",
  projectId: "gudaoyuqiao-blog",
  storageBucket: "gudaoyuqiao-blog.firebasestorage.app",
  messagingSenderId: "216006140355",
  appId: "1:216006140355:web:0eac5d2235b7d2e9691d76"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const githubProvider = new GithubAuthProvider();

// Owner Firebase UID — must match Firestore security rules.
// Knowing this is not a security risk; rules enforce it server-side.
const OWNER_UID = 'Alyn0DmpNdbMPsdSBWzn7qoy8zD3';
function isOwner() { return currentUser?.uid === OWNER_UID; }

// ─── Site Config ──────────────────────────────────────────────────
const SITE = {
  title: 'My Blog',
  subtitle: '记录思考，分享生活',
  about: `<h2>关于我</h2>
<p>你好，欢迎来到我的小角落。</p>
<p>这里记录了我的思考、阅读和生活片段。如果你也喜欢慢慢写、慢慢读，那我们或许会成为朋友。</p>
<h3>关于本站</h3>
<p>这是一个用 HTML / CSS / JavaScript 构建的极简博客，数据存在 Firebase，部署在 GitHub Pages。</p>
<blockquote>真正重要的事情，需要时间。</blockquote>`,
};
const DEFAULT_ABOUT = SITE.about;

async function loadSiteSettings() {
  try {
    const d = await getDoc(doc(db, 'settings', 'site'));
    if (d.exists()) {
      const data = d.data();
      if (data.title)    SITE.title    = data.title;
      if (data.subtitle) SITE.subtitle = data.subtitle;
      if (data.about)    SITE.about    = data.about;
    }
  } catch (e) { console.warn('site settings load failed', e); }
}

async function saveAboutToCloud(content) {
  SITE.about = content;
  await setDoc(doc(db, 'settings', 'site'), { about: content }, { merge: true });
}

// ─── Auth State ───────────────────────────────────────────────────
let currentUser = null;
let authReady = false;
let pendingRoute = false;

onAuthStateChanged(auth, async (user) => {
  const wasSignedIn = !!currentUser;
  currentUser = user;
  authReady = true;
  updateAuthUI();
  if (user && !wasSignedIn) {
    // Just signed in — try seeding empty DB
    await seedIfEmpty();
  }
  if (pendingRoute) { pendingRoute = false; route(); }
  else if (wasSignedIn !== !!user) route();
});

function updateAuthUI() {
  const writeBtn = document.getElementById('write-btn');
  if (writeBtn) writeBtn.hidden = !isOwner();
}

async function loginWithGithub() {
  try {
    await signInWithPopup(auth, githubProvider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') return;
    const msg = e.code === 'auth/unauthorized-domain'
      ? '当前域名未加入 Firebase 授权域名列表。需要在 Firebase Console → Authentication → Settings → Authorized domains 里加入 ' + location.hostname
      : (e.message || e.code);
    alert('登录失败：' + msg);
  }
}

async function logoutAction() {
  if (!confirm('确定要登出吗？')) return;
  await signOut(auth);
  go('/');
}

// ─── Store (Firestore) ────────────────────────────────────────────
function toArticle(d) {
  const data = d.data();
  const toIso = ts => ts?.toDate ? ts.toDate().toISOString() : (ts || new Date().toISOString());
  return {
    id: d.id,
    title:      data.title || '',
    content:    data.content || '',
    tags:       data.tags || [],
    visibility: data.visibility || 'public',
    authorUid:  data.authorUid || '',
    authorName: data.authorName || '',
    createdAt:  toIso(data.createdAt),
    updatedAt:  toIso(data.updatedAt),
  };
}

const Store = {
  async getAll() {
    try {
      let q;
      if (isOwner()) {
        q = query(collection(db, 'articles'), orderBy('createdAt', 'desc'));
      } else {
        q = query(collection(db, 'articles'),
          where('visibility', '==', 'public'),
          orderBy('createdAt', 'desc'));
      }
      const snap = await getDocs(q);
      return snap.docs.map(toArticle);
    } catch (e) {
      console.error('getAll failed', e);
      return [];
    }
  },

  async get(id) {
    try {
      const d = await getDoc(doc(db, 'articles', id));
      return d.exists() ? toArticle(d) : null;
    } catch (e) { console.error(e); return null; }
  },

  async create(a) {
    if (!currentUser) throw new Error('请先登录');
    const data = {
      title:      a.title,
      content:    a.content,
      tags:       a.tags || [],
      visibility: a.visibility || 'public',
      authorUid:  currentUser.uid,
      authorName: currentUser.displayName || currentUser.providerData[0]?.displayName || 'Owner',
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp(),
    };
    const r = await addDoc(collection(db, 'articles'), data);
    return r.id;
  },

  async update(id, a) {
    if (!currentUser) throw new Error('请先登录');
    await updateDoc(doc(db, 'articles', id), {
      title:      a.title,
      content:    a.content,
      tags:       a.tags || [],
      visibility: a.visibility || 'public',
      updatedAt:  serverTimestamp(),
    });
  },

  async remove(id) {
    if (!currentUser) throw new Error('请先登录');
    await deleteDoc(doc(db, 'articles', id));
  },
};

// ─── Sample seed for first-time owner ─────────────────────────────
async function seedIfEmpty() {
  if (!isOwner()) return;
  try {
    const snap = await getDocs(query(collection(db, 'articles'), limit(1)));
    if (!snap.empty) return;
  } catch { return; }

  const now = Date.now();
  const days = n => Timestamp.fromDate(new Date(now - n * 86400000));
  const seeds = [
    {
      title: '欢迎来到我的博客',
      content: `<p>这是我的个人博客，用 HTML / CSS / JavaScript 构建，账号系统和数据存在 Firebase，部署在 GitHub Pages 上。</p>
<h2>它能做什么</h2>
<ul>
<li>用网页内的富文本编辑器直接写文章</li>
<li>顶部菜单可以快速跳转到归档、标签、关于</li>
<li>右上角的搜索按钮可以全文搜索</li>
<li>每篇文章可以设为公开或仅自己可见</li>
<li>用 GitHub 账号登录后才能写作</li>
</ul>
<blockquote>公开文章对所有访客可见，私密文章只有你登录后能看到。</blockquote>`,
      tags: ['指南', '介绍'],
      daysAgo: 0,
    },
    {
      title: '为什么我开始写博客',
      content: `<p>很多人写博客是为了被看见，而我写博客是为了把自己看清楚。</p>
<p>当一个想法只在脑子里翻滚时，它常常是模糊的、自我感觉良好的；但当你尝试把它写下来时，逻辑里的洞、表达上的笨拙、情绪里的躲闪，会一个个被照出来。</p>
<h2>写作是诚实的工具</h2>
<p>你不可能糊弄文字。你可以糊弄聊天，可以糊弄会议，但写作要求你把每个词都安放到位。这种安放本身就是一次思想的整理。</p>
<blockquote>我手写我心，心也因此越来越清晰。</blockquote>`,
      tags: ['随笔', '写作'],
      daysAgo: 3,
    },
    {
      title: '关于慢的力量',
      content: `<p>这是一个崇拜速度的时代。两倍速听播客，三天读一本书，五分钟看完一部电影。</p>
<p>但有些东西无法被加速：信任、理解、爱、深度的快乐。它们只能慢慢生长。</p>
<h2>慢不是落后</h2>
<p>慢是一种主动的选择。是当所有人都在抢答时，你愿意先听完问题。</p>`,
      tags: ['随笔', '思考'],
      daysAgo: 10,
    },
  ];

  for (const s of seeds) {
    try {
      await addDoc(collection(db, 'articles'), {
        title: s.title, content: s.content, tags: s.tags,
        visibility: 'public',
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || 'Owner',
        createdAt: days(s.daysAgo),
        updatedAt: days(s.daysAgo),
      });
    } catch (e) { console.warn('seed item failed', e); }
  }
}

// ─── Utilities ────────────────────────────────────────────────────
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

function canEdit(article) {
  return isOwner() && article.authorUid === currentUser.uid;
}

// ─── Router ───────────────────────────────────────────────────────
function go(path) { window.location.hash = '#' + path; }
window.go = go;

const ROUTES = [
  [/^\/$/,                  () => viewHome()],
  [/^\/article\/([^/]+)$/,  m => viewArticle(m[1])],
  [/^\/editor$/,            () => viewEditor(null)],
  [/^\/editor\/([^/]+)$/,   m => viewEditor(m[1])],
  [/^\/archive$/,           () => viewArchive()],
  [/^\/tags$/,              () => viewTags()],
  [/^\/tag\/(.+)$/,         m => viewTag(decodeURIComponent(m[1]))],
  [/^\/about$/,             () => viewAbout()],
  [/^\/settings$/,          () => viewSettings()],
];

async function route() {
  if (!authReady) { pendingRoute = true; return; }
  const path = window.location.hash.replace(/^#/, '') || '/';
  syncNavActive(path);
  updateAuthUI();
  const app = document.getElementById('app');
  for (const [rx, fn] of ROUTES) {
    const m = path.match(rx);
    if (m) {
      try {
        app.innerHTML = `<div class="loading">加载中…</div>`;
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
  app.innerHTML = `<div class="error-page"><h2>页面不存在</h2><a href="#/">← 返回首页</a></div>`;
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
window.addEventListener('load', async () => {
  document.getElementById('nav-brand').textContent = SITE.title;
  document.getElementById('footer-brand').textContent = SITE.title;
  initSearch();
  initKeyboard();
  await loadSiteSettings();
  document.getElementById('nav-brand').textContent = SITE.title;
  document.getElementById('footer-brand').textContent = SITE.title;
  if (authReady) route();
});

// ─── View: Home ───────────────────────────────────────────────────
async function viewHome() {
  document.title = SITE.title;
  const articles = await Store.getAll();
  const app = document.getElementById('app');

  const hero = `
    <div class="hero">
      <h1 class="hero-title">${esc(SITE.title)}</h1>
      <p class="hero-subtitle">${esc(SITE.subtitle)}</p>
    </div>`;

  if (!articles.length) {
    app.innerHTML = `
      <div class="page-home">
        ${hero}
        <div class="empty-state">
          <div class="empty-icon">✒</div>
          <p>${isOwner() ? '还没有文章，来写第一篇吧' : '博主还没有发布任何文章'}</p>
          ${isOwner() ? `<a href="#/editor" class="btn btn-primary btn-lg">写第一篇文章</a>` : ''}
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

  app.innerHTML = `<div class="page-home">${hero}<div class="article-list">${cards}</div></div>`;
}

// ─── View: Article ────────────────────────────────────────────────
async function viewArticle(id) {
  const a = await Store.get(id);
  const app = document.getElementById('app');

  if (!a) {
    app.innerHTML = `<div class="error-page"><h2>文章不存在</h2><a href="#/">← 返回首页</a></div>`;
    return;
  }

  document.title = `${a.title} — ${SITE.title}`;

  const ownerActions = canEdit(a) ? `
    <div class="article-btns">
      <button class="btn btn-ghost" onclick="go('/editor/${a.id}')">编辑</button>
      <button class="btn btn-ghost btn-danger" onclick="window.deleteArt('${a.id}')">删除</button>
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
  try {
    document.getElementById('app').innerHTML = `<div class="loading">删除中…</div>`;
    await Store.remove(id);
    go('/');
  } catch (e) {
    alert('删除失败：' + e.message);
    route();
  }
}
window.deleteArt = deleteArt;

// ─── View: Archive ────────────────────────────────────────────────
async function viewArchive() {
  document.title = `归档 — ${SITE.title}`;
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
  document.title = `标签 — ${SITE.title}`;
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

// ─── View: Tag ────────────────────────────────────────────────────
async function viewTag(tag) {
  document.title = `${tag} — ${SITE.title}`;
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
      <div class="page-tag">${heading}
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

  app.innerHTML = `<div class="page-tag">${heading}<div class="article-list">${cards}</div></div>`;
}

// ─── View: About ──────────────────────────────────────────────────
async function viewAbout() {
  document.title = `关于 — ${SITE.title}`;
  const app = document.getElementById('app');
  const editBtn = isOwner()
    ? `<div class="about-edit-btn"><button class="btn btn-ghost" onclick="window.editAbout()">编辑这段内容</button></div>`
    : '';
  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '关于', '一些不会过时的话')}
      <div class="about-content" id="about-content">${SITE.about}</div>
      ${editBtn}
    </div>`;
}

function editAbout() {
  if (!isOwner()) return;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-about">
      ${renderPageHeading('About', '编辑关于页面', '使用富文本编辑器')}
      <div class="rte-wrap" style="margin-top:1rem">
        ${renderToolbar()}
        <div class="rte-area">
          <div id="rte" class="rte" contenteditable="true">${SITE.about}</div>
        </div>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:1.25rem;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="go('/about')">取消</button>
        <button class="btn btn-primary" onclick="window.saveAbout()">保存</button>
      </div>
      <div id="editor-banner"></div>
    </div>`;
  initEditor();
}
window.editAbout = editAbout;

async function saveAbout() {
  const content = document.getElementById('rte').innerHTML.trim();
  const banner = document.getElementById('editor-banner');
  try {
    banner.innerHTML = `<div class="banner banner-info">保存中…</div>`;
    await saveAboutToCloud(content || DEFAULT_ABOUT);
    go('/about');
  } catch (e) {
    banner.innerHTML = `<div class="banner banner-error">保存失败：${esc(e.message)}</div>`;
  }
}
window.saveAbout = saveAbout;

// ─── View: Settings ───────────────────────────────────────────────
function viewSettings() {
  document.title = `设置 — ${SITE.title}`;
  const app = document.getElementById('app');

  if (currentUser) {
    const provider = currentUser.providerData[0] || {};
    const ghName = provider.displayName || currentUser.displayName || provider.email || 'GitHub user';
    const photo = currentUser.photoURL
      ? `<img src="${esc(currentUser.photoURL)}" style="width:48px;height:48px;border-radius:50%" alt="">`
      : '';
    const owner = isOwner();
    const roleLabel = owner ? '主人模式' : '已登录访客';
    const dotClass = owner ? 'owner' : 'visitor';
    const description = owner
      ? `<p class="settings-help">
            可以写、改、删自己的文章。可见性「公开」对所有访客可见；「仅自己」只有你登录后能看到。
            权限隔离由 Firebase 服务器强制，访客即使打开浏览器开发者工具也绕不过。
          </p>`
      : `<p class="settings-help">
            你已登录，但不是这个博客的拥有者。可以读公开文章，但无法写入。
            如果你以为自己应该是拥有者，检查一下 Firestore 安全规则里指定的 UID 是否与下面这个 UID 匹配。
          </p>`;
    app.innerHTML = `
      <div class="page-settings">
        ${renderPageHeading('Settings', '设置', '账号与站点配置')}

        <div class="identity-card" style="padding:1.25rem">
          ${photo || `<div class="identity-dot ${dotClass}"></div>`}
          <div class="identity-text">
            <div class="identity-role">${esc(ghName)} · ${roleLabel}</div>
            <div class="identity-sub">UID: <code style="font-size:.78rem">${esc(currentUser.uid)}</code></div>
          </div>
        </div>

        <section class="settings-section">
          ${description}
        </section>

        <div class="settings-actions">
          <button class="btn btn-ghost btn-danger" onclick="window.logoutAction()">登出</button>
        </div>
      </div>`;
  } else {
    app.innerHTML = `
      <div class="page-settings">
        ${renderPageHeading('Settings', '设置', '登录后可以写文章')}

        <div class="identity-card">
          <div class="identity-dot visitor"></div>
          <div class="identity-text">
            <div class="identity-role">访客模式</div>
            <div class="identity-sub">登录后才能写、编辑、删除文章</div>
          </div>
        </div>

        <section class="settings-section">
          <p class="settings-help">用 GitHub 账号登录。只有博客的拥有者（在 Firebase 安全规则里指定的 UID）能写文章；其他人即使登录也只能读公开内容。</p>
        </section>

        <div class="settings-actions">
          <button class="btn btn-primary btn-lg" onclick="window.loginWithGithub()">
            <span style="display:inline-flex;align-items:center;gap:.5rem">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.6.5.5 5.6.5 12c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.8-1.4-3.8-1.4-.5-1.3-1.3-1.6-1.3-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.7 1.2 3.4.9.1-.7.4-1.2.7-1.5-2.5-.3-5.2-1.3-5.2-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.5 4.5-1.5 7.8-5.8 7.8-10.9C23.5 5.6 18.4.5 12 .5z"/>
              </svg>
              用 GitHub 登录
            </span>
          </button>
        </div>
      </div>`;
  }
}
window.logoutAction = logoutAction;
window.loginWithGithub = loginWithGithub;

// ─── Helpers ──────────────────────────────────────────────────────
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
        <button class="tb-btn" data-cmd="bold"><b>B</b></button>
        <button class="tb-btn" data-cmd="italic"><i>I</i></button>
        <button class="tb-btn" data-cmd="underline"><u>U</u></button>
        <button class="tb-btn" data-cmd="strikeThrough"><s>S</s></button>
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
        <button class="tb-btn" data-cmd="insertOrderedList">1. 列表</button>
        <button class="tb-btn" data-cmd="blockquote">引用</button>
      </div>
      <span class="tb-sep"></span>
      <div class="tb-group">
        <button class="tb-btn" data-cmd="link">🔗</button>
        <button class="tb-btn" data-cmd="image">🖼</button>
        <button class="tb-btn" data-cmd="hr">—</button>
        <button class="tb-btn" data-cmd="removeFormat">✕</button>
      </div>
      <span class="tb-sep"></span>
      <div class="tb-group">
        <button class="tb-btn" data-cmd="undo">↩</button>
        <button class="tb-btn" data-cmd="redo">↪</button>
      </div>
    </div>`;
}

// ─── View: Editor ─────────────────────────────────────────────────
async function viewEditor(id) {
  if (!isOwner()) {
    document.getElementById('app').innerHTML = `
      <div class="error-page">
        <h2>${currentUser ? '你不是博主' : '需要登录'}</h2>
        <p>${currentUser
          ? '只有博客的拥有者能写文章。'
          : '请先到 <a href="#/settings" style="color:var(--accent);text-decoration:underline">设置</a> 用 GitHub 登录后再写文章。'}</p>
      </div>`;
    return;
  }

  const a = id ? await Store.get(id) : null;

  if (id && !a) {
    document.getElementById('app').innerHTML = `<div class="error-page"><h2>文章不存在</h2></div>`;
    return;
  }
  if (a && !canEdit(a)) {
    document.getElementById('app').innerHTML = `<div class="error-page"><h2>你不是这篇文章的作者</h2></div>`;
    return;
  }

  const app = document.getElementById('app');
  const currentVis = a?.visibility || 'public';

  document.title = `${a ? '编辑文章' : '写文章'} — ${SITE.title}`;

  app.innerHTML = `
    <div class="page-editor">
      <div class="editor-topbar">
        <a href="${id ? '#/article/' + id : '#/'}" class="back-link">← 取消</a>
        <button class="btn btn-primary" id="publish-btn" onclick="window.saveArt('${id || ''}')">发布</button>
      </div>

      <input id="art-title" class="input-title" type="text"
        placeholder="文章标题…" value="${a ? esc(a.title) : ''}">

      <input id="art-tags" class="input-tags" type="text"
        placeholder="标签（用逗号分隔）"
        value="${a ? esc((a.tags || []).join(', ')) : ''}">

      <div class="visibility-row">
        <span class="visibility-label">可见性</span>
        <div class="vis-toggle">
          <input type="radio" id="vis-public"  name="visibility" value="public"  ${currentVis === 'public'  ? 'checked' : ''}>
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

      <div class="editor-footer"><span id="word-count" class="word-count">0 字</span></div>
      <div id="editor-banner"></div>
    </div>`;

  initEditor();

  const updateHint = () => {
    const v = document.querySelector('input[name="visibility"]:checked').value;
    document.getElementById('vis-hint').textContent =
      v === 'public' ? '所有访客都能看到' : '只有你登录后能看到';
  };
  document.querySelectorAll('input[name="visibility"]')
    .forEach(el => el.addEventListener('change', updateHint));
  updateHint();
}

function initEditor() {
  const toolbar = document.getElementById('toolbar');
  const rte = document.getElementById('rte');
  const wcEl = document.getElementById('word-count');
  if (!rte) return;

  function checkEmpty() {
    const empty = rte.innerText.replace(/[\n\r]/g, '').trim() === '';
    const ph = document.getElementById('rte-ph');
    if (ph) ph.classList.toggle('visible', empty);
  }
  function updateCount() {
    if (!wcEl) return;
    wcEl.textContent = rte.innerText.trim().replace(/\s+/g, '').length + ' 字';
  }
  function updateStates() {
    const stateful = ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'];
    document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
      if (!stateful.includes(btn.dataset.cmd)) return;
      try { btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd)); } catch {}
    });
  }

  toolbar.addEventListener('mousedown', e => {
    const btn = e.target.closest('.tb-btn');
    if (!btn) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    if (['h2','h3'].includes(cmd))    document.execCommand('formatBlock', false, cmd);
    else if (cmd === 'p')              document.execCommand('formatBlock', false, 'p');
    else if (cmd === 'blockquote')     document.execCommand('formatBlock', false, 'blockquote');
    else if (cmd === 'link') {
      const url = prompt('请输入链接地址：', 'https://');
      if (url && url.trim()) document.execCommand('createLink', false, url.trim());
    } else if (cmd === 'image') {
      const url = prompt('请输入图片链接地址：', 'https://');
      if (url && url.trim()) document.execCommand('insertImage', false, url.trim());
    } else if (cmd === 'hr')           document.execCommand('insertHTML', false, '<hr>');
    else                                document.execCommand(cmd, false, null);
    rte.focus();
    updateStates();
    updateCount();
  });

  rte.addEventListener('input',   () => { updateCount(); updateStates(); checkEmpty(); });
  rte.addEventListener('keyup',   updateStates);
  rte.addEventListener('mouseup', updateStates);
  rte.addEventListener('paste', e => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
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

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const articleData = { title, content, tags, visibility };

  publishBtn.disabled = true;
  publishBtn.textContent = '保存中…';
  if (banner) banner.innerHTML = '';

  try {
    let articleId = id;
    if (id) {
      await Store.update(id, articleData);
    } else {
      articleId = await Store.create(articleData);
    }
    go('/article/' + articleId);
  } catch (e) {
    if (banner) banner.innerHTML = `<div class="banner banner-error">保存失败：${esc(e.message)}</div>`;
    publishBtn.disabled = false;
    publishBtn.textContent = '重试';
  }
}
window.saveArt = saveArt;

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
    else if (e.key === 'ArrowDown') { e.preventDefault(); searchFocusIdx = Math.min(searchFocusIdx + 1, searchHits.length - 1); paintFocus(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); searchFocusIdx = Math.max(searchFocusIdx - 1, 0); paintFocus(); }
    else if (e.key === 'Enter') {
      if (searchHits[searchFocusIdx]) { const id = searchHits[searchFocusIdx].id; closeSearch(); go('/article/' + id); }
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
window.closeSearch = closeSearch;

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
    <div class="search-item" onclick="window.closeSearch();go('/article/${a.id}')">
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
