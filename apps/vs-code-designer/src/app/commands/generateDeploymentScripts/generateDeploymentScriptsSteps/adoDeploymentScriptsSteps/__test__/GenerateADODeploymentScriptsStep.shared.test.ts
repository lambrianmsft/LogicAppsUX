import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogResponses, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { DeploymentTargetType, OpenBehavior } from '@microsoft/vscode-extension-logic-apps';
import { GenerateADODeploymentScriptsStep } from '../GenerateADODeploymentScriptsStep';
import type { IAzureDeploymentScriptsContext } from '../../../generateDeploymentScripts';
import * as nativeExport from '../../../nativeInfrastructureExport';
import { nativeZip, scope } from '../../../__test__/nativeExportFixtures';
import { deploymentDirectory } from '../../../../../../constants';
import { ext } from '../../../../../../extensionVariables';
import { getConnectionsJson } from '../../../../../utils/codeless/connection';
import { getParametersJson } from '../../../../../utils/codeless/parameter';
import { getLocalSettingsJson } from '../../../../../utils/appSettings/localSettings';
import { areAllConnectionsParameterized } from '../../../../../utils/codeless/parameterizer';
import { parameterizeProjectConnections } from '../../../../parameterizeConnections';
import { unzipLogicAppArtifacts } from '../../../../../utils/taskUtils';
import { startDesignTimeApi } from '../../../../../utils/codeless/startDesignTimeApi';
import { getAuthorizationToken, getCloudHost } from '../../../../../utils/codeless/getAuthorizationToken';
import { FileManagement } from '../../../iacGestureHelperFunctions';

vi.mock('../../../../../utils/codeless/connection', () => ({ getConnectionsJson: vi.fn() }));
vi.mock('../../../../../utils/codeless/parameter', () => ({ getParametersJson: vi.fn() }));
vi.mock('../../../../../utils/appSettings/localSettings', () => ({ getLocalSettingsJson: vi.fn() }));
vi.mock('../../../../../utils/codeless/parameterizer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../utils/codeless/parameterizer')>()),
  areAllConnectionsParameterized: vi.fn(),
}));
vi.mock('../../../../parameterizeConnections', () => ({ parameterizeProjectConnections: vi.fn() }));
vi.mock('../../../../../utils/taskUtils', () => ({ unzipLogicAppArtifacts: vi.fn() }));
vi.mock('../../../../../utils/codeless/startDesignTimeApi', () => ({ startDesignTimeApi: vi.fn() }));
vi.mock('../../../../../utils/codeless/getAuthorizationToken', () => ({
  getAuthorizationToken: vi.fn().mockResolvedValue('token'),
  getCloudHost: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../iacGestureHelperFunctions', () => ({
  FileManagement: { addFolderToWorkspace: vi.fn(), convertToValidWorkspace: vi.fn() },
}));

const sourceId = '/subscriptions/source-sub/resourceGroups/source-rg/providers/Microsoft.Web/connections/resource-name';
const deploymentPath = path.join('workspace', deploymentDirectory);
const workflowPaths = ['withMetadata', 'withoutMetadata'].map((name) => path.join('project', name, 'workflow.json'));
const sourceWorkflow = {
  definition: {
    triggers: {},
    actions: {},
    Metadata: {
      designer: { description: 'keep me' },
      IaCMetadata: { custom: 'preserved', IaCWorkflowCorrelationId: 'old', IaCGenerationDate: 'old' },
    },
  },
  kind: 'Stateful',
};

function makeContext(format?: nativeExport.InfrastructureFormat): IAzureDeploymentScriptsContext {
  return {
    telemetry: { properties: {}, measurements: {} },
    infrastructureFormat: format,
    deploymentTarget: DeploymentTargetType.standard,
    projectPath: 'project',
    workspacePath: 'workspace',
    subscriptionId: scope.subscriptionId,
    resourceGroup: { name: scope.resourceGroupName, location: 'eastus' },
    storageAccountName: 'storage',
    appServicePlan: 'plan',
    logicAppName: 'app',
    tenantId: 'tenant',
    isValidWorkspace: true,
  } as IAzureDeploymentScriptsContext;
}

