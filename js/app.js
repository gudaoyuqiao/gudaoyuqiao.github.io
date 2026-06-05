// ─── Firebase imports ─────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import {
  getAuth, signInWithPopup, GithubAuthProvider, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import {
  getFirestore, collection, doc, query, where, orderBy, limit,
  getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, Timestamp, arrayUnion, arrayRemove
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
// Request scope needed to push images to the blog's repo.
githubProvider.addScope('public_repo');

// Repo where uploaded images get stored. Same as the blog repo.
const IMG_REPO_OWNER = 'gudaoyuqiao';
const IMG_REPO_NAME  = 'gudaoyuqiao.github.io';
const IMG_REPO_BRANCH = 'main';
const IMG_DIR = 'data/images';

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
    const result = await signInWithPopup(auth, githubProvider);
    // Capture GitHub OAuth access token for image uploads. It's the only
    // moment we can get it; Firebase doesn't expose it again later.
    const credential = GithubAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      localStorage.setItem('gh_access_token', credential.accessToken);
    }
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
  localStorage.removeItem('gh_access_token');
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
    // Sort client-side to avoid needing Firestore composite indexes.
    try {
      const q = isOwner()
        ? collection(db, 'articles')
        : query(collection(db, 'articles'), where('visibility', '==', 'public'));
      const snap = await getDocs(q);
      return snap.docs.map(toArticle).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
      console.error('getAll failed', e);
      return [];
    }
  },

  async get(id) {
    try {
      const d = await Promise.race([
        getDoc(doc(db, 'articles', id)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('请求超时（10s）')), 10000)),
      ]);
      return d.exists() ? toArticle(d) : null;
    } catch (e) { console.error('Store.get failed', e); return null; }
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

// ─── Comments (Firestore subcollection per article) ───────────────
const Comments = {
  colRef(articleId) {
    return collection(db, 'articles', articleId, 'comments');
  },
  docRef(articleId, commentId) {
    return doc(db, 'articles', articleId, 'comments', commentId);
  },

  async list(articleId) {
    try {
      const snap = await getDocs(this.colRef(articleId));
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          content:    data.content || '',
          authorUid:  data.authorUid || '',
          authorName: data.authorName || '匿名',
          authorPhoto:data.authorPhoto || '',
          parentId:   data.parentId || null,
          likedBy:    data.likedBy || [],
          createdAt:  data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        };
      });
      return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } catch (e) {
      console.error('comments list failed', e);
      return [];
    }
  },

  async create(articleId, { content, parentId = null }) {
    if (!currentUser) throw new Error('请先登录');
    const provider = currentUser.providerData[0] || {};
    const data = {
      content: content.trim(),
      authorUid: currentUser.uid,
      authorName: provider.displayName || currentUser.displayName || 'GitHub user',
      authorPhoto: currentUser.photoURL || '',
      parentId: parentId || null,
      likedBy: [],
      createdAt: serverTimestamp(),
    };
    const r = await addDoc(this.colRef(articleId), data);
    return r.id;
  },

  async remove(articleId, commentId) {
    if (!currentUser) throw new Error('请先登录');
    await deleteDoc(this.docRef(articleId, commentId));
  },

  async toggleLike(articleId, commentId, currentlyLiked) {
    if (!currentUser) throw new Error('请先登录');
    await updateDoc(this.docRef(articleId, commentId), {
      likedBy: currentlyLiked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    });
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

// ─── Image upload (compress → push to GitHub repo) ────────────────
function compressImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = width / height;
        if (width >= height) { width = maxDim; height = Math.round(maxDim / ratio); }
        else                 { height = maxDim; width = Math.round(maxDim * ratio); }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('压缩失败')),
        'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('图片读取失败')); };
    img.src = URL.createObjectURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function uploadImageToGithub(blob) {
  const token = localStorage.getItem('gh_access_token');
  if (!token) {
    throw new Error('GitHub 写入权限未授予 → 请去「设置」登出后重新登录一次');
  }

  const base64 = await blobToBase64(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).slice(2, 8);
  const filename = `${ts}_${random}.jpg`;
  const path = `${IMG_DIR}/${filename}`;

  const r = await fetch(
    `https://api.github.com/repos/${IMG_REPO_OWNER}/${IMG_REPO_NAME}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Add image ${filename}`,
        content: base64,
        branch: IMG_REPO_BRANCH,
      }),
    });

  if (!r.ok) {
    const t = await r.text();
    let hint = '';
    if (r.status === 401)      hint = ' Token 无效，请登出后重新登录。';
    else if (r.status === 403) hint = ' Token 缺少 public_repo 权限，请登出后重新登录。';
    else if (r.status === 404) hint = ' 仓库不存在或路径错误。';
    throw new Error(`上传失败 (${r.status}).${hint} ${t.slice(0, 100)}`);
  }

  // Use raw.githubusercontent.com — instant (skips Pages build wait)
  return `https://raw.githubusercontent.com/${IMG_REPO_OWNER}/${IMG_REPO_NAME}/${IMG_REPO_BRANCH}/${path}`;
}

