import { describe, expect, it, vi } from 'vitest';
import { ResourceGroupListStep } from '@microsoft/vscode-azext-azureutils';
import { ExistingResourceGroupStep, SubscriptionAndResourceGroupStep } from '../SubscriptionAndResourceGroupStep';
import type { IAzureDeploymentScriptsContext } from '../../generateDeploymentScripts';
import { ext } from '../../../../../extensionVariables';

vi.mock('@microsoft/vscode-azext-azureutils', () => ({
  ResourceGroupListStep: Object.assign(vi.fn(), { getResourceGroups: vi.fn() }),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({ AzureWizardPromptStep: class {} }));

describe('subscription and resource-group export selection', () => {
  it.each(['environment', 'credentials', 'createCredentialsForScopes'] as const)(
    'does not let a saved subscription ID suppress account resolution when %s is missing',
    async (missing) => {
      const context = {
        infrastructureFormat: 'Bicep',
        subscriptionId: 'saved-subscription',
        environment: { resourceManagerEndpointUrl: 'https://management.usgovcloudapi.net/' },
        credentials: { getToken: vi.fn() },
        createCredentialsForScopes: vi.fn(),
      };
      delete context[missing];
      ext.azureAccountTreeItem = {
        getSubscriptionPromptStep: vi.fn(async (wizardContext) => {
          expect(wizardContext.subscriptionId).toBeUndefined();
          return undefined;
        }),
      } as typeof ext.azureAccountTreeItem;
      await new SubscriptionAndResourceGroupStep().getSubWizard(context as IAzureDeploymentScriptsContext);
      expect(ext.azureAccountTreeItem.getSubscriptionPromptStep).toHaveBeenCalledOnce();
    }
  );

  it.each(['Bicep', 'Terraform', 'Arm', undefined] as const)('preserves a hydrated subscription context for %s', async (format) => {
    const context = {
      infrastructureFormat: format,
      subscriptionId: 'selected-subscription',
      environment: { resourceManagerEndpointUrl: 'https://management.usgovcloudapi.net/' },
      credentials: { getToken: vi.fn() },
      createCredentialsForScopes: vi.fn(),
    };
    ext.azureAccountTreeItem = {
      getSubscriptionPromptStep: vi.fn().mockResolvedValue(undefined),
    } as typeof ext.azureAccountTreeItem;
    await new SubscriptionAndResourceGroupStep().getSubWizard(context as IAzureDeploymentScriptsContext);
    expect(context.subscriptionId).toBe('selected-subscription');
    expect(ext.azureAccountTreeItem.getSubscriptionPromptStep).toHaveBeenCalledWith(context);
  });

  it.each(['Arm', undefined] as const)('does not change legacy %s saved defaults', async (format) => {
    const context = { infrastructureFormat: format, subscriptionId: 'saved-subscription' } as IAzureDeploymentScriptsContext;
    ext.azureAccountTreeItem = {
      getSubscriptionPromptStep: vi.fn().mockResolvedValue(undefined),
    } as typeof ext.azureAccountTreeItem;
    await new SubscriptionAndResourceGroupStep().getSubWizard(context);
    expect(context.subscriptionId).toBe('saved-subscription');
  });

  it('propagates account resolution errors without attempting resource lookup', async () => {
    const error = new Error('Azure account is unavailable');
    const getResourceGroups = vi.mocked(ResourceGroupListStep.getResourceGroups);
    getResourceGroups.mockClear();
    ext.azureAccountTreeItem = {
      getSubscriptionPromptStep: vi.fn().mockRejectedValue(error),
    } as typeof ext.azureAccountTreeItem;
    await expect(
      new SubscriptionAndResourceGroupStep().getSubWizard({
        infrastructureFormat: 'Bicep',
        subscriptionId: 'saved-subscription',
      } as IAzureDeploymentScriptsContext)
    ).rejects.toBe(error);
    expect(getResourceGroups).not.toHaveBeenCalled();
  });

  it.each(['Bicep', 'Terraform', 'Arm', undefined] as const)('suppresses resource creation only for native %s', async (format) => {
    vi.mocked(ResourceGroupListStep).mockClear();
    ext.azureAccountTreeItem = {
      getSubscriptionPromptStep: vi.fn().mockResolvedValue(undefined),
    } as typeof ext.azureAccountTreeItem;
    const step = new SubscriptionAndResourceGroupStep();
    const wizard = await step.getSubWizard({ infrastructureFormat: format } as IAzureDeploymentScriptsContext);
    if (format === 'Bicep' || format === 'Terraform') {
      expect(ResourceGroupListStep).not.toHaveBeenCalled();
      expect(wizard.promptSteps[0]).toBeInstanceOf(ExistingResourceGroupStep);
    } else {
      expect(ResourceGroupListStep).toHaveBeenCalledWith();
    }
    expect(wizard.executeSteps).toBeUndefined();
    expect(wizard.promptSteps).toHaveLength(1);
  });

  it.each(['Bicep', 'Terraform'] as const)('only offers existing groups for %s and cannot schedule resource creation', async (format) => {
    const group = { name: 'existing', location: 'eastus' };
    vi.mocked(ResourceGroupListStep.getResourceGroups).mockResolvedValue([group]);
    const showQuickPick = vi.fn().mockResolvedValue({ data: group });
    const context = { infrastructureFormat: format, ui: { showQuickPick } } as unknown as IAzureDeploymentScriptsContext;
    await new ExistingResourceGroupStep().prompt(context);
    expect(showQuickPick.mock.calls[0][0]).toEqual([{ label: 'existing', description: 'eastus', data: group }]);
    expect(context.resourceGroup).toEqual(group);
    expect(showQuickPick.mock.calls[0][1].placeHolder).toContain(
      format === 'Bicep' ? 'initial export values; pipeline variables control deployment' : 'existing target resource group'
    );
  });

  it('fails explicitly when the selected subscription has no existing resource groups', async () => {
    vi.mocked(ResourceGroupListStep.getResourceGroups).mockResolvedValue([]);
    await expect(new ExistingResourceGroupStep().prompt({} as IAzureDeploymentScriptsContext)).rejects.toThrow(
      'Create the target group separately'
    );
  });
});
