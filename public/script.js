const API = '/api';
const CATEGORIES = ['ทั่วไป', 'เทคโนโลยี', 'การศึกษา', 'บันเทิง'];

// ชุดอวาตาร์ [อิโมจิ, สีเริ่ม, สีจบ]  (จำนวนต้องตรงกับ AVATAR_COUNT ใน server/app.js)
const AVATARS = [
  ['🦊', '#ff9966', '#ff3d81'], ['🐼', '#7de2d1', '#339989'], ['🐸', '#c3f584', '#2fa84f'],
  ['🦄', '#f5b8ff', '#8a5cf6'], ['🐙', '#ffd36b', '#ff7a59'], ['🐧', '#7cc7ff', '#3a6df0'],
  ['🐱', '#ffc2d4', '#ff6f91'], ['🐻', '#e3b896', '#a8683a'], ['🦉', '#d1c4ff', '#6b4de6'],
  ['🐲', '#9ef0b2', '#1b998b'], ['🌵', '#f9f871', '#6fbf4a'], ['👾', '#a18cff', '#ff5fd2']
];

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M12 20s-7-4.4-9-9.2C1.7 7.5 3.7 4.5 6.8 4.5c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.1 0 5.1 3 3.8 6.3C19 15.6 12 20 12 20Z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>'
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

let currentUser = JSON.parse(localStorage.getItem('forum_user')) || null;
let filters = { q: '', category: '', tag: '' };
const openComments = new Set();
let searchTimer;

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ไม่มี body */ }
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  return data;
}

function showAlert(text, isError = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(showAlert.timer);
  showAlert.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function avatarIdx(u) {
  if (u && Number.isInteger(u.avatar)) return u.avatar;
  let h = 0;
  for (const c of (u && u.username) || '') h = (h * 31 + c.charCodeAt(0)) % AVATARS.length;
  return h;
}
function avatarHtml(u, size = '') {
  const [emoji, a, b] = AVATARS[avatarIdx(u)];
  return `<span class="av ${size}" style="--a:${a};--b:${b}">${emoji}</span>`;
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาที`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.`;
  if (s < 604800) return `${Math.floor(s / 86400)} วัน`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fillIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.icon === 'theme') return;
    el.innerHTML = icon(el.dataset.icon);
  });
  updateThemeIcons();
}

// ---------- theme ----------
function updateThemeIcons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('[data-icon="theme"], [data-action="theme"].icon-btn').forEach(el => {
    el.innerHTML = icon(dark ? 'sun' : 'moon');
  });
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('forum_theme', next);
  updateThemeIcons();
}

