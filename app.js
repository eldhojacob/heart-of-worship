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

// Configure pdf.js worker (used by the import feature)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── Constants ──────────────────────────────────────────────────────────────
const KEY_REGEX = /^[A-G][b#]?m?$/;

// All common major + minor keys for the dropdowns
const KEY_OPTIONS = (() => {
  const majors = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const minors = majors.map(k => k + 'm');
  return [...majors, ...minors];
})();

function populateKeyDropdowns() {
  const keyEl = document.querySelector('#f-key');
  const fEl   = document.querySelector('#f-ftranspose');
  if (keyEl && keyEl.options.length <= 1) {
    KEY_OPTIONS.forEach(k => keyEl.insertAdjacentHTML('beforeend', `<option value="${k}">${k}</option>`));
  }
  if (fEl && fEl.options.length <= 1) {
    KEY_OPTIONS.forEach(k => fEl.insertAdjacentHTML('beforeend', `<option value="${k}">${k}</option>`));
  }
}
populateKeyDropdowns();

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

// Escape HTML then colour chord lines / section labels
const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A line is treated as a "chord line" if, ignoring spaces, it only contains
// chord-like tokens (A–G with optional accidental/quality/bass).
function isChordLine(line) {
  const t = line.trim();
  if (!t) return false;
  const tokens = t.split(/\s+/);
  return tokens.every(tok => /^[A-G][#b]?(m|maj|min|dim|aug|sus|add)?\d{0,2}(\/[A-G][#b]?)?$/.test(tok));
}

// ── Transpose helpers ────────────────────────────────────────────────────────
const SHARP_SCALE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_SCALE  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const FLAT_KEYS   = new Set(['F','Bb','Eb','Ab','Db','Gb','Dm','Gm','Cm','Fm','Bbm']);

function noteToIndex(note) {
  const i = SHARP_SCALE.indexOf(note);
  if (i >= 0) return i;
  const j = FLAT_SCALE.indexOf(note);
  return j; // -1 if not found
}

// Transpose a single chord token by `semitones`, choosing sharps/flats to match target
function transposeChord(chord, semitones, useFlats) {
  // pattern: root (+accidental), suffix, optional /bass
  const m = chord.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return chord;
  const scale = useFlats ? FLAT_SCALE : SHARP_SCALE;
  const shift = root => {
    const idx = noteToIndex(root);
    if (idx < 0) return root;
    return scale[(idx + semitones + 1200) % 12];
  };
  const root = shift(m[1]);
  const suffix = m[2] || '';
  const bass = m[3] ? '/' + shift(m[3]) : '';
  return root + suffix + bass;
}

// Transpose a whole chord LINE while keeping character positions aligned.
// Replaces each chord token in place, padding/truncating so columns don't drift.
function transposeChordLine(line, semitones, useFlats) {
  return line.replace(/[A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b]?)?/g, (match) => {
    const out = transposeChord(match, semitones, useFlats);
    // keep alignment: pad or trim to original token width
    if (out.length < match.length) return out + ' '.repeat(match.length - out.length);
    if (out.length > match.length) return out; // let it grow slightly (rare)
    return out;
  });
}

// Lyrics-only view: drop chord lines, keep section labels + lyrics
function renderLyricsOnly(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const html = lines.map(line => {
    if (line.trim() === '') return `<div class="chart-line chart-line--blank">&nbsp;</div>`;
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) return `<div class="chart-line chart-label">${escapeHtml(line)}</div>`;
    if (isChordLine(line)) return ''; // skip pure chord lines
    return `<div class="chart-line">${escapeHtml(line.trimEnd())}</div>`;
  }).filter(x => x !== '').join('');
  return html;
}

function renderChordChart(text, semitones = 0, useFlats = false) {
  // Normalise all newline styles, then render each line as its own block so
  // line breaks are guaranteed regardless of surrounding flex/CSS.
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const html = lines.map(line => {
    if (line.trim() === '') return `<div class="chart-line chart-line--blank">&nbsp;</div>`;
    const trimmed = line.trim();
    let cls = 'chart-line';
    if (/^\[.*\]$/.test(trimmed)) { cls += ' chart-label'; return `<div class="${cls}">${escapeHtml(line)}</div>`; }
    if (isChordLine(line)) {
      cls += ' chart-chords';
      const shifted = semitones ? transposeChordLine(line, semitones, useFlats) : line;
      return `<div class="${cls}">${escapeHtml(shifted)}</div>`;
    }
    return `<div class="${cls}">${escapeHtml(line)}</div>`;
  }).join('');
  return html;
}

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
let songsVisible = false; // the song list is hidden on landing until shown
let sundayIds    = [];    // song IDs on the Upcoming Sunday Worship list
let sundayWeek   = '';    // ISO date (yyyy-mm-dd) of the upcoming Sunday this list is for
let sundayHistory = [];   // [{ date: 'yyyy-mm-dd', songIds: [...] }]

// ── Date helpers ─────────────────────────────────────────────────────────────
// Returns the upcoming Sunday (today if today is Sunday) as a Date
function upcomingSundayDate(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay();                 // 0 = Sunday
  const add = day === 0 ? 0 : (7 - day);
  d.setDate(d.getDate() + add);
  return d;
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function formatDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

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
  // The list stays hidden on the landing page until the user shows it
  // (or starts searching / filtering).
  if (!songsVisible) {
    qs('#song-list').hidden = true;
    return;
  }
  qs('#song-list').hidden = false;
  const q = searchQuery.trim().toLowerCase();
  const filtered = allSongs.filter(s => {
    const matchQ = !q || (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q);
    const matchL = !selectedLangs.size || (isNonEmpty(s.language) && selectedLangs.has(s.language.toLowerCase()));
    return matchQ && matchL;
  });
  renderSongList(filtered);
}

function setSongsVisible(visible) {
  songsVisible = visible;
  const btn = qs('#btn-show-songs');
  if (btn) {
    btn.setAttribute('aria-expanded', String(visible));
    btn.textContent = visible ? '📋 Hide songs' : '📋 Show all songs';
  }
  applyFilters();
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
    if (!songsVisible) songsVisible = true; // selecting a filter reveals the list
    renderChips();
    setSongsVisible(songsVisible);
  }));
}

