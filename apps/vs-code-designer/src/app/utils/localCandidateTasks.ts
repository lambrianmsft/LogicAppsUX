import * as fs from 'fs-extra';
import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as vscode from 'vscode';
import { assertLocalCandidateInstalled } from './localCandidate';
import { assertLocalCandidateProject, getActiveLocalCandidate, getLocalCandidateHostEnvironment } from './localCandidateRuntime';

const hostTaskLabel = 'func: host start';
const funcCommand = '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}';
const platforms = ['windows', 'linux', 'osx'] as const;

export function isSameCandidateTaskPath(value: unknown, expected: string): boolean {
  return typeof value === 'string' && path.isAbsolute(value) && path.isAbsolute(expected) && path.relative(value, expected) === '';
}

function taskArgumentValue(argument: string | vscode.ShellQuotedString): string {
  return typeof argument === 'string' ? argument : argument.value;
}

export function isLocalCandidateHostExecution(
  execution: vscode.ShellExecution | vscode.ProcessExecution | undefined,
  launcher: string
): boolean {
  if (!execution || !Array.isArray(execution.args)) {
    return false;
  }
  const command = 'process' in execution ? execution.process : execution.command;
  const args = execution.args.map(taskArgumentValue);
  return (
    command !== undefined &&
    taskArgumentValue(command) === 'node' &&
    isSameCandidateTaskPath(args[0], launcher) &&
    (args[1] === funcCommand || (typeof args[1] === 'string' && path.isAbsolute(args[1]))) &&
    args[2] === 'host' &&
    args[3] === 'start'
  );
}

