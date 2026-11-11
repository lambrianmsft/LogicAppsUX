import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { AzureWizard, IWizardOptions } from '@microsoft/vscode-azext-utils';
import { DeploymentScriptType, DeploymentTargetType } from '@microsoft/vscode-extension-logic-apps';
import type { IAzureDeploymentScriptsContext } from '../../generateDeploymentScripts';
import { DeploymentScriptTypeStep } from '../DeploymentScriptTypeStep';
import { ConnectedEnvironmentStep } from '../adoDeploymentScriptsSteps/ConnectedEnvironmentStep';

const generated = vi.hoisted(() => ({ ado: vi.fn(), deploymentCenter: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
  AzureWizardPromptStep: class {
    public reset(): void {
      Object.assign(this, { hasSubWizard: false, numSubPromptSteps: 0, numSubExecuteSteps: 0, prompted: false });
    }
  },
  AzureWizardExecuteStep: class {},
}));
vi.mock('../adoDeploymentScriptsSteps/GenerateADODeploymentScriptsStep', () => ({
  GenerateADODeploymentScriptsStep: class {
    public priority = 250;
    public options = {};
    public shouldExecute(): boolean {
      return true;
    }
    public execute = generated.ado;
  },
}));
vi.mock('../deploymentCenterScriptsSteps/GenerateDeploymentCenterScriptsStep', () => ({
  GenerateDeploymentCenterScriptsStep: class {
    public priority = 250;
    public options = {};
    public shouldExecute(): boolean {
      return true;
    }
    public execute = generated.deploymentCenter;
  },
}));
vi.mock('../deploymentCenterScriptsSteps/LogicAppStep', () => ({ LogicAppStep: class {} }));
vi.mock('../deploymentCenterScriptsSteps/LogicAppMSIStep', () => ({ LogicAppMSIStep: class {} }));
vi.mock('../SubscriptionAndResourceGroupStep', () => ({
  SubscriptionAndResourceGroupStep: class {
    public reset(): void {
      Object.assign(this, { hasSubWizard: false, prompted: false });
    }
    public shouldPrompt(): boolean {
      return true;
    }
    public async prompt(context: IAzureDeploymentScriptsContext): Promise<void> {
      context.resourceGroup = (await context.ui.showQuickPick([{ label: 'group', data: { name: 'group', location: 'eastus' } }])).data;
    }
  },
}));
vi.mock('../../../../utils/azureClients', () => ({ createContainerClient: vi.fn() }));

type Choice = { at: string; data?: string; back?: number; cancel?: boolean };

// Use the installed wizard's prompt/Back/subwizard-removal implementation; only external UI/services are replaced.
async function createWizard(choices: Choice[]) {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const source = path.join(path.dirname(require.resolve('@microsoft/vscode-azext-utils')), 'wizard', 'AzureWizard.js');
  const exports: { AzureWizard?: typeof AzureWizard } = {};
  class CancellationTokenSource {
    public token = { isCancellationRequested: false };
    public cancel(): void {
      this.token.isCancellationRequested = true;
    }
    public dispose(): void {}
  }
  runInNewContext(readFileSync(source, 'utf8'), {
    exports,
    require: (id: string) => {
      switch (id) {
        case 'util':
          return require('util');
        case 'vscode':
          return {
            CancellationTokenSource,
            l10n: { t: (value: string) => value },
            ProgressLocation: { Notification: 15 },
            Disposable: { from: () => ({ dispose() {} }) },
          };
        case '../errors':
          return { UserCancelledError: Error, GoBackError: Error };
        case '../parseError':
          return { parseError: (error: unknown) => error };
        case '../userInput/showQuickPick':
          return { createQuickPick: () => undefined };
        case '../extensionVariables':
          return { ext: {} };
        default:
          return {};
      }
    },
  });
  let onFinish: (result: { value: string; matchesDefault: boolean }) => void;
  const visited: string[] = [];
  let wizard: AzureWizard<IAzureDeploymentScriptsContext>;
  const choose = async () => {
    const choice = choices.shift();
    expect(choice, `Unexpected prompt ${wizard.currentStepId}`).toBeDefined();
    expect(wizard.currentStepId).toBe(choice.at);
    visited.push(choice.at);
    if (choice.back) {
      throw { errorType: 'GoBackError', numberOfStepsToGoBack: choice.back };
    }
    if (choice.cancel) {
      throw new Error('Cancelled');
    }
    onFinish({ value: choice.data, matchesDefault: false });
    return choice.data;
  };
  const context = {
    telemetry: { properties: {}, measurements: {} },
    infrastructureFormat: 'Bicep',
    deploymentTarget: DeploymentTargetType.hybrid,
    connectedEnvironmentName: 'stale-environment',
    connectedEnvironmentResourceGroup: 'stale-group',
    suppressNotification: true,
    ui: {
      onDidFinishPrompt: (listener: typeof onFinish) => {
        onFinish = listener;
        return { dispose() {} };
      },
      showQuickPick: async (picks: { data: unknown }[]) => {
        const data = await choose();
        return picks.find((pick) => typeof pick.data === 'object' || pick.data === data);
      },
      showInputBox: choose,
    },
  } as IAzureDeploymentScriptsContext;
  wizard = new exports.AzureWizard(context, {
    promptSteps: [new DeploymentScriptTypeStep()],
  } satisfies IWizardOptions<IAzureDeploymentScriptsContext>);
  return { wizard, context, visited };
}

