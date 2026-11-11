/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { localize } from '../../../../localize';
import {
  type AzureWizardExecuteStep,
  AzureWizardPromptStep,
  type IWizardOptions,
  type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import { DeploymentScriptType } from '@microsoft/vscode-extension-logic-apps';
import type { IAzureDeploymentScriptsContext } from '../generateDeploymentScripts';
import { GenerateADODeploymentScriptsStep } from './adoDeploymentScriptsSteps/GenerateADODeploymentScriptsStep';
import { GenerateDeploymentCenterScriptsStep } from './deploymentCenterScriptsSteps/GenerateDeploymentCenterScriptsStep';
import * as path from 'path';
import { SubscriptionAndResourceGroupStep } from './SubscriptionAndResourceGroupStep';
import { LogicAppNameStep } from './adoDeploymentScriptsSteps/LogicAppNameStep';
import { LogicAppStep } from './deploymentCenterScriptsSteps/LogicAppStep';
import { LogicAppMSIStep } from './deploymentCenterScriptsSteps/LogicAppMSIStep';
import { DeploymentTargetStep } from './DeploymentTargetStep';
import { DeploymentTargetType } from '@microsoft/vscode-extension-logic-apps';
import { StorageAccountNameStep } from './adoDeploymentScriptsSteps/StorageAccountNameStep';
import { AppServicePlanNameStep } from './adoDeploymentScriptsSteps/AppServicePlanNameStep';

export class DeploymentScriptTypeStep extends AzureWizardPromptStep<IAzureDeploymentScriptsContext> {
  public hideStepCount = true;

  public shouldPrompt(): boolean {
    return true;
  }

  /**
   * Prompts the user for a deployment script type.
   * @param context - The Azure deployment scripts context.
   */
  public async prompt(context: IAzureDeploymentScriptsContext): Promise<void> {
    context.telemetry.properties.lastStep = 'DeploymentScriptTypeStep';
    const placeHolder = localize('setDeploymentScriptType', 'Select deployment artifacts');
    const picks: IAzureQuickPickItem<DeploymentScriptType | 'Terraform'>[] = [
      {
        label: localize('azureDevOpsPipeline', 'Azure DevOps Pipeline'),
        description: localize('adoInfrastructureFormats', 'ARM or Bicep for Standard; ARM for Hybrid'),
        data: DeploymentScriptType.azureDevOpsPipeline,
      },
      { label: localize('azureDeploymentCenter', 'Azure Deployment Center'), data: DeploymentScriptType.azureDeploymentCenter },
      { label: localize('terraformInfrastructure', 'Terraform infrastructure only (Standard / App Service)'), data: 'Terraform' },
    ];
    const selected = (await context.ui.showQuickPick(picks, { placeHolder })).data;
    context.deploymentTarget = undefined;
    context.connectedEnvironmentName = undefined;
    context.connectedEnvironmentResourceGroup = undefined;
    context.telemetry.properties.deploymentTarget = undefined;
    context.telemetry.properties.infrastructureFormat = undefined;
    context.telemetry.properties.connectedEnvironmentName = undefined;
    if (selected === 'Terraform') {
      context.infrastructureFormat = selected;
      context.deploymentScriptType = DeploymentScriptType.azureDevOpsPipeline;
    } else {
      context.infrastructureFormat = undefined;
      context.deploymentScriptType = selected;
    }
  }

  /**
   * Appends prompt and execute steps based on the selected deployment script type.
   * @param context - The Azure deployment scripts context.
   */
  public async getSubWizard(context: IAzureDeploymentScriptsContext): Promise<IWizardOptions<IAzureDeploymentScriptsContext>> {
    let promptSteps: AzureWizardPromptStep<IAzureDeploymentScriptsContext>[] = [];
    let executeSteps: AzureWizardExecuteStep<IAzureDeploymentScriptsContext>[] = [];
    if (context.infrastructureFormat === 'Terraform') {
      context.deploymentTarget = DeploymentTargetType.standard;
      context.telemetry.properties.infrastructureFormat = context.infrastructureFormat;
      return {
        promptSteps: [
          new SubscriptionAndResourceGroupStep(),
          new StorageAccountNameStep(),
          new AppServicePlanNameStep(),
          new LogicAppNameStep(),
        ],
        executeSteps: [new GenerateADODeploymentScriptsStep()],
      };
    }
    if (context.deploymentScriptType === DeploymentScriptType.azureDevOpsPipeline) {
      context.telemetry.properties.deploymentScriptType = 'azureDevOpsPipeline';
      promptSteps = [new DeploymentTargetStep(), new LogicAppNameStep()];
      executeSteps = [new GenerateADODeploymentScriptsStep()];
    } else {
      context.telemetry.properties.deploymentScriptType = 'azureDeploymentCenter';
      context.localLogicAppName = path.basename(context.projectPath);
      promptSteps = [new SubscriptionAndResourceGroupStep(), new LogicAppStep(), new LogicAppMSIStep()];
      executeSteps = [new GenerateDeploymentCenterScriptsStep()];
    }

    return { promptSteps, executeSteps };
  }
}
