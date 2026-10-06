import path from 'path';
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { ProjectType, TargetFramework, WorkflowType, type IWebviewProjectContext } from '@microsoft/vscode-extension-logic-apps';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { createLogicAppWorkspace } from '../commands/createNewCodeProject/CodeProjectBase/CreateLogicAppWorkspace';
import { assertLocalCandidateProject, getActiveLocalCandidate } from './localCandidateRuntime';
import { localSettingsFileName, workflowSubscriptionIdKey } from '../../constants';
import type { ILocalSettingsJson } from '@microsoft/vscode-extension-logic-apps';

interface CandidateWorkspaceOptions {
  parentPath: string;
  workspaceName: string;
  logicAppName: string;
  workflowName: string;
}

export async function createLocalCandidateWorkspace(options: CandidateWorkspaceOptions) {
  if (!getActiveLocalCandidate() || !vscode.workspace.isTrusted) {
    throw new Error('Candidate workspace creation requires an opted-in, trusted workspace.');
  }
  for (const name of [options.workspaceName, options.logicAppName, options.workflowName]) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error('Candidate workspace and project names must be simple C# identifiers.');
    }
  }
  assertLocalCandidateProject(options.parentPath);
  const workspaceDirectory = path.join(options.parentPath, options.workspaceName);
  if (await fse.pathExists(workspaceDirectory)) {
    throw new Error(`Candidate workspace already exists: ${workspaceDirectory}`);
  }
  const projectPath = path.join(workspaceDirectory, options.logicAppName);
  const workspaceFile = path.join(workspaceDirectory, `${options.workspaceName}.code-workspace`);
  await callWithTelemetryAndErrorHandling('localCandidate.createWorkspace', async (context) => {
    context.errorHandling.rethrow = true;
    const projectContext: IWebviewProjectContext = {
      ...context,
      workspaceProjectPath: vscode.Uri.file(options.parentPath),
      workspaceFilePath: workspaceFile,
      workspaceName: options.workspaceName,
      logicAppName: options.logicAppName,
      workflowName: options.workflowName,
      logicAppType: ProjectType.codeful,
      workflowType: WorkflowType.statefulCodeful,
      targetFramework: TargetFramework.Net8,
      shouldCreateLogicAppProject: true,
      isDevContainerProject: false,
    };
    await createLogicAppWorkspace(context, projectContext, false, false);
  });
  const settingsPath = path.join(projectPath, localSettingsFileName);
  const settings: ILocalSettingsJson = await fse.readJson(settingsPath);
  settings.Values = { ...settings.Values, [workflowSubscriptionIdKey]: '' };
  await fse.writeJson(settingsPath, settings, { spaces: 2 });
  return { workspaceFile, projectPath };
}
