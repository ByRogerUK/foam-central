# Changelog

All notable changes to **Foam Central Workspace Helper** will be documented in this file.


## [0.3.0] - 2025-12-30

### Added

- **Project name override**

  - New setting: `foamCentral.projectNameOverride` (scope: Workspace Folder).
  - Allows a workspace folder (e.g. `mainapp`) to appear in notes as a custom
    name (e.g. `training_project_mainapp_core_0`).
  - Used for the project notes folder under `projects/<slug>/` and for titles
    / links in `home.md` and daily notes.

- **Folder index support**

  - New setting: `foamCentral.autoUpdateFolderIndex` (default: `true`).
  - When enabled, any folder inside the notes root that already has an `index.md`
    will be kept up to date: new `.md` files in that folder are appended as
    `- [[NoteName]]` entries, if not already present.

- **Build Folder Indexes command**

  - New command: `Foam Central: Build Folder Indexes`
    (`foamCentral.buildFolderIndexes`).
  - Walks the entire notes tree under `foamCentral.notesFolder` and creates an
    `index.md` in each folder that:
    - contains `.md` files, and
    - does not yet have an `index.md`.
  - Skips common noise folders like `.git`, `.history`, `.vscode`.

### Changed

- **Project home page content**

  - Newly created `home.md` files now include a direct link to the project’s
    `vcs.md` page:
    ```markdown
    - VCS log: [[projects/<slug>/vcs]]
    ```

## [0.2.0] - 2025-12-19

### Added
- Git Integration
- todo support.

### Changed
- layout of the Journals folder to stop it from having an oversized folder, so now in year and week

## [0.1.2] – 2025-12-18

### Added
- Automatic default notes folder (`foamCentral.notesFolder`) if not configured.
- Support for logging project opens even when the notes folder is not part of the workspace (single-folder projects).
- Project activity entries now link the date directly to the daily note (`[[YYYY-MM-DD]]`).

### Changed
- Packaging cleaned up so `.history` and other build junk are not included in the `.vsix`.
- trying to fix install problem

## [0.1.0] – 2025-12-17

### Added
- Central notes workspace support (`foamCentral.notesFolder` + `foamCentral.projectNotesFolder`).
- Automatic daily notes under `journals/YYYY-MM-DD.md`.
- Per-project pages under `projects/<slug>/home.md` and `projects/<slug>/vcs.md`.
- Logging of project open events into both:
  - The daily note (`[OPEN]` lines), and
  - The project home page (`## Activity`).
- Git integration:
  - Detect new commits / pulls on the project repo.
  - Log VCS events into the daily note and project `vcs.md`.