function setEditorBanner(html) {
  const b = document.getElementById('editor-banner');
  if (b) b.innerHTML = html;
}
function flashEditorSuccess(msg) {
  setEditorBanner(`<div class="banner banner-success">${esc(msg)}</div>`);
  setTimeout(() => setEditorBanner(''), 2500);
}

// ─── In-editor image selection / resize / align ───────────────────
let selectedImg = null;
let imgToolbar = null;

function deselectImage() {
  if (selectedImg) {
    selectedImg.classList.remove('img-selected');
    selectedImg = null;
  }
  if (imgToolbar) {
    imgToolbar.remove();
    imgToolbar = null;
  }
}

function selectImage(img) {
  if (selectedImg === img) return;
  deselectImage();
  selectedImg = img;
  img.classList.add('img-selected');
  buildImageToolbar();
  positionImageToolbar();
}

function buildImageToolbar() {
  imgToolbar = document.createElement('div');
  imgToolbar.className = 'img-toolbar';
  imgToolbar.innerHTML = `
    <button data-act="size-25" title="25%">25%</button>
    <button data-act="size-50" title="50%">50%</button>
    <button data-act="size-75" title="75%">75%</button>
    <button data-act="size-100" title="100%">100%</button>
    <span class="itl-sep"></span>
    <button data-act="align-left"   title="左对齐">左</button>
    <button data-act="align-center" title="居中">中</button>
    <button data-act="align-right"  title="右对齐">右</button>
    <span class="itl-sep"></span>
    <button data-act="delete" class="itl-del" title="删除">✕</button>
  `;
  // Prevent button mousedown from moving focus out of the editor
  imgToolbar.addEventListener('mousedown', e => e.preventDefault());
  imgToolbar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !selectedImg) return;
    handleImgAction(btn.dataset.act);
    requestAnimationFrame(positionImageToolbar);
    // Mark editor as dirty so word count / autosave hooks fire
    const rte = document.getElementById('rte');
    if (rte) rte.dispatchEvent(new Event('input'));
  });
  document.body.appendChild(imgToolbar);
}

function positionImageToolbar() {
  if (!imgToolbar || !selectedImg) return;
  const rect = selectedImg.getBoundingClientRect();
  const tb = imgToolbar;
  // Above the image, or below if it'd go off-screen
  const above = rect.top - 44;
  const top = above < 8 ? rect.bottom + 8 : above;
  tb.style.top = `${top}px`;
  tb.style.left = `${rect.left + rect.width / 2}px`;
  tb.style.transform = 'translateX(-50%)';
}

function handleImgAction(act) {
  const img = selectedImg;
  if (!img) return;
  if (act.startsWith('size-')) {
    const pct = act.slice(5);
    img.style.width = `${pct}%`;
    img.style.height = 'auto';
    img.style.maxWidth = '100%';
  } else if (act === 'align-left') {
    img.style.display = 'block';
    img.style.marginLeft = '0';
    img.style.marginRight = 'auto';
  } else if (act === 'align-center') {
    img.style.display = 'block';
    img.style.marginLeft = 'auto';
    img.style.marginRight = 'auto';
  } else if (act === 'align-right') {
    img.style.display = 'block';
    img.style.marginLeft = 'auto';
    img.style.marginRight = '0';
  } else if (act === 'delete') {
    img.remove();
    deselectImage();
  }
}

function attachImageEditor(rte) {
  rte.addEventListener('click', e => {
    if (e.target.tagName === 'IMG' && rte.contains(e.target)) {
      e.preventDefault();
      selectImage(e.target);
    } else {
      deselectImage();
    }
  });
  // Clicks outside editor + toolbar deselect
  document.addEventListener('mousedown', e => {
    if (!selectedImg) return;
    if (e.target === selectedImg) return;
    if (e.target.closest && e.target.closest('.img-toolbar')) return;
    if (rte.contains(e.target) && e.target.tagName !== 'IMG') {
      deselectImage();
    } else if (!rte.contains(e.target)) {
      deselectImage();
    }
  }, true);
  window.addEventListener('scroll', positionImageToolbar, true);
  window.addEventListener('resize', positionImageToolbar);
}

