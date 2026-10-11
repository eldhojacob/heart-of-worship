# Requirements Document

## Introduction

Heart of Worship is a shared, mobile-friendly reference tool for worship teams. It
gives any team member — musician, vocalist, or sound engineer — fast access to a
song's key, alternate female-lead key, time signature, chords, and lyrics in the
language it is sung in (Malayalam or English). It also lets the team plan the
upcoming Sunday service and keep a dated archive of past services.

Read access is fully public and login-free. Editors unlock write access by logging
in with a username/passcode checked against data stored in the backend; on success
the app establishes an anonymous backend session so writes are permitted. Users
have roles (Admin, Editor, Read-only) with per-permission toggles. All data is
stored in a shared backend so that every change is immediately visible to all users.

The frontend is three static files (HTML, CSS, JS) hosted on GitHub Pages, backed by
Firebase Firestore (data), Firebase Storage (background images), and Firebase
Anonymous Authentication (write access). There is no custom server or Cloud Function.

---

## Glossary

- **Song**: A record containing title, musical key, optional female-lead key, time
  signature, language, artist, details, notes, optional YouTube link, a chords+lyrics
  chart, and a plain lyrics field.
- **Song_List**: The alphabetically sorted collection of Songs, hidden on the landing
  page until the user chooses to show it.
- **Chord_Chart**: The chords-above-lyrics text stored on a Song and rendered in a
  monospace, horizontally scrollable view.
- **Lyrics_View**: A chords-free view of a Song's lyrics (Malayalam + English).
- **Transpose**: Shifting all chords in a Chord_Chart to a chosen target key.
- **Search_Bar**: The text input that filters the Song_List by title or artist.
- **Language_Filter**: Dynamically generated chip controls that filter by language.
- **Key_Badge / Time_Signature_Display**: Visual renderings of a Song's key and time
  signature.
- **Sunday_Worship**: The planned set of Songs for the upcoming Sunday service, split
  into Malayalam and English groups and dated to the upcoming Sunday.
- **Previous_Sundays**: A dated, read-only archive of past Sunday_Worship sets.
- **Import**: A feature that reads songs from an uploaded CSV, XLSX, TXT, DOCX, or PDF
  file and previews them before saving.
- **User**: A login identity stored in the backend with a username, passcode, role,
  and per-permission flags.
- **Role**: One of Admin, Editor, or Read-only. Admins have all permissions; Editors
  have per-permission toggles (add/edit/delete); Read-only users cannot write.
- **Editor (session)**: Any logged-in user whose role/permissions allow writes.
- **Backend**: Firebase Firestore (data) + Firebase Storage (images) + Firebase
  Anonymous Auth (write sessions).

---

## Requirements

### Requirement 1: Song Record Structure

**User Story:** As a worship team member, I want each song to carry all the musical
facts, chords, and lyrics in one place, so that I can find everything at a glance.

#### Acceptance Criteria

1. THE Song SHALL contain a `title` field (text, required).
2. THE Song SHALL contain a `key` field (required) chosen from a fixed dropdown of common major and minor keys (root A–G, optional accidental, optional minor suffix).
3. THE Song SHALL contain a `timeSignature` field (required), e.g. 4/4, 3/4, 6/8.
4. THE Song SHALL contain an `fTranspose` field (optional) chosen from the same key dropdown as `key`.
5. THE Song SHALL contain a `language` field chosen from a dropdown with values Malayalam and English.
6. THE Song SHALL contain optional `artist`, `details`, `notes`, and `youtube` fields, where `youtube` is a well-formed http/https URL when present.
7. THE Song SHALL contain an optional `chart` field holding chords-above-lyrics text (chords + English only).
8. THE Song SHALL contain an optional `lyrics` field holding plain lyrics (Malayalam + English, no chords).
9. THE Backend SHALL assign every Song a stable, immutable unique identifier at creation time.
10. IF a Song form is submitted with a missing or empty required field (`title`, `key`, or `timeSignature`), THEN THE application SHALL reject the save and display a field-level validation error identifying each invalid field, retaining the entered data.

---

