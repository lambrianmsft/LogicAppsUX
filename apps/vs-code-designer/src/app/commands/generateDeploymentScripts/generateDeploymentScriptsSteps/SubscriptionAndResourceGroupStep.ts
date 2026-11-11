import { AzureWizardPromptStep, type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import type { IAzureDeploymentScriptsContext } from '../generateDeploymentScripts';
import { ext } from '../../../../extensionVariables';
import { ResourceGroupListStep } from '@microsoft/vscode-azext-azureutils';
import { isNativeInfrastructureFormat } from '../nativeInfrastructureExport';
import { localize } from '../../../../localize';

export class ExistingResourceGroupStep extends AzureWizardPromptStep<IAzureDeploymentScriptsContext> {
  public shouldPrompt(): boolean {
    return true;
  }

  public async prompt(context: IAzureDeploymentScriptsContext): Promise<void> {
    context.resourceGroupsTask = undefined;
    const groups = await ResourceGroupListStep.getResourceGroups(context);
    if (!groups.length) {
      throw new Error(
        localize(
          'nativeExistingResourceGroupRequired',
          'Native infrastructure export requires an existing resource group in the selected subscription. Create the target group separately, then retry export.'
        )
      );
    }
    context.resourceGroup = (
      await context.ui.showQuickPick(
        groups.map((group) => ({ label: group.name, description: group.location, data: group })),
        {
          placeHolder:
            context.infrastructureFormat === 'Bicep'
              ? localize(
                  'bicepInitialResourceGroup',
                  'Select an existing resource group for initial export values; pipeline variables control deployment (no resources will be created)'
                )
              : localize('nativeExistingResourceGroup', 'Select an existing target resource group (no resources will be created)'),
        }
      )
    ).data;
  }
}

export class SubscriptionAndResourceGroupStep extends AzureWizardPromptStep<IAzureDeploymentScriptsContext> {
  public hideStepCount = true;

  public shouldPrompt(): boolean {
    return true;
  }

  public async prompt(context: IAzureDeploymentScriptsContext): Promise<void> {
    context.telemetry.properties.lastStep = 'SubscriptionAndResourceGroupStep';
    // No prompt needed for this step
  }

  public async getSubWizard(context: IAzureDeploymentScriptsContext): Promise<IWizardOptions<IAzureDeploymentScriptsContext>> {
    // A saved subscription ID is not an authenticated account context. Otherwise the account prompt skips hydration.
    if (
      isNativeInfrastructureFormat(context.infrastructureFormat) &&
      (!context.environment || !context.credentials || !context.createCredentialsForScopes)
    ) {
      context.subscriptionId = undefined;
    }
    const promptSteps: AzureWizardPromptStep<IActionContext>[] = [];
    const subscriptionPromptStep: AzureWizardPromptStep<IActionContext> | undefined =
      await ext.azureAccountTreeItem.getSubscriptionPromptStep(context);
    if (subscriptionPromptStep) {
      promptSteps.push(subscriptionPromptStep);
    }

    // The dependency's public types omit its runtime suppressCreate constructor option.
    // Use an existing-only picker that cannot register resource-creation execute steps.
    promptSteps.push(
      isNativeInfrastructureFormat(context.infrastructureFormat) ? new ExistingResourceGroupStep() : new ResourceGroupListStep()
    );
    return { promptSteps, showLoadingPrompt: true };
  }
}
