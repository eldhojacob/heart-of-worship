# Heart of Worship

A shared worship team song reference tool. Look up a song's **key**, **time signature**, and **language** at a glance — no login needed.

Built with vanilla HTML/CSS/JS, hosted on **GitHub Pages**, backed by **Firebase Firestore** for real-time shared data.

## Live site

> https://eldhojacob.github.io/heart-of-worship

## Features

- 🔍 Search songs by title or artist (live, as you type)
- 🌐 Filter by language (dynamic chips from your data)
- 🎵 Key displayed as a badge (green = default, amber = female lead)
- ♩ Time signature shown as a stacked fraction
- ▶ YouTube reference link per song
- 🔒 Passcode-protected editing (add / edit / delete) — verified server-side
- ⚡ Real-time sync via Firestore `onSnapshot` — changes appear instantly for everyone

## Setup

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore** (production mode)
4. Enable **Authentication** (Anonymous provider)
5. Enable **Functions** (Blaze plan required)

### 2. Configure the app

Edit `app.js` and replace the `FIREBASE_CONFIG` block with your project's config (found in Firebase Console → Project settings → Your apps).

Also set `VERIFY_PASSCODE_URL` to your deployed Cloud Function URL.

### 3. Deploy the Cloud Function

```bash
cd functions
npm install
# Set your passcode secret:
firebase functions:secrets:set PASSCODE_SECRET
# Deploy:
firebase deploy --only functions
```

### 4. Set Firestore security rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /songs/{songId} {
      allow read: if true;
      allow create, update, delete:
        if request.auth != null && request.auth.token.editor == true;
    }
    match /_meta/{doc} {
      allow read, write: if false;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 5. Enable GitHub Pages

1. Go to repo **Settings → Pages**
2. Source: **Deploy from a branch** → `main` → `/ (root)`
3. Save — your site will be live at `https://eldhojacob.github.io/heart-of-worship`

## Project structure

```
heart-of-worship/
├── index.html      # App shell + all markup
├── styles.css      # Design tokens + component styles
├── app.js          # All client-side logic (Firestore, auth, UI)
├── functions/
│   ├── index.js    # verifyPasscode Cloud Function
│   └── package.json
└── README.md
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (ES modules) |
| Hosting | GitHub Pages |
| Database | Firebase Firestore (real-time) |
| Auth | Firebase Authentication (Custom Tokens) |
| Backend logic | Firebase Cloud Functions (Node.js) |
| Fonts | Google Fonts — Fraunces + Inter |