const startStandard: Choice[] = [
  { at: 'DeploymentScriptTypeStep', data: DeploymentScriptType.azureDevOpsPipeline },
  { at: 'DeploymentTargetStep', data: DeploymentTargetType.standard },
];
const hostInputs: Choice[] = [
  { at: 'SubscriptionAndResourceGroupStep' },
  { at: 'StorageAccountNameStep', data: 'storage' },
  { at: 'AppServicePlanNameStep', data: 'plan' },
  { at: 'LogicAppNameStep', data: 'app' },
];
beforeEach(() => {
  vi.clearAllMocks();
});

describe('shared Azure DevOps wizard lifecycle', () => {
  it.each(['Arm', 'Bicep'] as const)('uses the same ADO assembly for Standard %s', async (format) => {
    const choices = [...startStandard, { at: 'InfrastructureFormatStep', data: format }, ...hostInputs];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe(format);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).toEqual([
      ...startStandard.map((choice) => choice.at),
      'InfrastructureFormatStep',
      ...hostInputs.map((choice) => choice.at),
    ]);
    expect(context.connectedEnvironmentName).toBeUndefined();
    expect(generated.ado).toHaveBeenCalledOnce();
    expect(generated.deploymentCenter).not.toHaveBeenCalled();
  });

  it.each([
    ['Bicep', 'Arm'],
    ['Arm', 'Bicep'],
  ] as const)('backs from %s into the format picker and switches to %s without a workspace prompt', async (initialFormat, format) => {
    const choices: Choice[] = [
      ...startStandard,
      { at: 'InfrastructureFormatStep', data: initialFormat },
      { at: 'SubscriptionAndResourceGroupStep', back: 1 },
      { at: 'InfrastructureFormatStep', data: format },
      ...hostInputs,
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe(format);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(context.telemetry.properties.infrastructureFormat).toBe(format);
    expect(visited).not.toContain('WorkspaceResourceIdStep');
    expect(generated.ado).toHaveBeenCalledOnce();
  });

  it.each(['Arm', 'Bicep'])('removes the Standard %s subwizard when backing to target selection and choosing Hybrid', async (format) => {
    vi.spyOn(ConnectedEnvironmentStep.prototype, 'prompt').mockImplementation(async (context) => {
      context.connectedEnvironmentName = await context.ui.showInputBox({ prompt: 'environment' });
    });
    const choices: Choice[] = [
      ...startStandard,
      { at: 'InfrastructureFormatStep', data: format },
      { at: 'SubscriptionAndResourceGroupStep', back: 2 },
      { at: 'DeploymentTargetStep', data: DeploymentTargetType.hybrid },
      { at: 'SubscriptionAndResourceGroupStep' },
      { at: 'ConnectedEnvironmentStep', data: 'environment' },
      { at: 'LogicAppNameStep', data: 'app' },
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe('Arm');
    expect(context.deploymentTarget).toBe(DeploymentTargetType.hybrid);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).not.toContain('StorageAccountNameStep');
    expect(visited).not.toContain('WorkspaceResourceIdStep');
    expect(generated.ado).toHaveBeenCalledOnce();
  });

  it.each(['Arm', 'Bicep'])('can cancel after backing into %s format selection without executing an abandoned branch', async (format) => {
    const choices: Choice[] = [
      ...startStandard,
      { at: 'InfrastructureFormatStep', data: format },
      { at: 'SubscriptionAndResourceGroupStep', back: 1 },
      { at: 'InfrastructureFormatStep', cancel: true },
    ];
    const { wizard, visited } = await createWizard(choices);
    await expect(wizard.prompt()).rejects.toThrow('Cancelled');
    expect(choices).toHaveLength(0);
    expect(visited).not.toContain('WorkspaceResourceIdStep');
    expect(generated.ado).not.toHaveBeenCalled();
    expect(generated.deploymentCenter).not.toHaveBeenCalled();
  });

  it.each(['Arm', 'Bicep'])('backs out of Hybrid into Standard %s without keeping the Hybrid branch', async (format) => {
    vi.spyOn(ConnectedEnvironmentStep.prototype, 'prompt').mockImplementation(async (context) => {
      context.connectedEnvironmentName = await context.ui.showInputBox({ prompt: 'environment' });
    });
    const choices: Choice[] = [
      { at: 'DeploymentScriptTypeStep', data: DeploymentScriptType.azureDevOpsPipeline },
      { at: 'DeploymentTargetStep', data: DeploymentTargetType.hybrid },
      { at: 'SubscriptionAndResourceGroupStep' },
      { at: 'ConnectedEnvironmentStep', back: 2 },
      { at: 'DeploymentTargetStep', data: DeploymentTargetType.standard },
      { at: 'InfrastructureFormatStep', data: format },
      ...hostInputs,
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe(format);
    expect(context.deploymentTarget).toBe(DeploymentTargetType.standard);
    expect(context.connectedEnvironmentName).toBeUndefined();
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).not.toContain('WorkspaceResourceIdStep');
    expect(generated.ado).toHaveBeenCalledOnce();
  });

  it('retains the independent Terraform export-only prompt sequence', async () => {
    const choices: Choice[] = [{ at: 'DeploymentScriptTypeStep', data: 'Terraform' }, ...hostInputs];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe('Terraform');
    expect(context.deploymentTarget).toBe(DeploymentTargetType.standard);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).toEqual(['DeploymentScriptTypeStep', ...hostInputs.map((choice) => choice.at)]);
    expect(visited).not.toContain('InfrastructureFormatStep');
    expect(visited).not.toContain('DeploymentTargetStep');
    expect(generated.ado).toHaveBeenCalledOnce();
  });

  it.each(['Arm', 'Bicep'])('can back from Terraform to ADO %s without retaining its old subwizard', async (format) => {
    const choices: Choice[] = [
      { at: 'DeploymentScriptTypeStep', data: 'Terraform' },
      { at: 'SubscriptionAndResourceGroupStep', back: 1 },
      ...startStandard,
      { at: 'InfrastructureFormatStep', data: format },
      ...hostInputs,
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe(format);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(context.telemetry.properties.infrastructureFormat).toBe(format);
    expect(visited.filter((step) => step === 'LogicAppNameStep')).toHaveLength(1);
    expect(visited).not.toContain('WorkspaceResourceIdStep');
    expect(generated.ado).toHaveBeenCalledOnce();
  });

  it.each(['Arm', 'Bicep'])('can back from ADO %s to Terraform without retaining ADO-only prompts', async (format) => {
    const choices: Choice[] = [
      ...startStandard,
      { at: 'InfrastructureFormatStep', data: format },
      { at: 'SubscriptionAndResourceGroupStep', back: 3 },
      { at: 'DeploymentScriptTypeStep', data: 'Terraform' },
      ...hostInputs,
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await wizard.prompt();
    await wizard.execute();
    expect(choices).toHaveLength(0);
    expect(context.infrastructureFormat).toBe('Terraform');
    expect(context.deploymentTarget).toBe(DeploymentTargetType.standard);
    expect(context.telemetry.properties.infrastructureFormat).toBe('Terraform');
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).toEqual([
      ...startStandard.map((choice) => choice.at),
      'InfrastructureFormatStep',
      'SubscriptionAndResourceGroupStep',
      'DeploymentScriptTypeStep',
      ...hostInputs.map((choice) => choice.at),
    ]);
    expect(generated.ado).toHaveBeenCalledOnce();
    expect(generated.deploymentCenter).not.toHaveBeenCalled();
  });

  it('can cancel after backing out of Terraform without prompting or executing the abandoned branch', async () => {
    const choices: Choice[] = [
      { at: 'DeploymentScriptTypeStep', data: 'Terraform' },
      { at: 'SubscriptionAndResourceGroupStep', back: 1 },
      { at: 'DeploymentScriptTypeStep', cancel: true },
    ];
    const { wizard, context, visited } = await createWizard(choices);
    await expect(wizard.prompt()).rejects.toThrow('Cancelled');
    expect(choices).toHaveLength(0);
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(visited).toEqual(['DeploymentScriptTypeStep', 'SubscriptionAndResourceGroupStep', 'DeploymentScriptTypeStep']);
    expect(generated.ado).not.toHaveBeenCalled();
    expect(generated.deploymentCenter).not.toHaveBeenCalled();
  });
});