async function handleImageUpload(file, rteEl) {
  console.log('[image upload] start', { name: file.name, size: file.size, type: file.type });

  if (!localStorage.getItem('gh_access_token')) {
    setEditorBanner(`<div class="banner banner-error">GitHub 写入权限未授予 → 去「设置」登出后重新登录一次，重新授权时勾选 public_repo</div>`);
    console.error('[image upload] missing gh_access_token');
    return;
  }

  // Get a valid range inside the editor for insertion
  const sel = window.getSelection();
  let range = null;
  if (sel && sel.rangeCount > 0 && rteEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(rteEl);
    range.collapse(false); // end of editor
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Create + insert placeholder via direct DOM (more reliable than execCommand).
  // Note: btoa() can't encode non-Latin1 chars, so we either ASCII-only the SVG
  // text or url-encode it. We URL-encode to keep the option of i18n later.
  const placeholder = document.createElement('img');
  placeholder.alt = '上传中…';
  placeholder.style.opacity = '0.6';
  placeholder.style.maxWidth = '300px';
  const phSvg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180">' +
    '<rect width="300" height="180" fill="#f5f5f4"/>' +
    '<text x="150" y="92" text-anchor="middle" fill="#71717a" ' +
    'font-family="system-ui,sans-serif" font-size="14" ' +
    'dominant-baseline="middle">Uploading...</text></svg>');
  placeholder.src = `data:image/svg+xml;utf8,${phSvg}`;

  range.deleteContents();
  range.insertNode(placeholder);
  range.setStartAfter(placeholder);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  setEditorBanner(`<div class="banner banner-info">压缩中…</div>`);

  try {
    console.log('[image upload] compressing');
    const blob = await compressImage(file);
    console.log('[image upload] compressed', { size: blob.size, type: blob.type });

    setEditorBanner(`<div class="banner banner-info">上传到 GitHub… (${Math.round(blob.size/1024)} KB)</div>`);
    console.log('[image upload] uploading to GitHub');
    const url = await uploadImageToGithub(blob);
    console.log('[image upload] uploaded', url);

    const realImg = document.createElement('img');
    realImg.src = url;
    realImg.alt = '';
    placeholder.replaceWith(realImg);
    flashEditorSuccess('✓ 图片已插入');

    if (rteEl) rteEl.dispatchEvent(new Event('input'));
  } catch (err) {
    console.error('[image upload] failed', err);
    placeholder.remove();
    setEditorBanner(`<div class="banner banner-error">上传失败：${esc(err.message)}</div>`);
  }
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

let routeGen = 0;
async function route() {
  if (!authReady) { pendingRoute = true; return; }
  // Tear down any leftover image-toolbar from the previous view
  deselectImage();
  const myGen = ++routeGen;
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
        // If a newer navigation happened, abandon further DOM writes from this one
        if (myGen !== routeGen) return;
      } catch (err) {
        if (myGen !== routeGen) return;
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
  if (myGen !== routeGen) return;
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

// ─── Theme ───────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

window.addEventListener('hashchange', route);
window.addEventListener('load', async () => {
  initTheme();
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

      <section class="comments-section" id="comments-section">
        <div class="loading">加载评论中…</div>
      </section>
    </div>`;

  // Load comments asynchronously without blocking article render
  refreshComments(a.id, a.authorUid);
}

// ─── Comments rendering ───────────────────────────────────────────
function relTime(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60)    return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60)    return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24)   return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7)     return `${day} 天前`;
  return fmtDate(iso);
}

function avatarHtml(c) {
  if (c.authorPhoto) {
    return `<div class="comment-avatar"><img src="${esc(c.authorPhoto)}" alt=""></div>`;
  }
  const initial = (c.authorName || '?').trim().charAt(0).toUpperCase();
  return `<div class="comment-avatar">${esc(initial)}</div>`;
}

function renderCommentContent(content) {
  // Highlight @username mentions
  return esc(content).replace(/@(\S+)/g, '<span class="comment-mention">@$1</span>');
}

function commentActionsHtml(articleId, c, authorOfArticle) {
  const liked = currentUser && c.likedBy.includes(currentUser.uid);
  const likeCount = c.likedBy.length;
  const heart = liked
    ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7-4.5-9.5-9C0 7 4 3 8 5c1.6.8 2.5 2.3 4 4 1.5-1.7 2.4-3.2 4-4 4-2 8 2 5.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-4.5-9.5-9C0 7 4 3 8 5c1.6.8 2.5 2.3 4 4 1.5-1.7 2.4-3.2 4-4 4-2 8 2 5.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>`;

  const canDelete = currentUser && (currentUser.uid === c.authorUid || isOwner());
  const canReply = currentUser != null;

  return `
    <div class="comment-actions">
      <button class="like-btn ${liked ? 'liked' : ''}"
              onclick="window.cmtToggleLike('${articleId}','${c.id}',${liked})"
              ${!currentUser ? 'title="登录后才能点赞"' : ''}>
        ${heart}${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
      </button>
      ${canReply
        ? `<button onclick="window.cmtShowReply('${articleId}','${c.id}','${esc(c.authorName)}')">回复</button>`
        : ''}
      ${canDelete
        ? `<button onclick="window.cmtDelete('${articleId}','${c.id}')">删除</button>`
        : ''}
    </div>`;
}

function renderComment(articleId, c, articleAuthorUid, isReply = false) {
  const isArticleAuthor = c.authorUid === articleAuthorUid;
  return `
    <li class="comment ${isReply ? 'reply' : ''}">
      ${avatarHtml(c)}
      <div class="comment-body">
        <div class="comment-header">
          <span class="comment-author ${isArticleAuthor ? 'owner-badge' : ''}">${esc(c.authorName)}</span>
          <span class="comment-time">${relTime(c.createdAt)}</span>
        </div>
        <div class="comment-content">${renderCommentContent(c.content)}</div>
        ${commentActionsHtml(articleId, c, articleAuthorUid)}
        <div id="reply-form-${c.id}"></div>
      </div>
    </li>`;
}

async function refreshComments(articleId, articleAuthorUid) {
  const container = document.getElementById('comments-section');
  if (!container) return;

  const all = await Comments.list(articleId);
  const topLevel = all.filter(c => !c.parentId);
  const repliesByParent = new Map();
  all.forEach(c => {
    if (c.parentId) {
      if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
      repliesByParent.get(c.parentId).push(c);
    }
  });

  const formHtml = currentUser
    ? `<div class="comment-form" id="top-comment-form">
         ${avatarHtml({ authorName: currentUser.displayName || 'You', authorPhoto: currentUser.photoURL || '' })}
         <div class="comment-form-body">
           <textarea id="top-comment-text" placeholder="写下你的想法…" rows="3"></textarea>
           <div class="comment-form-actions">
             <button class="btn btn-primary" onclick="window.cmtSubmit('${articleId}', '${articleAuthorUid}', null)">发表评论</button>
           </div>
         </div>
       </div>`
    : `<div class="comments-prompt">
         用 GitHub 账号登录后可以参与讨论
         <button onclick="window.loginWithGithub()">立即登录</button>
       </div>`;

  const listHtml = topLevel.length
    ? `<ul class="comment-list">
         ${topLevel.map(c => {
           const replies = repliesByParent.get(c.id) || [];
           const repliesHtml = replies.length
             ? `<ul class="reply-list">
                  ${replies.map(r => renderComment(articleId, r, articleAuthorUid, true)).join('')}
                </ul>`
             : '';
           const main = renderComment(articleId, c, articleAuthorUid, false);
           // Insert replies before closing </li>
           return main.replace('</li>', `${repliesHtml}</li>`);
         }).join('')}
       </ul>`
    : `<div class="comments-empty">还没有评论，来当第一个</div>`;

  container.innerHTML = `
    <h2 class="comments-heading">评论 ${all.length ? `(${all.length})` : ''}</h2>
    ${formHtml}
    ${listHtml}`;
}

// Comment action handlers
async function cmtSubmit(articleId, articleAuthorUid, parentId) {
  const textarea = parentId
    ? document.getElementById(`reply-text-${parentId}`)
    : document.getElementById('top-comment-text');
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) { textarea.focus(); return; }

  textarea.disabled = true;
  try {
    await Comments.create(articleId, { content, parentId });
    await refreshComments(articleId, articleAuthorUid);
  } catch (e) {
    alert('发表失败：' + e.message);
    textarea.disabled = false;
  }
}

async function cmtToggleLike(articleId, commentId, currentlyLiked) {
  if (!currentUser) { go('/settings'); return; }
  try {
    await Comments.toggleLike(articleId, commentId, currentlyLiked);
    // Get article authorUid from current view by refetching
    const article = await Store.get(articleId);
    await refreshComments(articleId, article?.authorUid || '');
  } catch (e) {
    alert('点赞失败：' + e.message);
  }
}

async function cmtDelete(articleId, commentId) {
  if (!confirm('确定要删除这条评论吗？')) return;
  try {
    await Comments.remove(articleId, commentId);
    const article = await Store.get(articleId);
    await refreshComments(articleId, article?.authorUid || '');
  } catch (e) {
    alert('删除失败：' + e.message);
  }
}

function cmtShowReply(articleId, parentId, parentAuthor) {
  if (!currentUser) { go('/settings'); return; }
  const slot = document.getElementById(`reply-form-${parentId}`);
  if (!slot) return;
  if (slot.querySelector('textarea')) {
    // Already open; just focus
    slot.querySelector('textarea').focus();
    return;
  }
  slot.innerHTML = `
    <div class="inline-reply-form">
      <textarea id="reply-text-${parentId}" placeholder="@${esc(parentAuthor)} " rows="2">@${esc(parentAuthor)} </textarea>
      <div class="inline-reply-form-actions">
        <button class="btn btn-ghost" onclick="window.cmtCancelReply('${parentId}')">取消</button>
        <button class="btn btn-primary" onclick="window.cmtSubmit('${articleId}', '', '${parentId}')">回复</button>
      </div>
    </div>`;
  const ta = document.getElementById(`reply-text-${parentId}`);
  ta.focus();
  // place cursor at end
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function cmtCancelReply(parentId) {
  const slot = document.getElementById(`reply-form-${parentId}`);
  if (slot) slot.innerHTML = '';
}

window.cmtSubmit = cmtSubmit;
window.cmtToggleLike = cmtToggleLike;
window.cmtDelete = cmtDelete;
window.cmtShowReply = cmtShowReply;
window.cmtCancelReply = cmtCancelReply;

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

  const byYearMonth = new Map();
  articles.forEach(a => {
    const d = new Date(a.createdAt);
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-indexed
    if (!byYearMonth.has(y)) byYearMonth.set(y, new Map());
    if (!byYearMonth.get(y).has(m)) byYearMonth.get(y).set(m, []);
    byYearMonth.get(y).get(m).push(a);
  });

  const sortedYears = [...byYearMonth.keys()].sort((a, b) => b - a);

  const groups = sortedYears.map(year => {
    const monthMap = byYearMonth.get(year);
    const yearTotal = [...monthMap.values()].reduce((s, list) => s + list.length, 0);
    const sortedMonths = [...monthMap.keys()].sort((a, b) => b - a);
    const monthsHtml = sortedMonths.map(monthIdx => {
      const list = monthMap.get(monthIdx);
      return `
        <div class="archive-month-group">
          <h3 class="archive-month">${monthIdx + 1} 月<span class="archive-month-count">${list.length}</span></h3>
          ${list.map(a => `
            <div class="archive-item" onclick="go('/article/${a.id}')">
              <span class="archive-date">${String(monthIdx + 1).padStart(2, '0')}-${String(new Date(a.createdAt).getDate()).padStart(2, '0')}</span>
              <span class="archive-item-title">${esc(a.title)}${lockBadge(a.visibility)}</span>
            </div>`).join('')}
        </div>`;
    }).join('');
    return `
      <section class="archive-group">
        <h2 class="archive-year">${year}<span class="archive-year-count">${yearTotal} 篇</span></h2>
        ${monthsHtml}
      </section>`;
  }).join('');

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
    const hasRepoToken = !!localStorage.getItem('gh_access_token');
    const description = owner
      ? `<p class="settings-help">
            可以写、改、删自己的文章。可见性「公开」对所有访客可见；「仅自己」只有你登录后能看到。
            权限隔离由 Firebase 服务器强制，访客即使打开浏览器开发者工具也绕不过。
          </p>
          <p class="settings-help" style="margin-top:1rem">
            <b>图片上传权限</b>：${hasRepoToken
              ? '<span style="color:#16a34a">✓ 已授予</span>（编辑器里点 🖼 按钮可以从本地选图片上传）'
              : '<span style="color:#dc2626">✗ 未授予</span>。当前 GitHub 登录不带仓库写入 scope，需要<b>登出后重新登录一次</b>，授权时勾选 public_repo 权限。'}
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

      <input type="file" id="image-upload-input" accept="image/*" style="display:none">

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
      // Trigger file picker (works on PC and mobile — mobile shows 拍照/相册)
      const input = document.getElementById('image-upload-input');
      if (input) input.click();
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

  // Click-to-select image + floating size/align toolbar
  attachImageEditor(rte);

  // File picker → image upload
  const fileInput = document.getElementById('image-upload-input');
  if (fileInput) {
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = ''; // reset so same file can be picked again
      if (!file) return;
      rte.focus(); // ensure caret in editor for insertHTML to work
      await handleImageUpload(file, rte);
      updateCount();
      checkEmpty();
    });
  }

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
