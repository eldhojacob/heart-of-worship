# Design Document — Heart of Worship

## Overview

Heart of Worship is a read-optimised, mobile-first worship-team reference tool. Any
visitor can browse, search, filter, view chords/lyrics, and plan the Sunday service
without logging in. Editors log in with a username/passcode checked client-side
against a user list stored in Firestore; on a successful match the app signs in with
Firebase **Anonymous Auth** so that Firestore security rules (which require
`request.auth != null`) permit writes.

The entire frontend is three static files — `index.html`, `styles.css`, `app.js` —
deployed to GitHub Pages. There is no build step, no bundler, and **no Cloud
Function** (an earlier passcode-verification function was removed in favour of the
simpler client-side check + anonymous session model). All shared state lives in
Firestore and is pushed to every open tab in real time via `onSnapshot` listeners.
Background images are stored in Firebase Storage.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        GitHub Pages                             │
│   index.html  →  styles.css  →  app.js  (ES module)             │
│       │  Firebase compat SDK (CDN) + SheetJS / mammoth / pdf.js │
│   ┌───▼────────────────────────────────────────────────────┐   │
│   │                 Firebase Project                        │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐   │   │
│   │   │  Firestore   │  │   Storage    │  │  Anonymous  │   │   │
│   │   │              │  │ (bg images)  │  │    Auth     │   │   │
│   │   │ /songs/{id}  │  └──────────────┘  └─────────────┘   │   │
│   │   │ /config/editor      (legacy passcode)              │   │
│   │   │ /config/users       (users, roles, perms)          │   │
│   │   │ /config/appearance  (themeColor, bg)               │   │
│   │   │ /config/sunday      (songIds, weekDate)            │   │
│   │   │ /config/sundayHistory (archives[])                 │   │
│   │   │ onSnapshot listeners → live UI                     │   │
│   │   └────────────────────────────────────────────────────┘  │
│   └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Key design choices

| Decision | Rationale |
|---|---|
| Static HTML + vanilla JS | No build step; deploys directly to GitHub Pages |
| Anonymous Auth (no Cloud Function) | Removed an IAM-constrained `signBlob` dependency; passcode is matched client-side against `config/users`, then an anonymous session unlocks writes |
| Firestore `onSnapshot` for all shared docs | Built-in real-time push for songs, users, appearance, Sunday list, and history |
| `config/*` documents for shared app state | One place per concern (users, appearance, sunday, history); public read, auth-required write |
| sessionStorage for the logged-in user | Keeps the role/permissions across refresh within the tab |
| Cache-busting `?v=N` on CSS/JS | Mobile browsers cache aggressively; bumping the version forces a reload |
| CDN parsers (SheetJS, mammoth.js, pdf.js) | File import without a backend |

---

## Components and Interfaces

`app.js` is a single well-structured module. Logical areas:

```
1. Firebase init + config
2. Constants (KEY_OPTIONS, SHARP/FLAT scales, regexes)
3. Render helpers (key badge, time sig, chord chart, lyrics-only)
4. Transpose helpers
5. State (allSongs, currentUser, sundayIds, sundayWeek, sundayHistory, …)
6. Song list + card rendering + card event wiring
7. Sunday Worship + Previous Sundays
8. Users / auth / permissions / settings dialogs
9. Add / Edit form + chord-lyric merge parsing
10. Import (CSV/XLSX/TXT/DOCX/PDF + paste) + preview
11. Firestore subscriptions + bootstrap
```

### Shared song card

`fullSongCardHtml(song, opts)` renders a card used in three contexts via `opts`:
- `sundayAction: 'toggle'` — main list (★ Add / ✓ On Sunday button)
- `sundayAction: 'remove'` + `hideEdit: true` — Sunday dialog (✕ remove, no edit)
- `hideEdit: true` — read-only contexts (locked archive display)

`wireCardEvents(container)` attaches: header expand/collapse, edit/delete,
Sunday toggle/remove, the With-Chords/Lyrics-only view buttons, and the transpose
dropdown.

