import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import type { IAzureDeploymentScriptsContext } from '../generateDeploymentScripts';
import { localize } from '../../../../localize';

export class InfrastructureFormatStep extends AzureWizardPromptStep<IAzureDeploymentScriptsContext> {
  public hideStepCount = true;

  public shouldPrompt(): boolean {
    return true;
  }

  public async prompt(context: IAzureDeploymentScriptsContext): Promise<void> {
    const picks: IAzureQuickPickItem<'Arm' | 'Bicep'>[] = [
      {
        label: localize('armInfrastructureFormat', 'ARM'),
        description: localize('armInfrastructureArtifacts', 'Existing ARM templates and Azure DevOps pipeline artifacts'),
        data: 'Arm',
      },
      {
        label: localize('bicepInfrastructureFormat', 'Bicep'),
        description: localize(
          'bicepInfrastructureArtifacts',
          'Infrastructure pipeline only; initial export values can be retargeted with pipeline variables'
        ),
        data: 'Bicep',
      },
    ];
    const format = (
      await context.ui.showQuickPick(picks, {
        placeHolder: localize('selectInfrastructureFormat', 'Select infrastructure format for the Azure DevOps pipeline'),
      })
    ).data;
    context.infrastructureFormat = format;
    context.telemetry.properties.infrastructureFormat = format;
  }
}
