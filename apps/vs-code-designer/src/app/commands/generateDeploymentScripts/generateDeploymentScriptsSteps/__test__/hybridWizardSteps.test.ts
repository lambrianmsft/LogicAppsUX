import { describe, it, expect, vi } from 'vitest';

// Override the global AzureWizardPromptStep mock: the test-setup version returns `{}`
// from its constructor, which throws away subclass prototype methods. Use real classes.
vi.mock('@microsoft/vscode-azext-utils', () => ({
  AzureWizardPromptStep: class {},
  AzureWizardExecuteStep: class {},
  AzureWizard: class {},
}));

// Sub-step modules pull in tree items / azureappservice / azureappsettings, which all do
// a CommonJS require('vscode') at module load. Stub them so the three SUTs load cleanly.
vi.mock('../adoDeploymentScriptsSteps/LogicAppNameStep', () => ({ LogicAppNameStep: class {} }));
vi.mock('../adoDeploymentScriptsSteps/StorageAccountNameStep', () => ({ StorageAccountNameStep: class {} }));
vi.mock('../adoDeploymentScriptsSteps/AppServicePlanNameStep', () => ({ AppServicePlanNameStep: class {} }));
vi.mock('../adoDeploymentScriptsSteps/GenerateADODeploymentScriptsStep', () => ({ GenerateADODeploymentScriptsStep: class {} }));
vi.mock('../deploymentCenterScriptsSteps/LogicAppStep', () => ({ LogicAppStep: class {} }));
vi.mock('../deploymentCenterScriptsSteps/LogicAppMSIStep', () => ({ LogicAppMSIStep: class {} }));
vi.mock('../deploymentCenterScriptsSteps/GenerateDeploymentCenterScriptsStep', () => ({ GenerateDeploymentCenterScriptsStep: class {} }));
vi.mock('../SubscriptionAndResourceGroupStep', () => ({ SubscriptionAndResourceGroupStep: class {} }));
vi.mock('../../../../utils/azureClients', () => ({ createContainerClient: vi.fn() }));

import { DeploymentScriptType, DeploymentTargetType } from '@microsoft/vscode-extension-logic-apps';
import { DeploymentScriptTypeStep } from '../DeploymentScriptTypeStep';
import { DeploymentTargetStep } from '../DeploymentTargetStep';
import { ConnectedEnvironmentStep } from '../adoDeploymentScriptsSteps/ConnectedEnvironmentStep';
import { InfrastructureFormatStep } from '../InfrastructureFormatStep';
import { SubscriptionAndResourceGroupStep } from '../SubscriptionAndResourceGroupStep';
import { LogicAppNameStep } from '../adoDeploymentScriptsSteps/LogicAppNameStep';
import { StorageAccountNameStep } from '../adoDeploymentScriptsSteps/StorageAccountNameStep';
import { AppServicePlanNameStep } from '../adoDeploymentScriptsSteps/AppServicePlanNameStep';
import { GenerateADODeploymentScriptsStep } from '../adoDeploymentScriptsSteps/GenerateADODeploymentScriptsStep';
import { LogicAppStep } from '../deploymentCenterScriptsSteps/LogicAppStep';
import { LogicAppMSIStep } from '../deploymentCenterScriptsSteps/LogicAppMSIStep';
import { GenerateDeploymentCenterScriptsStep } from '../deploymentCenterScriptsSteps/GenerateDeploymentCenterScriptsStep';

// Minimal context — only the fields these steps read.
const makeContext = (overrides: Record<string, any> = {}) => ({
  telemetry: { properties: {}, measurements: {} },
  ui: { showQuickPick: vi.fn().mockResolvedValue({ data: undefined }) },
  ...overrides,
});