### Requirement 2: Public Landing Page and Song List Display

**User Story:** As a worship team member, I want a clean landing page with quick
actions, and the ability to reveal the full song list on demand, so that the page is
uncluttered during rehearsal.

#### Acceptance Criteria

1. THE landing page SHALL be accessible to any user without login.
2. THE landing page SHALL present equal-width action buttons: Sunday Worship, Show all songs, Add Song, and Import, where Add Song and Import are visible only to users permitted to add.
3. THE Song_List SHALL remain hidden on the landing page until the user activates "Show all songs" (or starts searching / filtering).
4. WHEN the user toggles "Show all songs", THE Song_List SHALL show or hide and the button label SHALL switch between "Show all songs" and "Hide songs".
5. THE Song_List SHALL display Songs sorted in ascending case-insensitive alphabetical order by `title`.
6. THE Song_List SHALL render each Song as a card showing `title`, Key_Badge(s), Time_Signature_Display, and language tag, with optional fields and chart/lyrics revealed on expand.
7. WHEN a Song has an `fTranspose` value, THE Key_Badge SHALL render the female-lead key as a distinctly styled (warm amber) badge; otherwise no female badge SHALL render.
8. THE Time_Signature_Display SHALL render the time signature as a stacked fraction.
9. WHEN a Song has a `youtube` value, THE card SHALL render a play icon that opens the URL in a new tab.
10. WHEN a Song card is expanded, THE card SHALL show non-empty details/notes/artist and provide buttons for the chords and lyrics views; chords/lyrics SHALL stay hidden until a view button is pressed.
11. WHEN the Song_List is empty, THE Song_List SHALL display an empty-state message.

---

### Requirement 3: Chords, Lyrics Views, and Transpose

**User Story:** As a musician or singer, I want to switch between a chords view and a
lyrics-only view, and transpose the chords, so that each person sees what they need.

#### Acceptance Criteria

1. THE expanded Song card SHALL provide two view buttons: "With Chords" and "Lyrics only".
2. WHEN "With Chords" is active, THE card SHALL render the Song's `chart` (chords above English lyrics) in a monospace view.
3. WHEN "Lyrics only" is active, THE card SHALL render the Song's `lyrics` (Malayalam + English, chords removed), falling back to chord-stripped `chart` for songs without a `lyrics` field.
4. THE "With Chords" view SHALL provide a Transpose dropdown listing all target keys; THE "Lyrics only" view SHALL NOT provide a Transpose control.
5. WHEN a target key is chosen, THE chords SHALL shift by the correct number of semitones, choosing sharps or flats appropriate to the target key, while preserving chord-column alignment.
6. WHEN a view button that is already active is pressed again, THE view SHALL collapse.
7. THE chords view SHALL be horizontally scrollable so long lines can be read in full on mobile without wrapping; THE lyrics-only view SHALL remain readable on mobile.

---

### Requirement 4: Add, Edit, and Import Songs (Chord/Lyric Parsing)

**User Story:** As an Editor, I want to add songs by typing or pasting from VerseView,
or by importing files, so that building the library is fast even with messy sources.

#### Acceptance Criteria

1. WHILE a user permitted to add is logged in, THE application SHALL display Add Song and Import controls.
2. THE Add/Edit form SHALL provide a "Chords & Lyrics" paste field and a separate "Lyrics only" paste field.
3. WHEN both paste fields contain text on save, THE application SHALL build the stored `chart` by keeping ALL chords from the chords field and aligning them above the clean English lines taken from the lyrics field in matching order, dropping Malayalam lines from the chart.
4. WHEN only the chords field is provided, THE application SHALL parse VerseView-style glued inline chords (chords embedded mid-word) into a chords-above-lyrics chart without discarding chords.
5. THE application SHALL store the lyrics field as `lyrics` (Malayalam + English) for the lyrics-only view.
6. THE Import feature SHALL accept CSV, XLSX, TXT, DOCX, and PDF files and SHALL identify title, artist, time signature, key, language, and chords/lyrics where available.
7. THE Import feature SHALL present a preview of parsed songs before saving and SHALL allow choosing Malayalam or English for the import.
8. WHEN an Editor edits a Song, THE form SHALL be pre-populated with the Song's current values, and saving SHALL persist the changes using the Song's identifier.
9. WHEN an Editor cancels the form, THE application SHALL discard unsaved changes without modifying the Backend.
10. IF a persistence operation fails, THEN THE application SHALL show an error, SHALL NOT discard the entered data, and SHALL allow retry.

