import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { fetchLocalCandidateDebugTasks, isSameCandidateTaskPath, migrateLocalCandidateTasks } from '../localCandidateTasks';

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  environment: vi.fn(),
  assertProject: vi.fn(),
  assertInstalled: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  realpath: vi.fn(),
}));
vi.mock('../localCandidateRuntime', () => ({
  getActiveLocalCandidate: mocks.candidate,
  getLocalCandidateHostEnvironment: mocks.environment,
  assertLocalCandidateProject: mocks.assertProject,
}));
vi.mock('fs-extra', () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, realpath: mocks.realpath }));
vi.mock('../localCandidate', () => ({ assertLocalCandidateInstalled: mocks.assertInstalled }));
vi.mock('vscode', () => ({
  ShellQuoting: { Strong: 2 },
  workspace: { isTrusted: true, textDocuments: [] },
  tasks: { fetchTasks: vi.fn() },
  ShellExecution: class {
    commandLine = undefined;
    constructor(
      public command: string,
      public args: string[],
      public options: unknown
    ) {}
  },
  ProcessExecution: class {
    constructor(
      public process: string,
      public args: string[],
      public options: unknown
    ) {}
  },
}));

const environment = { FUNCTIONS_CORE_TOOLS_OFFLINE: 'false', FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:43210/new-feed/' };
const generatedTask = () => ({
  label: 'func: host start',
  type: 'shell',
  command: '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
  args: ['host', 'start', '--offline', '--address', '127.0.0.1', '--port', '7077'],
  options: { cwd: '${workspaceFolder}/custom', env: { KEEP: 'private-value', FUNCTIONS_CORE_TOOLS_OFFLINE: 'true' } },
  dependsOn: ['custom-prepare'],
  problemMatcher: '$func-watch',
  isBackground: true,
  presentation: { reveal: 'silent' },
  ...Object.fromEntries(
    ['windows', 'linux', 'osx'].map((platform) => [
      platform,
      {
        args: ['host', 'start', '--offline', '--verbose'],
        options: { cwd: `custom-${platform}`, env: { PATH: `custom-${platform}`, FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'old-feed' } },
      },
    ])
  ),
});
const source = () =>
  JSON.stringify({
    version: '2.0.0',
    tasks: [generatedTask(), { label: 'custom-prepare', type: 'shell', command: 'echo', args: ['--offline'] }],
    inputs: [{ id: 'user', type: 'promptString', description: 'Leave me alone' }],
  });

describe('candidate-only task migration', () => {
  it('uses Windows path identity without accepting another helper or relative paths', () => {
    const launcher = path.resolve('extension', 'localCandidateHost.js');
    expect(isSameCandidateTaskPath(launcher, launcher)).toBe(true);
    expect(isSameCandidateTaskPath(launcher.toUpperCase(), launcher)).toBe(process.platform === 'win32');
    expect(isSameCandidateTaskPath(path.join(path.dirname(launcher), 'other.js'), launcher)).toBe(false);
    expect(isSameCandidateTaskPath('localCandidateHost.js', launcher)).toBe(false);
    expect(isSameCandidateTaskPath(`"${launcher}"`, launcher)).toBe(false);
  });
  it('wraps codeful host execution after existing build dependencies and preserves OS arguments', () => {
    const launcher = path.resolve('extension', 'localCandidateHost.js');
    const text = migrateLocalCandidateTasks(source(), environment, launcher);
    const task = jsonc.parse(text).tasks[0];
    expect(task.command).toBe('node');
    expect(task.args).toEqual([
      launcher,
      '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
      'host',
      'start',
      '--address',
      '127.0.0.1',
      '--port',
      '7077',
    ]);
    expect(task.dependsOn).toEqual(['custom-prepare']);
    expect(task.options.cwd).toBe('${workspaceFolder}/custom');
    for (const platform of ['windows', 'linux', 'osx']) {
      expect(task[platform].command).toBe('node');
      expect(task[platform].args).toEqual([
        launcher,
        '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
        'host',
        'start',
        '--verbose',
      ]);
    }
    expect(migrateLocalCandidateTasks(text, environment, launcher)).toBe(text);
  });

  it('preserves inline argument comments and command-only platform inheritance when wrapping', () => {
    const task = generatedTask();
    const document = JSON.stringify({ tasks: [{ ...task, windows: { command: task.command } }] }).replace(
      '"--port"',
      '/* user port */ "--port"'
    );
    const launcher = path.resolve('extension', 'localCandidateHost.js');
    const migrated = migrateLocalCandidateTasks(document, environment, launcher);
    expect(migrated).toContain('/* user port */');
    expect(jsonc.parse(migrated).tasks[0].windows.args).toBeUndefined();
    expect(migrateLocalCandidateTasks(migrated, environment, launcher)).toBe(migrated);
  });
  it('refreshes old base and all OS overrides while retaining user tasks, args, cwd, env and metadata', () => {
    const original = JSON.parse(source());
    const updated = jsonc.parse(migrateLocalCandidateTasks(source(), environment));
    const expected = structuredClone(original);
    for (const block of [expected.tasks[0], ...['windows', 'linux', 'osx'].map((platform) => expected.tasks[0][platform])]) {
      block.args = block.args.filter((arg: string) => arg !== '--offline');
      Object.assign(block.options.env, environment);
    }
    expect(updated).toEqual(expected);
  });

  it('preserves BOM, CRLF, comments, trailing commas and unrelated text; repeated migration is stable', () => {
    const text =
      '\uFEFF{\r\n// custom comment\r\n"tasks": [{ "label": "func: host start", "type": "shell", "command": "${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}", "args": ["host", "start", "--offline", /* preserve port */ "--port", "7077",], }],\r\n"inputs": [ /* untouched */ ],\r\n}';
    const updated = migrateLocalCandidateTasks(text, environment);
    expect(updated.startsWith('\uFEFF')).toBe(true);
    expect(updated).toContain('// custom comment\r\n');
    expect(updated).toContain('/* preserve port */');
    expect(updated).toContain('"inputs": [ /* untouched */ ]');
    expect(migrateLocalCandidateTasks(updated, environment)).toBe(updated);
    expect(jsonc.parse(updated.slice(1)).tasks[0].args).toEqual(['host', 'start', '--port', '7077']);
  });

  it('adds current env to new tasks and picks up changing feed values on subsequent launches', () => {
    const task = generatedTask();
    task.args = ['host', 'start'];
    const initial = migrateLocalCandidateTasks(JSON.stringify({ tasks: [task] }), environment);
    const nextEnv = { ...environment, FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:54321/next-feed/' };
    const next = jsonc.parse(migrateLocalCandidateTasks(initial, nextEnv)).tasks[0];
    for (const block of [next, next.windows, next.linux, next.osx]) {
      expect(block.options.env).toMatchObject(nextEnv);
    }
  });

  it.each([
    ['host', 'start', '--offline'],
    ['host', 'start', '--offline', '--offline'],
    ['host', 'start', '--offline', '--verbose', '--offline'],
  ])('removes trailing or repeated offline flags without invalidating the array: %j', (...args) => {
    const task = { ...generatedTask(), args };
    const updated = jsonc.parse(migrateLocalCandidateTasks(JSON.stringify({ tasks: [task] }), environment));
    expect(updated.tasks[0].args).toEqual(args.filter((argument) => argument !== '--offline'));
  });

  it.each([
    ['missing', { tasks: [] }],
    ['duplicate', { tasks: [generatedTask(), generatedTask()] }],
    ['custom command', { tasks: [{ ...generatedTask(), command: 'custom-wrapper' }] }],
    ['provider-backed', { tasks: [{ ...generatedTask(), type: 'func' }] }],
    ['custom args', { tasks: [{ ...generatedTask(), args: 'host start --offline' }] }],
    ['invalid env', { tasks: [{ ...generatedTask(), options: { env: 'custom' } }] }],
    ['OS command', { tasks: [{ ...generatedTask(), windows: { command: 'custom-wrapper' } }] }],
  ])('fails explicitly for %s instead of regenerating tasks', (_name, document) => {
    expect(() => migrateLocalCandidateTasks(JSON.stringify(document), environment)).toThrow('Cannot prepare local candidate host task');
  });

  it('rejects malformed JSONC and duplicate keys', () => {
    expect(() => migrateLocalCandidateTasks('{', environment)).toThrow('valid JSONC');
    expect(() => migrateLocalCandidateTasks('{"tasks":[],"tasks":[]}', environment)).toThrow('duplicate properties');
  });
});

describe('candidate F5 task resolution', () => {
  const projectPath = path.resolve('candidate', 'workspace', 'logicapp');
  const folder = { uri: { fsPath: projectPath }, name: 'logicapp', index: 0 } as vscode.WorkspaceFolder;
  const tasksPath = path.join(projectPath, '.vscode', 'tasks.json');
  let staleTask: vscode.Task;

  beforeEach(() => {
    vi.clearAllMocks();
    const candidate = { root: path.resolve('candidate'), bundle: { sha256: 'bundle-hash' }, sdk: { sha256: 'sdk-hash' } };
    mocks.candidate.mockReturnValue(candidate);
    mocks.assertInstalled.mockResolvedValue(candidate);
    mocks.environment.mockReturnValue(environment);
    mocks.assertProject.mockImplementation(() => undefined);
    mocks.realpath.mockResolvedValue(tasksPath);
    mocks.readFile.mockResolvedValue(source());
    mocks.writeFile.mockResolvedValue(undefined);
    Object.assign(vscode.workspace, { isTrusted: true, textDocuments: [] });
    staleTask = {
      name: 'func: host start',
      scope: folder,
      definition: { type: 'shell' },
      execution: new vscode.ShellExecution('resolved-func', ['host', 'start', '--verbose'], {
        cwd: 'resolved-custom-cwd',
        env: { PATH: 'resolved-custom-path', ...environment },
      }),
      presentationOptions: { reveal: 2 },
    } as vscode.Task;
    vi.mocked(vscode.tasks.fetchTasks).mockResolvedValue([staleTask]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('awaits installed-byte integrity verification before reading environment/configuration or resolving tasks', async () => {
    let rejectIntegrity!: (error: Error) => void;
    mocks.assertInstalled.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectIntegrity = reject;
        })
    );
    const pending = fetchLocalCandidateDebugTasks(folder, projectPath, undefined);
    const rejected = expect(pending).rejects.toThrow('candidate integrity failure');
    await vi.waitFor(() => expect(mocks.assertInstalled).toHaveBeenCalled());
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(vscode.tasks.fetchTasks).not.toHaveBeenCalled();
    rejectIntegrity(new Error('candidate integrity failure'));
    await rejected;
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rejects candidate changes after activation before migrating or resolving tasks', async () => {
    mocks.assertInstalled.mockResolvedValue({ ...mocks.candidate(), bundle: { sha256: 'different-hash' } });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('candidate changed after activation');
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(vscode.tasks.fetchTasks).not.toHaveBeenCalled();
  });

  it('awaits persistence and task-cache refresh, preserving the original resolved task identity and execution', async () => {
    const cachedTask = {
      ...staleTask,
      execution: new vscode.ShellExecution('resolved-func', ['host', 'start', '--offline', '--verbose'], { env: { ...environment } }),
    };
    const execution = staleTask.execution;
    vi.mocked(vscode.tasks.fetchTasks).mockResolvedValueOnce([cachedTask]).mockResolvedValue([staleTask]);
    let releaseWrite!: () => void;
    mocks.writeFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        })
    );
    const pending = fetchLocalCandidateDebugTasks(folder, projectPath, 'func: host start');
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
    expect(vscode.tasks.fetchTasks).not.toHaveBeenCalled();
    releaseWrite();
    const result = await pending;
    expect(result[0]).toBe(staleTask);
    expect(vscode.tasks.fetchTasks).toHaveBeenCalledTimes(2);
    expect(staleTask.execution).toBe(execution);
    expect(staleTask.execution).toMatchObject({
      command: 'resolved-func',
      args: ['host', 'start', '--verbose'],
      options: { cwd: 'resolved-custom-cwd', env: { PATH: 'resolved-custom-path', ...environment } },
    });
    expect(staleTask.presentationOptions).toEqual({ reveal: 2 });
    expect(mocks.assertProject).toHaveBeenCalledWith(projectPath);
    expect(mocks.assertProject).toHaveBeenCalledWith(tasksPath);
  });

  it('supports resolved process execution without losing options', async () => {
    staleTask.execution = new vscode.ProcessExecution('resolved-func', ['host', 'start'], { cwd: 'keep', env: environment });
    const execution = staleTask.execution;
    await fetchLocalCandidateDebugTasks(folder, projectPath, undefined);
    expect(staleTask.execution).toBe(execution);
    expect(staleTask.execution).toMatchObject({
      process: 'resolved-func',
      args: ['host', 'start'],
      options: { cwd: 'keep', env: environment },
    });
  });

  it('does not write already-current task configuration', async () => {
    mocks.readFile.mockResolvedValue(migrateLocalCandidateTasks(source(), environment));
    await fetchLocalCandidateDebugTasks(folder, projectPath, undefined);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(vscode.tasks.fetchTasks).toHaveBeenCalledTimes(1);
  });

  it('admits handoff-wrapped tasks repeatedly with actual fetchTasks unresolved config arguments and Windows casing', async () => {
    const launcher = path.resolve(__dirname, '..', 'localCandidateHost.js');
    const writtenLauncher = process.platform === 'win32' ? launcher.toUpperCase() : launcher;
    const migrated = migrateLocalCandidateTasks(source(), environment, writtenLauncher);
    mocks.readFile.mockResolvedValue(migrated);
    const returnedFolder = {
      ...folder,
      uri: { fsPath: process.platform === 'win32' ? folder.uri.fsPath.toUpperCase() : folder.uri.fsPath },
    };
    staleTask.scope = returnedFolder as vscode.WorkspaceFolder;
    staleTask.execution = new vscode.ShellExecution(
      'node',
      [writtenLauncher, '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}', 'host', 'start', '--address', '127.0.0.1'],
      { cwd: 'bin/Debug/net8', env: environment }
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await fetchLocalCandidateDebugTasks(folder, projectPath, undefined, true))[0]).toBe(staleTask);
    }
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(vscode.tasks.fetchTasks).toHaveBeenCalledTimes(2);
  });

  it('admits ShellQuotedString arguments without changing the real execution object', async () => {
    const launcher = path.resolve(__dirname, '..', 'localCandidateHost.js');
    mocks.readFile.mockResolvedValue(migrateLocalCandidateTasks(source(), environment, launcher));
    const execution = new vscode.ShellExecution('node', [launcher, path.resolve('tools', 'func.exe'), 'host', 'start'], {
      env: environment,
    });
    execution.command = { value: 'node', quoting: vscode.ShellQuoting.Strong };
    execution.args = execution.args.map((arg) => ({ value: String(arg), quoting: vscode.ShellQuoting.Strong }));
    staleTask.execution = execution;
    expect((await fetchLocalCandidateDebugTasks(folder, projectPath, undefined, true))[0].execution).toBe(execution);
  });

  it.each(['other-helper', 'other-command', 'provider'])('rejects %s despite a candidate task label', async (kind) => {
    const launcher = path.resolve(__dirname, '..', 'localCandidateHost.js');
    mocks.readFile.mockResolvedValue(migrateLocalCandidateTasks(source(), environment, launcher));
    staleTask.execution = new vscode.ShellExecution(
      kind === 'other-command' ? 'custom-node' : 'node',
      [
        kind === 'other-helper' ? path.resolve('other', 'localCandidateHost.js') : launcher,
        path.resolve('tools', 'func.exe'),
        'host',
        'start',
      ],
      { env: environment }
    );
    if (kind === 'provider') {
      staleTask.definition = { type: 'func' };
    }
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined, true)).rejects.toThrow('Cannot prepare local candidate');
  });

  it('fails closed after bounded retries when cached execution still has old runtime environment', async () => {
    vi.useFakeTimers();
    staleTask.execution = new vscode.ProcessExecution('resolved-func', ['host', 'start'], {
      env: { ...environment, FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'stale-feed' },
    });
    const pending = fetchLocalCandidateDebugTasks(folder, projectPath, undefined);
    const rejected = expect(pending).rejects.toThrow('VS Code has not reloaded');
    await vi.runAllTimersAsync();
    await rejected;
    expect(vscode.tasks.fetchTasks).toHaveBeenCalledTimes(50);
  });

  it('leaves ordinary noncandidate tasks completely unchanged without reading or writing configuration', async () => {
    mocks.candidate.mockReturnValue(undefined);
    const execution = staleTask.execution;
    expect(await fetchLocalCandidateDebugTasks(folder, projectPath, 'custom task')).toEqual([staleTask]);
    expect(staleTask.execution).toBe(execution);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.assertInstalled).not.toHaveBeenCalled();
  });

  it('fails closed before configuration access for untrusted or outside-root workspaces and custom prelaunch tasks', async () => {
    Object.assign(vscode.workspace, { isTrusted: false });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('not trusted');
    Object.assign(vscode.workspace, { isTrusted: true });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, 'custom')).rejects.toThrow('custom preLaunchTask');
    mocks.assertProject.mockImplementation(() => {
      throw new Error('outside root');
    });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('outside root');
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(vscode.tasks.fetchTasks).not.toHaveBeenCalled();
  });

  it('does not overwrite unsaved or concurrent edits', async () => {
    Object.assign(vscode.workspace, { textDocuments: [{ isDirty: true, uri: { fsPath: tasksPath } }] });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('unsaved');
    Object.assign(vscode.workspace, { textDocuments: [] });
    mocks.readFile.mockResolvedValueOnce(source()).mockResolvedValueOnce('changed');
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('changed while preparing');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('rejects ambiguous cached tasks and shell command lines rather than executing stale arguments', async () => {
    vi.mocked(vscode.tasks.fetchTasks).mockResolvedValue([staleTask, staleTask]);
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('one resolved host task');
    vi.mocked(vscode.tasks.fetchTasks).mockResolvedValue([staleTask]);
    Object.assign(staleTask.execution!, { commandLine: 'func host start --offline' });
    await expect(fetchLocalCandidateDebugTasks(folder, projectPath, undefined)).rejects.toThrow('not an explicit shell/process command');
  });
});