// ── Shared full song card (used by main list AND Sunday dialog) ─────────────
// opts.sundayAction: 'toggle' (★ Add/✓ On Sunday) | 'remove' (✕) | 'none'
function fullSongCardHtml(song, opts = {}) {
  const sundayMode = opts.sundayAction || 'toggle';
  const detailRows = [
    song.artist  && isNonEmpty(song.artist)  ? `<div class="detail-row"><span class="detail-row__label">Artist</span><span>${song.artist}</span></div>` : '',
    song.details && isNonEmpty(song.details) ? `<div class="detail-row"><span class="detail-row__label">Details</span><span>${song.details}</span></div>` : '',
    song.notes   && isNonEmpty(song.notes)   ? `<div class="detail-row"><span class="detail-row__label">Notes</span><span>${song.notes}</span></div>` : '',
    song.youtube && isNonEmpty(song.youtube) ? `<div class="detail-row"><span class="detail-row__label">Video</span><a href="${song.youtube}" target="_blank" rel="noopener">${song.youtube}</a></div>` : '',
    isNonEmpty(song.chart) ? `<div class="detail-row" style="flex-direction:column; align-items:stretch;">
      <div class="chart-view-buttons">
        <button class="btn btn--sm btn--outline" data-view="chords" data-song="${song.id}">🎵 With Chords</button>
        <button class="btn btn--sm btn--outline" data-view="lyrics" data-song="${song.id}">📝 Lyrics only</button>
      </div>
      <div class="chart-collapse" data-chart-collapse="${song.id}" hidden>
        <div class="chart-toolbar" data-toolbar-for="${song.id}">
          <label class="transpose-ctl">Transpose to:
            <select class="transpose-select" data-song="${song.id}" data-origkey="${(song.key||'C').replace(/m$/,'')}">
              ${SHARP_SCALE.map(k => `<option value="${k}"${k===(song.key||'C').replace(/m$/,'')?' selected':''}>${k}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="chord-chart" data-chart-for="${song.id}">${renderChordChart(song.chart)}</div>
      </div>
    </div>` : '',
  ].filter(Boolean).join('');

  let sundayBtn = '';
  if (sundayMode === 'toggle') {
    sundayBtn = `<div class="song-card__sunday">
      <button class="btn btn--sm btn--sunday${sundayIds.includes(song.id) ? ' is-on' : ''}" data-action="sunday" aria-label="Toggle Sunday for ${song.title}">
        ${sundayIds.includes(song.id) ? '✓ On Sunday' : '★ Add to Sunday'}
      </button>
    </div>`;
  } else if (sundayMode === 'remove') {
    sundayBtn = `<div class="song-card__sunday">
      <button class="btn btn--sm btn--icon-x" data-action="sunday-remove" aria-label="Remove ${song.title} from Sunday" title="Remove from Sunday">✕</button>
    </div>`;
  }

  const editDelete = (!opts.hideEdit) ? `<div class="song-card__actions">
    ${canEdit()   ? `<button class="btn btn--sm btn--outline" data-action="edit"   aria-label="Edit ${song.title}">Edit</button>` : ''}
    ${canDelete() ? `<button class="btn btn--sm btn--danger"  data-action="delete" aria-label="Delete ${song.title}">Delete</button>` : ''}
  </div>` : '';

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
      ${sundayBtn}
      ${editDelete}
    </div>
    ${detailRows ? `<div class="song-card__detail">${detailRows}</div>` : ''}
  </article>`;
}

// Wire up click/expand/transpose events for all cards within a container
function wireCardEvents(container) {
  qsa('.song-card', container).forEach(card => {
    qs('.song-card__header', card).addEventListener('click', () => {
      qs('.song-card__detail', card)?.classList.toggle('is-open');
    });
    qs('[data-action="edit"]',          card)?.addEventListener('click', e => { e.stopPropagation(); openEditForm(card.dataset.id); });
    qs('[data-action="delete"]',        card)?.addEventListener('click', e => { e.stopPropagation(); confirmDelete(card.dataset.id); });
    qs('[data-action="sunday"]',        card)?.addEventListener('click', e => { e.stopPropagation(); toggleSunday(card.dataset.id); });
    qs('[data-action="sunday-remove"]', card)?.addEventListener('click', e => { e.stopPropagation(); toggleSunday(card.dataset.id); });
    // Chord/Lyrics view buttons
    const viewBtns = qsa('[data-view]', card);
    viewBtns.forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id    = btn.dataset.song;
        const view  = btn.dataset.view; // 'chords' | 'lyrics'
        const song  = allSongs.find(s => s.id === id);
        if (!song) return;
        const panel   = qs(`[data-chart-collapse="${id}"]`, card);
        const chartEl = qs(`[data-chart-for="${id}"]`, card);
        const toolbar = qs(`[data-toolbar-for="${id}"]`, card);

        // If this view is already active and open, clicking again collapses it
        if (!panel.hidden && btn.classList.contains('is-active')) {
          panel.hidden = true;
          viewBtns.forEach(b => b.classList.remove('is-active'));
          return;
        }
        // Activate the chosen view
        viewBtns.forEach(b => b.classList.toggle('is-active', b === btn));
        panel.hidden = false;
        if (view === 'lyrics') {
          toolbar.style.display = 'none';            // no transpose for lyrics
          chartEl.classList.add('chord-chart--wrap'); // lyrics can wrap, no scroll needed
          chartEl.innerHTML = renderLyricsOnly(song.chart);
        } else {
          toolbar.style.display = '';                // show transpose
          chartEl.classList.remove('chord-chart--wrap');
          const sel = qs('.transpose-select', card);
          if (sel) sel.value = (song.key || 'C').replace(/m$/, '');
          chartEl.innerHTML = renderChordChart(song.chart);
        }
      });
    });
    // Transpose dropdown
    const sel = qs('.transpose-select', card);
    if (sel) {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', e => {
        e.stopPropagation();
        const song = allSongs.find(s => s.id === card.dataset.id);
        if (!song) return;
        const origKey = sel.dataset.origkey || 'C';
        const target  = sel.value;
        const semis = ((noteToIndex(target) - noteToIndex(origKey)) % 12 + 12) % 12;
        const useFlats = FLAT_KEYS.has(target) || target.includes('b');
        const chartEl = qs(`[data-chart-for="${card.dataset.id}"]`, card);
        if (chartEl) chartEl.innerHTML = renderChordChart(song.chart, semis, useFlats);
      });
    }
  });
}

