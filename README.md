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
### Roadmap / Ideas

- Smarter tagging of events (e.g. ```#code```, ```#review```, ```#meeting```).

- Commands to open:

    - Today’s daily note

    - Current project’s home / VCS pages

- Optional auto-linking into project-specific “log” notes per branch.

---

### License

This extension is licensed under the GNU General Public License, version 2 (GPL-2.0).