---

### Requirement 5: Search and Language Filter

**User Story:** As a worship team member, I want to search by title or artist and
filter by language, so that I can find the right song quickly.

#### Acceptance Criteria

1. WHEN the user types in the Search_Bar, THE Song_List SHALL display only Songs whose `title` or `artist` contains the text (case-insensitive).
2. WHEN the Search_Bar is empty or whitespace-only, THE Song_List SHALL display all Songs.
3. THE Language_Filter SHALL generate one chip per distinct non-empty `language` value, sorted case-insensitively, derived dynamically from the data.
4. WHEN one or more chips are selected, THE Song_List SHALL display only Songs whose `language` matches any selected chip (case-insensitive OR logic).
5. WHEN both search text and language chips are active, THE Song_List SHALL show only Songs satisfying both filters.
6. WHEN the backend data changes, THE Language_Filter SHALL add or remove chips to match within a few seconds without a page reload.

---

### Requirement 6: Real-Time Data Synchronisation

**User Story:** As a worship team member, I want to see changes the moment they are
saved, so that everyone works from the same information.

#### Acceptance Criteria

1. WHEN a Song, the Sunday_Worship list, user list, or appearance settings change, THE Backend SHALL broadcast the update to all active clients within a few seconds.
2. WHEN a client receives a broadcast update, THE affected view SHALL re-render without a manual page refresh.
3. WHEN a client starts or reconnects, THE application SHALL load the most recently persisted data before displaying it.

---

### Requirement 7: Authentication, Users, Roles, and Permissions

**User Story:** As an administrator, I want role-based logins so that only trusted
people can edit, with fine-grained control over what editors can do.

#### Acceptance Criteria

1. THE header SHALL present a Login control; write controls SHALL be hidden by default.
2. WHEN a user submits a username and passcode, THE application SHALL verify them against the stored user list (`config/users`) and, on success, establish an anonymous Backend session and apply the user's role and permissions.
3. THE application SHALL support a legacy fallback: the original passcode at `config/editor` logs in as an admin when no matching user is found.
4. WHEN logged in, THE header SHALL show a user badge, a settings gear, and a Logout control, and SHALL hide the Login control.
5. THE application SHALL support roles Admin, Editor, and Read-only, where Admin has all permissions and Editor has per-permission add/edit/delete toggles.
6. THE Song_List SHALL show Edit and Delete controls only to users whose permissions allow those actions.
7. THE Backend security rules SHALL allow public reads and SHALL require an authenticated session for all writes to `config/*` and `songs`.

---

### Requirement 8: Settings (Background, Theme Colour, Users, Password)

**User Story:** As an administrator, I want a settings menu to customise appearance
and manage users, and any logged-in user should be able to reset their password.

#### Acceptance Criteria

1. THE settings gear SHALL open a menu whose items open individual dialogs.
2. THE "Change background picture" item (admin only) SHALL upload an image to Firebase Storage and apply it as the page background, synced to all clients.
3. THE "Change theme colour" item (admin only) SHALL present a palette of selectable colours that override the primary green theme variables, synced via `config/appearance.themeColor`.
4. THE "Manage users" item (admin only) SHALL allow adding and removing users with a role and per-permission toggles.
5. THE "Reset password" item SHALL be available to any logged-in user to change their own passcode.

---

### Requirement 9: Upcoming Sunday Worship

**User Story:** As a worship planner, I want to assemble the songs for the upcoming
Sunday, grouped by language and dated, so that the team knows the plan.

#### Acceptance Criteria