// ── Render: song list ──────────────────────────────────────────────────────
function renderSongList(songs) {
  const list = qs('#song-list');
  if (!songs.length) {
    list.innerHTML = `<p class="empty-state">${allSongs.length ? 'No songs match your search.' : 'No songs yet. Add the first one!'}</p>`;
    return;
  }
  list.innerHTML = songs.map(song => fullSongCardHtml(song, { sundayAction: 'toggle' })).join('');
  wireCardEvents(list);
}

// ── Upcoming Sunday Worship ──────────────────────────────────────────────────
// config/sunday → { songIds: [...], weekDate: 'yyyy-mm-dd' }  (live-synced)
// config/sundayHistory → { archives: [{ date, songIds }] }
db.collection('config').doc('sunday').onSnapshot(
  snap => {
    const data = snap.exists ? snap.data() : {};
    sundayIds  = Array.isArray(data.songIds) ? data.songIds : [];
    sundayWeek = data.weekDate || '';
    maybeArchivePastWeek();   // auto-roll the week if it's in the past
    renderSunday();
    applyFilters();
  },
  err => console.error('sunday listener error:', err)
);

db.collection('config').doc('sundayHistory').onSnapshot(
  snap => { sundayHistory = (snap.exists && Array.isArray(snap.data().archives)) ? snap.data().archives : []; },
  err  => console.error('sunday history listener error:', err)
);

