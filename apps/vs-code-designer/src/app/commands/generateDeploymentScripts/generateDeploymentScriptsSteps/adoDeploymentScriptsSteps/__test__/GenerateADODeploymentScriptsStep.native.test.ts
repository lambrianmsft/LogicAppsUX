import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import axios from 'axios';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DeploymentTargetType } from '@microsoft/vscode-extension-logic-apps';
import { GenerateADODeploymentScriptsStep } from '../GenerateADODeploymentScriptsStep';
import type { IAzureDeploymentScriptsContext } from '../../../generateDeploymentScripts';
import * as nativeExport from '../../../nativeInfrastructureExport';
import { legacyBicepHostZip, legacyHelperBicepHostZip, nativeZip, scope } from '../../../__test__/nativeExportFixtures';
import { getConnectionsJson } from '../../../../../utils/codeless/connection';
import { getParametersJson } from '../../../../../utils/codeless/parameter';
import { getLocalSettingsJson } from '../../../../../utils/appSettings/localSettings';
import { parameterizeProjectConnections } from '../../../../parameterizeConnections';
import { areAllConnectionsParameterized } from '../../../../../utils/codeless/parameterizer';
import { unzipLogicAppArtifacts } from '../../../../../utils/taskUtils';
import { startDesignTimeApi } from '../../../../../utils/codeless/startDesignTimeApi';
import { getAuthorizationToken } from '../../../../../utils/codeless/getAuthorizationToken';
import { FileManagement } from '../../../iacGestureHelperFunctions';
import { ext } from '../../../../../../extensionVariables';

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

