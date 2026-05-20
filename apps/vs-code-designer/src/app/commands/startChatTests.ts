/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

const chatTestsDebugName = 'Chat Tests (Extension Host)';

export async function startChatTests(_context: IActionContext): Promise<void> {
  logChatTestsMessage('Command invoked.');

  const workspaceFolder = await findLogicAppsUXWorkspaceFolder();
  if (!workspaceFolder) {
    logChatTestsMessage('Could not find the LogicAppsUX workspace folder containing apps/vs-code-designer.');
    throw new Error('Could not find the LogicAppsUX workspace folder containing apps/vs-code-designer.');
  }

  const repoRoot = workspaceFolder.uri.fsPath;
  const vsCodeDesignerRoot = path.join(repoRoot, 'apps', 'vs-code-designer');
  const extensionDevelopmentPath = path.join(vsCodeDesignerRoot, 'dist');
  const extensionTestsPath = path.join(vsCodeDesignerRoot, 'out', 'test', 'e2e', 'runChatTests');
  const compiledExtensionTestsPath = `${extensionTestsPath}.js`;
  const workspacePath = path.join(vsCodeDesignerRoot, 'e2e', 'test-workspace', 'test-workspace.code-workspace');

  const missingPaths = [extensionDevelopmentPath, compiledExtensionTestsPath, workspacePath].filter(
    (candidate) => !fse.existsSync(candidate)
  );
  logChatTestsMessage(`Workspace folder: ${workspaceFolder.uri.fsPath}`);
  logChatTestsMessage(`Extension development path: ${extensionDevelopmentPath}`);
  logChatTestsMessage(`Extension tests path: ${extensionTestsPath}`);
  logChatTestsMessage(`Test workspace path: ${workspacePath}`);

  if (missingPaths.length > 0) {
    logChatTestsMessage(`Missing required paths: ${missingPaths.join(', ')}`);
    throw new Error(
      `Cannot start ${chatTestsDebugName}; required paths are missing. Run the build:chat-tests task first. Missing: ${missingPaths.join(', ')}`
    );
  }

  logChatTestsMessage('Stopping active debug sessions before launch.');
  await stopActiveDebugSessions();

  const sessionStartedSubscription = vscode.debug.onDidStartDebugSession((session) => {
    logChatTestsMessage(`Debug session started: ${session.name} (${session.type})`);
  });
  const sessionTerminatedSubscription = vscode.debug.onDidTerminateDebugSession((session) => {
    logChatTestsMessage(`Debug session terminated: ${session.name} (${session.type})`);
  });

  logChatTestsMessage(`Starting ${chatTestsDebugName}.`);
  const started = await vscode.debug.startDebugging(workspaceFolder, {
    name: chatTestsDebugName,
    type: 'extensionHost',
    request: 'launch',
    runtimeExecutable: '${execPath}',
    args: [`--extensionDevelopmentPath=${extensionDevelopmentPath}`, `--extensionTestsPath=${extensionTestsPath}`, workspacePath],
    env: {
      LAUX_CHAT_TESTS: '1',
    },
    outFiles: [path.join(vsCodeDesignerRoot, 'out', 'test', 'e2e', '**', '*.js'), path.join(extensionDevelopmentPath, '**', '*.js')],
  });
  logChatTestsMessage(`vscode.debug.startDebugging returned ${started}.`);

  sessionStartedSubscription.dispose();
  sessionTerminatedSubscription.dispose();

  if (!started) {
    throw new Error(`VS Code did not start the ${chatTestsDebugName} debug session.`);
  }
}

async function findLogicAppsUXWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    if (await fse.pathExists(path.join(workspaceFolder.uri.fsPath, 'apps', 'vs-code-designer'))) {
      return workspaceFolder;
    }
  }

  return undefined;
}

async function stopActiveDebugSessions(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
      logChatTestsMessage('No active debug session remains.');
      return;
    }

    logChatTestsMessage(`Stopping active debug session: ${activeSession.name} (${activeSession.type}).`);
    await vscode.debug.stopDebugging(activeSession);
    await waitForDebugSessionToEnd(activeSession);
  }
}

async function waitForDebugSessionToEnd(session: vscode.DebugSession, timeoutMs = 15_000): Promise<void> {
  if (vscode.debug.activeDebugSession?.id !== session.id) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, timeoutMs);

    const subscription = vscode.debug.onDidTerminateDebugSession((terminatedSession) => {
      if (terminatedSession.id === session.id) {
        clearTimeout(timeout);
        subscription.dispose();
        resolve();
      }
    });
  });
}

function logChatTestsMessage(message: string): void {
  ext.outputChannel.appendLine(`[chat-tests] ${message}`);
}
