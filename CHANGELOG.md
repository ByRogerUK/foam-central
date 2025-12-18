# Changelog

All notable changes to **Foam Central Workspace Helper** will be documented in this file.

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