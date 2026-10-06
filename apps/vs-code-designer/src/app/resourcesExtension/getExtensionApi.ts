/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { localize } from '../../localize';
import { apiUtils } from '@microsoft/vscode-azext-utils';
import type { AzureHostExtensionApi } from '@microsoft/vscode-azext-utils/hostapi';
import { getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import type { ExtensionContext } from 'vscode';
import type { AzureAccountTreeItemWithProjects } from '../tree/AzureAccountTreeItemWithProjects';
import { ext } from '../../extensionVariables';

export async function initializeResourceGroupsApi(context: ExtensionContext): Promise<void> {
  const rgApi = await getResourceGroupsApi();
  const tree = rgApi.appResourceTree;
  const root: unknown = tree && '_rootTreeItem' in tree ? tree._rootTreeItem : undefined;
  if (!root || typeof root !== 'object' || !('getSubscriptionPromptStep' in root) || typeof root.getSubscriptionPromptStep !== 'function') {
    throw new Error(
      localize(
        'incompatibleResourceGroupExt',
        'Azure Resources did not provide its subscription picker API. Enable or update the Azure Resources extension, then reload this window.'
      )
    );
  }
  const rgApiV2 = await getAzureResourcesExtensionApi(context, '2.0.0');
  ext.rgApi = rgApi;
  ext.rgApiV2 = rgApiV2;
  ext.azureAccountTreeItem = root as AzureAccountTreeItemWithProjects;
}

export async function getResourceGroupsApi(): Promise<AzureHostExtensionApi> {
  const rgApiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>('ms-azuretools.vscode-azureresourcegroups');
  if (rgApiProvider) {
    return rgApiProvider.getApi<AzureHostExtensionApi>('^0.0.1');
  }
  throw new Error(localize('noResourceGroupExt', 'Could not find the Azure Resource Groups extension'));
}