describe('shared deployment execution behavior', () => {
  const step = Object.create(GenerateADODeploymentScriptsStep.prototype) as GenerateADODeploymentScriptsStep;
  let events: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    // The global azext mock has no Yes/No values; keep the two choices distinct.
    Object.assign(DialogResponses, { yes: { title: 'Yes' }, no: { title: 'No' } });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      events.push('mkdir');
      return undefined;
    });
    vi.mocked(fs.readdirSync).mockImplementation((source) => {
      if (String(source) === 'project') {
        events.push('enumerate');
        return ['withMetadata', 'withoutMetadata', 'notWorkflow', 'host.json'] as never;
      }
      return (String(source).endsWith('notWorkflow') ? ['workflow.json', 'extra.json'] : ['workflow.json']) as never;
    });
    vi.mocked(fs.statSync).mockImplementation((source) => ({ isDirectory: () => !String(source).endsWith('host.json') }) as fs.Stats);
    vi.mocked(fs.readFileSync).mockImplementation((source) => {
      if (String(source) === workflowPaths[0]) {
        return JSON.stringify(sourceWorkflow);
      }
      if (String(source) === workflowPaths[1]) {
        return JSON.stringify({ definition: { triggers: {}, actions: {} }, kind: 'Stateless' });
      }
      throw new Error(`Unexpected source read: ${source}`);
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      events.push('metadata');
    });
    vi.mocked(getConnectionsJson).mockImplementation(async () => {
      events.push('readConnections');
      return JSON.stringify({ managedApiConnections: { reference: { connection: { id: sourceId } } } });
    });
    vi.mocked(areAllConnectionsParameterized).mockResolvedValue(true);
    vi.mocked(getParametersJson).mockResolvedValue({});
    vi.mocked(getLocalSettingsJson).mockResolvedValue({ IsEncrypted: false, Values: {} });
    vi.mocked(parameterizeProjectConnections).mockImplementation(async () => {
      events.push('parameterize');
    });
    vi.mocked(startDesignTimeApi).mockResolvedValue(undefined);
    vi.mocked(getAuthorizationToken).mockResolvedValue('token');
    vi.mocked(getCloudHost).mockResolvedValue(undefined);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Export infrastructure' as never);
    vi.mocked(vscode.window.showInformationMessage).mockImplementation(async () => {
      events.push('prompt');
      return DialogResponses.yes as never;
    });
    vi.mocked(unzipLogicAppArtifacts).mockImplementation(async (buffer) => {
      events.push(`unzip:${buffer.toString()}`);
    });
    vi.mocked(FileManagement.addFolderToWorkspace).mockImplementation(() => {
      events.push('addWorkspace');
    });
    vi.mocked(FileManagement.convertToValidWorkspace).mockImplementation(() => {
      events.push('convertWorkspace');
    });
    ext.designTimeInstances.clear();
    ext.designTimeInstances.set('project', { port: 43210 } as never);
    ext.pinnedBundleVersion.clear();
    ext.currentBundleVersion.clear();
    vi.spyOn(nativeExport, 'publishNativeExport').mockImplementation(() => {
      events.push('publish');
      return 'native-output';
    });
  });

  function expectNoLegacyFinalization() {
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(FileManagement.addFolderToWorkspace).not.toHaveBeenCalled();
    expect(FileManagement.convertToValidWorkspace).not.toHaveBeenCalled();
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  }

  it.each([undefined, 'Arm'] as const)(
    '%s preserves ARM preparation, reread, raw child requests, output and merged workflow metadata',
    async (format) => {
      const context = makeContext(format);
      const workspaceAlreadyOpen = format === 'Arm';
      context.isValidWorkspace = workspaceAlreadyOpen;
      if (workspaceAlreadyOpen) {
        context.workspaceFolder = { uri: vscode.Uri.file('open-workspace') } as vscode.WorkspaceFolder;
      }
      ext.pinnedBundleVersion.set('project', 'pinned-bundle');
      ext.currentBundleVersion.set('project', 'current-bundle');
      vi.mocked(areAllConnectionsParameterized).mockResolvedValue(false);
      let parameterized = false;
      vi.mocked(parameterizeProjectConnections).mockImplementation(async () => {
        events.push('parameterize');
        parameterized = true;
      });
      vi.mocked(getConnectionsJson).mockImplementation(async () => {
        events.push(parameterized ? 'reread' : 'readConnections');
        return JSON.stringify({
          managedApiConnections: parameterized
            ? {
                afterPrompt: { connection: { id: `${sourceId}/raw final@component` } },
                secondReference: { connection: { id: sourceId } },
              }
            : { staleReference: { connection: { id: `${sourceId}/stale-resource` } } },
        });
      });
      vi.mocked(axios.post).mockImplementation(async (url) => {
        const host = String(url).startsWith('http://localhost:');
        events.push(host ? 'host' : 'child');
        expect(context.telemetry.properties.lastStep).toBe(
          host ? 'getLogicAppDeploymentArtifactsBuffer' : 'generateManagedConnectionsDeploymentArtifacts'
        );
        return { data: Buffer.from(host ? 'host' : 'child') };
      });

      await step.execute(context);

      expect(events).toEqual([
        'mkdir',
        'readConnections',
        'enumerate',
        'prompt',
        'parameterize',
        'reread',
        'child',
        'unzip:child',
        'child',
        'unzip:child',
        'host',
        'unzip:host',
        workspaceAlreadyOpen ? 'addWorkspace' : 'convertWorkspace',
        'metadata',
        'metadata',
      ]);
      expect(fs.mkdirSync).toHaveBeenCalledExactlyOnceWith(deploymentPath);
      expect(getConnectionsJson).toHaveBeenCalledTimes(2);
      expect(parameterizeProjectConnections).toHaveBeenCalledOnce();
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        `https://management.azure.com/subscriptions/${scope.subscriptionId}/resourceGroups/${scope.resourceGroupName}/providers/Microsoft.Web/connections/raw final@component/generateDeploymentArtifacts?api-version=2018-07-01-preview`,
        { TargetLogicAppName: 'app', ConnectionReferenceName: 'afterPrompt' },
        {
          headers: { 'Content-Type': 'application/json', Authorization: 'token' },
          responseType: 'arraybuffer',
        }
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/connections/resource-name/generateDeploymentArtifacts?'),
        { TargetLogicAppName: 'app', ConnectionReferenceName: 'secondReference' },
        expect.anything()
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        3,
        'http://localhost:43210/runtime/webhooks/workflow/api/management/generateDeploymentArtifacts',
        {
          targetSubscriptionName: scope.subscriptionId,
          targetResourceGroupName: scope.resourceGroupName,
          targetStorageAccountName: 'storage',
          targetLocation: 'eastus',
          targetLogicAppName: 'app',
          targetAppServicePlanName: 'plan',
        },
        { headers: { Accept: 'application/zip', 'Content-Type': 'application/json' }, responseType: 'arraybuffer' }
      );
      expect(unzipLogicAppArtifacts).toHaveBeenCalledTimes(3);
      for (const [, destination] of vi.mocked(unzipLogicAppArtifacts).mock.calls) {
        expect(destination).toBe(deploymentPath);
      }
      expect(context.deploymentFolderPath).toBe(deploymentPath);
      expect(context.workspacePath).toBe(workspaceAlreadyOpen ? 'open-workspace' : 'workspace');
      if (workspaceAlreadyOpen) {
        expect(context.openBehavior).toBe(OpenBehavior.alreadyOpen);
        expect(FileManagement.addFolderToWorkspace).toHaveBeenCalledExactlyOnceWith(deploymentPath);
        expect(FileManagement.convertToValidWorkspace).not.toHaveBeenCalled();
      } else {
        expect(FileManagement.convertToValidWorkspace).toHaveBeenCalledExactlyOnceWith(deploymentPath);
        expect(FileManagement.addFolderToWorkspace).not.toHaveBeenCalled();
      }
      const writes = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writes.map(([file]) => file)).toEqual(workflowPaths);
      const updated = writes.map(([, content, encoding]) => {
        expect(encoding).toBe('utf-8');
        return JSON.parse(String(content));
      });
      const metadata = updated[0].definition.metadata;
      expect(updated[0].definition).not.toHaveProperty('Metadata');
      expect(metadata.designer).toEqual(sourceWorkflow.definition.Metadata.designer);
      expect(updated[0].kind).toBe('Stateful');
      expect(updated[1]).toMatchObject({ kind: 'Stateless', definition: { triggers: {}, actions: {} } });
      expect(metadata.IaCMetadata).toEqual({
        custom: 'preserved',
        IaCGenerationDate: expect.any(String),
        IaCWorkflowCorrelationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        LogicAppsExtensionVersion: ext.extensionVersion,
        LogicAppsPinnedBundle: 'pinned-bundle',
        LogicAppsCurrentBundleVersion: 'current-bundle',
      });
      expect(Number.isNaN(Date.parse(metadata.IaCMetadata.IaCGenerationDate))).toBe(false);
      expect(updated[1].definition.metadata.IaCMetadata).toEqual(
        Object.fromEntries(Object.entries(metadata.IaCMetadata).filter(([key]) => key !== 'custom'))
      );
      expect(context.telemetry.properties).toMatchObject({
        parameterizeConnectionsInDeploymentScripts: 'true',
        lastStep: 'updateMetadata',
      });
      expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
      expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
        expect.stringContaining('Deployment script generation completed successfully.')
      );
    }
  );

  it.each([undefined, 'Arm'] as const)(
    '%s decline keeps initial directory creation but stops all artifact/finalization work',
    async (format) => {
      const context = makeContext(format);
      vi.mocked(areAllConnectionsParameterized).mockResolvedValue(false);
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(async () => {
        events.push('prompt');
        return DialogResponses.no as never;
      });

      await expect(step.execute(context)).rejects.toBeInstanceOf(UserCancelledError);

      expect(events).toEqual(['mkdir', 'readConnections', 'enumerate', 'prompt']);
      expect(fs.mkdirSync).toHaveBeenCalledExactlyOnceWith(deploymentPath);
      expect(getConnectionsJson).toHaveBeenCalledTimes(1);
      expect(parameterizeProjectConnections).not.toHaveBeenCalled();
      expect(startDesignTimeApi).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
      expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
      expectNoLegacyFinalization();
      expect(context.telemetry.properties).toMatchObject({
        parameterizeConnectionsInDeploymentScripts: 'false',
        lastStep: 'parameterizeConnectionsPrompt',
      });
      expect(ext.outputChannel.appendLog).not.toHaveBeenCalledWith(expect.stringContaining('completed successfully'));
    }
  );

  it.each(['Bicep', 'Terraform'] as const)(
    '%s consumes one source read and validates host before iterating multiple children',
    async (format) => {
      const context = makeContext(format);
      vi.mocked(getConnectionsJson).mockImplementation(async () => {
        events.push('readConnections');
        return JSON.stringify({
          managedApiConnections: {
            first: { connection: { id: sourceId } },
            second: { connection: { id: sourceId.replace('resource-name', 'second-physical') } },
          },
        });
      });
      vi.mocked(axios.post).mockImplementation(async (_url, body) => {
        const reference = body.ConnectionReferenceName as string | undefined;
        events.push(reference ?? 'host');
        return { data: nativeZip(format, reference, {}, reference === 'second' ? 'second-physical' : 'resource-name') };
      });

      await step.execute(context);

      expect(events).toEqual(['readConnections', 'host', 'first', 'second', 'publish']);
      expect(getConnectionsJson).toHaveBeenCalledExactlyOnceWith('project');
      expect(axios.post).toHaveBeenCalledTimes(3);
      expect(nativeExport.publishNativeExport).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: format === 'Bicep' ? 'app/infrastructure/resource-name.bicep' : 'app/infrastructure/connections/first/main.tf',
          }),
          expect.objectContaining({
            name: format === 'Bicep' ? 'app/infrastructure/second-physical.bicep' : 'app/infrastructure/connections/second/main.tf',
          }),
        ]),
        deploymentPath,
        format
      );
      expect(context).toMatchObject({ deploymentFolderPath: 'native-output', workspacePath: 'workspace' });
      expect(context.telemetry.properties.lastStep).toBe('publishNativeInfrastructure');
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.readdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(areAllConnectionsParameterized).not.toHaveBeenCalled();
      expect(parameterizeProjectConnections).not.toHaveBeenCalled();
      expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
      expect(FileManagement.addFolderToWorkspace).not.toHaveBeenCalled();
      expect(FileManagement.convertToValidWorkspace).not.toHaveBeenCalled();
    }
  );

  it.each(['Bicep', 'Terraform'] as const)('%s cancellation precedes source access, requests and any output', async (format) => {
    const context = makeContext(format);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined);

    await expect(step.execute(context)).rejects.toBeInstanceOf(UserCancelledError);

    expect(events).toEqual([]);
    expect(getConnectionsJson).not.toHaveBeenCalled();
    expect(getParametersJson).not.toHaveBeenCalled();
    expect(getLocalSettingsJson).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.readdirSync).not.toHaveBeenCalled();
    expect(startDesignTimeApi).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(ext.outputChannel.appendLog).not.toHaveBeenCalled();
    expect(context.deploymentFolderPath).toBeUndefined();
    expectNoLegacyFinalization();
  });

  it.each(['Bicep', 'Terraform'] as const)('%s rejects an incompatible host descriptor before children or publication', async (format) => {
    const context = makeContext(format);
    vi.mocked(axios.post).mockResolvedValueOnce({ data: nativeZip(format, undefined, { applicationPackageIncluded: true }) });

    await expect(step.execute(context)).rejects.toThrow('Update the host/service');

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(context.telemetry.properties.lastStep).toBe('getNativeHostArtifacts');
    expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expectNoLegacyFinalization();
  });

  it('Hybrid unzips children before local generation and transformation without invoking the Standard host', async () => {
    const context = { ...makeContext(), deploymentTarget: DeploymentTargetType.hybrid };
    const generate = vi
      .spyOn(GenerateADODeploymentScriptsStep, 'generateHybridDeploymentArtifacts' as never)
      .mockImplementation((async () => {
        events.push('hybrid');
      }) as never);
    const transform = vi
      .spyOn(GenerateADODeploymentScriptsStep, 'transformConnectionTemplatesForHybrid' as never)
      .mockImplementation((() => {
        events.push('transform');
      }) as never);
    vi.mocked(axios.post).mockImplementation(async () => {
      events.push('child');
      return { data: Buffer.from('child') };
    });

    await step.execute(context);

    expect(events).toEqual([
      'mkdir',
      'readConnections',
      'enumerate',
      'readConnections',
      'child',
      'unzip:child',
      'hybrid',
      'transform',
      'addWorkspace',
      'metadata',
      'metadata',
    ]);
    expect(generate).toHaveBeenCalledExactlyOnceWith(context);
    expect(transform).toHaveBeenCalledExactlyOnceWith(path.join(deploymentPath, 'app', 'infrastructure'));
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axios.post).mock.calls[0][0]).toContain('/connections/resource-name/generateDeploymentArtifacts?');
    expect(startDesignTimeApi).not.toHaveBeenCalled();
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(context.telemetry.properties.lastStep).toBe('updateMetadata');
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith('Hybrid deployment artifacts generated successfully.');
  });
});
