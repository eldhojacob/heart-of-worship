/**
 * Heart of Worship — app.js
 * Vanilla JS single-file application.
 * Replace FIREBASE_CONFIG and VERIFY_PASSCODE_URL before deploying.
 */

// ── Firebase config ────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT.firebaseapp.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};

// Cloud Function URL (set after deploying functions)
const VERIFY_PASSCODE_URL = 'YOUR_CLOUD_FUNCTION_URL/verifyPasscode';

// ── Firebase init ──────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.firestore();
const auth = firebase.auth();

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
let isEditor      = false;
let editingId     = null;

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
          <button class="btn btn--sm btn--outline" data-action="edit"   aria-label="Edit ${song.title}">Edit</button>
          <button class="btn btn--sm btn--danger"  data-action="delete" aria-label="Delete ${song.title}">Delete</button>
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

// ── Auth state ─────────────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  isEditor = !!user;
  document.body.classList.toggle('is-editor', isEditor);
  qs('#btn-unlock').textContent = isEditor ? '🔓 Lock editing' : '🔒 Unlock editing';
  if (isEditor && !qs('.add-song-btn')) {
    const div = document.createElement('div');
    div.className = 'add-song-btn';
    div.innerHTML = '<button class="btn btn--primary" id="btn-add-song">+ Add Song</button>';
    qs('.toolbar').insertAdjacentElement('afterend', div);
    qs('#btn-add-song').addEventListener('click', openAddForm);
  }
  if (!isEditor) showToast('Editor session ended.');
});

// ── Passcode modal ─────────────────────────────────────────────────────────
qs('#btn-unlock').addEventListener('click', () => {
  if (isEditor) { auth.signOut(); return; }
  qs('#passcode-input').value = '';
  qs('#passcode-error').hidden = true;
  qs('#passcode-modal').showModal();
  setTimeout(() => qs('#passcode-input').focus(), 50);
});
qs('#btn-cancel-modal').addEventListener('click', () => qs('#passcode-modal').close());

qs('#passcode-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = qs('[type=submit]', e.target);
  const err = qs('#passcode-error');
  btn.disabled = true; btn.textContent = 'Checking…'; err.hidden = true;
  try {
    const res  = await fetch(VERIFY_PASSCODE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: qs('#passcode-input').value }) });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.waitSeconds ? `Too many attempts. Try again in ${data.waitSeconds}s.` : `Incorrect passcode. ${data.attemptsRemaining ?? ''} attempt(s) remaining.`;
      err.hidden = false;
    } else {
      await auth.signInWithCustomToken(data.customToken);
      qs('#passcode-modal').close();
      showToast('Editing unlocked.');
    }
  } catch { err.textContent = 'Could not reach server. Please try again.'; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Unlock'; }
});

// ── Song form ──────────────────────────────────────────────────────────────
const FIELDS = { title: 'f-title', key: 'f-key', time: 'f-time', fTranspose: 'f-ftranspose', language: 'f-language', artist: 'f-artist', details: 'f-details', notes: 'f-notes', youtube: 'f-youtube' };

function openAddForm() {
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
  const s = allSongs.find(x => x.id === id);
  if (!s || !confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
  try { await db.collection('songs').doc(id).delete(); showToast('Song deleted.'); }
  catch (err) { showToast(`Delete failed: ${err.message}`); }
}

// ── Search ─────────────────────────────────────────────────────────────────
qs('#search-input').addEventListener('input', e => { searchQuery = e.target.value; applyFilters(); });