// ---------- auth ----------
function showAuthTab(tab) {
  ['login', 'register', 'forgot'].forEach(t => {
    $(`#${t}-form`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

async function submitJson(e, path) {
  e.preventDefault();
  return api(path, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
}

async function handleLogin(e) {
  try {
    const data = await submitJson(e, '/login');
    saveUser(data.user);
    showAlert('เข้าสู่ระบบสำเร็จ');
    e.target.reset();
    enterApp();
  } catch (err) { showAlert(err.message, true); }
}

async function handleRegister(e) {
  try {
    await submitJson(e, '/register');
    showAlert('สมัครสมาชิกสำเร็จ เข้าสู่ระบบได้เลย');
    showAuthTab('login');
    e.target.reset();
  } catch (err) { showAlert(err.message, true); }
}

async function handleForgot(e) {
  try {
    const data = await submitJson(e, '/forgot-password');
    showAlert(data.message);
    showAuthTab('login');
    e.target.reset();
  } catch (err) { showAlert(err.message, true); }
}

function saveUser(user) {
  currentUser = user;
  localStorage.setItem('forum_user', JSON.stringify(user));
}

function logout() {
  currentUser = null;
  localStorage.removeItem('forum_user');
  location.hash = '#/';
  updateShell();
  showAlert('ออกจากระบบแล้ว');
}

function updateShell() {
  $('#landing').classList.toggle('hidden', !!currentUser);
  $('#app').classList.toggle('hidden', !currentUser);
  document.title = currentUser ? 'MiniTalk' : 'MiniTalk · เว็บบอร์ดสำหรับคนช่างคุย';
  if (!currentUser) return;
  $('#nav-avatar').innerHTML = avatarHtml(currentUser, 'sm');
  $('#composer-avatar').innerHTML = avatarHtml(currentUser);
  $('#nav-name').textContent = currentUser.name;
  $('#nav-handle').textContent = `@${currentUser.username}`;
  const me = `#/u/${currentUser.username}`;
  $('#nav-profile').href = me;
  $('#tab-profile').href = me;
}

function enterApp() {
  updateShell();
  route();
}

// ---------- routing ----------
function route() {
  if (!currentUser) return;
  const m = location.hash.match(/^#\/u\/(.+)$/);
  const isProfile = !!m;
  $('#view-feed').classList.toggle('hidden', isProfile);
  $('#view-profile').classList.toggle('hidden', !isProfile);

  const mine = isProfile && decodeURIComponent(m[1]) === currentUser.username;
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === 'profile' ? mine : (el.dataset.nav === 'home' && !isProfile));
  });

  loadTrending();
  if (isProfile) loadProfile(decodeURIComponent(m[1]));
  else loadFeed();
}

// ---------- rail ----------
async function loadTrending() {
  try {
    const { categories, tags } = await api('/trending');
    const counts = Object.fromEntries(categories.map(c => [c._id, c.count]));
    const total = categories.reduce((n, c) => n + c.count, 0);
    $('#category-chips').innerHTML =
      `<button class="chip ${filters.category ? '' : 'active'}" data-action="cat" data-v="">ทั้งหมด<small>${total}</small></button>` +
      CATEGORIES.map(c =>
        `<button class="chip ${filters.category === c ? 'active' : ''}" data-action="cat" data-v="${encodeURIComponent(c)}">${c}<small>${counts[c] || 0}</small></button>`
      ).join('');
    $('#tag-chips').innerHTML = tags.length
      ? tags.map(t =>
          `<button class="chip ${filters.tag === t._id ? 'active' : ''}" data-action="tag" data-v="${encodeURIComponent(t._id)}">#${t._id}<small>${t.count}</small></button>`
        ).join('')
      : '<span class="rail-empty">ยังไม่มีแท็ก ลองใส่แท็กตอนโพสต์ดูนะ</span>';
  } catch (err) { /* แถบข้างโหลดไม่ได้ก็ไม่กระทบฟีด */ }
}

// ---------- feed ----------
function postHtml(p, users) {
  const u = users[p.author] || { username: p.author };
  const likes = p.likes || [];
  const comments = p.comments || [];
  const liked = likes.includes(currentUser.username);
  const canDelete = currentUser.username === p.author || currentUser.role === 'admin';
  const tags = (p.tags || []).map(t =>
    `<button class="chip chip-tag" data-action="tag" data-v="${encodeURIComponent(t)}">#${t}</button>`).join('');

  const commentsHtml = comments.map(c => {
    const cu = users[c.author] || { username: c.author };
    const canDel = currentUser.username === c.author || currentUser.username === p.author || currentUser.role === 'admin';
    return `<div class="comment">
      <a href="#/u/${c.author}">${avatarHtml(cu, 'sm')}</a>
      <div class="comment-main">
        <a class="who" href="#/u/${c.author}"><strong>${cu.name || c.author}</strong><span class="handle">@${c.author} · ${timeAgo(c.createdAt)}</span></a>
        <p>${c.content}</p>
      </div>
      ${canDel ? `<button class="act danger" data-action="del-comment" data-cid="${c._id}" aria-label="ลบคอมเมนต์">${icon('trash')}</button>` : ''}
    </div>`;
  }).join('');

  return `<article class="post" data-id="${p._id}">
    <a href="#/u/${p.author}">${avatarHtml(u)}</a>
    <div class="post-body">
      <header class="post-head">
        <a class="who" href="#/u/${p.author}"><strong>${u.name || p.author}</strong><span class="handle">@${p.author}</span></a>
        <time datetime="${p.createdAt}">${timeAgo(p.createdAt)}</time>
      </header>
      <h3 class="post-title">${p.title}</h3>
      <p class="post-text">${p.content}</p>
      <div class="post-tags">
        <button class="chip" data-action="cat" data-v="${encodeURIComponent(p.category)}">${p.category}</button>${tags}
      </div>
      <div class="post-actions">
        <button class="act ${liked ? 'liked' : ''}" data-action="like" aria-pressed="${liked}" aria-label="ไลก์">${icon('heart')}<span>${likes.length}</span></button>
        <button class="act" data-action="toggle-comments" aria-label="คอมเมนต์">${icon('comment')}<span>${comments.length}</span></button>
        ${canDelete ? `<button class="act danger push" data-action="del-post" aria-label="ลบโพสต์">${icon('trash')}</button>` : ''}
      </div>
      <div class="comments ${openComments.has(p._id) ? '' : 'hidden'}">
        ${commentsHtml}
        <form class="comment-form" data-post="${p._id}">
          <input type="text" name="content" maxlength="500" placeholder="เขียนคอมเมนต์..." aria-label="เขียนคอมเมนต์" required>
          <button class="btn btn-primary" type="submit">คอมเมนต์</button>
        </form>
      </div>
    </div>
  </article>`;
}

function renderPosts(container, posts, users, emptyHtml) {
  if (!posts.length) {
    container.className = '';
    container.innerHTML = emptyHtml;
    return;
  }
  container.className = 'feed';
  container.innerHTML = posts.map(p => postHtml(p, users)).join('');
}

function replaceCard(post, users) {
  const old = document.querySelector(`.post[data-id="${post._id}"]`);
  if (!old) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = postHtml(post, users);
  const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  return fresh;
}

function renderFilterBar() {
  const bar = $('#filter-bar');
  const parts = [];
  if (filters.q) parts.push(`ค้นหา “${filters.q}”`);
  if (filters.category) parts.push(`หมวด ${filters.category}`);
  if (filters.tag) parts.push(`#${filters.tag}`);
  bar.classList.toggle('hidden', !parts.length);
  bar.innerHTML = '';
  if (!parts.length) return;
  const label = document.createElement('span');
  label.textContent = `กำลังดู: ${parts.join(' · ')}`;
  const clear = document.createElement('button');
  clear.className = 'chip';
  clear.dataset.action = 'clear-filters';
  clear.textContent = 'ล้างตัวกรอง';
  bar.append(label, clear);
}

async function loadFeed() {
  renderFilterBar();
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const filtered = qs.toString() !== '';
  try {
    const { posts, users } = await api(`/posts?${qs}`);
    renderPosts($('#posts-container'), posts, users, filtered
      ? `<div class="empty"><p>ไม่พบโพสต์ที่ตรงกับตัวกรอง ลองเปลี่ยนคำค้นหรือล้างตัวกรอง</p><button class="btn" data-action="clear-filters">ล้างตัวกรอง</button></div>`
      : `<div class="empty"><p>ยังไม่มีโพสต์ในเว็บบอร์ด เริ่มโพสต์แรกได้เลย</p><button class="btn btn-primary" data-action="focus-compose">เขียนโพสต์</button></div>`);
  } catch (err) { showAlert(err.message, true); }
}

function setFilter(key, value) {
  filters[key] = filters[key] === value ? '' : value;
  if (location.hash.startsWith('#/u/')) location.hash = '#/';
  else loadFeed();
  loadTrending();
}

async function handleCreatePost(e) {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.author = currentUser.username;
  try {
    await api('/posts', { method: 'POST', body });
    showAlert('โพสต์แล้ว');
    e.target.reset();
    filters = { q: '', category: '', tag: '' };
    $('#search-input').value = '';
    loadFeed();
    loadTrending();
  } catch (err) { showAlert(err.message, true); }
}

// ---------- actions บนโพสต์ (ใช้ event delegation) ----------
async function onAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const card = btn.closest('.post');
  const id = card && card.dataset.id;
  const val = btn.dataset.v !== undefined ? decodeURIComponent(btn.dataset.v) : '';

  try {
    switch (action) {
      case 'theme': return toggleTheme();
      case 'logout': return logout();
      case 'cat': return setFilter('category', val);
      case 'tag': return setFilter('tag', val);
      case 'clear-filters':
        filters = { q: '', category: '', tag: '' };
        $('#search-input').value = '';
        loadFeed(); loadTrending();
        return;
      case 'focus-search':
        if (location.hash.startsWith('#/u/')) location.hash = '#/';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return $('#search-input').focus({ preventScroll: true });
      case 'focus-compose':
        if (location.hash.startsWith('#/u/')) location.hash = '#/';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return setTimeout(() => $('#post-form [name="title"]').focus({ preventScroll: true }), 50);
      case 'toggle-comments': {
        const box = card.querySelector('.comments');
        box.classList.toggle('hidden');
        box.classList.contains('hidden') ? openComments.delete(id) : openComments.add(id);
        if (!box.classList.contains('hidden')) box.querySelector('input').focus();
        return;
      }
      case 'like': {
        const { post, users } = await api(`/posts/${id}/like`, { method: 'POST', body: { username: currentUser.username } });
        return replaceCard(post, users);
      }
      case 'del-comment': {
        if (!confirm('ลบคอมเมนต์นี้หรือไม่?')) return;
        const { post, users } = await api(`/posts/${id}/comments/${btn.dataset.cid}`, {
          method: 'DELETE', body: { requestUser: currentUser.username, role: currentUser.role }
        });
        showAlert('ลบคอมเมนต์แล้ว');
        return replaceCard(post, users);
      }
      case 'del-post': {
        if (!confirm('ลบโพสต์นี้หรือไม่?')) return;
        await api(`/posts/${id}`, { method: 'DELETE', body: { requestUser: currentUser.username, role: currentUser.role } });
        showAlert('ลบโพสต์แล้ว');
        route();
        return;
      }
      case 'edit-profile': return renderProfileEdit();
      case 'cancel-edit': return route();
    }
  } catch (err) { showAlert(err.message, true); }
}

async function onSubmit(e) {
  if (!e.target.classList.contains('comment-form')) return;
  e.preventDefault();
  const id = e.target.dataset.post;
  const content = e.target.content.value;
  try {
    const { post, users } = await api(`/posts/${id}/comments`, {
      method: 'POST', body: { author: currentUser.username, content }
    });
    openComments.add(id);
    const fresh = replaceCard(post, users);
    if (fresh) fresh.querySelector('.comment-form input').focus();
  } catch (err) { showAlert(err.message, true); }
}

// ---------- profile ----------
let profileData = null;

async function loadProfile(username) {
  const view = $('#view-profile');
  try {
    const [profile, feed] = await Promise.all([
      api(`/users/${encodeURIComponent(username)}`),
      api(`/posts?author=${encodeURIComponent(username)}`)
    ]);
    profileData = profile;
    const mine = profile.username === currentUser.username;
    const joined = profile.createdAt
      ? new Date(profile.createdAt).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }) : '';
    view.innerHTML = `
      <a class="back" href="#/">← กลับไปหน้าแรก</a>
      <div class="profile-head" id="profile-head">
        <div class="profile-top">
          ${avatarHtml(profile, 'xl')}
          <div>
            <h1>${profile.name}</h1>
            <div class="profile-meta">@${profile.username}${joined ? ` · เข้าร่วม ${joined}` : ''} · ${profile.postCount} โพสต์</div>
          </div>
        </div>
        <p class="profile-bio">${profile.bio || (mine ? 'ยังไม่มี bio เล่าเกี่ยวกับตัวเองสักหน่อยไหม?' : '')}</p>
        ${mine ? '<div><button class="btn" data-action="edit-profile">แก้ไขโปรไฟล์</button></div>' : ''}
      </div>
      <div id="profile-posts"></div>`;
    renderPosts($('#profile-posts'), feed.posts, feed.users,
      `<div class="empty"><p>${mine ? 'คุณยังไม่ได้โพสต์อะไร' : 'ผู้ใช้นี้ยังไม่ได้โพสต์อะไร'}</p></div>`);
  } catch (err) {
    view.innerHTML = `<a class="back" href="#/">← กลับไปหน้าแรก</a><div class="empty"><p>${err.message}</p></div>`;
  }
}

