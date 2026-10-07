/**
 * Heart of Worship — app.js
 * Vanilla JS single-file application.
 *
 * Editing model (Option A — no Cloud Function):
 *   - A passcode is stored in Firestore at  /config/editor  → { passcode: "..." }
 *   - When an editor enters the passcode, the app compares it client-side.
 *   - On match, the app signs in anonymously (Firebase Anonymous Auth).
 *   - Security rules allow writes only for signed-in users.
 */

// ── Firebase config ────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCjSYSQcW3vgjkdsH4QGwK7pMl0M8XXrRo',
  authDomain:        'heart-of-worship-spwc.firebaseapp.com',
  projectId:         'heart-of-worship-spwc',
  storageBucket:     'heart-of-worship-spwc.firebasestorage.app',
  messagingSenderId: '249170805695',
  appId:             '1:249170805695:web:9fb0faa941ca1e4561970a',
};

// ── Firebase init ──────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db      = firebase.firestore();
const auth    = firebase.auth();
const storage = firebase.storage();

// ── Constants ──────────────────────────────────────────────────────────────
const KEY_REGEX = /^[A-G][b#]?m?$/;

// ── Helpers ────────────────────────────────────────────────────────────────
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const isNonEmpty = val => typeof val === 'string' && val.trim().length > 0;

const renderKeyBadge = (key, variant = 'default') =>
  `<span class="key-badge${variant === 'female' ? ' key-badge--female' : ''}" aria-label="${variant === 'female' ? 'Female key' : 'Key'}: ${key}">${key}</span>`;

const renderTimeSig = ts => {
  const [num, den] = ts.split('/');
  if (!den) return `<span class="time-sig"><span>${ts}</span></span>`;
  return `<span class="time-sig" aria-label="Time signature ${ts}"><span class="time-sig__num">${num}</span><span class="time-sig__den">${den}</span></span>`;
};

function showToast(msg, ms = 3000) {
  let t = qs('.toast');
  if (!t) { t = Object.assign(document.createElement('div'), { className: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('is-visible'), ms);
}

// ── State ──────────────────────────────────────────────────────────────────
let allSongs      = [];
let selectedLangs = new Set();
let searchQuery   = '';
let editingId     = null;

// Current logged-in user + derived permissions
let currentUser = null; // { username, role, perms:{add,edit,delete} }
let usersCache  = [];   // list of users from config/users

// Permission helpers
const isLoggedIn = () => !!currentUser;
const isAdmin    = () => !!currentUser && currentUser.role === 'admin';
const canAdd     = () => isAdmin() || (!!currentUser && currentUser.role === 'editor' && currentUser.perms.add);
const canEdit    = () => isAdmin() || (!!currentUser && currentUser.role === 'editor' && currentUser.perms.edit);
const canDelete  = () => isAdmin() || (!!currentUser && currentUser.role === 'editor' && currentUser.perms.delete);
const canWriteAny= () => canAdd() || canEdit() || canDelete();

// ── Filter & derive ────────────────────────────────────────────────────────
const deriveLanguages = songs =>
  [...new Set(songs.filter(s => isNonEmpty(s.language)).map(s => s.language.trim()))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  const filtered = allSongs.filter(s => {
    const matchQ = !q || (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q);
    const matchL = !selectedLangs.size || (isNonEmpty(s.language) && selectedLangs.has(s.language.toLowerCase()));
    return matchQ && matchL;
  });
  renderSongList(filtered);
}

// ── Render: chips ──────────────────────────────────────────────────────────
function renderChips() {
  const c = qs('#language-chips');
  c.innerHTML = deriveLanguages(allSongs).map(lang =>
    `<button class="chip${selectedLangs.has(lang.toLowerCase()) ? ' chip--active' : ''}" data-lang="${lang}">${lang}</button>`
  ).join('');
  qsa('.chip', c).forEach(chip => chip.addEventListener('click', () => {
    const l = chip.dataset.lang.toLowerCase();
    selectedLangs.has(l) ? selectedLangs.delete(l) : selectedLangs.add(l);
    renderChips(); applyFilters();
  }));
}

// ── Render: song list ──────────────────────────────────────────────────────
function renderSongList(songs) {
  const list = qs('#song-list');
  if (!songs.length) {
    list.innerHTML = `<p class="empty-state">${allSongs.length ? 'No songs match your search.' : 'No songs yet. Add the first one!'}</p>`;
    return;
  }
  list.innerHTML = songs.map(song => {
    const detailRows = [
      song.artist  && isNonEmpty(song.artist)  ? `<div class="detail-row"><span class="detail-row__label">Artist</span><span>${song.artist}</span></div>` : '',
      song.details && isNonEmpty(song.details) ? `<div class="detail-row"><span class="detail-row__label">Details</span><span>${song.details}</span></div>` : '',
      song.notes   && isNonEmpty(song.notes)   ? `<div class="detail-row"><span class="detail-row__label">Notes</span><span>${song.notes}</span></div>` : '',
      song.youtube && isNonEmpty(song.youtube) ? `<div class="detail-row"><span class="detail-row__label">Video</span><a href="${song.youtube}" target="_blank" rel="noopener">${song.youtube}</a></div>` : '',
    ].filter(Boolean).join('');

    return `<article class="song-card" data-id="${song.id}">
      <div class="song-card__header">
        <span class="song-card__title">${song.title}</span>
        <div class="song-card__badges">
          ${renderKeyBadge(song.key)}
          ${isNonEmpty(song.fTranspose) ? renderKeyBadge(song.fTranspose, 'female') : ''}
          ${renderTimeSig(song.timeSignature)}
          ${isNonEmpty(song.language) ? `<span class="lang-tag">${song.language}</span>` : ''}
          ${isNonEmpty(song.youtube)  ? `<a class="yt-link" href="${song.youtube}" target="_blank" rel="noopener" aria-label="Watch on YouTube">&#9654;</a>` : ''}
        </div>
        <div class="song-card__actions">
          ${canEdit()   ? `<button class="btn btn--sm btn--outline" data-action="edit"   aria-label="Edit ${song.title}">Edit</button>` : ''}
          ${canDelete() ? `<button class="btn btn--sm btn--danger"  data-action="delete" aria-label="Delete ${song.title}">Delete</button>` : ''}
        </div>
      </div>
      ${detailRows ? `<div class="song-card__detail">${detailRows}</div>` : ''}
    </article>`;
  }).join('');

  qsa('.song-card', list).forEach(card => {
    qs('.song-card__header', card).addEventListener('click', () => {
      qs('.song-card__detail', card)?.classList.toggle('is-open');
    });
    qs('[data-action="edit"]',   card)?.addEventListener('click', e => { e.stopPropagation(); openEditForm(card.dataset.id); });
    qs('[data-action="delete"]', card)?.addEventListener('click', e => { e.stopPropagation(); confirmDelete(card.dataset.id); });
  });
}

// ── Firestore subscription ─────────────────────────────────────────────────
qs('#song-list').innerHTML = '<div class="spinner"></div>';
db.collection('songs').orderBy('title').onSnapshot(
  snap => { allSongs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderChips(); applyFilters(); },
  err  => { console.error(err); qs('#song-list').innerHTML = '<p class="empty-state">Could not load songs. Check your connection.<br/><button class="btn btn--outline" onclick="location.reload()">Retry</button></p>'; }
);

// ── Users: load list (admins manage this; login reads it) ───────────────────
// Stored in Firestore at config/users → { users: [ {username, passcode, role, perms} ] }
// Backwards-compat: if config/editor has a passcode and no users exist yet,
// that passcode acts as the first admin ("admin").

async function loadUsers() {
  const snap = await db.collection('config').doc('users').get();
  usersCache = (snap.exists && Array.isArray(snap.data().users)) ? snap.data().users : [];
  return usersCache;
}

async function getLegacyAdminPasscode() {
  const snap = await db.collection('config').doc('editor').get();
  return snap.exists ? (snap.data().passcode || '') : '';
}

async function saveUsers(users) {
  await db.collection('config').doc('users').set({ users }, { merge: true });
  usersCache = users;
}

// Apply the UI state for the current permission level
function applyPermissionUI() {
  const loggedIn = isLoggedIn();
  document.body.classList.toggle('is-editor', canWriteAny());
  document.body.classList.toggle('can-add', canAdd());
  document.body.classList.toggle('can-edit', canEdit());
  document.body.classList.toggle('can-delete', canDelete());

  // Header buttons
  const badge   = qs('#user-badge');
  const btnLogin = qs('#btn-login');
  const btnGear  = qs('#btn-settings');
  const btnOut   = qs('#btn-logout-header');

  if (loggedIn) {
    badge.hidden = false;
    badge.textContent = currentUser.username;
    btnLogin.hidden = true;
    // Gear shows for anyone logged in who can change settings OR is admin
    btnGear.hidden = !(canWriteAny() || isAdmin());
    btnOut.hidden = false;
  } else {
    badge.hidden = true;
    btnLogin.hidden = false;
    btnGear.hidden = true;
    btnOut.hidden = true;
  }

  // Add Song button
  let addWrap = qs('.add-song-btn');
  if (canAdd()) {
    if (!addWrap) {
      addWrap = document.createElement('div');
      addWrap.className = 'add-song-btn';
      addWrap.innerHTML = '<button class="btn btn--primary" id="btn-add-song">+ Add Song</button>';
      qs('.toolbar').insertAdjacentElement('afterend', addWrap);
      qs('#btn-add-song').addEventListener('click', openAddForm);
    }
    addWrap.style.display = 'flex';
  } else if (addWrap) {
    addWrap.style.display = 'none';
  }

  // Re-render song list so edit/delete buttons reflect permissions
  applyFilters();
}

// Restore a session if present
(function restoreSession() {
  const saved = sessionStorage.getItem('hw_user');
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch { currentUser = null; }
  }
})();

// Ensure we have an anonymous Firebase session for writes
async function ensureAnonAuth() {
  if (!auth.currentUser) await auth.signInAnonymously();
}

// ── Settings modal (editors/admins) — appearance + user management ──────────
function refreshSettingsSections() {
  qs('#settings-appearance').hidden = !isAdmin();   // background is admin-only
  qs('#settings-users').hidden      = !isAdmin();
  qs('#settings-password').hidden   = !isLoggedIn();
  if (isAdmin()) renderUserList();
}

qs('#btn-settings').addEventListener('click', async () => {
  if (!(canWriteAny() || isAdmin())) { showToast('Log in first.'); return; }
  qs('#bg-status').textContent = '';
  try { await loadUsers(); } catch (e) { console.error(e); }
  refreshSettingsSections();
  qs('#settings-modal').showModal();
});
qs('#btn-settings-close').addEventListener('click', () => qs('#settings-modal').close());

// ── Login modal open/close ──────────────────────────────────────────────────
qs('#btn-login').addEventListener('click', () => {
  qs('#login-error').hidden = true;
  qs('#login-username').value = '';
  qs('#login-passcode').value = '';
  const inp = qs('#login-passcode');
  inp.type = 'password';
  const tgl = qs('#btn-toggle-passcode');
  tgl.textContent = '👁';
  tgl.classList.remove('is-on');
  qs('#login-modal').showModal();
  setTimeout(() => qs('#login-username').focus(), 50);
});
qs('#btn-login-close').addEventListener('click', () => qs('#login-modal').close());
qs('#btn-login-cancel').addEventListener('click', () => qs('#login-modal').close());

// Logout from header
qs('#btn-logout-header').addEventListener('click', async () => {
  currentUser = null;
  sessionStorage.removeItem('hw_user');
  try { await auth.signOut(); } catch {}
  applyPermissionUI();
  showToast('Logged out.');
});

// Show/hide passcode toggle (login field)
qs('#btn-toggle-passcode').addEventListener('click', () => {
  const input  = qs('#login-passcode');
  const toggle = qs('#btn-toggle-passcode');
  const show   = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.textContent = show ? '🙈' : '👁';
  toggle.setAttribute('aria-label', show ? 'Hide passcode' : 'Show passcode');
  toggle.setAttribute('aria-pressed', String(show));
  toggle.classList.toggle('is-on', show);
  input.focus();
});

// ── Login ────────────────────────────────────────────────────────────────────
qs('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = qs('#login-error');
  const btn = qs('[type=submit]', e.target);
  const username = qs('#login-username').value.trim();
  const passcode = qs('#login-passcode').value.trim();
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    await loadUsers();

    // Try to match a configured user
    let matched = usersCache.find(u =>
      u.username.toLowerCase() === username.toLowerCase() && u.passcode === passcode);

    // Legacy fallback: the original editor passcode logs in as admin
    if (!matched) {
      const legacy = await getLegacyAdminPasscode();
      if (legacy && passcode === legacy) {
        matched = { username: username || 'admin', role: 'admin', perms: { add: true, edit: true, delete: true } };
      }
    }

    if (!matched) {
      err.textContent = 'Incorrect username or passcode.';
      err.hidden = false;
      return;
    }

    // Normalise perms
    const role  = matched.role || 'editor';
    const perms = role === 'admin'
      ? { add: true, edit: true, delete: true }
      : role === 'readonly'
        ? { add: false, edit: false, delete: false }
        : { add: !!(matched.perms && matched.perms.add), edit: !!(matched.perms && matched.perms.edit), delete: !!(matched.perms && matched.perms.delete) };

    currentUser = { username: matched.username, role, perms };
    sessionStorage.setItem('hw_user', JSON.stringify(currentUser));

    if (canWriteAny()) await ensureAnonAuth();

    applyPermissionUI();
    qs('#login-modal').close();
    showToast(`Welcome, ${currentUser.username}!`);
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Could not log in. Check your connection.';
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

// ── User management (admins) ────────────────────────────────────────────────
function renderUserList() {
  const wrap = qs('#user-list');
  if (!usersCache.length) {
    wrap.innerHTML = '<p class="field__hint">No users yet. Add one below. (You are logged in via the original admin passcode.)</p>';
    return;
  }
  wrap.innerHTML = usersCache.map((u, i) => {
    const role = u.role || 'editor';
    const permText = role === 'editor'
      ? ['add','edit','delete'].filter(p => u.perms && u.perms[p]).join(', ') || 'no permissions'
      : (role === 'admin' ? 'full access' : 'view only');
    return `<div class="user-row">
      <div class="user-row__info">
        <span class="user-row__name">${u.username} <span class="role-tag role-tag--${role}">${role}</span></span>
        <span class="user-row__meta">${permText}</span>
      </div>
      <button class="btn btn--sm btn--danger" data-remove-user="${i}">Remove</button>
    </div>`;
  }).join('');

  qsa('[data-remove-user]', wrap).forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.removeUser, 10);
      const u = usersCache[idx];
      if (!u) return;
      if (!confirm(`Remove user "${u.username}"?`)) return;
      const next = usersCache.filter((_, i) => i !== idx);
      try { await saveUsers(next); renderUserList(); showToast('User removed.'); }
      catch (ex) { showToast('Could not remove user: ' + (ex.message || ex)); }
    });
  });
}

// Toggle the editor-permissions fieldset based on role select
qs('#nu-role').addEventListener('change', () => {
  qs('#nu-perms').style.display = qs('#nu-role').value === 'editor' ? 'flex' : 'none';
});

qs('#adduser-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = qs('#adduser-error');
  err.hidden = true;
  const username = qs('#nu-username').value.trim();
  const passcode = qs('#nu-passcode').value.trim();
  const role     = qs('#nu-role').value;
  if (!username || !passcode) { err.textContent = 'Username and passcode are required.'; err.hidden = false; return; }
  if (usersCache.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    err.textContent = 'A user with that username already exists.'; err.hidden = false; return;
  }
  const newUser = { username, passcode, role };
  if (role === 'editor') {
    newUser.perms = { add: qs('#nu-add').checked, edit: qs('#nu-edit').checked, delete: qs('#nu-delete').checked };
  }
  try {
    await saveUsers([...usersCache, newUser]);
    renderUserList();
    qs('#adduser-form').reset();
    qs('#nu-perms').style.display = 'flex';
    showToast('User added.');
  } catch (ex) {
    err.textContent = 'Could not add user: ' + (ex.message || ex);
    err.hidden = false;
  }
});

// ── Reset my own password ────────────────────────────────────────────────────
qs('#password-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = qs('#pw-status');
  const newPass = qs('#pw-new').value.trim();
  if (!newPass) { status.textContent = 'Enter a new passcode.'; return; }
  if (!currentUser) { status.textContent = 'You must be logged in.'; return; }
  status.textContent = 'Updating…';
  try {
    await loadUsers();
    const idx = usersCache.findIndex(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
    if (idx >= 0) {
      // Update an existing managed user
      const next = usersCache.slice();
      next[idx] = { ...next[idx], passcode: newPass };
      await saveUsers(next);
    } else {
      // Legacy admin (logged in via config/editor passcode) → update that passcode
      await db.collection('config').doc('editor').set({ passcode: newPass }, { merge: true });
    }
    qs('#pw-new').value = '';
    status.textContent = 'Passcode updated.';
    showToast('Your passcode has been updated.');
  } catch (ex) {
    console.error(ex);
    status.textContent = 'Could not update: ' + (ex.message || ex);
  }
});

// Apply initial permission UI (in case a session was restored)
if (currentUser) { ensureAnonAuth().finally(applyPermissionUI); } else { applyPermissionUI(); }

// ── Song form ──────────────────────────────────────────────────────────────
const FIELDS = { title: 'f-title', key: 'f-key', time: 'f-time', fTranspose: 'f-ftranspose', language: 'f-language', artist: 'f-artist', details: 'f-details', notes: 'f-notes', youtube: 'f-youtube' };

function openAddForm() {
  if (!canAdd()) { showToast('You do not have permission to add songs.'); return; }
  editingId = null;
  qs('#song-modal-title').textContent = 'Add Song';
  qs('#song-form').reset();
  qsa('.field__error').forEach(el => el.textContent = '');
  qsa('.field__input').forEach(el => el.classList.remove('is-invalid'));
  qs('#song-form-error').hidden = true;
  qs('#song-modal').showModal();
  qs('#f-title').focus();
}

function openEditForm(id) {
  if (!canEdit()) { showToast('You do not have permission to edit songs.'); return; }
  const s = allSongs.find(x => x.id === id);
  if (!s) return;
  editingId = id;
  qs('#song-modal-title').textContent = 'Edit Song';
  Object.entries(FIELDS).forEach(([k, fid]) => { qs(`#${fid}`).value = s[k === 'time' ? 'timeSignature' : k] || ''; });
  qsa('.field__error').forEach(el => el.textContent = '');
  qsa('.field__input').forEach(el => el.classList.remove('is-invalid'));
  qs('#song-form-error').hidden = true;
  qs('#song-modal').showModal();
}

function validateDraft(d) {
  const e = {};
  if (!isNonEmpty(d.title))         e.title      = 'Required.';
  if (!isNonEmpty(d.key))           e.key        = 'Required.';
  else if (!KEY_REGEX.test(d.key))  e.key        = 'Invalid format (e.g. G, Bm, F#).';
  if (!isNonEmpty(d.timeSignature)) e.time       = 'Required.';
  if (isNonEmpty(d.fTranspose) && !KEY_REGEX.test(d.fTranspose)) e.fTranspose = 'Invalid format.';
  if (isNonEmpty(d.youtube)) { try { new URL(d.youtube); } catch { e.youtube = 'Enter a valid URL.'; } }
  return e;
}

qs('#btn-cancel-song').addEventListener('click', () => { qs('#song-modal').close(); editingId = null; });

qs('#song-form').addEventListener('submit', async e => {
  e.preventDefault();
  qsa('.field__error').forEach(el => el.textContent = '');
  qsa('.field__input').forEach(el => el.classList.remove('is-invalid'));

  const draft = {
    title:         qs('#f-title').value.trim(),
    key:           qs('#f-key').value.trim(),
    timeSignature: qs('#f-time').value.trim(),
    fTranspose:    qs('#f-ftranspose').value.trim() || null,
    language:      qs('#f-language').value.trim()   || null,
    artist:        qs('#f-artist').value.trim()     || null,
    details:       qs('#f-details').value.trim()    || null,
    notes:         qs('#f-notes').value.trim()      || null,
    youtube:       qs('#f-youtube').value.trim()    || null,
  };

  const errs = validateDraft(draft);
  if (Object.keys(errs).length) {
    const idMap = { title: 'f-title', key: 'f-key', time: 'f-time', fTranspose: 'f-ftranspose', youtube: 'f-youtube' };
    Object.entries(errs).forEach(([k, msg]) => {
      const errEl = qs(`#err-${k === 'time' ? 'time' : k}`);
      if (errEl) errEl.textContent = msg;
      const inp = idMap[k] ? qs(`#${idMap[k]}`) : null;
      if (inp) inp.classList.add('is-invalid');
    });
    return;
  }

  const btn = qs('#btn-save-song');
  btn.disabled = true; btn.textContent = 'Saving…';
  qs('#song-form-error').hidden = true;
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    if (editingId) {
      await db.collection('songs').doc(editingId).update({ ...draft, updatedAt: ts });
      showToast('Song updated.');
    } else {
      await db.collection('songs').add({ ...draft, createdAt: ts, updatedAt: ts });
      showToast('Song added.');
    }
    qs('#song-modal').close(); editingId = null;
  } catch (err) {
    const el = qs('#song-form-error');
    el.textContent = `Save failed: ${err.message}. Your changes have not been lost.`;
    el.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
});

// ── Delete ─────────────────────────────────────────────────────────────────
async function confirmDelete(id) {
  if (!canDelete()) { showToast('You do not have permission to delete songs.'); return; }
  const s = allSongs.find(x => x.id === id);
  if (!s || !confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
  try { await db.collection('songs').doc(id).delete(); showToast('Song deleted.'); }
  catch (err) { showToast(`Delete failed: ${err.message}`); }
}

// ── Search ─────────────────────────────────────────────────────────────────
qs('#search-input').addEventListener('input', e => { searchQuery = e.target.value; applyFilters(); });

// ── Shared background image ──────────────────────────────────────────────────
// Stored in Firestore at config/appearance → { backgroundUrl }
// Applied live for everyone via onSnapshot. Uploads go to Firebase Storage.

const DEFAULT_BG = 'default-bg.svg'; // shipped in the repo, shown faded

function applyBackground(url) {
  const img = url || DEFAULT_BG;
  document.body.style.setProperty('--bg-image', `url("${img}")`);
  document.body.classList.add('has-bg');
}

// Live-sync the background for all users
db.collection('config').doc('appearance').onSnapshot(
  snap => applyBackground(snap.exists ? (snap.data().backgroundUrl || '') : ''),
  err  => console.error('appearance listener error:', err)
);

// Trigger the hidden file picker (button lives in the Settings → Appearance section)
qs('#btn-bg-upload').addEventListener('click', () => qs('#bg-file-input').click());

// Handle the chosen file → upload to Storage → save URL to Firestore
qs('#bg-file-input').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!isAdmin()) { showToast('Only admins can change the background.'); return; }
  if (!file.type.startsWith('image/')) { qs('#bg-status').textContent = 'Please choose an image file.'; return; }
  if (file.size > 8 * 1024 * 1024) { qs('#bg-status').textContent = 'Image too large (max 8 MB).'; return; }

  const status = qs('#bg-status');
  status.textContent = 'Uploading…';
  try {
    const ref = storage.ref().child('backgrounds/current-' + Date.now() + '-' + file.name);
    const task = await ref.put(file);
    const url  = await task.ref.getDownloadURL();
    await db.collection('config').doc('appearance').set({ backgroundUrl: url }, { merge: true });
    status.textContent = 'Background updated!';
    showToast('Background updated.');
  } catch (ex) {
    console.error(ex);
    status.textContent = 'Upload failed: ' + (ex.message || ex);
  } finally {
    e.target.value = ''; // reset so same file can be re-picked
  }
});

// Remove the background (reset to default paper)
qs('#btn-bg-remove').addEventListener('click', async () => {
  if (!isAdmin()) { showToast('Only admins can change the background.'); return; }
  qs('#bg-status').textContent = 'Removing…';
  try {
    await db.collection('config').doc('appearance').set({ backgroundUrl: '' }, { merge: true });
    qs('#bg-status').textContent = 'Background removed.';
    showToast('Background removed.');
  } catch (ex) {
    console.error(ex);
    qs('#bg-status').textContent = 'Could not remove: ' + (ex.message || ex);
  }
});