// If the stored week date is before this week's upcoming Sunday, archive it
// and reset the current list for the new upcoming Sunday.
let archiveInFlight = false;
async function maybeArchivePastWeek() {
  const todayUpcoming = toISODate(upcomingSundayDate());
  // No week set yet → set it to the upcoming Sunday (no archive)
  if (!sundayWeek) {
    try { await ensureAnonAuthForSunday(); await db.collection('config').doc('sunday').set({ weekDate: todayUpcoming }, { merge: true }); } catch (e) { /* non-critical */ }
    return;
  }
  if (sundayWeek >= todayUpcoming) return;   // still current/future — nothing to do
  if (archiveInFlight) return;
  archiveInFlight = true;
  try {
    await ensureAnonAuthForSunday();
    // Archive the old week only if it had songs
    if (sundayIds.length) {
      const existing = sundayHistory.filter(a => a.date !== sundayWeek);
      const archives = [{ date: sundayWeek, songIds: sundayIds }, ...existing].slice(0, 52); // keep ~1 year
      await db.collection('config').doc('sundayHistory').set({ archives }, { merge: true });
    }
    // Reset current list for the new upcoming Sunday
    await db.collection('config').doc('sunday').set({ songIds: [], weekDate: todayUpcoming }, { merge: true });
  } catch (ex) {
    console.error('archive error:', ex);
  } finally {
    archiveInFlight = false;
  }
}

async function toggleSunday(id) {
  const next = sundayIds.includes(id) ? sundayIds.filter(x => x !== id) : [...sundayIds, id];
  const week = sundayWeek || toISODate(upcomingSundayDate());
  try {
    await ensureAnonAuthForSunday();
    await db.collection('config').doc('sunday').set({ songIds: next, weekDate: week }, { merge: true });
    showToast(sundayIds.includes(id) ? 'Removed from Sunday.' : 'Added to Sunday.');
  } catch (ex) {
    console.error(ex);
    showToast('Could not update Sunday list: ' + (ex.message || ex));
  }
}

// Anyone (even logged out) can modify the Sunday list, so make sure there is
// at least an anonymous Firebase session when they try.
async function ensureAnonAuthForSunday() {
  if (!auth.currentUser) await auth.signInAnonymously();
}

function sundayCardHtml(song) {
  // Full card (expandable details + chords/lyrics), with ✕ remove and no edit/delete
  return fullSongCardHtml(song, { sundayAction: 'remove', hideEdit: true });
}

