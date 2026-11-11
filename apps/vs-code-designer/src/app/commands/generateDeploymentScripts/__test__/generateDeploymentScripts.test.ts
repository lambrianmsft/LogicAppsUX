import { describe, expect, beforeEach, vi, it, Mock } from 'vitest';
import * as vscode from 'vscode';
import { generateDeploymentScripts } from '../generateDeploymentScripts';
import { IActionContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../localize';
import { addLocalFuncTelemetry } from '../../../utils/funcCoreTools/funcVersion';
import { ensureWorkspace } from '../../ensureWorkspace';
import { getWorkspaceFolder, isMultiRootWorkspace } from '../../../utils/workspace';
import { isLogicAppProject, tryGetLogicAppProjectRoot } from '../../../utils/verifyIsProject';
import { AzureWizard } from '@microsoft/vscode-azext-utils';
import { COMMON_ERRORS } from '../../../../constants';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import type { IAzureDeploymentScriptsContext } from '../generateDeploymentScripts';
import { SubscriptionAndResourceGroupStep } from '../generateDeploymentScriptsSteps/SubscriptionAndResourceGroupStep';
import { ResourceGroupListStep } from '@microsoft/vscode-azext-azureutils';
import { getLocalSettingsJson } from '../../../utils/appSettings/localSettings';
import { workflowSubscriptionIdKey, workflowResourceGroupNameKey, workflowLocationKey } from '../../../../constants';

vi.mock('@microsoft/vscode-azext-utils', () => ({
  AzureWizardExecuteStep: vi.fn().mockImplementation(() => {
    return {};
  }),
  AzureWizardPromptStep: class {},
  AzureWizard: vi.fn().mockImplementation(() => ({
    prompt: vi.fn(),
    execute: vi.fn(),
  })),
  nonNullProp: vi.fn(),
  nonNullValue: vi.fn(),
  callWithTelemetryAndErrorHandling: (_key: string, callback: Function) => {
    // Simply invoke the callback with a fake telemetry context.
    return callback({
      telemetry: { properties: {}, measurements: {} },
      errorHandling: { rethrow: false, suppressDisplay: false },
      valuesToMask: [],
    });
  },
  parseError: vi.fn(() => {
    return { message: 'error' };
  }),
  UserCancelledError: class UserCancelledError extends Error {
    constructor() {
      super(COMMON_ERRORS.OPERATION_CANCELLED);
    }
  },
  DialogResponses: vi.fn(),
  AzExtTreeItem: class AzExtTreeItem {},
  AzExtParentTreeItem: class AzExtParentTreeItem {},
}));

vi.mock('@microsoft/vscode-azext-azureutils', () => ({
  ResourceGroupListStep: Object.assign(vi.fn(), { getResourceGroups: vi.fn() }),
}));

vi.mock('../../../../localize', () => ({
  localize: vi.fn((key: string, message: string, ...args: string[]) => message.replace(/{(\d+)}/g, (_match, index) => args[index] || '')),
}));

vi.mock('../../../utils/funcCoreTools/funcVersion', () => ({
  addLocalFuncTelemetry: vi.fn(),
}));

vi.mock('../../ensureWorkspace', () => ({
  ensureWorkspace: vi.fn(),
}));

vi.mock('../../../utils/workspace', () => ({
  getWorkspaceFolder: vi.fn(),
  isMultiRootWorkspace: vi.fn(),
}));

vi.mock('../../../utils/verifyIsProject', () => ({
  tryGetLogicAppProjectRoot: vi.fn(),
  isLogicAppProject: vi.fn(),
}));

vi.mock('../../../utils/appSettings/localSettings', () => ({
  getLocalSettingsJson: vi.fn().mockResolvedValue({ Values: {} }),
}));

vi.mock('../generateDeploymentScriptsSteps/DeploymentScriptTypeStep', () => ({
  DeploymentScriptTypeStep: vi.fn(),
}));

describe('generateDeploymentScripts', () => {
  let context: IActionContext;
  let node: vscode.Uri;

  beforeEach(async () => {
    context = {
      telemetry: {
        properties: {},
      },
    } as IActionContext;
    node = { fsPath: 'testPath' } as vscode.Uri;

    (ext.outputChannel.appendLog as Mock).mockClear();
    (ext.outputChannel.show as Mock).mockClear();
    (addLocalFuncTelemetry as Mock).mockClear();
    (ensureWorkspace as Mock).mockResolvedValue(true);
    (isMultiRootWorkspace as Mock).mockReturnValue(true);
    (isLogicAppProject as Mock).mockResolvedValue(true);
    (getWorkspaceFolder as Mock).mockResolvedValue({} as vscode.WorkspaceFolder);
    (tryGetLogicAppProjectRoot as Mock).mockResolvedValue('projectRoot');
    const localSettingsMod = await import('../../../utils/appSettings/localSettings');
    vi.mocked(localSettingsMod.getLocalSettingsJson).mockResolvedValue({ Values: {} } as any);
    (AzureWizard as Mock).mockImplementation(() => ({
      prompt: vi.fn().mockResolvedValue({}),
      execute: vi.fn().mockResolvedValue({}),
    }));
    (localize as Mock).mockClear();
  });

  it('should execute deployment script generation successfully', async () => {
    await generateDeploymentScripts(context, node);

    expect(ext.outputChannel.show).toHaveBeenCalled();
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith('Starting deployment script generation...');
    expect(addLocalFuncTelemetry).toHaveBeenCalledWith(context);
    expect(ensureWorkspace).toHaveBeenCalledWith(expect.any(Object));
    expect(tryGetLogicAppProjectRoot).not.toHaveBeenCalled();
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith('Azure deployment scripts wizard executed successfully.');
  });

  it('should throw an error when project path is undefined', async () => {
    (isLogicAppProject as Mock).mockResolvedValue(false);
    (tryGetLogicAppProjectRoot as Mock).mockResolvedValue(undefined);

    await expect(generateDeploymentScripts(context, node)).rejects.toThrow('No Logic App project found.');

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining('No Logic App project found.'));
    expect(context.telemetry.properties.errorMessage).toBeDefined();
  });

  it('should handle errors during prompt steps', async () => {
    const errorMessage = 'Test prompt step error message';
    (AzureWizard as Mock).mockImplementation(() => ({
      prompt: vi.fn().mockRejectedValue(new Error(errorMessage)),
      execute: vi.fn(),
    }));

    await expect(generateDeploymentScripts(context, node)).rejects.toThrow(errorMessage);

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining(errorMessage));
    expect(context.telemetry.properties.errorMessage).toContain(errorMessage);
  });

  it('should handle errors during deployment script generation execute step', async () => {
    const errorMessage = 'Test execute step error message';
    (AzureWizard as Mock).mockImplementation(() => ({
      prompt: vi.fn(),
      execute: vi.fn().mockRejectedValue(new Error(errorMessage)),
    }));

    await expect(generateDeploymentScripts(context, node)).rejects.toThrow(errorMessage);

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining(errorMessage));
    expect(context.telemetry.properties.errorMessage).toContain(errorMessage);
  });

  it('should not throw error if operation is cancelled', async () => {
    (AzureWizard as Mock).mockImplementation(() => {
      return {
        prompt: vi.fn(),
        execute: vi.fn().mockRejectedValue(new UserCancelledError()),
      };
    });

    await generateDeploymentScripts(context, node);

    expect(context.telemetry.properties.result).toBe('Canceled');
    expect(context.telemetry.properties.errorMessage).toBeUndefined();
  });

  it('does not prepare a workspace or generate artifacts when a wizard picker is cancelled', async () => {
    const execute = vi.fn();
    (AzureWizard as Mock).mockImplementation(() => ({
      prompt: vi.fn().mockRejectedValue(new UserCancelledError()),
      execute,
    }));
    await generateDeploymentScripts(context, node);
    expect(context.telemetry.properties.result).toBe('Canceled');
    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('should use workspace folder if node is undefined', async () => {
    (ensureWorkspace as Mock).mockResolvedValue(true);
    (tryGetLogicAppProjectRoot as Mock).mockResolvedValue('workspaceRoot');

    await generateDeploymentScripts(context, undefined);

    expect(getWorkspaceFolder).toHaveBeenCalledWith(context);
    expect(tryGetLogicAppProjectRoot).toHaveBeenCalled();
  });

  it('does not execute legacy generation when workspace setup is declined', async () => {
    (ensureWorkspace as Mock).mockResolvedValue(false);
    const execute = vi.fn();
    (AzureWizard as Mock).mockImplementation(() => ({ prompt: vi.fn(), execute }));

    await generateDeploymentScripts(context, node);

    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith('Exiting deployment script generation...');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['Bicep', 'Terraform'])('does not create or convert a workspace for native %s export', async (format) => {
    const execute = vi.fn();
    (AzureWizard as Mock).mockImplementation((wizardContext) => ({
      prompt: vi.fn(async () => {
        wizardContext.infrastructureFormat = format;
      }),
      execute,
    }));
    await generateDeploymentScripts(context, node);
    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it.each([
    ['Bicep', 1],
    ['Bicep', 2],
    ['Terraform', 1],
    ['Terraform', 2],
  ] as const)(
    'hydrates the account before %s resource lookup with saved defaults and %s available subscriptions',
    async (format, subscriptionCount) => {
      // Exercise the installed account provider's single/multiple-subscription behavior, without loading VS Code or signing in.
      const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
      const require = createRequire(path.join(process.cwd(), 'package.json'));
      const source = path.join(path.dirname(require.resolve('@microsoft/vscode-azext-azureutils')), 'tree', 'AzureAccountTreeItemBase.js');
      const exports: {
        AzureAccountTreeItemBase?: {
          prototype: {
            getSubscriptionPromptStep(context: IActionContext): Promise<AzureWizardPromptStep<IActionContext> | undefined>;
          };
        };
      } = {};
      runInNewContext(readFileSync(source, 'utf8'), {
        exports,
        require: (id: string) => {
          switch (id) {
            case '@microsoft/vscode-azext-utils':
              return { AzExtParentTreeItem: class {}, AzureWizardPromptStep: class {} };
            case 'vscode':
              return { l10n: { t: (value: string) => value } };
            case './SubscriptionTreeItemBase':
              return { SubscriptionTreeItemBase: { contextValue: 'subscription' } };
            case 'semver':
            case './IconPath':
              return {};
            default:
              throw new Error(`Unexpected account dependency: ${id}`);
          }
        },
      });
      const subscription = {
        subscriptionId: 'selected-subscription',
        tenantId: 'selected-tenant',
        environment: { resourceManagerEndpointUrl: 'https://management.usgovcloudapi.net/' },
        credentials: { getToken: vi.fn() },
        createCredentialsForScopes: vi.fn(),
      };
      const selectedGroup = { name: 'selected-group', location: 'usgovvirginia' };
      const picker = vi.fn().mockResolvedValue({ subscription });
      const account = {
        ensureSubscriptionTreeItems: vi
          .fn()
          .mockResolvedValue([{ subscription }, { subscription: { subscriptionId: 'another' } }].slice(0, subscriptionCount)),
        treeDataProvider: { showTreeItemPicker: picker },
      };
      ext.azureAccountTreeItem = {
        getSubscriptionPromptStep: (wizardContext) =>
          exports.AzureAccountTreeItemBase.prototype.getSubscriptionPromptStep.call(account, wizardContext),
      } as typeof ext.azureAccountTreeItem;
      vi.mocked(getLocalSettingsJson).mockResolvedValue({
        IsEncrypted: false,
        Values: {
          [workflowSubscriptionIdKey]: 'saved-subscription',
          [workflowResourceGroupNameKey]: 'saved-group',
          [workflowLocationKey]: 'saved-location',
        },
      });
      vi.mocked(ResourceGroupListStep.getResourceGroups).mockImplementation(async (wizardContext) => {
        expect(wizardContext.environment.resourceManagerEndpointUrl).toBe(subscription.environment.resourceManagerEndpointUrl);
        expect(wizardContext.credentials).toBe(subscription.credentials);
        expect(wizardContext.createCredentialsForScopes).toBe(subscription.createCredentialsForScopes);
        expect(wizardContext.subscriptionId).toBe(subscription.subscriptionId);
        expect(wizardContext.tenantId).toBe(subscription.tenantId);
        return [selectedGroup];
      });
      const execute = vi.fn();
      (AzureWizard as Mock).mockImplementation((wizardContext: IAzureDeploymentScriptsContext) => ({
        prompt: async () => {
          wizardContext.infrastructureFormat = format;
          wizardContext.ui = { showQuickPick: vi.fn().mockResolvedValue({ data: selectedGroup }) } as typeof wizardContext.ui;
          expect(wizardContext.subscriptionId).toBe('saved-subscription');
          expect(wizardContext.environment).toBeUndefined();
          const subWizard = await new SubscriptionAndResourceGroupStep().getSubWizard(wizardContext);
          for (const step of subWizard.promptSteps) {
            if (step.shouldPrompt(wizardContext)) {
              await step.prompt(wizardContext);
            }
          }
          expect(wizardContext.resourceGroup).toEqual(selectedGroup);
          expect(subWizard.executeSteps).toBeUndefined();
        },
        execute,
      }));

      await generateDeploymentScripts(context, node);

      expect(picker).toHaveBeenCalledTimes(subscriptionCount === 1 ? 0 : 1);
      expect(ResourceGroupListStep.getResourceGroups).toHaveBeenCalledWith(context);
      expect(ensureWorkspace).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
    }
  );
});
