/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ProjectTypeOption, WorkflowTypeOption } from '../chatConstants';
import { ProjectTypeOption as ProjectTypeOptionValue, ToolName, WorkflowTypeOption as WorkflowTypeOptionValue } from '../chatConstants';
import { createLogicAppProject } from '../../commands/createNewCodeProject/CodeProjectBase/CreateLogicAppProjects';
import { ProjectType, TargetFramework, WorkflowType } from '@microsoft/vscode-extension-logic-apps';
import * as path from 'path';
import * as fse from 'fs-extra';
import { resolveProjectCreationWorkspaceRoot } from '../../utils/projectRoot';

/**
 * Parameters for creating a Logic App project
 */
export interface CreateProjectParams {
  projectName: string;
  projectType: ProjectTypeOption;
  workflowName?: string;
  workflowType?: WorkflowTypeOption;
  workspacePath?: string;
  createWorkspace?: boolean;
  includeCustomCode?: boolean;
  targetFramework?: string;
  functionName?: string;
  functionNamespace?: string;
}

/**
 * Result of a project operation
 */
export interface ProjectOperationResult {
  success: boolean;
  message: string;
  projectPath?: string;
  error?: string;
  code?:
    | 'invalidProjectName'
    | 'invalidWorkflowName'
    | 'missingWorkspace'
    | 'missingWorkflowName'
    | 'missingWorkflowType'
    | 'invalidWorkflowType'
    | 'projectExists'
    | 'createFailed';
}

/**
 * Register project-related language model tools
 */
export function registerProjectTools(context: vscode.ExtensionContext): void {
  // Register create project tool
  context.subscriptions.push(vscode.lm.registerTool(ToolName.createProject, new CreateProjectTool()));
}

/**
 * Tool for creating a new Logic App project
 */
class CreateProjectTool implements vscode.LanguageModelTool<CreateProjectParams> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateProjectParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await createProjectFromToolInput(options.input);
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.message)]);
  }
}

export async function createProjectFromToolInput(input: CreateProjectParams): Promise<ProjectOperationResult> {
  const { projectName } = input;
  const workflowName = typeof input.workflowName === 'string' ? input.workflowName.trim() : '';
  const workflowType = input.workflowType;

  try {
    if (!projectName || !isValidProjectName(projectName)) {
      return {
        success: false,
        code: 'invalidProjectName',
        message: `Invalid project name "${projectName}". Project name must start with a letter and can only contain letters, digits, "_" and "-".`,
      };
    }

    if (!workflowName && !workflowType) {
      return {
        success: false,
        code: 'missingWorkflowName',
        message:
          'Please specify the initial workflow name and type for this project. For example: workflowName="OrderProcessing", workflowType="stateful".',
      };
    }

    if (!workflowName) {
      return {
        success: false,
        code: 'missingWorkflowName',
        message: 'Please specify an initial workflow name for this project (for example: workflowName="OrderProcessing").',
      };
    }

    if (!isValidWorkflowName(workflowName)) {
      return {
        success: false,
        code: 'invalidWorkflowName',
        message: `Invalid workflow name "${workflowName}". Workflow name must start with a letter and can only contain letters, digits, "_" and "-".`,
      };
    }

    if (!workflowType) {
      return {
        success: false,
        code: 'missingWorkflowType',
        message: 'Please specify the initial workflow type: "stateful", "stateless", "agentic", or "agent".',
      };
    }

    const mappedWorkflowType = mapWorkflowTypeToProjectType(workflowType);
    if (!mappedWorkflowType) {
      return {
        success: false,
        code: 'invalidWorkflowType',
        message: `Invalid workflow type "${String(workflowType)}". Valid values are: stateful, stateless, agentic, agent.`,
      };
    }

    if (!vscode.workspace.workspaceFile) {
      return {
        success: false,
        code: 'missingWorkspace',
        message:
          'Cannot create project: you need to be in a Logic Apps workspace first. Please use the command palette (Ctrl+Shift+P) and run "Azure Logic Apps: Create new Logic App workspace".',
      };
    }

    const workspaceRootFolder = await resolveProjectCreationWorkspaceRoot(vscode.workspace.workspaceFile.fsPath);
    const logicAppFolderPath = path.join(workspaceRootFolder, projectName);

    if (await fse.pathExists(logicAppFolderPath)) {
      return {
        success: false,
        code: 'projectExists',
        projectPath: logicAppFolderPath,
        message: `A project named "${projectName}" already exists in this workspace. Please choose a different name.`,
      };
    }

    const projectType =
      input.projectType === ProjectTypeOptionValue.rulesEngine
        ? ProjectType.rulesEngine
        : input.projectType === ProjectTypeOptionValue.logicAppCustomCode || input.includeCustomCode
          ? ProjectType.customCode
          : ProjectType.logicApp;

    const isCustomCodeOrRules = projectType === ProjectType.customCode || projectType === ProjectType.rulesEngine;
    const functionName = isCustomCodeOrRules ? input.functionName || `${projectName}Functions` : undefined;
    const functionNamespace = isCustomCodeOrRules ? input.functionNamespace || `${projectName}.Functions` : undefined;
    const targetFramework = input.targetFramework || TargetFramework.Net8;

    const projectContext: any = {
      logicAppName: projectName,
      logicAppType: projectType,
      workflowName,
      workflowType: mappedWorkflowType,
      workspaceFilePath: vscode.workspace.workspaceFile.fsPath,
      shouldCreateLogicAppProject: true,
      targetFramework,
      functionFolderName: functionName,
      functionName,
      functionNamespace,
    };

    const actionContext: any = {
      telemetry: { properties: {}, measurements: {} },
      errorHandling: { issueProperties: {} },
      valuesToMask: [],
    };

    await createLogicAppProject(actionContext, projectContext, workspaceRootFolder);

    return {
      success: true,
      projectPath: logicAppFolderPath,
      message: `Successfully created Logic App project "${projectName}" in the workspace.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code: 'createFailed',
      message: `Failed to create project: ${errorMessage}`,
      error: errorMessage,
    };
  }
}

/**
 * Validate project name
 * @internal Exported for testing
 */
export function isValidProjectName(name: string): boolean {
  const projectNameValidation = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  return projectNameValidation.test(name);
}

/**
 * Validate workflow name
 * @internal Exported for testing
 */
export function isValidWorkflowName(name: string): boolean {
  const workflowNameValidation = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  return workflowNameValidation.test(name);
}

export { resolveProjectCreationWorkspaceRoot } from '../../utils/projectRoot';

function mapWorkflowTypeToProjectType(workflowType: WorkflowTypeOption): WorkflowType | undefined {
  switch (workflowType) {
    case WorkflowTypeOptionValue.stateful:
      return WorkflowType.stateful;
    case WorkflowTypeOptionValue.stateless:
      return WorkflowType.stateless;
    case WorkflowTypeOptionValue.agentic:
      return WorkflowType.agentic;
    case WorkflowTypeOptionValue.agent:
      return WorkflowType.agent;
    default:
      return undefined;
  }
}