function renderSunday() {
  const clearBtn = qs('#btn-sunday-clear');
  const mlWrap   = qs('#sunday-list-malayalam');
  const enWrap   = qs('#sunday-list-english');
  if (!mlWrap || !enWrap) return;

  // Show the upcoming Sunday's date
  const dateEl = qs('#sunday-date');
  if (dateEl) {
    const iso = sundayWeek || toISODate(upcomingSundayDate());
    dateEl.textContent = '📅 ' + formatDMY(iso);
  }

  // Resolve IDs → song objects, preserving chosen order
  const songs = sundayIds.map(id => allSongs.find(s => s.id === id)).filter(Boolean);

  clearBtn.hidden = !isAdmin() || songs.length === 0;

  const isMalayalam = s => (s.language || '').trim().toLowerCase() === 'malayalam';
  const ml = songs.filter(isMalayalam);
  const en = songs.filter(s => !isMalayalam(s)); // English + anything else

  mlWrap.innerHTML = ml.length
    ? ml.map(sundayCardHtml).join('')
    : '<p class="sunday-empty">No Malayalam songs added yet.</p>';
  enWrap.innerHTML = en.length
    ? en.map(sundayCardHtml).join('')
    : '<p class="sunday-empty">No English songs added yet.</p>';

  wireCardEvents(mlWrap);
  wireCardEvents(enWrap);
}

// Open / close the Sunday Worship dialog
qs('#btn-sunday-open').addEventListener('click', () => {
  renderSunday();
  qs('#sunday-modal').showModal();
});
qs('#btn-sunday-close').addEventListener('click', () => qs('#sunday-modal').close());

// Previous Sundays
qs('#btn-sunday-prev').addEventListener('click', () => {
  qs('#sunday-modal').close();
  renderPrevSundays();
  qs('#prev-sunday-modal').showModal();
});
qs('#btn-prev-sunday-close').addEventListener('click', () => qs('#prev-sunday-modal').close());
qs('#btn-back-to-current').addEventListener('click', () => {
  qs('#prev-sunday-modal').close();
  renderSunday();
  qs('#sunday-modal').showModal();
});

function renderPrevSundays() {
  const wrap = qs('#prev-sunday-list');
  if (!sundayHistory.length) {
    wrap.innerHTML = '<p class="sunday-empty">No previous Sunday worship lists yet.</p>';
    return;
  }
  const isMalayalam = s => (s.language || '').trim().toLowerCase() === 'malayalam';
  wrap.innerHTML = sundayHistory
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))   // newest first
    .map(week => {
      const songs = (week.songIds || []).map(id => allSongs.find(s => s.id === id)).filter(Boolean);
      const ml = songs.filter(isMalayalam);
      const en = songs.filter(s => !isMalayalam(s));
      const groupHtml = (label, list) => list.length
        ? `<div class="prev-week__group"><h4>🕊 ${label}</h4>${list.map(s =>
            `<div class="prev-week__song">${renderKeyBadge(s.key)} <span>${s.title}</span></div>`).join('')}</div>`
        : '';
      return `<div class="prev-week">
        <div class="prev-week__date">📅 ${formatDMY(week.date)}</div>
        ${songs.length ? (groupHtml('Malayalam', ml) + groupHtml('English', en)) : '<p class="sunday-empty">No songs recorded.</p>'}
      </div>`;
    }).join('');
}

qs('#btn-sunday-clear').addEventListener('click', async () => {
  if (!isAdmin()) { showToast('Only admins can clear the Sunday list.'); return; }
  if (!confirm('Clear ALL songs from the Upcoming Sunday Worship list?\n\nThis cannot be undone.')) return;
  try {
    await ensureAnonAuthForSunday();
    await db.collection('config').doc('sunday').set({ songIds: [] }, { merge: true });
    showToast('Sunday list cleared.');
  } catch (ex) {
    console.error(ex);
    showToast('Could not clear: ' + (ex.message || ex));
  }
});

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

  // Add Song + Import buttons (present in HTML; just toggle visibility)
  const allowed = canAdd();
  qs('#btn-add-song').hidden    = !allowed;
  qs('#btn-import-song').hidden = !allowed;

  // Re-render song list so edit/delete buttons reflect permissions
  applyFilters();
  if (typeof renderSunday === 'function') renderSunday();
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