function invalidTasks(reason: string): never {
  throw new Error(`Cannot prepare local candidate host task: ${reason}. Update the generated "${hostTaskLabel}" task and retry.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOptions(options: unknown): void {
  if (options !== undefined && (!isRecord(options) || (options.env !== undefined && !isRecord(options.env)))) {
    invalidTasks('options and options.env must be objects');
  }
}

function validateArgs(args: unknown): asserts args is unknown[] {
  if (!Array.isArray(args) || args[0] !== 'host' || args[1] !== 'start') {
    invalidTasks('expected explicit host/start arguments');
  }
}

/**
 * Only update candidate-owned fields, retaining JSONC comments and all other task content.
 * Runtime environment values are supplied afresh for every launch, not copied from the generator.
 */
export function migrateLocalCandidateTasks(content: string, environment: Record<string, string>, launcher?: string): string {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  let text = content.slice(bom.length);
  const errors: jsonc.ParseError[] = [];
  const tree = jsonc.parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length || !tree) {
    invalidTasks('tasks.json is not valid JSONC');
  }
  // JSON permits duplicate property names, but editing/resolving different occurrences is unsafe.
  const checkProperties = (node: jsonc.Node): void => {
    if (node.type === 'object') {
      const names = node.children?.map((property) => property.children?.[0].value) ?? [];
      if (new Set(names).size !== names.length) {
        invalidTasks('tasks.json contains duplicate properties');
      }
    }
    node.children?.forEach(checkProperties);
  };
  checkProperties(tree);
  const document = jsonc.getNodeValue(tree);
  if (!isRecord(document) || !Array.isArray(document.tasks)) {
    invalidTasks('tasks.json must contain a tasks array');
  }
  const matches = document.tasks.flatMap((task, index) => (isRecord(task) && task.label === hostTaskLabel ? [index] : []));
  if (matches.length !== 1) {
    invalidTasks('expected exactly one built-in host task');
  }
  const index = matches[0];
  const task = document.tasks[index];
  const isWrapped = (block: Record<string, unknown>): boolean =>
    Boolean(
      launcher &&
        block.command === 'node' &&
        Array.isArray(block.args) &&
        isSameCandidateTaskPath(block.args[0], launcher) &&
        block.args[1] === funcCommand
    );
  if ((task.type !== 'shell' && task.type !== 'process') || (task.command !== funcCommand && !isWrapped(task))) {
    invalidTasks('the host task command/type has been customized or is provider-backed');
  }
  validateArgs(isWrapped(task) ? task.args.slice(2) : task.args);
  validateOptions(task.options);
  for (const platform of platforms) {
    const override = task[platform];
    if (override !== undefined) {
      if (
        !isRecord(override) ||
        (override.command !== undefined &&
          override.command !== funcCommand &&
          !isWrapped(override) &&
          !(isWrapped(task) && override.command === 'node' && override.args === undefined))
      ) {
        invalidTasks(`unsupported ${platform} host command`);
      }
      if (override.args !== undefined) {
        validateArgs(isWrapped(override) ? (override.args as unknown[]).slice(2) : override.args);
      }
      validateOptions(override.options);
    }
  }
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' };
  const update = (location: jsonc.JSONPath, value: unknown): void => {
    if (jsonc.findNodeAtLocation(jsonc.parseTree(text)!, location)?.value === value) {
      return;
    }
    text = jsonc.applyEdits(text, jsonc.modify(text, location, value, { formattingOptions }));
  };
  for (const platform of [undefined, ...platforms]) {
    const location: jsonc.JSONPath = platform ? ['tasks', index, platform] : ['tasks', index];
    const block = platform ? task[platform] : task;
    // Delete only the token and its comma; jsonc.modify's array removal also deletes
    // intervening comments, which can belong to the user's following argument.
    if (block?.args) {
      for (let i = block.args.length - 1; i >= 0; i--) {
        if (block.args[i] === '--offline') {
          const args = jsonc.findNodeAtLocation(jsonc.parseTree(text)!, [...location, 'args'])!;
          const argument = args.children![i];
          const scanner = jsonc.createScanner(text, true);
          scanner.setPosition(argument.offset + argument.length);
          scanner.scan();
          if (text[scanner.getTokenOffset()] !== ',') {
            const previous = args.children![i - 1];
            scanner.setPosition(previous.offset + previous.length);
            scanner.scan();
            if (text[scanner.getTokenOffset()] !== ',') {
              invalidTasks('cannot remove the offline argument safely');
            }
          }
          text = jsonc.applyEdits(
            text,
            [
              { offset: argument.offset, length: argument.length, content: '' },
              { offset: scanner.getTokenOffset(), length: 1, content: '' },
            ].sort((left, right) => left.offset - right.offset)
          );
        }
      }
    }
    for (const [key, value] of Object.entries(environment)) {
      update([...location, 'options', 'env', key], value);
    }
    if (launcher && (!platform || block?.command !== undefined || block?.args !== undefined)) {
      const current = jsonc.getNodeValue(jsonc.findNodeAtLocation(jsonc.parseTree(text)!, location)!);
      if (current.args && !isWrapped(current)) {
        const args = jsonc.findNodeAtLocation(jsonc.parseTree(text)!, [...location, 'args'])!;
        text = jsonc.applyEdits(text, [
          {
            offset: args.offset + 1,
            length: 0,
            content: `${JSON.stringify(launcher)}, ${JSON.stringify(funcCommand)}, `,
          },
        ]);
      }
      update([...location, 'command'], 'node');
    }
  }
  return bom + text;
}

/**
 * F5 is started by pickFuncProcess, not VS Code's preLaunchTask runner. Await the file
 * migration before fetchTasks, then verify the returned execution: a task service/
 * file-watcher cache may still contain the previous options or arguments.
 * Do not replace Task.execution: that discards VS Code's configured task identity
 * and can lose dependsOn/runOptions semantics when executeTask serializes the task.
 */
export async function fetchLocalCandidateDebugTasks(
  folder: vscode.WorkspaceFolder,
  projectPath: string,
  preLaunchTask: string | undefined,
  codeful = false
): Promise<vscode.Task[]> {
  const activeCandidate = getActiveLocalCandidate();
  if (!activeCandidate) {
    return vscode.tasks.fetchTasks();
  }
  if (!vscode.workspace.isTrusted) {
    invalidTasks('the workspace is not trusted');
  }
  assertLocalCandidateProject(projectPath);
  assertLocalCandidateProject(folder.uri.fsPath);
  if (preLaunchTask && preLaunchTask !== hostTaskLabel) {
    invalidTasks('a custom preLaunchTask cannot be migrated automatically');
  }
  const installed = await assertLocalCandidateInstalled();
  if (
    !installed ||
    installed.root !== activeCandidate.root ||
    installed.manifestPath !== activeCandidate.manifestPath ||
    installed.bundlePath !== activeCandidate.bundlePath ||
    installed.sdkPath !== activeCandidate.sdkPath ||
    installed.bundle.sha256 !== activeCandidate.bundle.sha256 ||
    installed.sdk.sha256 !== activeCandidate.sdk.sha256
  ) {
    invalidTasks('the installed candidate changed after activation; reload the window');
  }
  const tasksPath = path.join(folder.uri.fsPath, '.vscode', 'tasks.json');
  assertLocalCandidateProject(await fs.realpath(tasksPath));
  const assertSaved = (): void => {
    if (vscode.workspace.textDocuments.some((document) => document.isDirty && isSameCandidateTaskPath(document.uri.fsPath, tasksPath))) {
      invalidTasks('tasks.json has unsaved edits');
    }
  };
  assertSaved();
  const environment = getLocalCandidateHostEnvironment();
  const original = await fs.readFile(tasksPath, 'utf8');
  const launcher = codeful ? path.join(__dirname, 'localCandidateHost.js') : undefined;
  const updated = migrateLocalCandidateTasks(original, environment, launcher);
  if (updated !== original) {
    if ((await fs.readFile(tasksPath, 'utf8')) !== original) {
      invalidTasks('tasks.json changed while preparing the host');
    }
    assertSaved();
    await fs.writeFile(tasksPath, updated, 'utf8');
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const tasks = await vscode.tasks.fetchTasks();
    const matches = tasks.filter(
      (task) =>
        task.name === hostTaskLabel && typeof task.scope === 'object' && isSameCandidateTaskPath(task.scope.uri.fsPath, folder.uri.fsPath)
    );
    if (matches.length !== 1) {
      invalidTasks('expected exactly one resolved host task in the selected workspace');
    }
    const execution = matches[0].execution;
    if (
      (matches[0].definition.type !== 'shell' && matches[0].definition.type !== 'process') ||
      (!(execution instanceof vscode.ProcessExecution) &&
        !(execution instanceof vscode.ShellExecution && execution.commandLine === undefined && execution.command !== undefined))
    ) {
      invalidTasks('resolved host execution is not an explicit shell/process command');
    }
    const wrapped = launcher && isLocalCandidateHostExecution(execution, launcher);
    const args = execution.args.map(taskArgumentValue);
    validateArgs(wrapped ? args.slice(2) : args);
    if (
      !args.includes('--offline') &&
      (!launcher || wrapped) &&
      Object.entries(environment).every(([key, value]) => execution.options?.env?.[key] === value)
    ) {
      return tasks;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  invalidTasks('VS Code has not reloaded the candidate task configuration; reload the window before retrying');
}