1. THE landing page SHALL provide a "Sunday Worship" button that opens the Sunday_Worship dialog.
2. THE Sunday_Worship dialog SHALL display the upcoming Sunday date in DD/MM/YYYY format below the heading.
3. THE Sunday_Worship dialog SHALL split songs into Malayalam and English groups, each rendered as full expandable cards with chords/lyrics and transpose.
4. ANY user SHALL be able to add a Song to Sunday_Worship (via a toggle on each song card) and remove it; THE toggle SHALL reflect the on/off state.
5. THE Sunday_Worship dialog SHALL remain available even when it contains no songs, showing an empty-state message per group.
6. THE "Clear all" control SHALL be visible to admins only and SHALL require a Yes/No confirmation before clearing.
7. THE Sunday_Worship list SHALL be stored at `config/sunday` with the song IDs and the week date, and SHALL sync live to all clients.

---

### Requirement 10: Previous Sundays Archive and Move-to-Previous

**User Story:** As a worship planner, I want to archive the completed Sunday set and
keep a dated, locked history, so that past services are preserved and the upcoming
list resets cleanly.

#### Acceptance Criteria

1. THE Sunday_Worship dialog SHALL provide a "Previous Sundays" control that closes the current dialog and opens the Previous_Sundays dialog.
2. THE Previous_Sundays dialog SHALL list archived weeks newest-first, each labelled with its date in DD/MM/YYYY format and grouped into Malayalam and English.
3. THE Previous_Sundays entries SHALL be read-only (locked): no edit, delete, or remove controls SHALL be shown on archived songs.
4. THE application SHALL auto-archive a Sunday_Worship set when its stored week date has passed, moving it to `config/sundayHistory.archives` and resetting the upcoming list to the new upcoming Sunday.
5. THE Sunday_Worship dialog SHALL provide a "Move to Previous Sunday" control, visible to admins only and only when songs are present.
6. WHEN an admin activates "Move to Previous Sunday" and confirms, THE application SHALL archive the current songs under the worship date into Previous_Sundays, empty the upcoming list, and roll the week forward to the next upcoming Sunday.
7. WHEN the upcoming list is emptied by the move, THE "✓ On Sunday" tags in the Song_List SHALL clear automatically because the live-synced song IDs are removed.
8. WHEN the move completes, THE application SHALL show a confirmation and open the Previous_Sundays dialog so the moved set is visible.

---

### Requirement 11: Visual Design and Mobile Experience

**User Story:** As a worship team member on a phone or tablet, I want a calm,
hymnal-like design that is easy to read and navigate on small screens.

#### Acceptance Criteria

1. THE application SHALL use a warm paper-toned background, Fraunces for titles/headings, and Inter for UI text.
2. THE application SHALL use deep forest green as the primary action colour by default, overridable by the theme-colour setting.
3. THE female-lead Key_Badge and Language_Filter chips SHALL use warm amber.
4. THE modal close (✕) control SHALL be pinned to the top-right corner of each dialog.
5. THE chords view SHALL provide a visible horizontal scrollbar / sliding so full lines can be read on mobile.
6. THE action buttons and view-toggle buttons SHALL be equal-width and stack to full width on small screens.
7. THE HTML `hidden` attribute SHALL always win over display rules so toggled controls hide correctly.

---

### Requirement 12: Static Hosting and Backend Persistence/Security

**User Story:** As a project maintainer, I want free static hosting with a reliable,
secured backend, so that hosting is simple and data is safe.

#### Acceptance Criteria

1. THE frontend SHALL consist entirely of static HTML, CSS, and JavaScript with no server-side rendering, deployable to GitHub Pages unchanged.
2. THE frontend SHALL communicate with the Backend exclusively through client-side Firebase SDK calls.
3. THE Backend SHALL store Songs in the `songs` collection and shared state in `config/*` documents that survive restarts.
4. THE Backend security rules SHALL allow public reads and require `request.auth != null` for all writes.
5. IF a Backend write fails due to a network or service error, THEN THE application SHALL surface an explicit error without silently discarding the attempted change.
6. THE frontend SHALL use cache-busting version query parameters on `styles.css` and `app.js` so that updated assets are picked up by browsers.
