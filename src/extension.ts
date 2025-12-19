import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs'; 
import * as fsp from 'fs/promises';
import * as cp from 'child_process';
import * as os from 'os';

interface ProjectInfo {
  name: string;       // project directory name (e.g. "story_engine2")
  path: string;       // absolute path to project root
  slug: string;       // slug used for folder name in notes (e.g. "story_engine2")
  homePath: string;   // notes/projects/<slug>/home.md
  vcsPath: string;    // notes/projects/<slug>/vcs.md
}

interface VcsEvent {
  branch: string;
  message: string;
  shortHash: string;
  ahead: number;
  behind: number;
  tags: string[];
  upstreamName: string;
}

type GitAPI = {
  repositories: any[];
};

let currentProject: ProjectInfo | undefined;
let dailyNoteTimer: NodeJS.Timeout | undefined;
let logChannel: vscode.OutputChannel;
let notesGitRoot: string | undefined;
let notesDirty = false;
let notesSaveCount = 0;
let notesLastSyncTime = Date.now();
let notesSyncInProgress = false;
let notesSyncTimer: NodeJS.Timeout | undefined;
const repoHeads = new Map<any, string | undefined>();

/* ---------- Small helpers ---------- */

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function getNotesFolder(): string | undefined {
  const config = vscode.workspace.getConfiguration('foamCentral');
  let folder = config.get<string>('notesFolder');

  // If user has already set it, respect that.
  if (folder && folder.trim().length > 0) {
    return folder.trim();
  }

  // Try to infer a sensible default.
  // Prefer OneDrive if available, otherwise fall back to HOME/USERPROFILE.
  const oneDrive =
    process.env.OneDrive ||
    process.env.ONE_DRIVE ||
    process.env.ONEDRIVE;

  const base =
    oneDrive ||
    process.env.USERPROFILE ||
    process.env.HOME;

  if (!base) {
    vscode.window.showErrorMessage(
      'Foam Central: notesFolder is not set and no default location could be inferred. Please set "foamCentral.notesFolder" in Settings.'
    );
    return undefined;
  }

  // Default folder name under the base path
  folder = path.join(base, 'foam-notes');

  // Persist this as the global default so next time it’s already set.
  config
    .update('notesFolder', folder, vscode.ConfigurationTarget.Global)
    .then(
      () => {
        // optional: log to output channel if you want
        if (logChannel) {
          logChannel.appendLine(`Foam Central: notesFolder defaulted to ${folder}`);
        }
      },
      (err) => {
        console.error('Foam Central: failed to update notesFolder setting', err);
      }
    );

  return folder;
}