### Chord / lyrics rendering

- `renderChordChart(text, semitones, useFlats)` — splits text into line `<div>`s;
  classifies each line as a section label (`[Verse N]`), a chord line
  (`isChordLine`), or a lyric line; transposes chord lines in place while keeping
  column alignment.
- `renderLyricsOnly(text)` — drops chord lines, keeps labels and lyric lines
  (Malayalam + English).
- `isChordLine(line)` — true when every whitespace-separated token is a chord token.

### Transpose

- `SHARP_SCALE` / `FLAT_SCALE` / `FLAT_KEYS` drive sharp-vs-flat choice.
- `transposeChord` shifts a single chord (root + suffix + optional bass).
- `transposeChordLine` replaces each chord token in a line, padding to preserve the
  monospace column layout.

### Sunday Worship / Previous Sundays

- `renderSunday()` resolves `sundayIds` → song objects, splits Malayalam vs English,
  shows the upcoming date (DD/MM/YYYY), and toggles the admin-only "Clear all" and
  "Move to Previous Sunday" buttons based on `isAdmin()` and song count.
- `toggleSunday(id)` adds/removes a song ID in `config/sunday`.
- `maybeArchivePastWeek()` auto-archives a set whose `weekDate` has passed into
  `config/sundayHistory.archives` and resets the upcoming list.
- The **Move to Previous Sunday** handler (admin-only) archives the current songs
  under the worship date, empties `config/sunday`, and rolls `weekDate` forward to
  the next upcoming Sunday; the live `config/sunday` listener then clears the
  "✓ On Sunday" tags in the song list automatically. It opens the Previous Sundays
  dialog so the moved set is visible.
- `renderPrevSundays()` lists archived weeks newest-first, dated and grouped, as
  read-only entries (no edit/remove controls → locked state).

### Auth / users / permissions

- `loadUsers()` reads `config/users`; `getLegacyAdminPasscode()` reads
  `config/editor` for the legacy admin fallback.
- Login matches username/passcode against the user list (or legacy passcode), stores
  the resolved user in `sessionStorage`, calls `auth.signInAnonymously()` to unlock
  writes, and applies UI via `applyPermissionUI()`.
- Permission helpers: `isLoggedIn`, `isAdmin`, `canAdd`, `canEdit`, `canDelete`,
  `canWriteAny`. Body classes (`is-editor`, `can-add`, …) gate control visibility.
- `ensureAnonAuthForSunday()` / `ensureAnonAuth()` guarantee an anonymous session
  before any write (including the public Sunday toggles).

### Settings dialogs

A settings **menu** opens individual dialogs: background upload (Storage), theme
colour palette (writes `config/appearance.themeColor`, overrides CSS vars
`--color-green/-light/-tint`), manage users (admin), and reset password (any
logged-in user).

### Add / Edit form and chord-lyric merge

The form provides two paste fields: `#f-chart` (Chords & Lyrics) and `#f-lyrics`
(Lyrics only). On save, `buildChart(chordsText, lyricsText)` decides:
- both present → `mergeChordsOverMixedLyrics` builds a chords+English chart keeping
  all chords, with English lines taken from the lyrics field in order (Malayalam
  dropped from the chart);
- chords only → `normaliseChart` / `convertInlineChords` parse VerseView glued inline
  chords (chords embedded mid-word) into chords-above-lyrics;
- lyrics only → stored as-is.
The `lyrics` field is stored separately for the lyrics-only view.

### Import

`buildFromPastedSong` and file extractors (`extractDocxText`, `extractPdfText`,
SheetJS for CSV/XLSX) parse uploads, detect title/artist/key/time/language and
chords/lyrics, and present a preview before saving. The user picks Malayalam or
English for the batch.

---

## Data Models

### Firestore collection: `songs/{songId}`