// ── Settings MENU → opens individual dialogs ────────────────────────────────
function refreshSettingsMenu() {
  qs('#menu-background').hidden = !isAdmin();     // background is admin-only
  qs('#menu-users').hidden      = !isAdmin();     // user management admin-only
  qs('#menu-password').hidden   = !isLoggedIn();  // anyone logged in
}

qs('#btn-settings').addEventListener('click', async () => {
  if (!(canWriteAny() || isAdmin())) { showToast('Log in first.'); return; }
  refreshSettingsMenu();
  qs('#settings-modal').showModal();
});
qs('#btn-settings-close').addEventListener('click', () => qs('#settings-modal').close());

// Menu item → Background dialog
qs('#menu-background').addEventListener('click', () => {
  qs('#settings-modal').close();
  qs('#bg-status').textContent = '';
  qs('#background-modal').showModal();
});
qs('#btn-bg-close').addEventListener('click', () => qs('#background-modal').close());

// Menu item → Users dialog
qs('#menu-users').addEventListener('click', async () => {
  qs('#settings-modal').close();
  try { await loadUsers(); } catch (e) { console.error(e); }
  renderUserList();
  qs('#users-modal').showModal();
});
qs('#btn-users-close').addEventListener('click', () => qs('#users-modal').close());

// Menu item → Reset password dialog
qs('#menu-password').addEventListener('click', () => {
  qs('#settings-modal').close();
  qs('#pw-status').textContent = '';
  qs('#pw-new').value = '';
  qs('#password-modal').showModal();
});
qs('#btn-pw-close').addEventListener('click', () => qs('#password-modal').close());

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
    setTimeout(() => qs('#password-modal').close(), 800);
  } catch (ex) {
    console.error(ex);
    status.textContent = 'Could not update: ' + (ex.message || ex);
  }
});

// Apply initial permission UI (in case a session was restored)
if (currentUser) { ensureAnonAuth().finally(applyPermissionUI); } else { applyPermissionUI(); }

// ── Song form ──────────────────────────────────────────────────────────────
const FIELDS = { title: 'f-title', key: 'f-key', time: 'f-time', fTranspose: 'f-ftranspose', language: 'f-language', artist: 'f-artist', details: 'f-details', notes: 'f-notes', youtube: 'f-youtube', chart: 'f-chart' };

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
    chart:         qs('#f-chart').value             || null,
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

// ── Show / hide songs toggle ─────────────────────────────────────────────────
qs('#btn-show-songs').addEventListener('click', () => setSongsVisible(!songsVisible));

// ── Add / Import buttons (wired once; shown/hidden by permissions) ──────────
qs('#btn-add-song').addEventListener('click', openAddForm);
qs('#btn-import-song').addEventListener('click', openImportDialog);

// ── Search ─────────────────────────────────────────────────────────────────
qs('#search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  // Searching auto-reveals the list; clearing it does not force-hide
  if (searchQuery.trim() && !songsVisible) { setSongsVisible(true); return; }
  applyFilters();
});

// ── Import songs (CSV / Excel / pasted text) ────────────────────────────────
const IMPORT_FIELDS = ['title','key','timesignature','ftranspose','language','artist','details','notes','youtube','chart'];
let importParsed = []; // [{ data:{...}, valid:bool, error:'' }]

function openImportDialog() {
  if (!canAdd()) { showToast('You do not have permission to add songs.'); return; }
  qs('#import-preview').hidden = true;
  qs('#import-rows').innerHTML = '';
  qs('#import-summary').textContent = '';
  qs('#import-error').hidden = true;
  qs('#import-filename').textContent = '';
  qs('#btn-import-confirm').disabled = true;
  importParsed = [];
  qs('#import-modal').showModal();
}
qs('#btn-import-close').addEventListener('click', () => qs('#import-modal').close());
qs('#btn-import-cancel').addEventListener('click', () => qs('#import-modal').close());