function getProjectNotesFolderName(): string {
  const config = vscode.workspace.getConfiguration('foamCentral');
  const folder = config.get<string>('projectNotesFolder');
  return folder && folder.trim().length > 0 ? folder.trim() : 'projects';
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const e: any = err;
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function findGitRoot(startPath: string): string | undefined {
  let current = path.resolve(startPath);

  // Walk up until we find .git or hit filesystem root
  while (true) {
    const gitPath = path.join(current, '.git');
    try {
      if (fs.existsSync(gitPath)) {
        return current;
      }
    } catch {
      // ignore
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

/* ---------- Command: create workspace for current folder ---------- */

async function createWorkspaceForCurrentFolder(): Promise<void> {
  const notesFolder = getNotesFolder();
  if (!notesFolder) {
    vscode.window.showErrorMessage(
      'Foam Central: Please set "foamCentral.notesFolder" in Settings first.'
    );
    return;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage(
      'Foam Central: No folder is open. Open a project folder first, then run this command.'
    );
    return;
  }

  // First opened folder is the "project"
  const projectFolder = folders[0].uri.fsPath;
  const projectName = path.basename(projectFolder);

  const workspace = {
    folders: [
      {
        name: 'notes',
        path: notesFolder
      },
      {
        name: 'project',
        path: projectFolder
      }
    ],
    settings: {
      'foam.files.ignore': ['project/**']
    }
  };

  const workspaceFileName = `${projectName}.code-workspace`;
  const workspaceFilePath = path.join(projectFolder, workspaceFileName);

  try {
    await fsp.writeFile(
      workspaceFilePath,
      JSON.stringify(workspace, null, 2),
      { encoding: 'utf8' }
    );

    const uri = vscode.Uri.file(workspaceFilePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
  } catch (err: any) {
    console.error(err);
    vscode.window.showErrorMessage(
      `Foam Central: Failed to create workspace – ${err?.message ?? err}`
    );
  }
}

/* ---------- Daily note (journals/YYYY-MM-DD.md) ---------- */

function getDailyNoteSlug(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ensureDailyNoteFile(notesFolder: string, date: Date): Promise<{ slug: string; uri: vscode.Uri }> {
  const slug = getDailyNoteSlug(date);
  const journalsDir = path.join(notesFolder, 'journals');

  await fsp.mkdir(journalsDir, { recursive: true });

  const filePath = path.join(journalsDir, `${slug}.md`);
  try {
    await fsp.access(filePath);
  } catch {
    const content = [
      '---',
      'type: daily-note',
      '---',
      '',
      `# ${slug}`,
      '',
      '## Log',
      ''
    ].join('\n');
    await fsp.writeFile(filePath, content, { encoding: 'utf8' });
  }

  return { slug, uri: vscode.Uri.file(filePath) };
}

async function openDailyNoteForToday(): Promise<{ slug: string; document: vscode.TextDocument } | undefined> {
  const notesFolder = getNotesFolder();
  if (!notesFolder) {
    vscode.window.showErrorMessage(
      'Foam Central: notes folder is not configured, cannot open daily note.'
    );
    return undefined;
  }
  const { slug, uri } = await ensureDailyNoteFile(notesFolder, new Date());
  const doc = await vscode.workspace.openTextDocument(uri);
  return { slug, document: doc };
}

async function appendToDailyNote(lines: string[]): Promise<string | undefined> {
  const result = await openDailyNoteForToday();
  if (!result) {
    return undefined;
  }

  const { slug, document } = result;
  const lastLine = document.lineAt(document.lineCount - 1);
  const position = lastLine.range.end;

  const text = '\n' + lines.join('\n') + '\n';

  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, position, text);
  const success = await vscode.workspace.applyEdit(edit);
  if (success) {
    await document.save();
  } else {
    console.error('Foam Central: failed to apply edit to daily note');
  }

  return slug;
}

/* ---------- Project folder + home.md + vcs.md ---------- */

async function ensureProjectFiles(notesFolder: string, info: ProjectInfo): Promise<void> {
  const projectRootInNotes = path.dirname(info.homePath);

  try {
    await fsp.mkdir(projectRootInNotes, { recursive: true });
  } catch (err) {
    console.error('Foam Central: failed to create project dir', err);
    return;
  }

  // home.md
  try {
    await fsp.access(info.homePath);
  } catch {
    const now = new Date();
    const contentLines = [
      '---',
      'type: project',
      `name: ${info.name}`,
      `slug: ${info.slug}`,
      '---',
      '',
      `# Project: ${info.name}`,
      '',
      `- Created: ${now.toISOString()}`,
      `- Default path: \`${info.path}\``,
      '',
      '## Activity',
      ''
    ];
    await fsp.writeFile(info.homePath, contentLines.join('\n'), { encoding: 'utf8' });
  }

  // vcs.md
  try {
    await fsp.access(info.vcsPath);
  } catch {
    const contentLines = [
      '---',
      'type: project-vcs',
      `project: ${info.slug}`,
      '---',
      '',
      `# VCS log for ${info.name}`,
      ''
    ];
    await fsp.writeFile(info.vcsPath, contentLines.join('\n'), { encoding: 'utf8' });
  }
}

/* ---------- Logging project open ---------- */

async function logProjectOpen(info: ProjectInfo): Promise<void> {
  const now = new Date();
  const timeStr = formatTime(now);
  const dateStr = now.toISOString().slice(0, 10);

  const projectRef = `[[projects/${info.slug}/home]]`;
  const dailyLine = `- ${timeStr} [OPEN] ${projectRef} at \`${info.path}\``;

  const dailySlug = await appendToDailyNote([dailyLine]);
  if (!dailySlug) return;

  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(info.homePath));
    const text = `\n- [[${dailySlug}|${dateStr}]] opened at ${timeStr}\n`;
    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineAt(doc.lineCount - 1);
    edit.insert(doc.uri, lastLine.range.end, text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  } catch (err) {
    console.error('Foam Central: failed to log open in home.md', err);
  }
}


/* ---------- Git integration ---------- */

function getGitAPI(): GitAPI | undefined {
  const gitExt = vscode.extensions.getExtension<any>('vscode.git');
  const api = gitExt?.exports?.getAPI?.(1);
  return api;
}

function setupGitLoggingForProject(info: ProjectInfo) {
  const git = getGitAPI();
  if (!git) {
    logChannel.appendLine('Foam Central: Git API not available');
    return;
  }

  const normalizedProject = normalizePath(info.path);
  for (const repo of git.repositories) {
    const root = normalizePath(repo.rootUri.fsPath);
    if (root !== normalizedProject) continue;

    logChannel.appendLine(`Foam Central: Found Git repo for project at ${repo.rootUri.fsPath}`);
    repoHeads.set(repo, repo.state.HEAD?.commit);

    repo.state.onDidChange(async () => {
      try {
        await handleRepoStateChange(repo, info);
      } catch (err) {
        console.error('Foam Central: handleRepoStateChange failed', err);
        logChannel.appendLine('handleRepoStateChange failed: ' + String(err));
      }
    });

    break;
  }
}

async function handleRepoStateChange(repo: any, info: ProjectInfo) {
  const head = repo.state.HEAD;
  if (!head || !head.commit) return;

  const prevCommit = repoHeads.get(repo);
  if (prevCommit === head.commit) {
    return; // nothing new
  }
  repoHeads.set(repo, head.commit);

  let latest: any;
  try {
    const logEntries = await repo.log({ maxEntries: 1 });
    latest = logEntries[0];
  } catch (err) {
    console.error('Foam Central: repo.log failed', err);
    return;
  }
  if (!latest) return;

  const branch = head.name || '(detached)';
  const message = latest.message || '';
  const shortHash = (latest.hash || '').slice(0, 7);

  const ahead = head.ahead ?? 0;
  const behind = head.behind ?? 0;

  let kind: 'COMMIT' | 'PULL' | 'UPDATE' = 'UPDATE';
  if (ahead > 0) {
    kind = 'COMMIT';
  } else if (ahead === 0 && behind === 0) {
    kind = 'PULL';
}

  let tags: string[] = [];
  if (Array.isArray(latest.refs)) {
    tags = latest.refs
      .filter((r: any) => r.type === 2 /* tag */)
      .map((r: any) => r.name);
  }

  const upstreamName = head.upstream?.name || '';

  await logVcsEvent(kind, info, {
    branch,
    message,
    shortHash,
    ahead,
    behind,
    tags,
    upstreamName
  });
}

async function logVcsEvent(
  kind: 'COMMIT' | 'PULL' | 'UPDATE',
  info: ProjectInfo,
  evt: VcsEvent
): Promise<void> {
  const now = new Date();
  const timeStr = formatTime(now);
  const dateStr = now.toISOString().slice(0, 10);

  const tagStr = evt.tags.length ? ` tags: ${evt.tags.join(', ')}` : '';
  const upStr = evt.upstreamName ? ` upstream: ${evt.upstreamName}` : '';
  const aheadBehind = `ahead ${evt.ahead}, behind ${evt.behind}`;
  const projectRef = `[[projects/${info.slug}/home]]`;

  // DAILY NOTE
  const dailyLine =
    `- ${timeStr} [${kind}] ${projectRef} ` +
    `on branch ${evt.branch} "${evt.message}" ` +
    `(${aheadBehind}${tagStr ? ',' + tagStr : ''}${upStr ? ',' + upStr : ''})`;

  const dailySlug = await appendToDailyNote([dailyLine]);
  if (!dailySlug) return;

  // VCS PAGE
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(info.vcsPath));
    const lines = [
      '',
      `## ${dateStr} ${timeStr} [${kind}] (${evt.branch})`,
      '',
      `- Commit: \`${evt.shortHash}\``,
      `- Message: ${evt.message}`,
      `- Ahead: ${evt.ahead} Behind: ${evt.behind}`,
      upStr ? `- Upstream: ${evt.upstreamName}` : '',
      tagStr ? `- Tags: ${evt.tags.join(', ')}` : '',
      `- Journal: [[${dailySlug}]]`,
      ''
    ].filter(Boolean);

    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineAt(doc.lineCount - 1);
    edit.insert(doc.uri, lastLine.range.end, lines.join('\n'));
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  } catch (err) {
    console.error('Foam Central: failed to log VCS in vcs.md', err);
  }
}

/* ---------- Project detection (notes + project in workspace) ---------- */

async function initProjectTelemetry(): Promise<void> {
  const notesFolder = getNotesFolder();
  logChannel.appendLine('initProjectTelemetry: notesFolder=' + String(notesFolder));
  if (!notesFolder) {
    return;
  }

  const folders = vscode.workspace.workspaceFolders;
  logChannel.appendLine(
    'initProjectTelemetry: workspaceFolders=' +
    JSON.stringify(folders?.map(f => f.uri.fsPath))
  );
  if (!folders || folders.length === 0) {
    logChannel.appendLine('initProjectTelemetry: no workspace folders, nothing to do');
    return;
  }

  const notesNorm = normalizePath(notesFolder);

  // Prefer a folder that is NOT the notes folder, if present.
  let projectFolder = folders[0];
  const nonNotes = folders.find(f => normalizePath(f.uri.fsPath) !== notesNorm);
  if (nonNotes) {
    projectFolder = nonNotes;
  }

  const projectFolderPath = projectFolder.uri.fsPath;
  const projectName = path.basename(projectFolderPath);
  const slug = projectName.replace(/\s+/g, '_');

  const projectNotesRoot = path.join(notesFolder, getProjectNotesFolderName(), slug);
  const homePath = path.join(projectNotesRoot, 'home.md');
  const vcsPath = path.join(projectNotesRoot, 'vcs.md');

  currentProject = {
    name: projectName,
    path: projectFolderPath,
    slug,
    homePath,
    vcsPath
  };

  logChannel.appendLine(
    `initProjectTelemetry: project="${projectName}" slug="${slug}" path="${projectFolderPath}"`
  );

  await ensureProjectFiles(notesFolder, currentProject);
  await logProjectOpen(currentProject);
  setupGitLoggingForProject(currentProject);
}


/* ---------- Daily note scheduler ---------- */

async function startDailyNoteScheduler(): Promise<void> {
  const notesFolder = getNotesFolder();
  if (!notesFolder) {
    return;
  }

  try {
    await ensureDailyNoteFile(notesFolder, new Date());
    logChannel.appendLine('startDailyNoteScheduler: ensured today daily note exists');
  } catch (err) {
    console.error('Foam Central: failed to ensure today daily note', err);
    logChannel.appendLine('startDailyNoteScheduler: error ensuring today note: ' + String(err));
  }

  const scheduleNext = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 5, 0); // 00:00:05

    const delay = tomorrow.getTime() - now.getTime();
    if (dailyNoteTimer) {
      clearTimeout(dailyNoteTimer);
    }

    dailyNoteTimer = setTimeout(async () => {
      const nf = getNotesFolder();
      if (nf) {
        try {
          await ensureDailyNoteFile(nf, new Date());
          logChannel.appendLine('Daily scheduler: ensured new daily note exists');
        } catch (err) {
          console.error('Foam Central: failed to ensure next daily note', err);
          logChannel.appendLine('Daily scheduler error: ' + String(err));
        }
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

/* ----------- Git support ----------------*/

async function initNotesGitSync(notesFolder: string, context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('foamCentral');
  const autoEnabled = config.get<boolean>('notesGit.autoSyncEnabled') ?? false;
  if (!autoEnabled) {
    logChannel.appendLine('Foam Central: notes Git auto-sync disabled in settings.');
    return;
  }

  const root = findGitRoot(notesFolder);
  if (!root) {
    logChannel.appendLine('Foam Central: notes folder is not inside a Git repo; skipping auto-sync.');
    return;
  }

  notesGitRoot = root;
  notesDirty = false;
  notesSaveCount = 0;
  notesLastSyncTime = Date.now();
  notesSyncInProgress = false;

  logChannel.appendLine(`Foam Central: notes Git root = ${notesGitRoot}`);

  // Watch saves in notes folder
  const notesNorm = normalizePath(notesFolder);
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.uri.scheme !== 'file') return;
    const fsPath = normalizePath(doc.uri.fsPath);
    if (!fsPath.startsWith(notesNorm)) return;

    const cfg = vscode.workspace.getConfiguration('foamCentral');
    if (!cfg.get<boolean>('notesGit.autoSyncEnabled')) return;

    notesDirty = true;
    notesSaveCount += 1;

    const threshold = cfg.get<number>('notesGit.saveCountThreshold') ?? 10;
    logChannel.appendLine(
      `Foam Central: notes save detected (${notesSaveCount}/${threshold}) for ${doc.uri.fsPath}`
    );

    if (notesSaveCount >= threshold) {
      void runNotesSync('save-threshold');
    }
  });

  context.subscriptions.push(saveDisposable);

  // Timer-based sync (every minute)
  notesSyncTimer = setInterval(() => {
    void maybeTimerSyncNotes();
  }, 60 * 1000);

  context.subscriptions.push({
    dispose: () => {
      if (notesSyncTimer) {
        clearInterval(notesSyncTimer);
        notesSyncTimer = undefined;
      }
    }
  });

  // On startup, just warn if remote is ahead (no auto-merge, no auto-commit)
  void checkNotesRemoteAheadOnStartup();
}

async function maybeTimerSyncNotes(): Promise<void> {
  if (!notesGitRoot) return;
  if (!notesDirty) return;

  const cfg = vscode.workspace.getConfiguration('foamCentral');
  const minutesThreshold = cfg.get<number>('notesGit.minutesThreshold') ?? 10;
  const elapsedMinutes = (Date.now() - notesLastSyncTime) / 60000;

  if (elapsedMinutes < minutesThreshold) {
    return;
  }

  logChannel.appendLine(
    `Foam Central: timer-based notes sync triggered after ${elapsedMinutes.toFixed(1)} minutes`
  );

  await runNotesSync('timer');
}

async function getNotesAheadBehind(): Promise<{ ahead: number; behind: number; hasUpstream: boolean }> {
  if (!notesGitRoot) {
    return { ahead: 0, behind: 0, hasUpstream: false };
  }

  try {
    const { stdout } = await runGit(
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      notesGitRoot
    );
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { ahead: 0, behind: 0, hasUpstream: false };
    }
    const [left, right] = trimmed.split(/\s+/);
    const ahead = parseInt(left || '0', 10) || 0;
    const behind = parseInt(right || '0', 10) || 0;
    return { ahead, behind, hasUpstream: true };
  } catch (err: any) {
    // Probably no upstream configured
    logChannel.appendLine(
      `Foam Central: getNotesAheadBehind failed (likely no upstream): ${err.message || err}`
    );
    return { ahead: 0, behind: 0, hasUpstream: false };
  }
}

async function checkNotesRemoteAheadOnStartup(): Promise<void> {
  if (!notesGitRoot) return;
  const { behind, hasUpstream } = await getNotesAheadBehind();
  if (hasUpstream && behind > 0) {
    vscode.window.showWarningMessage(
      `Foam Central: your notes repo at "${notesGitRoot}" is behind its upstream by ${behind} commit(s). ` +
      `Consider pulling before relying on auto-sync.`
    );
  }
}

async function runNotesSync(reason: 'save-threshold' | 'timer' | 'manual'): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('foamCentral');
  const autoEnabled = cfg.get<boolean>('notesGit.autoSyncEnabled') ?? false;
  if (!autoEnabled) {
    logChannel.appendLine('Foam Central: notes Git auto-sync disabled, skipping.');
    return;
  }

  if (!notesGitRoot) {
    logChannel.appendLine('Foam Central: notes Git root not set, skipping sync.');
    return;
  }

  if (notesSyncInProgress) {
    logChannel.appendLine('Foam Central: notes sync already in progress, skipping.');
    return;
  }

  notesSyncInProgress = true;
  try {
    // Any changes at all?
    const status = await runGit(['status', '--porcelain'], notesGitRoot);
    const hasChanges = status.stdout.trim().length > 0;
    if (!hasChanges) {
      logChannel.appendLine('Foam Central: no changes to commit in notes repo.');
      notesDirty = false;
      notesSaveCount = 0;
      notesLastSyncTime = Date.now();
      return;
    }

    // Check ahead/behind vs upstream
    const { ahead, behind, hasUpstream } = await getNotesAheadBehind();

    if (hasUpstream && behind > 0) {
      const choice = await vscode.window.showWarningMessage(
        `Foam Central: notes repo at "${notesGitRoot}" is behind its upstream by ` +
          `${behind} commit(s). Auto-push is paused. Do you want to pull and merge now?`,
        'Pull Now',
        'Skip'
      );

      if (choice === 'Pull Now') {
        try {
          // Safe-ish: fast-forward only, no auto-merge commit
          await runGit(['pull', '--ff-only'], notesGitRoot);
          vscode.window.showInformationMessage('Foam Central: git pull completed for notes repo.');
        } catch (err: any) {
          vscode.window.showErrorMessage(
            'Foam Central: git pull failed for notes repo. Please resolve conflicts manually.\n' +
            (err.stderr || err.message || String(err))
          );
          // Don't auto-push if pull failed
          return;
        }
      } else {
        // User chose Skip → don't push
        logChannel.appendLine('Foam Central: user skipped pull, not pushing notes repo.');
        return;
      }
    }

    // Stage everything
    await runGit(['add', '.'], notesGitRoot);

    // Commit
    const template = cfg.get<string>('notesGit.commitMessage') || 'Foam Central auto-commit ({reason})';
    const message = template.replace('{reason}', reason);

    try {
      await runGit(['commit', '-m', message], notesGitRoot);
      logChannel.appendLine(`Foam Central: committed notes changes with message "${message}".`);
    } catch (err: any) {
      // Ignore "nothing to commit" race
      const msg = err.stderr || err.message || String(err);
      if (/nothing to commit/i.test(msg)) {
        logChannel.appendLine('Foam Central: nothing to commit (race), skipping push.');
        notesDirty = false;
        notesSaveCount = 0;
        notesLastSyncTime = Date.now();
        return;
      }
      throw err;
    }

    // Push (if we have a remote)
    try {
      await runGit(['push'], notesGitRoot);
      logChannel.appendLine(
        `Foam Central: pushed notes repo (ahead was ${ahead}, now synchronized).`
      );
    } catch (err: any) {
      vscode.window.showWarningMessage(
        'Foam Central: git push failed for notes repo. Check remote configuration.\n' +
          (err.stderr || err.message || String(err))
      );
    }

    notesDirty = false;
    notesSaveCount = 0;
    notesLastSyncTime = Date.now();
  } catch (err: any) {
    logChannel.appendLine('Foam Central: error during notes sync: ' + (err.message || String(err)));
  } finally {
    notesSyncInProgress = false;
  }
}

