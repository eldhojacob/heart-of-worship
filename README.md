# Heart of Worship

A shared, mobile-friendly song reference tool for worship teams. Look up a song's
**key**, **female-lead key**, **time signature**, **language**, **chords**, and
**lyrics** — plan the **upcoming Sunday service**, and keep a dated archive of past
services. Read access needs no login.

Built with vanilla HTML/CSS/JS, hosted on **GitHub Pages**, backed by **Firebase**
(Firestore + Storage + Anonymous Auth). No server, no Cloud Functions, no build step.

## Live site

> https://eldhojacob.github.io/heart-of-worship

## Features

- 🔍 Search by title or artist (live, as you type)
- 🌐 Filter by language (dynamic chips: Malayalam / English)
- 🎵 Key badge (green = default, amber = female-lead) and stacked time signature
- 🎼 Two views per song: **With Chords** (with transpose to any key) and **Lyrics only**
- 📋 Clean landing page — song list is hidden until you tap "Show all songs"
- ➕ Add songs by typing, pasting from **VerseView**, or **importing** a file
      (CSV, XLSX, DOCX, PDF, TXT) with a preview before saving
- ✝ **Sunday Worship** planner — pick songs for the upcoming Sunday, grouped by
      language, with the date shown (DD/MM/YYYY)
- ⏮ **Previous Sundays** — dated, locked (read-only) archive, with auto-archiving
      and a **Move to Previous Sunday** button
- 👤 Username/passcode login with **roles** (Admin / Editor / Read-only) and
      per-permission toggles (add / edit / delete)
- ⚙ Settings: change background picture, change theme colour, manage users, reset password
- ⚡ Real-time sync via Firestore `onSnapshot` — changes appear instantly for everyone

## How editing works

Read access is public. To edit, a user logs in with a **username + passcode**, which
is checked client-side against the user list stored in Firestore at `config/users`
(a legacy single passcode at `config/editor` still logs in as admin). On a match the
app signs in with **Firebase Anonymous Auth**, and Firestore security rules allow
writes only for signed-in sessions. There is no backend code to maintain.

## Project structure

```
heart-of-worship/
├── index.html      # App shell + all markup/dialogs
├── styles.css      # Design tokens + component styles (cache-busted ?v=N)
├── app.js          # All client-side logic (Firestore, auth, UI)   (cache-busted ?v=N)
├── firebase.json   # Firebase config
├── README.md
└── .kiro/
    └── specs/heart-of-worship/
        ├── .config.kiro     # Kiro spec metadata
        ├── requirements.md  # Full requirements (EARS format)
        ├── design.md        # Architecture, data models, security rules, properties
        └── tasks.md         # Step-by-step build plan + task dependency graph
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (ES module, no bundler) |
| Hosting | GitHub Pages |
| Database | Firebase Firestore (real-time) |
| Images | Firebase Storage (background pictures) |
| Auth | Firebase Anonymous Authentication |
| File import | SheetJS (CSV/XLSX), mammoth.js (DOCX), pdf.js (PDF) — from CDN |
| Fonts | Google Fonts — Fraunces + Inter |

---

## Setup (fresh Firebase project)

### 1. Create a Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore Database** (Native mode)
4. Enable **Authentication → Anonymous** sign-in provider
5. Enable **Storage** (needed for the background-picture feature)

### 2. Configure the app
Edit `app.js` and replace the `FIREBASE_CONFIG` block with your project's config
(Firebase Console → Project settings → Your apps → Web app).

### 3. Create the login documents
In Firestore, create collection `config` with:
- Document `editor` → field `passcode` (string) — legacy admin passcode fallback
- Document `users` → field `users` (array) — e.g.
  `[{ "username": "admin", "passcode": "…", "role": "admin", "perms": { "add": true, "edit": true, "delete": true } }]`

### 4. Set Firestore security rules
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

### 5. Set Storage security rules
```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

### 6. Enable GitHub Pages
1. Repo **Settings → Pages**
2. Source: **Deploy from a branch** → `main` → `/ (root)` → Save

---

## Continuing / porting to another machine (with Kiro)

This repo is self-contained and portable. The full Kiro spec lives in
`.kiro/specs/heart-of-worship/`, so another computer with Kiro installed can pick up
exactly where this left off.

### Steps
1. **Clone the repo**
   `git clone https://github.com/eldhojacob/heart-of-worship.git`
2. **Open the folder in Kiro** — it auto-detects the spec under
   `.kiro/specs/heart-of-worship/` (requirements + design + tasks). The `tasks.md`
   file is a complete, ordered build plan (with a task dependency graph) so you can
   rebuild from scratch or keep extending. From there you can run tasks, update the
   spec, or keep building.
3. **Install Node.js** (any recent LTS) if you want to run the quick syntax check
   `node -c app.js` before pushing. No `npm install` is required for the app itself —
   there is no build step.

### What MUST change for a different environment

| Thing to change | Where | Why |
|---|---|---|
| **Firebase config** (`FIREBASE_CONFIG`) | `app.js` (top of file) | Point the app at *your* Firebase project. The current values target `heart-of-worship-spwc`. |
| **GitHub repo / Pages URL** | repo settings + the links in `README.md` and `index.html` references | The live URL `eldhojacob.github.io/heart-of-worship` is tied to this account. |
| **Firestore security rules** | Firebase Console → Firestore → Rules | Apply the rules in step 4 to your project. |
| **Storage security rules** | Firebase Console → Storage → Rules | Apply the rules in step 5 so background uploads work. |
| **Login documents** (`config/editor`, `config/users`) | Firestore Console | Create your own passcodes/users; the app reads these to log people in. |
| **Git author / remote** | local git config | Push to your own fork/remote if not using this repo. |

### What does NOT need to change
- `index.html`, `styles.css`, `app.js` logic — fully portable as-is.
- The CDN libraries (SheetJS, mammoth, pdf.js, Firebase SDK) load from the internet.
- The `.kiro/specs/` documents — plain markdown, platform-independent.

### Everyday change workflow (any machine)
1. Edit `index.html` / `styles.css` / `app.js`.
2. **Bump the cache-busting version** on BOTH `styles.css?v=N` and `app.js?v=N` in
   `index.html` (mobile browsers cache hard — this forces a reload).
3. Run `node -c app.js` to check syntax.
4. `git add` → `git commit` → `git push origin main`.
5. GitHub Pages redeploys automatically. Test in a private/incognito tab on mobile.

> Note: on Windows PowerShell, `git push` sometimes prints an exit-code-1 warning even
> though the push succeeds — confirm by the `main -> main` line in the output.

---

## Changing the passcode / users

Edit the `config/editor.passcode` field, or the `config/users` array, in the Firestore
console. Changes take effect immediately — no redeploy needed.

## Cost

Everything runs within Firebase and GitHub free tiers for a worship-team's level of
use — effectively **$0/month**. The only optional cost is a custom domain
(~$10–15/year) if you ever want your own web address instead of the free
`github.io` one. (An earlier Cloud Function design that required a paid Firebase plan
was removed to keep it free.)