describe('native requests and execution routing', () => {
  const step = Object.create(GenerateADODeploymentScriptsStep.prototype) as GenerateADODeploymentScriptsStep;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(axios.isAxiosError).mockImplementation((await vi.importActual<typeof import('axios')>('axios')).isAxiosError);
    vi.mocked(getConnectionsJson).mockResolvedValue(
      JSON.stringify({ managedApiConnections: { reference: { connection: { id: sourceId } } } })
    );
    vi.mocked(getParametersJson).mockResolvedValue({});
    vi.mocked(getLocalSettingsJson).mockResolvedValue({ IsEncrypted: false, Values: {} });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Export infrastructure' as never);
    ext.designTimeInstances.set('project', { port: 43210 } as typeof ext.designTimeInstances extends Map<string, infer T> ? T : never);
    vi.spyOn(nativeExport, 'publishNativeExport').mockReturnValue('output');
  });

  it.each([
    { app: 'app', names: ['app'] },
    { app: 'app', names: ['APP'] },
    { app: 'app', names: ['physical', 'physical'] },
    { app: 'app', names: ['physical', 'PHYSICAL'] },
    { app: 'app', names: ['physical', 'physical'], secondScope: true },
    { app: 'app', names: ['CON'] },
    { app: 'app', names: ['com1.txt'] },
    { app: 'app', names: ['physical.'] },
    { app: 'NUL', names: ['physical'] },
  ])('rejects unsafe/colliding source names before any export request: %j', async ({ app, names, secondScope }) => {
    const connections = Object.fromEntries(
      names.map((name, index) => [
        `reference${index}`,
        {
          connection: { id: sourceId.replace('resource-name', name).replace('source-rg', secondScope && index ? 'other-rg' : 'source-rg') },
        },
      ])
    );
    vi.mocked(getConnectionsJson).mockResolvedValue(JSON.stringify({ managedApiConnections: connections }));
    const context = makeContext('Bicep');
    context.logicAppName = app;
    await expect(step.execute(context)).rejects.toThrow();
    expect(axios.post).not.toHaveBeenCalled();
    expect(startDesignTimeApi).not.toHaveBeenCalled();
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(parameterizeProjectConnections).not.toHaveBeenCalled();
  });

  it.each(['Bicep', 'Terraform'] as const)('forwards %s to both contracts and bypasses ARM source/pipeline operations', async (format) => {
    const hostArchive = nativeZip(format);
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: hostArchive })
      .mockResolvedValueOnce({ data: nativeZip(format, 'reference') });
    const context = makeContext(format);
    await step.execute(context);
    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'http://localhost:43210/runtime/webhooks/workflow/api/management/generateDeploymentArtifacts',
      {
        targetSubscriptionName: scope.subscriptionId,
        targetResourceGroupName: scope.resourceGroupName,
        targetStorageAccountName: 'storage',
        targetLocation: 'eastus',
        targetLogicAppName: 'app',
        targetAppServicePlanName: 'plan',
        infrastructureFormat: format,
      },
      expect.objectContaining({ responseType: 'arraybuffer', maxContentLength: 5 * 1024 * 1024 })
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/subscriptions/source-sub/resourceGroups/source-rg/providers/Microsoft.Web/connections/resource-name/'),
      {
        TargetLogicAppName: 'app',
        ConnectionReferenceName: 'reference',
        InfrastructureFormat: format,
      },
      expect.anything()
    );
    expect(nativeExport.publishNativeExport).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: format === 'Bicep' ? 'app/infrastructure/resource-name.bicep' : 'app/infrastructure/connections/reference/main.tf',
        }),
      ]),
      expect.any(String),
      format
    );
    expect(areAllConnectionsParameterized).not.toHaveBeenCalled();
    expect(parameterizeProjectConnections).not.toHaveBeenCalled();
    expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(FileManagement.addFolderToWorkspace).not.toHaveBeenCalled();
    expect(FileManagement.convertToValidWorkspace).not.toHaveBeenCalled();
    expect(context.deploymentFolderPath).toBe('output');
    const files = vi.mocked(nativeExport.publishNativeExport).mock.calls[0][0];
    const hostInputs = format === 'Bicep' ? 'app/infrastructure/app.bicepparam' : 'app/infrastructure/terraform.tfvars.json';
    expect(files.find((file) => file.name === hostInputs).content).toEqual(new AdmZip(hostArchive).getEntry(hostInputs).getData());
    expect(context).not.toHaveProperty('workspaceResourceId');
    expect(vi.mocked(axios.post).mock.calls[0][1]).not.toHaveProperty('workspaceResourceId');
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
      expect.stringContaining(
        format === 'Bicep'
          ? 'Bicep Azure DevOps infrastructure pipeline and connection modules exported'
          : 'infrastructure-only modules exported'
      )
    );
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining(format === 'Bicep' ? 'Azure DevOps Bicep infrastructure deployment pipeline' : 'No pipeline'),
      { modal: true },
      'Export infrastructure'
    );
    if (format === 'Bicep') {
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('AzureLogicAppsStandardConnectionsDeployment@1 installed'),
        { modal: true },
        'Export infrastructure'
      );
      expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining('AzureLogicAppsStandardConnectionsDeployment@1'));
      expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining('@0 task remains available for legacy pipelines'));
      for (const variable of [
        'subscriptionId',
        'resourceGroupName',
        'logicAppName',
        'resourceGroupLocation',
        'hostingPlanName',
        'storageAccountName',
      ]) {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining(variable),
          { modal: true },
          'Export infrastructure'
        );
        expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining(variable));
      }
      expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(
        expect.stringContaining('required deployment targets, not fallbacks to initial exported values')
      );
    }
  });

  it.each([undefined, 'Arm'] as const)('omits format for legacy %s on both calls', async (format) => {
    vi.mocked(axios.post).mockResolvedValue({ data: Buffer.from('legacy') });
    await GenerateADODeploymentScriptsStep['getLogicAppDeploymentArtifactsBuffer'](makeContext(format));
    await GenerateADODeploymentScriptsStep['getManagedConnectionDeploymentArtifactsBuffer'](
      'tenant',
      'sub',
      'rg',
      'app',
      'ref',
      'resource',
      format
    );
    expect(vi.mocked(axios.post).mock.calls[0][1]).not.toHaveProperty('infrastructureFormat');
    expect(vi.mocked(axios.post).mock.calls[1][1]).not.toHaveProperty('InfrastructureFormat');
    expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
  });

  it.each(['host', 'connection'] as const)('rejects ARM fallback from the %s before publication', async (failure) => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: failure === 'host' ? Buffer.from('arm') : nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: Buffer.from('arm') });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('Update the host/service');
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['host', 'connection'] as const)('reports missing %s response content without partial output', async (failure) => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: failure === 'host' ? null : nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: null });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('No native infrastructure export content');
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it.each(['host', 'connection'] as const)(
    'rejects a wrong native using binding at the %s boundary without publishing or source writes',
    async (boundary) => {
      const host = new AdmZip(nativeZip('Bicep'));
      const child = new AdmZip(nativeZip('Bicep', 'reference'));
      const zip = boundary === 'host' ? host : child;
      const name = boundary === 'host' ? 'app/infrastructure/app.bicepparam' : 'app/infrastructure/resource-name.bicepparam';
      const text = zip
        .getEntry(name)
        .getData()
        .toString()
        .replace(/using '[^']+'/, "using '../outside.bicep'");
      zip.updateFile(name, Buffer.from(text));
      vi.mocked(axios.post).mockResolvedValueOnce({ data: host.toBuffer() }).mockResolvedValueOnce({ data: child.toBuffer() });
      await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('Regenerate JSON-parameter native exports');
      expect(axios.post).toHaveBeenCalledTimes(boundary === 'host' ? 1 : 2);
      expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(parameterizeProjectConnections).not.toHaveBeenCalled();
      expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
    }
  );

  it('rejects the old Bicep host before exporting connections or publishing a nominal pipeline', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: legacyBicepHostZip() });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('not the older infrastructure-only export');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(ext.outputChannel.appendLog).not.toHaveBeenCalledWith(expect.stringContaining('pipeline and connection modules exported'));
  });

  it('rejects the obsolete PowerShell helper host before connection downloads or publication', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: legacyHelperBicepHostZip() });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('PowerShell helper pipeline');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['@0', '@0.0.3'])('rejects schema-4 output with unsupported task major %s before publication', async (version) => {
    const zip = new AdmZip(nativeZip('Bicep'));
    const pipeline = zip.getEntry('app/infrastructure/infrastructure-pipeline.yml').getData().toString().split('@1').join(version);
    zip.updateFile('app/infrastructure/infrastructure-pipeline.yml', Buffer.from(pipeline));
    vi.mocked(axios.post).mockResolvedValueOnce({ data: zip.toBuffer() });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('task-based infrastructure pipeline');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('populates pipeline inventory from all assembled exports without confusing reference/resource/display or inferring unknown keys', async () => {
    vi.mocked(getConnectionsJson).mockResolvedValue(
      JSON.stringify({
        managedApiConnections: {
          firstReference: {
            connection: { id: sourceId },
            displayName: 'display-other',
            connectionRuntimeUrl: "@parameters('runtimeUrl')",
          },
          secondReference: {
            connection: { id: sourceId.replace('resource-name', 'second-physical') },
            connectionRuntimeUrl: 'https://literal-source-runtime-url',
          },
        },
      })
    );
    vi.mocked(getParametersJson).mockResolvedValue({ runtimeUrl: { type: 'String', value: "@appsetting('exact-custom-consumed-key')" } });
    vi.mocked(getLocalSettingsJson).mockResolvedValue({
      IsEncrypted: false,
      Values: { 'exact-custom-consumed-key': 'https://secret-runtime-url' },
    });
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: nativeZip('Bicep', 'firstReference') })
      .mockResolvedValueOnce({ data: nativeZip('Bicep', 'secondReference', {}, 'second-physical') });
    await step.execute(makeContext('Bicep'));
    const files = vi.mocked(nativeExport.publishNativeExport).mock.calls[0][0];
    expect(files).toHaveLength(9);
    expect(
      files
        .filter((file) => file.name.endsWith('.bicep'))
        .map((file) => file.name)
        .sort()
    ).toEqual(['app/infrastructure/app.bicep', 'app/infrastructure/resource-name.bicep', 'app/infrastructure/second-physical.bicep']);
    expect(files.some((file) => file.name.includes('/connections/') || file.name.endsWith('.export.json'))).toBe(false);
    expect(files.some((file) => file.name.endsWith('.ps1'))).toBe(false);
    const settings = files.find((file) => file.name.endsWith('/pipeline-settings.json')).content.toString();
    expect(JSON.parse(settings)).toEqual({
      schemaVersion: '1.0',
      connections: [
        { connectionReferenceName: 'firstReference', runtimeUrlSettingName: 'exact-custom-consumed-key' },
        { connectionReferenceName: 'secondReference', runtimeUrlSettingName: null },
      ],
    });
    expect(settings).not.toContain('secret-runtime-url');
    expect(settings).not.toContain('display-other');
    expect(settings).not.toContain('resource-name');
    expect(files.find((file) => file.name === 'app/infrastructure/app.bicepparam').content.toString()).not.toHaveProperty(
      'workspaceResourceId'
    );
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith(expect.stringContaining('Null mappings must be resolved explicitly'));
  });

  it('does not add pipeline settings or pipeline warnings to the unchanged Terraform export', async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: nativeZip('Terraform') })
      .mockResolvedValueOnce({ data: nativeZip('Terraform', 'reference') });
    await step.execute(makeContext('Terraform'));
    const files = vi.mocked(nativeExport.publishNativeExport).mock.calls[0][0];
    expect(files).toHaveLength(6);
    expect(files.some((file) => /pipeline|\.ps1$/.test(file.name))).toBe(false);
    expect(ext.outputChannel.appendLog).not.toHaveBeenCalledWith(expect.stringContaining('Bicep Azure DevOps infrastructure pipeline'));
  });

  it('rejects a mismatched flat Bicep input reference before publishing any output', async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: nativeZip('Bicep', 'other') });
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('managed-connection export service');
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(parameterizeProjectConnections).not.toHaveBeenCalled();
  });

  it('fails a later required connection without publishing partial modules', async () => {
    vi.mocked(getConnectionsJson).mockResolvedValue(
      JSON.stringify({
        managedApiConnections: {
          first: { connection: { id: sourceId } },
          second: { connection: { id: sourceId.replace('resource-name', 'second-physical') } },
        },
      })
    );
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: nativeZip('Bicep', 'first') })
      .mockRejectedValueOnce(new Error('HTTP 403 Forbidden'));
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow('HTTP 403 Forbidden');
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it.each(['network', 'authentication'] as const)('preserves %s errors without claiming host incompatibility', async (kind) => {
    const error = new Error(kind === 'network' ? 'ECONNREFUSED' : 'Sign in required');
    if (kind === 'network') {
      vi.mocked(axios.post).mockRejectedValueOnce(error);
    } else {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: nativeZip('Bicep') });
      vi.mocked(getAuthorizationToken).mockRejectedValueOnce(error);
    }
    await expect(step.execute(makeContext('Bicep'))).rejects.toBe(error);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it.each([
    ['Bicep', 'host'],
    ['Bicep', 'connection'],
    ['Terraform', 'host'],
    ['Terraform', 'connection'],
  ] as const)('identifies a %s HTTP 400 at the %s boundary without exposing response secrets', async (format, boundary) => {
    const { AxiosError, AxiosHeaders } = await vi.importActual<typeof import('axios')>('axios');
    const error = new AxiosError('Request failed with status code 400');
    error.response = {
      status: 400,
      statusText: 'Bad Request',
      data: Buffer.from(JSON.stringify({ error: { code: 'private-error-code', message: 'secret-response-credential' } })),
      headers: { 'x-private-header': 'secret-header-value' },
      config: { headers: new AxiosHeaders() },
    };
    if (boundary === 'connection') {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: nativeZip(format) });
    }
    vi.mocked(axios.post).mockRejectedValueOnce(error);
    const context = makeContext(format);
    let failure: unknown;
    try {
      await step.execute(context);
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(`${format} infrastructure export failed`);
    expect(message).toContain('HTTP 400');
    expect(message).toContain(boundary === 'host' ? 'local design-time host' : 'cloud managed-connection export service');
    expect(message).toContain(
      boundary === 'host'
        ? 'POST /runtime/webhooks/workflow/api/management/generateDeploymentArtifacts'
        : 'POST /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Web/connections/{connectionName}/generateDeploymentArtifacts'
    );
    for (const secret of [
      'secret-response-credential',
      'private-error-code',
      'secret-header-value',
      'source-sub',
      'source-rg',
      'resource-name',
    ]) {
      expect(message).not.toContain(secret);
      expect(ext.outputChannel.appendLog).not.toHaveBeenCalledWith(expect.stringContaining(secret));
    }
    expect(message).not.toContain('Update the host');
    expect(axios.post).toHaveBeenCalledTimes(boundary === 'host' ? 1 : 2);
    expect(context.telemetry.properties.lastStep).toBe(boundary === 'host' ? 'getNativeHostArtifacts' : 'getNativeConnectionArtifacts');
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    'LogicAppTargetDeploymentArtifactsInputInvalid',
    'InvalidRequestContent',
    'MissingIaCFile',
    'InvalidApiConnectionDeploymentArtifactsGenerationRequest',
    'WorkflowParametersInvalidExpression',
  ])('includes only the known backend code %s from an arraybuffer error response', async (code) => {
    const { AxiosError, AxiosHeaders } = await vi.importActual<typeof import('axios')>('axios');
    const error = new AxiosError('Request failed with status code 400');
    error.response = {
      status: 400,
      statusText: 'secret-status-text',
      data: Buffer.from(JSON.stringify({ error: { code, message: 'secret-server-message' } })),
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    vi.mocked(axios.post).mockRejectedValueOnce(error);
    const failure: unknown = await step.execute(makeContext('Bicep')).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) {
      expect(failure.message).toContain(`; code ${code}`);
      expect(failure.message).not.toContain('secret-server-message');
      expect(failure.message).not.toContain('secret-status-text');
    }
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON string', JSON.stringify({ error: { code: 'InvalidRequestContent' } }), 'InvalidRequestContent'],
    ['parsed object', { error: { code: 'MissingIaCFile' } }, 'MissingIaCFile'],
    [
      'ArrayBuffer',
      new TextEncoder().encode(JSON.stringify({ error: { code: 'InvalidApiConnectionDeploymentArtifactsGenerationRequest' } })).buffer,
      'InvalidApiConnectionDeploymentArtifactsGenerationRequest',
    ],
    ['unknown code', { error: { code: 'secret-unknown-code' } }, undefined],
    ['wrong case', { error: { code: 'invalidrequestcontent' } }, undefined],
    ['nonstring code', { error: { code: ['InvalidRequestContent'] } }, undefined],
    ['top-level code', { code: 'InvalidRequestContent' }, undefined],
    ['message only', { error: { message: 'InvalidRequestContent secret-message' } }, undefined],
    ['HTML response', Buffer.from('<html>secret-message</html>'), undefined],
    ['invalid JSON', '{error: secret-message}', undefined],
    ['oversized body', `${' '.repeat(16 * 1024)}{"error":{"code":"InvalidRequestContent"}}`, undefined],
    ['null response', null, undefined],
  ])('safely extracts allowlisted error codes from %s', (_kind, data, expected) => {
    expect(GenerateADODeploymentScriptsStep['nativeExportResponseCode'](data)).toBe(expected);
  });

  it.each([401, 403, 500])('retains HTTP %s without claiming an unsupported backend version', async (status) => {
    const { AxiosError, AxiosHeaders } = await vi.importActual<typeof import('axios')>('axios');
    const error = new AxiosError(`Request failed with status code ${status}`);
    error.response = { status, statusText: '', data: '', headers: {}, config: { headers: new AxiosHeaders() } };
    vi.mocked(axios.post).mockRejectedValueOnce(error);
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow(`HTTP ${status}`);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it('preserves an Axios transport error without a response', async () => {
    const { AxiosError } = await vi.importActual<typeof import('axios')>('axios');
    const error = new AxiosError('ECONNREFUSED', 'ECONNREFUSED');
    vi.mocked(axios.post).mockRejectedValueOnce(error);
    await expect(step.execute(makeContext('Bicep'))).rejects.toBe(error);
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it.each(['startup', 'authentication'] as const)(
    'does not mislabel an HTTP error during %s as an export endpoint failure',
    async (stage) => {
      const { AxiosError, AxiosHeaders } = await vi.importActual<typeof import('axios')>('axios');
      const error = new AxiosError(`${stage} failed`);
      error.response = { status: 400, statusText: '', data: '', headers: {}, config: { headers: new AxiosHeaders() } };
      if (stage === 'startup') {
        vi.mocked(startDesignTimeApi).mockRejectedValueOnce(error);
      } else {
        vi.mocked(axios.post).mockResolvedValueOnce({ data: nativeZip('Bicep') });
        vi.mocked(getAuthorizationToken).mockRejectedValueOnce(error);
      }
      await expect(step.execute(makeContext('Bicep'))).rejects.toBe(error);
      expect(axios.post).toHaveBeenCalledTimes(stage === 'startup' ? 0 : 1);
      expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
    }
  );

  it('rejects unsupported Hybrid and cancellation before requests or output', async () => {
    await expect(step.execute({ ...makeContext('Bicep'), deploymentTarget: DeploymentTargetType.hybrid })).rejects.toThrow('not Hybrid');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined);
    await expect(step.execute(makeContext('Bicep'))).rejects.toThrow();
    expect(axios.post).not.toHaveBeenCalled();
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });

  it('resolves parameterized source connection IDs without source writes', async () => {
    vi.mocked(getConnectionsJson).mockResolvedValue(
      JSON.stringify({
        managedApiConnections: {
          reference: { connection: { id: "@parameters('connectionId')" } },
        },
      })
    );
    vi.mocked(getParametersJson).mockResolvedValue({
      connectionId: {
        type: 'String',
        value: "/subscriptions/@{appsetting('sub')}/resourceGroups/source-rg/providers/Microsoft.Web/connections/resource-name",
      },
    });
    vi.mocked(getLocalSettingsJson).mockResolvedValue({ IsEncrypted: false, Values: { sub: 'source-sub' } });
    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: nativeZip('Bicep') })
      .mockResolvedValueOnce({ data: nativeZip('Bicep', 'reference') });
    await step.execute(makeContext('Bicep'));
    expect(vi.mocked(axios.post).mock.calls[1][0]).toContain('/subscriptions/source-sub/');
    expect(parameterizeProjectConnections).not.toHaveBeenCalled();
  });

  it.each([undefined, '', "@parameters('missing')", '/invalid/id'])(
    'fails unresolved or missing source ID %s before requests',
    async (id) => {
      vi.mocked(getConnectionsJson).mockResolvedValue(JSON.stringify({ managedApiConnections: { reference: { connection: { id } } } }));
      await expect(step.execute(makeContext('Terraform'))).rejects.toThrow('Cannot resolve the resource ID');
      expect(axios.post).not.toHaveBeenCalled();
    }
  );

  it('keeps the existing Standard ARM unzip/workspace/metadata path', async () => {
    vi.mocked(getConnectionsJson).mockResolvedValue('{}');
    vi.mocked(areAllConnectionsParameterized).mockResolvedValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(axios.post).mockResolvedValueOnce({ data: Buffer.from('legacy') });
    await step.execute(makeContext());
    expect(areAllConnectionsParameterized).toHaveBeenCalled();
    expect(unzipLogicAppArtifacts).toHaveBeenCalledWith(Buffer.from('legacy'), expect.any(String));
    expect(FileManagement.addFolderToWorkspace).toHaveBeenCalled();
    expect(nativeExport.publishNativeExport).not.toHaveBeenCalled();
  });
});