```ts
interface Song {
  id: string;              // Firestore doc ID (immutable)
  title: string;           // required
  key: string;             // required, from the key dropdown
  timeSignature: string;   // required, e.g. "4/4"
  fTranspose?: string;     // optional female-lead key
  language?: string;       // "Malayalam" | "English"
  artist?: string;
  details?: string;
  notes?: string;
  youtube?: string;        // http/https URL
  chart?: string;          // chords-above-lyrics (chords + English)
  lyrics?: string;         // plain lyrics (Malayalam + English, no chords)
}
```

### Shared config documents

```ts
// config/users
interface UsersDoc { users: Array<{
  username: string; passcode: string; role: 'admin'|'editor'|'readonly';
  perms: { add: boolean; edit: boolean; delete: boolean };
}>; }

// config/editor  (legacy admin fallback)
interface EditorDoc { passcode: string; }

// config/appearance
interface AppearanceDoc { themeColor?: string; bgImageUrl?: string; }

// config/sunday  (upcoming set)
interface SundayDoc { songIds: string[]; weekDate: string; /* yyyy-mm-dd */ }

// config/sundayHistory  (archive)
interface SundayHistoryDoc {
  archives: Array<{ date: string; /* yyyy-mm-dd */ songIds: string[] }>; // newest-first, ~52 kept
}
```

### Client-side state

```ts
let allSongs: Song[];
let currentUser: { username; role; perms } | null;
let usersCache: UsersDoc['users'];
let songsVisible: boolean;          // landing list hidden until shown
let sundayIds: string[];
let sundayWeek: string;             // yyyy-mm-dd
let sundayHistory: SundayHistoryDoc['archives'];
```

---

## Firebase Security Rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /songs/{songId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null;
    }
    match /config/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

Writes require any authenticated session; the app establishes an **anonymous**
session at login (and before public Sunday-list writes). Passcode/role checks are
performed client-side against `config/users`.

---

## Authentication Flow (no Cloud Function)

```
Browser
  │  user enters username + passcode
  │  read config/users  (and config/editor as legacy fallback)
  │  match client-side
  │   ├─ no match → show error, stay locked
  │   └─ match → resolve role + perms
  │               auth.signInAnonymously()   // unlock writes
  │               sessionStorage['hw_user'] = user
  │               applyPermissionUI()         // reveal allowed controls
```

Session persistence: the resolved user is restored from `sessionStorage` on load;
Firestore writes work while the anonymous Firebase session is active.

---

## Real-Time Sync

A set of `onSnapshot` listeners is attached once at startup:

```js
db.collection('songs').orderBy('title').onSnapshot(/* → allSongs, re-render */);
db.collection('config').doc('sunday').onSnapshot(/* → sundayIds/week, re-render */);
db.collection('config').doc('sundayHistory').onSnapshot(/* → sundayHistory */);
// plus appearance + users reads on demand / at login
```

Each delivery rebuilds the relevant state and re-renders. Language chips are derived
on every songs delivery by scanning distinct non-empty `language` values. The Sunday
listener also calls `maybeArchivePastWeek()` to roll past weeks into history.

---

## Deployment

```
/ (repo root → GitHub Pages)
├── index.html     (loads fonts, Firebase compat SDK, CDN parsers, styles.css?v=N, app.js?v=N)
├── styles.css
├── app.js
├── firebase.json
└── .gitignore     (functions/ and node artefacts excluded; Cloud Function removed)
```

Workflow: edit files in the working clone, bump the `?v=N` cache-busting version on
both `styles.css` and `app.js` in `index.html`, run `node -c app.js` to check syntax,
then `git add` / `commit` / `push origin main`. GitHub Pages serves the three static
files; Firestore + Storage + Anonymous Auth provide the backend.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Firestore read error (songs) | Banner "Could not load songs. Check your connection." + retry |
| Sunday/history listener error | Logged to console; UI stays on last good state |
| Login passcode wrong / no match | Inline error; controls stay locked |
| Add/Edit save fails | Error shown; form data retained for retry |
| Sunday toggle / clear / move fails | Toast "Could not …: {reason}" |
| Background upload fails | Status message in the background dialog |
| Import parse error | Error shown in the import dialog; preview not populated |

