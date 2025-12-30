# Foam Central Workspace Helper

Foam Central keeps a **single notes workspace** for all your projects and automatically:

- Ensures today’s **daily note** exists in the central notes repo.
- Creates (or reuses) a **project notebook** under `projects/<slug>/`.
- Logs **open / close events** for that project into the daily note.
- Maintains a `home.md` and `vcs.md` for each project, so you have a
  “landing page” and a simple VCS log.
- (Optional) Automatically keeps a simple `index.md` in each folder of the notes
  up to date, with wiki-links to every note in that folder.

This lets you have lots of separate repos (and even multiple copies of the same repo name in different places), but **only one Foam graph** and one journal.

---

## Features

- **Central notes folder**

  Configure a single folder (e.g. `C:\Users\<you>\OneDrive\foam-notes`) as your
  Foam notes root. All daily notes and project notes live under here.

- **Per-project notebooks**

  For each workspace folder you open, Foam Central creates a project notebook:

  ```text
  <notesRoot>/
    projects/
      <slug>/
        home.md
        vcs.md
        ...
````

The slug is normally derived from the folder name, but can be overridden (see below).

* **Project home + VCS log**

  * `home.md` contains front-matter + basic metadata:

    * project name
    * slug
    * default path on disk
    * **link to the VCS log page**
  * `vcs.md` is a simple page where Foam Central can append entries about git activity
    (if you have git logging enabled in your version).

* **Daily notes**

  When you open a project, Foam Central makes sure today’s daily note exists
  and logs an entry like “Opened project X at HH:MM” with a wiki-link
  back to the project’s home page.

* **Project name override**

  Sometimes you have multiple repos called `mainapp` in different places, but in
  your notes you want to distinguish them, e.g.:

  * `training_project_mainapp_core_0`
  * `training_project_mainapp_core_1`

  Foam Central supports a per-workspace **project name override** so the project
  ’s notes folder and links use the override instead of the raw directory name.

* **Folder index pages (optional)**

  If enabled, Foam Central will:

  * Maintain a simple `index.md` in any folder that already has one, adding
    a bullet `- [[NoteName]]` whenever a new `.md` file is created in that folder.
  * Provide a command to walk the entire notes tree and generate `index.md`
    files for every folder that contains `.md` files but doesn’t yet have an index.

  This makes it much easier to navigate large notes trees without relying solely
  on the graph.

---

## Requirements

* [VS Code](https://code.visualstudio.com/) (Insiders or Stable).
* The [Foam](https://marketplace.visualstudio.com/items?itemName=foam.foam-vscode) extension installed and enabled.
* A folder to act as your central notes repo (can be a git repo, e.g. on OneDrive).
* (Optional but recommended) `git` installed and on your PATH.

---

## Configuration

All settings live under the `"foamCentral"` namespace.

You can set them via **Settings UI** or in `settings.json`.

### `foamCentral.notesFolder` (string, required)

Absolute path to your central Foam notes folder.

Example (`settings.json`):

```json
"foamCentral.notesFolder": "C:/Users/roger/OneDrive/foam-notes"
```

Foam Central will create subfolders like `daily/`, `projects/`, etc. underneath here.

---

### `foamCentral.projectNameOverride` (string, per-workspace)

**Scope:** Workspace Folder

This lets you override the project name used in notes. The override affects:

* the slug used for the project’s notes directory under `projects/<slug>/`
* the title and metadata in `home.md`
* links written into daily notes and VCS logs

Example (`.vscode/settings.json` in your project folder):

```json
{
  "foamCentral.projectNameOverride": "training_project_mainapp_core_0"
}
```

If this is empty or unset, Foam Central uses the workspace folder’s name.

---

### `foamCentral.autoUpdateFolderIndex` (boolean, default: `true`)

When enabled:

* Whenever a new `*.md` file is created **inside the notes folder**, Foam Central:

  * checks whether that folder has an `index.md`
  * if it does, adds a line `- [[NewNote]]` to that index (if not already present)

This applies only to `.md` files under `foamCentral.notesFolder`, and it ignores:

* `index.md` itself
* folders such as `.git`, `.history`, `.vscode`

If disabled, Foam Central won’t touch `index.md` automatically.

---

## Commands

You can run these from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

> Note: ID values below are how they appear in `package.json`.

### `Foam Central: Build Folder Indexes`

**Command ID:** `foamCentral.buildFolderIndexes`

Walks the entire notes tree under `foamCentral.notesFolder` and:

* For each folder that contains `.md` files but **no** `index.md`:

  * Creates an `index.md` with a simple bullet list:

    ```markdown
    # Index for <relative/path>

    - [[NoteOne]]
    - [[NoteTwo]]
    ```
* Skips:

  * `.git`, `.history`, `.vscode`, and similar hidden folders.

This is intended as a one-time bootstrap (or occasional rebuilder). Ongoing maintenance for existing indices is handled by `foamCentral.autoUpdateFolderIndex`.

---

*(If you have other Foam Central commands already implemented – e.g. “open today’s note” or “open project home” – you can add them here in the same style.)*

---

## Behaviour summary

* On activation:

  * Reads `foamCentral.notesFolder`; if not set, logs an info message and does nothing.
  * Identifies the “project folder” (prefers a workspace folder that is not the notes folder).
  * Applies `foamCentral.projectNameOverride` (if set) to derive the project name + slug.
  * Ensures:

    * project notes directory `projects/<slug>/`
    * `home.md` (with link to `vcs.md`)
    * `vcs.md`

* During the session:

  * Logs project open / close events into daily notes.
  * Optionally updates `index.md` in any folder that already has one when new notes appear there.

---

## License

This extension is licensed under the **GPL v2** (or later, if you decide to phrase it that way).

See `LICENSE` for full text.
