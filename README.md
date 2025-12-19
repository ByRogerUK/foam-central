# Foam Central Workspace Helper

Foam Central keeps a **single notes workspace** for all your projects and automatically:

- Creates **daily notes** in one place.
- Creates **per-project home + VCS pages** in your notes.
- Logs **when you open a project**.
- (If the project is a Git repo) logs **commits / pulls** into both your daily note and a project `vcs.md`.

It’s designed for people who work on lots of repos at once and want a **Foam-style knowledge base** that tracks what they touched and when.

---

## Features

- 🗂 **Central notes folder**
  - All notes live under a single path (`foamCentral.notesFolder`), e.g. `C:\Users\<you>\OneDrive\foam-notes`.
  - Optional subfolder for projects (`foamCentral.projectNotesFolder`, default: `projects`).

- 📆 **Automatic daily notes**
  - Ensures there is a `journals/YYYY-MM-DD.md` for **today**.
  - Keeps a simple `## Log` section where events are appended.

- 📁 **Per-project pages**
  - For each project folder you open, Foam Central creates:
    - `projects/<slug>/home.md`
    - `projects/<slug>/vcs.md`
  - The _home_ page gets an `## Activity` section with links back to daily notes.
  - The _vcs_ page keeps a structured history of Git events.

- 🧷 **Project open logging**
  - When a project is detected, the extension:
    - Appends a line to today’s daily note:
      - `- 14:32 [OPEN] [[projects/my-project/home]] at \`C:\path\to\my-project\``
    - Appends a line to the project home page:
      - `- [[2025-12-18]] opened at 14:32`

- 🧬 **Git integration (optional)**
  - If the project folder is a Git repo, Foam Central:
    - Detects HEAD changes (commits, pulls, etc.).
    - Writes a summary to the daily note.
    - Writes a detailed block to `projects/<slug>/vcs.md`, including:
      - Branch
      - Short hash
      - Commit message
      - Ahead/behind counts
      - Upstream name (if any)
      - Tags (if any)
      - Link back to the daily note

---

## Requirements

- Visual Studio Code **1.90.0+**
- Foam extension: `foam.foam-vscode`
- (Optional, for Git logging) VS Code Git extension: `vscode.git`  
  – this is built-in in standard VS Code.

---

## Installation

You can either:

1. **Install directly from the Marketplace**

   - Open VS Code.
   - Go to **Extensions** (`Ctrl+Shift+X`).
   - Search for **“Foam Central Workspace Helper”** or `byroger.foam-central`.
   - Click **Install**.

2. **Use the Foam Central Pack**

   If you install the **Foam Central Pack**, it will pull in:

   - Foam
   - Foam Central
   - Recommended Markdown / Git helpers

---

## Configuration

Open **Settings** → search for **“Foam Central”**.

### `foamCentral.notesFolder` (string)

Absolute path to your central notes workspace, for example:

```text
C:\Users\<you>\OneDrive\foam-notes
```

If you leave it empty, Foam Central will try to pick a default:
- Prefer ```OneDrive\foam-notes``` if OneDrive is configured.

- Otherwise use ```HOME\foam-notes```.

This value is then stored in your global settings.

```foamCentral.projectNotesFolder``` (string)

Relative folder inside ```notesFolder``` where per-project notes are stored.

- Default: ```"projects"```

- Example layout:
```
foam-notes/
  journals/
    2025-12-18.md
  projects/
    story_engine2/
      home.md
      vcs.md
    foam-central/
      home.md
      vcs.md
```


---
## Commands
```Foam Central: Create Workspace for Current Folder```

Takes the currently-open folder and creates a ```.code-workspace``` file that includes:

1. Your notes folder (from ```foamCentral.notesFolder```)

2. The current project folder

Example generated workspace:
```
{
  "folders": [
    { "name": "notes", "path": "C:/Users/<you>/OneDrive/foam-notes" },
    { "name": "project", "path": "C:/dev/my-project" }
  ],
  "settings": {
    "foam.files.ignore": [
      "project/**",
      "**/.history/**"
    ]
  }
}
```

VS Code then reopens on this workspace.
---
How it works
Project detection

On activation, Foam Central:

1. Resolves ```foamCentral.notesFolder```.

2. Looks at the workspace folders:

    - If both notes + project are present, it uses those.

    - Otherwise, it uses the first workspace folder as the project and still logs into the central notes folder.

For a detected project:

- Slug = folder name with spaces replaced by ```_```

- Project notes root:
```notesFolder/<projectNotesFolder>/<slug>/```


Files it creates

For a project with slug ```my-project```:

- ```journals/2025-12-18.md```

- ```projects/my-project/home.md```

- ```projects/my-project/vcs.md```

Existing files are reused; they won’t be overwritten.

---
### Git logging details

When the project folder is a Git repository:

- Foam Central subscribes to the repo’s state changes.

- When ```HEAD``` changes, it:

    - Reads the latest commit (message, hash, refs/tags).

    - Determines if it’s more like a COMMIT or PULL (based on ahead/behind).

    - Logs a line to today’s daily note, for example:
```
- 15:04 [COMMIT] [[projects/my-project/home]] on branch main "Fix bug"
  (ahead 1, behind 0, upstream: origin/main, tags: v0.1.0)
```
    - Appends a section to projects/my-project/vcs.md:

```
## 2025-12-18 15:04 [COMMIT] (main)

- Commit: `3f2a9c1`
- Message: Fix bug
- Ahead: 1 Behind: 0
- Upstream: origin/main
- Tags: v0.1.0
- Journal: [[2025-12-18]]
```


---

### Notes Git Integration

Foam Central can keep your **notes folder** automatically synced to a Git repository and (optionally) a private GitHub repo.

#### Command: Initialize Notes Git Repo

Use the command:

> **Foam Central: Initialize Notes Git Repo**

This command:

1. Looks at your configured `foamCentral.notesFolder`.
2. If the folder is **not** in a Git repo:

   * Offers to run `git init` in the notes folder.
   * Optionally makes an initial commit if there are existing files.
   * Offers to create or link a **private GitHub repository** in the GitHub account you’re signed into in VS Code (e.g. `foam-notes`, `foam-notes-1`, `foam-notes-2`, …).
   * Sets the `origin` remote and tries an initial `git push -u origin main`.
3. If the folder **is already** in a Git repo:

   * Offers to configure a **GitHub remote** for the existing repo (or reuse an existing one).
4. Once the repo + remote are set up, it enables the automatic notes sync (see below).

You can run this any time from the Command Palette.

---

### Command: Sync Notes Now

You can also manually force a sync at any time with:

> **Foam Central: Sync Notes Now**

This will:

1. Check for changes in the notes repo.
2. If the remote has new commits (you’re behind), prompt you to pull before pushing.
3. Stage and commit changes using the configured commit message template.
4. Push the notes repo to its configured remote.

---

### Notes Git Auto-Sync Settings

These settings live under **Settings → Extensions → Foam Central**:

* `foamCentral.notesGit.autoSyncEnabled` (boolean, default: `false`)
  Enable/disable automatic Git commit + push for the notes folder (if it’s inside a Git repo).

* `foamCentral.notesGit.saveCountThreshold` (number, default: `10`)
  After this many **note saves** (in the notes folder), Foam Central will trigger an auto-sync (commit + push), if there are changes.

* `foamCentral.notesGit.minutesThreshold` (number, default: `10`)
  Minimum number of **minutes between auto-syncs**. If there are uncommitted changes and this much time has passed since the last sync, an auto-sync will run even if you haven’t hit the save-count threshold.

* `foamCentral.notesGit.commitMessage` (string, default:
  `"Foam Central auto-commit ({reason})"`)
  Template for auto-commit messages. The `{reason}` placeholder is replaced with:

  * `save-threshold` (triggered by number of saves)
  * `timer` (triggered by time threshold)
  * `manual` (when you run **Sync Notes Now**)

When auto-sync runs and the notes repo is **behind** its upstream (remote has new commits not in your local copy), Foam Central:

1. Warns you that the remote is ahead.
2. Offers to run a **fast-forward pull** (`git pull --ff-only`).
3. Only commits + pushes if you either:

   * Pull successfully, or
   * Choose to skip and there’s no remote divergence.

This avoids silently clobbering remote changes.

---

### Troubleshooting: Foam onWillSaveTextDocument Error

If you see an error like this in your logs:

```text
onWillSaveTextDocument-listener from extension 'foam.foam-vscode' threw ERROR
TypeError: Cannot read properties of undefined (reading 'document')
    at ...
```

This error is coming from the **Foam extension itself** (`foam.foam-vscode`), not from Foam Central.

In practice:

* Foam Central will continue to work normally (daily notes, project pages, Git sync).
* The error is usually triggered by Foam’s own `onWillSaveTextDocument` handler when certain documents are saved.

If it becomes noisy or disruptive, you can try:

* Updating Foam to the latest version.
* Temporarily disabling specific Foam features that run on save.
* As a last resort, disabling the Foam extension for that workspace and relying on Foam Central’s features alone.

Foam Central does **not** rely on Foam’s `onWillSaveTextDocument` hook, so the error does not affect its core behaviour.

---
### Roadmap / Ideas

- Smarter tagging of events (e.g. ```#code```, ```#review```, ```#meeting```).

- Commands to open:

    - Today’s daily note

    - Current project’s home / VCS pages

- Optional auto-linking into project-specific “log” notes per branch.

---

### License

This extension is licensed under the GNU General Public License, version 2 (GPL-2.0).