---

## Testing Strategy

The pure client-side logic (chord parsing/merge, transpose, filtering, language
derivation, date formatting, key-format checks) is suited to property-based and
example tests runnable in Node without a browser. Firestore security rules and the
Storage upload are covered by manual/emulator checks. Mobile layout (horizontal
chord scrolling, modal corners, equal-width buttons) is verified on-device
(Samsung + iPhone) in private/incognito tabs to bypass cache.

Suggested property-based library: fast-check; runner: Vitest.

---

## Correctness Properties

### Property 1: Chord-merge preserves every chord
*For any* VerseView-style chords field and any lyrics field, the chart produced by
`buildChart` SHALL contain every chord token present in the chords field (no chord is
dropped), with chords placed on chord lines above the corresponding English lyric
lines. **Validates: Requirements 4.3, 4.4**

### Property 2: Lyrics-only view contains no chord lines
*For any* stored `chart`/`lyrics` text, `renderLyricsOnly` SHALL produce output
containing no line classified as a chord line by `isChordLine`, while preserving
section labels and lyric lines. **Validates: Requirements 3.3**

### Property 3: Transpose is correct and alignment-preserving
*For any* chord line and any target key, `transposeChordLine` SHALL shift every chord
by the correct semitone interval using sharps/flats appropriate to the target, and
SHALL keep each chord's starting column within one character of its original column.
**Validates: Requirements 3.5**

### Property 4: Key badge variant selection
*For any* valid key, `renderKeyBadge(key,'default')` SHALL output the green badge; for
any `fTranspose`, `renderKeyBadge(fTranspose,'female')` SHALL output the amber
`key-badge--female`; a song without `fTranspose` SHALL produce no female badge.
**Validates: Requirements 2.7, 11.3**

### Property 5: Time-signature parsing
*For any* `N/M` string with positive integers, `renderTimeSig` SHALL render N as the
numerator and M as the denominator. **Validates: Requirements 2.8**

### Property 6: Search filter correctness
*For any* song array and query, the search SHALL return exactly those songs whose
`title` or `artist` contains the query (case-insensitive); empty/whitespace query
returns all. **Validates: Requirements 5.1, 5.2**

### Property 7: Language derivation
*For any* song array, `deriveLanguages` SHALL return sorted, distinct, non-empty
language values (case-insensitive), excluding null/empty. **Validates: Requirements 5.3**

### Property 8: Combined filter is the intersection
*For any* song array, query, and selected chip set, the applied filter SHALL return
exactly the songs matching both the search predicate and the language predicate.
**Validates: Requirements 5.4, 5.5**

### Property 9: Sunday store reflects every snapshot
*For any* sequence of `config/sunday` snapshots, after each delivery the rendered
Sunday list SHALL contain exactly the songs whose IDs are in that snapshot (that
still exist), split correctly into Malayalam and English. **Validates: Requirements 6.2, 9.3, 9.7**

### Property 10: Move-to-Previous archives and clears atomically
*For any* non-empty upcoming set, invoking the move operation SHALL result in a
Previous_Sundays archive entry (dated with the worship date) containing exactly those
song IDs, an empty `config/sunday.songIds`, and a `weekDate` equal to the next
upcoming Sunday. **Validates: Requirements 10.6, 10.7**

### Property 11: Upcoming-Sunday date computation
*For any* date, `upcomingSundayDate` SHALL return that same date when it is a Sunday,
otherwise the next Sunday, and `formatDMY(toISODate(d))` SHALL render it as
DD/MM/YYYY. **Validates: Requirements 9.2, 10.2**

### Property 12: Previous Sundays are read-only
*For any* archived week rendered by `renderPrevSundays`, the output SHALL contain no
edit, delete, or Sunday-remove controls. **Validates: Requirements 10.3**