describe('DeploymentScriptTypeStep', () => {
  const step = new DeploymentScriptTypeStep();

  it('always prompts', () => {
    expect(step.shouldPrompt()).toBe(true);
  });

  it('captures the selected script type and stores it on telemetry', async () => {
    const ctx = makeContext();
    ctx.ui.showQuickPick = vi.fn().mockResolvedValue({ data: DeploymentScriptType.azureDevOpsPipeline });
    await step.prompt(ctx as any);
    expect((ctx as any).deploymentScriptType).toBe(DeploymentScriptType.azureDevOpsPipeline);
    expect(ctx.telemetry.properties.lastStep).toBe('DeploymentScriptTypeStep');
  });

  it.each(['Arm', 'Bicep'])('returns the same workspace-free ADO sub-wizard for %s', async (infrastructureFormat) => {
    const ctx = makeContext({ deploymentScriptType: DeploymentScriptType.azureDevOpsPipeline, infrastructureFormat });
    const sub = await step.getSubWizard(ctx as any);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([DeploymentTargetStep, LogicAppNameStep]);
    expect(sub.executeSteps).toHaveLength(1);
    expect(sub.executeSteps[0]).toBeInstanceOf(GenerateADODeploymentScriptsStep);
    expect(ctx.telemetry.properties.deploymentScriptType).toBe('azureDevOpsPipeline');
  });

  it('returns the Deployment Center sub-wizard otherwise', async () => {
    const ctx = makeContext({
      deploymentScriptType: DeploymentScriptType.azureDeploymentCenter,
      projectPath: '/path/to/MyLogicApp',
    });
    const sub = await step.getSubWizard(ctx as any);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([SubscriptionAndResourceGroupStep, LogicAppStep, LogicAppMSIStep]);
    expect(sub.executeSteps).toHaveLength(1);
    expect(sub.executeSteps[0]).toBeInstanceOf(GenerateDeploymentCenterScriptsStep);
    expect(ctx.telemetry.properties.deploymentScriptType).toBe('azureDeploymentCenter');
    expect((ctx as any).localLogicAppName).toBe('MyLogicApp');
  });

  it('offers Terraform as export-only while Bicep is nested under the ADO flow', async () => {
    const format = 'Terraform';
    const ctx = makeContext({ deploymentTarget: DeploymentTargetType.hybrid });
    ctx.ui.showQuickPick.mockResolvedValue({ data: format });
    await step.prompt(ctx as any);
    const picks = ctx.ui.showQuickPick.mock.calls[0][0];
    expect(picks.map((pick: { data: string }) => pick.data)).toEqual([
      DeploymentScriptType.azureDevOpsPipeline,
      DeploymentScriptType.azureDeploymentCenter,
      'Terraform',
    ]);
    expect(picks.find((pick: { data: string }) => pick.data === format).label).toContain('infrastructure only');
    expect((ctx as any).infrastructureFormat).toBe(format);
    const sub = await step.getSubWizard(ctx as any);
    expect((ctx as any).deploymentTarget).toBe(DeploymentTargetType.standard);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([
      SubscriptionAndResourceGroupStep,
      StorageAccountNameStep,
      AppServicePlanNameStep,
      LogicAppNameStep,
    ]);
    expect(sub.executeSteps).toHaveLength(1);
    expect(sub.executeSteps[0]).toBeInstanceOf(GenerateADODeploymentScriptsStep);
    expect(ctx).not.toHaveProperty('workspaceResourceId');
  });

  it.each([DeploymentScriptType.azureDevOpsPipeline, DeploymentScriptType.azureDeploymentCenter])(
    'clears native selection when returning to legacy option %s',
    async (selection) => {
      const ctx = makeContext({
        infrastructureFormat: 'Bicep',
        deploymentTarget: DeploymentTargetType.hybrid,
        connectedEnvironmentName: 'stale',
        connectedEnvironmentResourceGroup: 'stale',
      });
      ctx.ui.showQuickPick.mockResolvedValue({ data: selection });
      await step.prompt(ctx as any);
      expect((ctx as any).infrastructureFormat).toBeUndefined();
      expect((ctx as any).deploymentScriptType).toBe(selection);
      expect(ctx).not.toHaveProperty('workspaceResourceId');
      expect((ctx as any).deploymentTarget).toBeUndefined();
      expect((ctx as any).connectedEnvironmentName).toBeUndefined();
      expect((ctx as any).connectedEnvironmentResourceGroup).toBeUndefined();
    }
  );
});

