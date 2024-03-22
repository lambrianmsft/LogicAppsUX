/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { developmentDirectoryName, testsDirectoryName, workflowFileName } from '../../../../constants';
import { getUnitTestName, pickUnitTest } from '../../../utils/unitTests';
import { tryGetLogicAppProjectRoot } from '../../../utils/verifyIsProject';
import { getWorkflowNode, getWorkspaceFolder } from '../../../utils/workspace';
import { type IAzureConnectorsContext } from '../azureConnectorWizard';
import OpenDesignerForLocalProject from '../openDesigner/openDesignerForLocalProject';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Edits a unit test for a Logic App workflow.
 * @param {IAzureConnectorsContext} context - The Azure Connectors context.
 * @param {vscode.Uri} node - The URI of the unit test file to edit. If not provided, the user will be prompted to select a unit test file.
 * @returns A Promise that resolves when the unit test has been edited.
 */
export async function editUnitTest(context: IAzureConnectorsContext, node: vscode.Uri | vscode.TestItem): Promise<void> {
  let unitTestNode: vscode.Uri;
  const workspaceFolder = await getWorkspaceFolder(context);
  const projectPath = await tryGetLogicAppProjectRoot(context, workspaceFolder);

  if (node && node instanceof vscode.Uri) {
    unitTestNode = getWorkflowNode(node) as vscode.Uri;
  } else if (node && !(node instanceof vscode.Uri) && node.uri instanceof vscode.Uri) {
    unitTestNode = node.uri;
  } else {
    const unitTest = await pickUnitTest(context, path.join(projectPath, developmentDirectoryName, testsDirectoryName));
    unitTestNode = vscode.Uri.file(unitTest.data) as vscode.Uri;
  }

  const workflowName = path.basename(path.dirname(unitTestNode.fsPath));
  const workflowPath = path.join(projectPath, workflowName, workflowFileName);
  const workflowNode = vscode.Uri.file(workflowPath);
  const unitTestDefinition = JSON.parse(readFileSync(unitTestNode.fsPath, 'utf8'));
  const unitTestName = getUnitTestName(unitTestNode.fsPath);

  const openDesignerObj = new OpenDesignerForLocalProject(context, workflowNode, unitTestName, unitTestDefinition);
  await openDesignerObj?.createPanel();
}
