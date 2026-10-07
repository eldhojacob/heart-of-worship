# Heart of Worship

A shared worship team song reference tool. Look up a song's **key**, **time signature**, and **language** at a glance — no login needed.

Built with vanilla HTML/CSS/JS, hosted on **GitHub Pages**, backed by **Firebase Firestore** for real-time shared data. No server, no Cloud Functions.

## Live site

> https://eldhojacob.github.io/heart-of-worship

## Features

- 🔍 Search songs by title or artist (live, as you type)
- 🌐 Filter by language (dynamic chips from your data)
- 🎵 Key displayed as a badge (green = default, amber = female lead)
- ♩ Time signature shown as a stacked fraction
- ▶ YouTube reference link per song
- 🔒 Passcode-protected editing (add / edit / delete)
- ⚡ Real-time sync via Firestore `onSnapshot` — changes appear instantly for everyone

## How editing works

Read access is public. To edit, a user clicks **Unlock editing** and enters a passcode.
The passcode is stored in Firestore at `config/editor`. When it matches, the app signs
in anonymously (Firebase Anonymous Auth), and Firestore security rules allow writes only
for signed-in users. This keeps casual users from accidentally editing, with no backend
code to maintain.

## Setup

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore Database** (Native mode)
4. Enable **Authentication → Anonymous** sign-in provider

### 2. Configure the app

Edit `app.js` and replace the `FIREBASE_CONFIG` block with your project's config
(Firebase Console → Project settings → Your apps).

### 3. Create the passcode document

In Firestore, create:
- Collection: `config`
- Document: `editor`
- Field: `passcode` (string) → your chosen passcode

### 4. Set Firestore security rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Songs: anyone can read; only signed-in users can write
    match /songs/{songId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null;
    }

    // Passcode config: readable (needed for the check), not writable from the app
    match /config/{doc} {
      allow read: if true;
      allow write: if false;
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
└── README.md
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript |
| Hosting | GitHub Pages |
| Database | Firebase Firestore (real-time) |
| Auth | Firebase Anonymous Authentication |
| Fonts | Google Fonts — Fraunces + Inter |

## Changing the passcode

Edit the `passcode` field in the `config/editor` document in the Firestore console.
The change takes effect immediately — no redeploy needed.