function renderProfileEdit() {
  const p = profileData;
  let selected = avatarIdx(p);
  const head = $('#profile-head');
  head.innerHTML = `
    <form id="profile-form">
      <label>ชื่อที่แสดง<input type="text" name="name" maxlength="60" value="${p.name.replace(/"/g, '&quot;')}" required></label>
      <label>Bio (ไม่เกิน 160 ตัวอักษร)<textarea name="bio" rows="3" maxlength="160">${p.bio || ''}</textarea></label>
      <label>เลือกอวาตาร์
        <div class="avatar-grid" role="radiogroup">
          ${AVATARS.map((_, i) => `<button type="button" class="avatar-opt ${i === selected ? 'selected' : ''}" data-i="${i}" role="radio" aria-checked="${i === selected}" aria-label="อวาตาร์ ${i + 1}">${avatarHtml({ avatar: i })}</button>`).join('')}
        </div>
      </label>
      <div class="row-end">
        <button type="button" class="btn" data-action="cancel-edit">ยกเลิก</button>
        <button type="submit" class="btn btn-primary">บันทึก</button>
      </div>
    </form>`;

  head.querySelector('.avatar-grid').addEventListener('click', (e) => {
    const opt = e.target.closest('.avatar-opt');
    if (!opt) return;
    selected = Number(opt.dataset.i);
    head.querySelectorAll('.avatar-opt').forEach(o => {
      const on = o === opt;
      o.classList.toggle('selected', on);
      o.setAttribute('aria-checked', on);
    });
  });

  head.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const { user } = await api(`/users/${currentUser.username}`, {
        method: 'PUT',
        body: { requestUser: currentUser.username, name: f.name.value, bio: f.bio.value, avatar: selected }
      });
      saveUser({ ...currentUser, ...user });
      updateShell();
      showAlert('บันทึกโปรไฟล์แล้ว');
      route();
    } catch (err) { showAlert(err.message, true); }
  });
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', () => {
  fillIcons();
  updateShell();

  $('#login-form').addEventListener('submit', handleLogin);
  $('#register-form').addEventListener('submit', handleRegister);
  $('#forgot-form').addEventListener('submit', handleForgot);
  $('#post-form').addEventListener('submit', handleCreatePost);
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => showAuthTab(b.dataset.tab)));

  document.addEventListener('click', onAction);
  document.addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', route);

  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = e.target.value.trim();
      if (location.hash.startsWith('#/u/')) location.hash = '#/';
      else loadFeed();
    }, 300);
  });

  if (currentUser) route();
});
