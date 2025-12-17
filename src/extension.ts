import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

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

let currentProject: ProjectInfo | undefined;
let dailyNoteTimer: NodeJS.Timeout | undefined;
let logChannel: vscode.OutputChannel;
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
    await fs.writeFile(
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

  await fs.mkdir(journalsDir, { recursive: true });

  const filePath = path.join(journalsDir, `${slug}.md`);
  try {
    await fs.access(filePath);
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
    await fs.writeFile(filePath, content, { encoding: 'utf8' });
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
    await fs.mkdir(projectRootInNotes, { recursive: true });
  } catch (err) {
    console.error('Foam Central: failed to create project dir', err);
    return;
  }

  // home.md
  try {
    await fs.access(info.homePath);
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
    await fs.writeFile(info.homePath, contentLines.join('\n'), { encoding: 'utf8' });
  }

  // vcs.md
  try {
    await fs.access(info.vcsPath);
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
    await fs.writeFile(info.vcsPath, contentLines.join('\n'), { encoding: 'utf8' });
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
    const text = `\n- ${dateStr} [[${dailySlug}]] opened at ${timeStr}\n`;
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

type GitAPI = {
  repositories: any[];
};

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

/* ---------- VS Code activate/deactivate ---------- */

export function activate(context: vscode.ExtensionContext) {
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
