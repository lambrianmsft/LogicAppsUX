/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { RemoteWorkflowTreeItem } from '../../../tree/remoteWorkflowsTree/RemoteWorkflowTreeItem';
import { getWorkflowNode } from '../../../utils/workspace';
import type { IAzureConnectorsContext } from '../azureConnectorWizard';
import { OpenDesignerForAzureResource } from './openDesignerForAzureResource';
import OpenDesignerForLocalProject from './openDesignerForLocalProject';
import { Uri } from 'vscode';
import { tryBuildCustomCodeFunctionsProject } from '../../buildCustomCodeFunctionsProject';
import { customCodeArtifactsExist } from '../../../utils/customCodeUtils';

/**
 * Options for opening the designer with specific initial state
 */
export interface OpenDesignerOptions {
  /** Whether to automatically show the connections panel after opening */
  showConnectionsPanel?: boolean;
  /** Node IDs with pending connections that need user configuration */
  pendingConnectionNodeIds?: string[];
}

/**
 * Opens the designer for a workflow. This is the command handler registered with VS Code.
 * For programmatic usage with options, use openDesignerWithOptions instead.
 */
export async function openDesigner(context: IAzureConnectorsContext, node: Uri | RemoteWorkflowTreeItem | undefined): Promise<void> {
  return openDesignerInternal(context, node);
}

/**
 * Opens the designer for a workflow with optional configuration.
 * Use this function when you need to pass options like pendingConnectionNodeIds.
 */
export async function openDesignerWithOptions(
  context: IAzureConnectorsContext,
  node: Uri | RemoteWorkflowTreeItem | undefined,
  options?: OpenDesignerOptions
): Promise<void> {
  return openDesignerInternal(context, node, options);
}

async function openDesignerInternal(
  context: IAzureConnectorsContext,
  node: Uri | RemoteWorkflowTreeItem | undefined,
  options?: OpenDesignerOptions
): Promise<void> {
  let openDesignerObj: OpenDesignerForLocalProject | OpenDesignerForAzureResource;

  const workflowNode = getWorkflowNode(node);

  if (workflowNode instanceof Uri) {
    const logicAppNode = Uri.file(path.join(workflowNode.fsPath, '../../'));
    // Only build custom code projects on open designer if custom code binaries don't already exist in the logic app folder
    if (!(await customCodeArtifactsExist(logicAppNode.fsPath))) {
      await tryBuildCustomCodeFunctionsProject(context, logicAppNode);
    }

    openDesignerObj = new OpenDesignerForLocalProject(context, workflowNode, undefined, undefined, undefined, options);
  } else if (workflowNode instanceof RemoteWorkflowTreeItem) {
    openDesignerObj = new OpenDesignerForAzureResource(context, workflowNode);
  }

  await openDesignerObj?.createPanel();
}