// Normalise a header name → our canonical field key
function normaliseHeader(h) {
  const k = (h || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  // map a few friendly aliases
  if (k === 'timesig' || k === 'time' || k === 'timesignature') return 'timesignature';
  if (k === 'femalekey' || k === 'ftranspose' || k === 'femaletranspose') return 'ftranspose';
  return k;
}

// Turn an array-of-arrays (rows) into validated song objects
function buildFromRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normaliseHeader);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => String(c ?? '').trim() === '')) continue; // skip blank lines
    const rec = {};
    headers.forEach((h, idx) => {
      if (IMPORT_FIELDS.includes(h)) rec[h] = String(row[idx] ?? '').trim();
    });
    const data = {
      title:         rec.title || '',
      key:           rec.key || '',
      timeSignature: rec.timesignature || '',
      fTranspose:    rec.ftranspose || null,
      language:      rec.language || null,
      artist:        rec.artist || null,
      details:       rec.details || null,
      notes:         rec.notes || null,
      youtube:       rec.youtube || null,
      chart:         rec.chart || null,
    };
    // validate
    let error = '';
    if (!isNonEmpty(data.title)) error = 'missing title';
    else if (!isNonEmpty(data.key)) error = 'missing key';
    else if (!KEY_REGEX.test(data.key)) error = 'bad key format';
    else if (!isNonEmpty(data.timeSignature)) error = 'missing time signature';
    else if (isNonEmpty(data.fTranspose) && !KEY_REGEX.test(data.fTranspose)) error = 'bad female-key format';
    out.push({ data, valid: !error, error });
  }
  return out;
}

// Split pasted text into rows, auto-detecting tab / comma / semicolon
function parseDelimited(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length);
  if (!lines.length) return [];
  // detect delimiter from the header line
  const header = lines[0];
  const delim = header.includes('\t') ? '\t' : (header.includes(';') ? ';' : ',');
  return lines.map(line => line.split(delim).map(c => c.trim()));
}

function renderImportPreview() {
  const wrap = qs('#import-rows');
  const valid = importParsed.filter(r => r.valid).length;
  const total = importParsed.length;
  qs('#import-summary').textContent = `${total} row(s) found · ${valid} valid · ${total - valid} will be skipped.`;
  wrap.innerHTML = importParsed.map(r => {
    const d = r.data;
    if (r.valid) {
      return `<div class="import-row import-row--ok">
        <span class="import-row__title">${d.title}</span>
        <span class="import-row__detail">${d.key} · ${d.timeSignature}${d.language ? ' · ' + d.language : ''}</span>
      </div>`;
    }
    return `<div class="import-row import-row--bad">
      <span class="import-row__title">${d.title || '(no title)'}</span>
      <span class="import-row__err">⚠ ${r.error}</span>
    </div>`;
  }).join('');
  qs('#import-preview').hidden = false;
  qs('#btn-import-confirm').disabled = valid === 0;
  qs('#import-error').hidden = true;
}

// Parse a plain-text document (txt/docx/pdf extracted text) with labelled
// fields at the top and a chords/lyrics body below. Returns one song object.
function buildFromDocument(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rec = { title:'', key:'', timeSignature:'', fTranspose:null, language:null, artist:null, details:null, notes:null, youtube:null, chart:null };

  // Field label aliases → our keys
  const labelMap = {
    title: 'title', song: 'title', name: 'title',
    artist: 'artist', by: 'artist', author: 'artist', composer: 'artist',
    key: 'key',
    time: 'timeSignature', timesignature: 'timeSignature', timesig: 'timeSignature', meter: 'timeSignature',
    language: 'language', lang: 'language',
    ftranspose: 'fTranspose', femalekey: 'fTranspose', female: 'fTranspose',
    details: 'details', scripture: 'details', reference: 'details',
    notes: 'notes', note: 'notes',
    youtube: 'youtube', video: 'youtube', link: 'youtube',
  };

  let i = 0;
  // Read labelled lines until we hit a blank line or a non-labelled line
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { i++; break; } // blank line ends the header block
    const m = line.match(/^\s*([A-Za-z ]+?)\s*[:\-]\s*(.+)$/);
    if (!m) { break; } // first non-labelled line → body starts here
    const label = m[1].trim().toLowerCase().replace(/\s+/g, '');
    const value = m[2].trim();
    const field = labelMap[label];
    if (field) rec[field] = value;
    // if the label isn't recognised, treat it as the start of the body
    else { break; }
  }

  // Everything from line i onwards is the chords/lyrics chart
  const body = lines.slice(i).join('\n').trim();
  if (body) rec.chart = body;

  // If no explicit title label, use the first non-empty line as the title
  if (!rec.title) {
    const firstLine = lines.find(l => l.trim());
    if (firstLine) rec.title = firstLine.trim();
  }

  // Validate (same rules as rows)
  let error = '';
  if (!isNonEmpty(rec.title)) error = 'missing title';
  else if (!isNonEmpty(rec.key)) error = 'missing key';
  else if (!KEY_REGEX.test(rec.key)) error = 'bad or missing key (e.g. G, Bm, F#)';
  else if (!isNonEmpty(rec.timeSignature)) error = 'missing time signature';
  else if (isNonEmpty(rec.fTranspose) && !KEY_REGEX.test(rec.fTranspose)) error = 'bad female-key format';
  return [{ data: rec, valid: !error, error }];
}