/* ---------- VS Code activate/deactivate ---------- */

export async function activate(context: vscode.ExtensionContext) {
  logChannel = vscode.window.createOutputChannel('Foam Central');
  logChannel.appendLine('Foam Central: activate()');

  const disposable = vscode.commands.registerCommand(
    'foam-central.createWorkspaceForCurrentFolder',
    () => createWorkspaceForCurrentFolder().catch(err => {
      console.error('Foam Central: createWorkspaceForCurrentFolder failed', err);
      logChannel.appendLine('createWorkspaceForCurrentFolder failed: ' + String(err));
    })
  );

  context.subscriptions.push(disposable);

  const notesFolder = getNotesFolder();
  if (notesFolder) {
    await ensureDailyNoteFile(notesFolder, new Date()); // whatever you already have
    await initNotesGitSync(notesFolder, context);
  }

  await initProjectTelemetry();

  context.subscriptions.push(
    vscode.commands.registerCommand('foamCentral.syncNotesNow', async () => {
      if (!notesGitRoot) {
        vscode.window.showInformationMessage('Foam Central: notes Git repo not detected.');
        return;
      }
      await runNotesSync('manual');
    })
  );
  (async () => {
    try {
      logChannel.appendLine('initProjectTelemetry() starting');
      await initProjectTelemetry();
      logChannel.appendLine('initProjectTelemetry() done');
    } catch (err: any) {
      if (err?.name !== 'Canceled') {
        console.error('Foam Central: initProjectTelemetry failed', err);
        logChannel.appendLine('initProjectTelemetry failed: ' + String(err));
      }
    }

    try {
      logChannel.appendLine('startDailyNoteScheduler() starting');
      await startDailyNoteScheduler();
      logChannel.appendLine('startDailyNoteScheduler() scheduled');
    } catch (err: any) {
      if (err?.name !== 'Canceled') {
        console.error('Foam Central: startDailyNoteScheduler failed', err);
        logChannel.appendLine('startDailyNoteScheduler failed: ' + String(err));
      }
    }
  })();
}

export async function deactivate(): Promise<void> {
  if (dailyNoteTimer) {
    clearTimeout(dailyNoteTimer);
    dailyNoteTimer = undefined;
  }
  // We intentionally do NOT try to log "CLOSE" here because VS Code often
  // cancels async work at shutdown, which just creates noisy errors.
}