describe('DeploymentTargetStep', () => {
  const step = new DeploymentTargetStep();

  it('always prompts', () => {
    expect(step.shouldPrompt()).toBe(true);
  });

  it('records the chosen target on context and telemetry', async () => {
    const ctx = makeContext();
    ctx.ui.showQuickPick = vi.fn().mockResolvedValue({ data: DeploymentTargetType.hybrid });
    await step.prompt(ctx as any);
    expect((ctx as any).deploymentTarget).toBe(DeploymentTargetType.hybrid);
    expect(ctx.telemetry.properties.deploymentTarget).toBe(DeploymentTargetType.hybrid);
  });

  it('returns Hybrid sub-steps when target is hybrid', async () => {
    const ctx = makeContext({ deploymentTarget: DeploymentTargetType.hybrid });
    const sub = await step.getSubWizard(ctx as any);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([SubscriptionAndResourceGroupStep, ConnectedEnvironmentStep]);
  });

  it.each(['Arm', 'Bicep'])('returns the same workspace-free Standard sub-steps for %s', async (infrastructureFormat) => {
    const ctx = makeContext({ deploymentTarget: DeploymentTargetType.standard, infrastructureFormat });
    const sub = await step.getSubWizard(ctx as any);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([
      InfrastructureFormatStep,
      SubscriptionAndResourceGroupStep,
      StorageAccountNameStep,
      AppServicePlanNameStep,
    ]);
  });
});

describe('InfrastructureFormatStep', () => {
  it.each(['Arm', 'Bicep'])('selects %s within Standard ADO without injecting workspace context', async (format) => {
    const ctx = makeContext({ infrastructureFormat: 'Bicep' });
    ctx.ui.showQuickPick.mockResolvedValue({ data: format });
    await new InfrastructureFormatStep().prompt(ctx as any);
    expect(ctx.ui.showQuickPick.mock.calls[0][0].map((pick: { data: string }) => pick.data)).toEqual(['Arm', 'Bicep']);
    expect((ctx as any).infrastructureFormat).toBe(format);
    expect(ctx).not.toHaveProperty('workspaceResourceId');
    expect(ctx.telemetry.properties.infrastructureFormat).toBe(format);
  });

  it('does not mutate selection on cancellation or Back', async () => {
    const error = new Error('cancel or Back');
    const ctx = makeContext({ infrastructureFormat: 'Bicep' });
    ctx.ui.showQuickPick.mockRejectedValue(error);
    await expect(new InfrastructureFormatStep().prompt(ctx as any)).rejects.toBe(error);
    expect((ctx as any).infrastructureFormat).toBe('Bicep');
    expect(ctx).not.toHaveProperty('workspaceResourceId');
  });

  it('clears native state when changing to Hybrid and does not offer a format subwizard', async () => {
    const ctx = makeContext({ infrastructureFormat: 'Bicep' });
    ctx.ui.showQuickPick.mockResolvedValue({ data: DeploymentTargetType.hybrid });
    const target = new DeploymentTargetStep();
    await target.prompt(ctx as any);
    expect((ctx as any).infrastructureFormat).toBe('Arm');
    expect(ctx).not.toHaveProperty('workspaceResourceId');
    const sub = await target.getSubWizard(ctx as any);
    expect(sub.promptSteps.map((prompt) => prompt.constructor)).toEqual([SubscriptionAndResourceGroupStep, ConnectedEnvironmentStep]);
  });
});

describe('ConnectedEnvironmentStep', () => {
  const step = new ConnectedEnvironmentStep();

  it('always prompts', () => {
    expect(step.shouldPrompt()).toBe(true);
  });
});