// Extract text from a .docx file (mammoth) or .pdf (pdf.js)
async function extractDocxText(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || '';
}
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group items by their vertical position to rebuild lines
    const rows = {};
    content.items.forEach(it => {
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
    });
    Object.keys(rows).sort((a,b) => b - a).forEach(y => {
      const line = rows[y].sort((a,b) => a.x - b.x).map(o => o.s).join('');
      out += line + '\n';
    });
    out += '\n';
  }
  return out;
}

// File → preview (routes by extension)
qs('#btn-import-file').addEventListener('click', () => qs('#import-file-input').click());
qs('#import-file-input').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  qs('#import-filename').textContent = file.name;
  qs('#import-error').hidden = true;
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      importParsed = buildFromRows(parseDelimited(await file.text()));
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      importParsed = buildFromRows(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }));
    } else if (name.endsWith('.txt')) {
      importParsed = buildFromDocument(await file.text());
    } else if (name.endsWith('.docx')) {
      importParsed = buildFromDocument(await extractDocxText(file));
    } else if (name.endsWith('.pdf')) {
      importParsed = buildFromDocument(await extractPdfText(file));
    } else if (name.endsWith('.doc')) {
      throw new Error('Old .doc files are not supported — please save as .docx or .txt.');
    } else {
      throw new Error('Unsupported file type.');
    }

    if (!importParsed.length) {
      qs('#import-error').textContent = 'No songs found in the file.';
      qs('#import-error').hidden = false;
      qs('#import-preview').hidden = false;
      return;
    }
    renderImportPreview();
  } catch (ex) {
    console.error(ex);
    qs('#import-error').textContent = 'Could not read the file: ' + (ex.message || ex);
    qs('#import-error').hidden = false;
    qs('#import-preview').hidden = false;
  } finally {
    e.target.value = '';
  }
});

// Confirm → write valid songs to Firestore (batched)
qs('#btn-import-confirm').addEventListener('click', async () => {
  if (!canAdd()) { showToast('You do not have permission to add songs.'); return; }
  const valid = importParsed.filter(r => r.valid);
  if (!valid.length) return;
  // Language chosen via the radio buttons applies to all imported songs
  const langRadio = document.querySelector('input[name="import-lang"]:checked');
  const importLang = langRadio ? langRadio.value : null;
  const btn = qs('#btn-import-confirm');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    // Firestore batches cap at 500 ops; chunk to be safe
    const chunks = [];
    for (let i = 0; i < valid.length; i += 400) chunks.push(valid.slice(i, i + 400));
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(r => {
        const ref = db.collection('songs').doc();
        // Force the chosen language (fallback to any language already in the row)
        const data = { ...r.data, language: importLang || r.data.language || null };
        batch.set(ref, { ...data, createdAt: ts, updatedAt: ts });
      });
      await batch.commit();
    }
    qs('#import-modal').close();
    showToast(`Imported ${valid.length} song(s).`);
  } catch (ex) {
    console.error(ex);
    qs('#import-error').textContent = 'Import failed: ' + (ex.message || ex);
    qs('#import-error').hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Import valid songs';
  }
});

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
