import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DialogResponses, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { DeploymentTargetType, type ConnectionsData, type Parameter } from '@microsoft/vscode-extension-logic-apps';
import { GenerateADODeploymentScriptsStep } from '../GenerateADODeploymentScriptsStep';
import type { IAzureDeploymentScriptsContext } from '../../../generateDeploymentScripts';
import { nativeZip, scope } from '../../../__test__/nativeExportFixtures';
import { publishNativeExport, type InfrastructureFormat } from '../../../nativeInfrastructureExport';
import { parameterizeProjectConnections } from '../../../../parameterizeConnections';
import { getConnectionsJson } from '../../../../../utils/codeless/connection';
import { getParametersJson } from '../../../../../utils/codeless/parameter';
import { getLocalSettingsJson } from '../../../../../utils/appSettings/localSettings';
import { areAllConnectionsParameterized } from '../../../../../utils/codeless/parameterizer';
import { unzipLogicAppArtifacts } from '../../../../../utils/taskUtils';
import { startDesignTimeApi } from '../../../../../utils/codeless/startDesignTimeApi';
import { ext } from '../../../../../../extensionVariables';
import { deploymentDirectory, managementApiPrefix } from '../../../../../../constants';

// Keep the parameterizer, command, connection/parameter/settings readers and writers,
// JSON formatting, HTTP request serializers and native ZIP validation real.
// Only synthetic filesystem, VS Code/project discovery, host/auth and output boundaries
// are replaced. Every subsequent read sees the bytes written by the real save chain.
const memory = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  writes: [] as string[],
}));

vi.mock('fs-extra', () => ({
  pathExists: vi.fn(async (file: string) => memory.files.has(file) || memory.directories.has(file)),
  pathExistsSync: vi.fn((file: string) => memory.files.has(file) || memory.directories.has(file)),
  existsSync: vi.fn((file: string) => memory.files.has(file) || memory.directories.has(file)),
  readFile: vi.fn(async (file: string) => {
    if (!memory.files.has(file)) {
      throw new Error(`Unexpected synthetic read: ${file}`);
    }
    return Buffer.from(memory.files.get(file)!);
  }),
  writeJson: vi.fn(async (file: string, value: unknown) => {
    if (!memory.files.has(file)) {
      throw new Error(`Unexpected synthetic write: ${file}`);
    }
    memory.writes.push(file);
    memory.files.set(file, JSON.stringify(value, null, 2));
  }),
}));
vi.mock('../../../../../utils/workspace', () => ({
  getWorkspaceLogicAppRoots: vi.fn(async () => [path.join('synthetic-workspace', 'app')]),
  getContainingWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: 'synthetic-workspace' } })),
}));
vi.mock('../../../../../utils/verifyIsProject', () => ({
  tryGetLogicAppProjectRoot: vi.fn(async () => path.join('synthetic-workspace', 'app')),
}));
vi.mock('../../../../../utils/detectProjectLanguage', () => ({ isCSharpProject: vi.fn(async () => false) }));
vi.mock('../../../../../utils/taskUtils', () => ({ unzipLogicAppArtifacts: vi.fn() }));
vi.mock('../../../../../utils/codeless/startDesignTimeApi', () => ({ startDesignTimeApi: vi.fn() }));
vi.mock('../../../../../utils/codeless/getAuthorizationToken', () => ({
  getAuthorizationToken: vi.fn(async () => 'SYNTHETIC-NOT-A-CREDENTIAL'),
  getCloudHost: vi.fn(async () => undefined),
}));
vi.mock('../../../iacGestureHelperFunctions', () => ({
  FileManagement: { addFolderToWorkspace: vi.fn(), convertToValidWorkspace: vi.fn() },
}));
vi.mock('../../../nativeInfrastructureExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../nativeInfrastructureExport')>()),
  // Publishing files is an output boundary; parsing and validating fixture ZIPs is real.
  publishNativeExport: vi.fn(() => 'synthetic-native-output'),
}));

const workspacePath = 'synthetic-workspace';
const projectPath = path.join(workspacePath, 'app');
const connectionsPath = path.join(projectPath, 'connections.json');
const parametersPath = path.join(projectPath, 'parameters.json');
const settingsPath = path.join(projectPath, 'local.settings.json');
const workflowPath = path.join(projectPath, 'workflow', 'workflow.json');
const references = ['arm-1', 'kusto', 'msnweather'] as const;
type Reference = (typeof references)[number];
const runtimeSetting = (reference: Reference) => `${reference}-ConnectionRuntimeUrl`;
const authParameter = (reference: Reference) => `${reference}-Authentication`;
const parameterRef = (name: string) => `@parameters('${name}')`;
const settingRef = (name: string) => `@appsetting('${name}')`;
const runtimeUrl = (reference: Reference) => `https://${reference}.synthetic.invalid/runtime`;
const originalWorkflow = { definition: { triggers: {}, actions: {} }, kind: 'Stateful' };

// arm/kusto values are inert objects, not inferred customer connector credentials.
// msnweather deliberately retains the reported Raw/Key/app-setting structure.
const authentication: Record<Reference, object> = {
  'arm-1': { synthetic: 'arm-auth-object', nested: { inert: true } },
  kusto: { synthetic: 'kusto-auth-object', nested: { inert: true } },
  msnweather: { type: 'Raw', scheme: 'Key', parameter: settingRef('msnweather-connectionKey') },
};

function put(file: string, value: unknown): void {
  memory.files.set(file, JSON.stringify(value, null, 2));
}

function json<T>(file: string): T {
  const bytes = memory.files.get(file);
  if (bytes === undefined) {
    throw new Error(`Missing synthetic fixture: ${file}`);
  }
  return JSON.parse(bytes) as T;
}

function rawConnection(reference: Reference) {
  return {
    api: { id: `/subscriptions/source-sub/providers/Microsoft.Web/locations/eastus/managedApis/${reference}` },
    connection: { id: `/subscriptions/source-sub/resourceGroups/source-rg/providers/Microsoft.Web/connections/${reference}` },
    connectionRuntimeUrl: runtimeUrl(reference),
    authentication: structuredClone(authentication[reference]),
  };
}

function seedRaw(selected: readonly Reference[] = references): void {
  put(connectionsPath, { managedApiConnections: Object.fromEntries(selected.map((reference) => [reference, rawConnection(reference)])) });
  put(parametersPath, {});
}

function seedParameterized(
  runtimeExpression: (reference: Reference) => string = (reference) => settingRef(runtimeSetting(reference))
): void {
  // Literal IDs deliberately separate runtime-reference recognition from ID rewriting
  // and let native export resolve IDs even when authentication parameters are corrupt.
  put(connectionsPath, {
    managedApiConnections: Object.fromEntries(
      references.map((reference) => [
        reference,
        {
          ...rawConnection(reference),
          connectionRuntimeUrl: runtimeExpression(reference),
          authentication: parameterRef(authParameter(reference)),
        },
      ])
    ),
  });
  put(
    parametersPath,
    Object.fromEntries(
      references.flatMap((reference) => [
        [authParameter(reference), { type: 'Object', value: authentication[reference] }],
        [runtimeSetting(reference), { type: 'String', value: settingRef(runtimeSetting(reference)) }],
      ])
    )
  );
}

function corruptCustomerParameters(): void {
  seedParameterized();
  const parameters = json<Record<string, Parameter>>(parametersPath);
  for (const reference of ['arm-1', 'kusto'] as const) {
    parameters[authParameter(reference)].value = parameterRef(authParameter(reference));
  }
  put(parametersPath, parameters);
}

function context(format?: InfrastructureFormat): IAzureDeploymentScriptsContext {
  return {
    telemetry: { properties: {}, measurements: {} },
    errorHandling: {},
    infrastructureFormat: format,
    deploymentTarget: DeploymentTargetType.standard,
    projectPath,
    workspacePath,
    subscriptionId: scope.subscriptionId,
    resourceGroup: { name: scope.resourceGroupName, location: 'eastus' },
    storageAccountName: 'storage',
    appServicePlan: 'plan',
    logicAppName: 'app',
    tenantId: 'synthetic-tenant',
    isValidWorkspace: true,
  } as IAzureDeploymentScriptsContext;
}

function sourceBytes() {
  return [connectionsPath, parametersPath, settingsPath, workflowPath].map((file) => memory.files.get(file));
}

function clearObservations(): void {
  memory.writes.length = 0;
  vi.mocked(axios.post).mockClear();
  vi.mocked(vscode.window.showInformationMessage).mockClear();
  vi.mocked(unzipLogicAppArtifacts).mockClear();
  vi.mocked(startDesignTimeApi).mockClear();
}

function expectRequests(format: InfrastructureFormat | undefined, selected: readonly Reference[]): void {
  const native = format === 'Bicep' || format === 'Terraform';
  const calls = vi.mocked(axios.post).mock.calls;
  expect(calls).toHaveLength(selected.length + 1);
  const hostIndex = native ? 0 : selected.length;
  expect(calls[hostIndex]).toEqual([
    `http://localhost:43210${managementApiPrefix}/generateDeploymentArtifacts`,
    {
      targetSubscriptionName: scope.subscriptionId,
      targetResourceGroupName: scope.resourceGroupName,
      targetStorageAccountName: 'storage',
      targetLocation: 'eastus',
      targetLogicAppName: 'app',
      targetAppServicePlanName: 'plan',
      ...(native ? { infrastructureFormat: format } : {}),
    },
    {
      headers: { Accept: 'application/zip', 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      ...(native ? { maxContentLength: 5 * 1024 * 1024 } : {}),
    },
  ]);
  selected.forEach((reference, index) => {
    expect(calls[native ? index + 1 : index]).toEqual([
      `https://management.azure.com/subscriptions/${native ? 'source-sub' : scope.subscriptionId}/resourceGroups/${native ? 'source-rg' : scope.resourceGroupName}/providers/Microsoft.Web/connections/${reference}/generateDeploymentArtifacts?api-version=2018-07-01-preview`,
      {
        TargetLogicAppName: 'app',
        ConnectionReferenceName: reference,
        ...(native ? { InfrastructureFormat: format } : {}),
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: 'SYNTHETIC-NOT-A-CREDENTIAL' },
        responseType: 'arraybuffer',
        ...(native ? { maxContentLength: 5 * 1024 * 1024 } : {}),
      },
    ]);
  });
}

describe('real deployment parameterization regression', () => {
  const step = Object.create(GenerateADODeploymentScriptsStep.prototype) as GenerateADODeploymentScriptsStep;
  let hostParameterSnapshots: Record<string, Parameter>[];
  const savedWorkspaceFolders = vscode.workspace.workspaceFolders;

  beforeEach(() => {
    vi.clearAllMocks();
    memory.files.clear();
    memory.directories.clear();
    memory.writes.length = 0;
    hostParameterSnapshots = [];
    memory.directories.add(workspacePath);
    memory.directories.add(projectPath);
    memory.directories.add(path.dirname(workflowPath));
    seedRaw();
    put(workflowPath, originalWorkflow);
    put(settingsPath, {
      IsEncrypted: false,
      Values: {
        WORKFLOWS_SUBSCRIPTION_ID: 'source-sub',
        WORKFLOWS_RESOURCE_GROUP_NAME: 'source-rg',
        WORKFLOWS_LOCATION_NAME: 'eastus',
        ...Object.fromEntries(
          references.flatMap((reference) => [
            [`${reference}-connectionKey`, `INERT-${reference}-SECRET-PLACEHOLDER`],
            [runtimeSetting(reference), runtimeUrl(reference)],
          ])
        ),
      },
    });
    Object.assign(DialogResponses, { yes: { title: 'Yes' }, no: { title: 'No' } });
    // The shared setup's nonNullValue is an empty mock; preserve its real contract here.
    vi.mocked(nonNullValue).mockImplementation((value) => {
      if (value === undefined || value === null) {
        throw new Error('Missing synthetic workspace value');
      }
      return value;
    });
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ name: 'synthetic-workspace', index: 0, uri: vscode.Uri.file(workspacePath) }],
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(DialogResponses.yes);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Export infrastructure' as never);
    vi.mocked(fs.existsSync).mockImplementation((file) => memory.files.has(String(file)) || memory.directories.has(String(file)));
    vi.mocked(fs.mkdirSync).mockImplementation((directory) => {
      const name = String(directory);
      expect(name).toBe(path.join(workspacePath, deploymentDirectory));
      memory.directories.add(name);
      return undefined;
    });
    vi.mocked(fs.readdirSync).mockImplementation(
      (directory) =>
        [
          ...new Set(
            [...memory.directories, ...memory.files.keys()]
              .filter((file) => path.dirname(file) === String(directory))
              .map((file) => path.basename(file))
          ),
        ] as never
    );
    vi.mocked(fs.statSync).mockImplementation((file) => ({ isDirectory: () => memory.directories.has(String(file)) }) as fs.Stats);
    vi.mocked(fs.readFileSync).mockImplementation((file) => {
      const bytes = memory.files.get(String(file));
      if (bytes === undefined) {
        throw new Error(`Unexpected synthetic read: ${file}`);
      }
      return bytes;
    });
    vi.mocked(fs.writeFileSync).mockImplementation((file, value) => {
      expect(String(file)).toBe(workflowPath);
      memory.writes.push(String(file));
      memory.files.set(String(file), String(value));
    });
    ext.designTimeInstances.clear();
    ext.designTimeInstances.set(projectPath, { port: 43210 } as never);
    vi.mocked(axios.post).mockImplementation(async (url, body) => {
      const host = String(url).startsWith('http://localhost:');
      if (host) {
        hostParameterSnapshots.push(json<Record<string, Parameter>>(parametersPath));
      }
      const request = body as {
        infrastructureFormat?: InfrastructureFormat;
        InfrastructureFormat?: InfrastructureFormat;
        ConnectionReferenceName?: string;
      };
      const format = request.infrastructureFormat ?? request.InfrastructureFormat;
      return {
        data:
          format === 'Bicep' || format === 'Terraform'
            ? nativeZip(format, host ? undefined : request.ConnectionReferenceName, {}, host ? 'app' : request.ConnectionReferenceName)
            : Buffer.from('inert-arm-zip'),
      };
    });
  });

  afterEach(() => {
    Object.assign(vscode.workspace, { workspaceFolders: savedWorkspaceFolders });
    memory.files.clear();
    memory.directories.clear();
    ext.designTimeInstances.clear();
  });

  it.each([undefined, 'Arm'] as const)(
    '%s preserves real first-generation auth objects across a mixed rerun and unchanged rerun',
    async (format) => {
      seedRaw(['arm-1', 'kusto']);
      await step.execute(context(format));

      expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
      expect(memory.writes).toEqual([parametersPath, connectionsPath, settingsPath, workflowPath]);
      expectRequests(format, ['arm-1', 'kusto']);
      const firstParameters = await getParametersJson(projectPath);
      const firstConnections: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
      const firstSettings = await getLocalSettingsJson(context(format), projectPath);
      for (const reference of ['arm-1', 'kusto'] as const) {
        expect(firstParameters[authParameter(reference)]).toEqual({ type: 'Object', value: authentication[reference] });
        expect(firstParameters[runtimeSetting(reference)]).toEqual({ type: 'String', value: settingRef(runtimeSetting(reference)) });
        expect(firstConnections.managedApiConnections![reference].authentication).toBe(parameterRef(authParameter(reference)));
        expect(firstConnections.managedApiConnections![reference].connectionRuntimeUrl).toBe(parameterRef(runtimeSetting(reference)));
      }
      expect(hostParameterSnapshots).toEqual([firstParameters]);

      const mixed = structuredClone(firstConnections);
      mixed.managedApiConnections!.msnweather = rawConnection('msnweather') as never;
      put(connectionsPath, mixed);
      clearObservations();
      await step.execute(context(format));

      expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
      expect(memory.writes).toEqual([parametersPath, connectionsPath, settingsPath, workflowPath]);
      expectRequests(format, references);
      const parameters = await getParametersJson(projectPath);
      const connections: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
      const settings = await getLocalSettingsJson(context(format), projectPath);
      expect(parameters).toEqual({
        ...firstParameters,
        [authParameter('msnweather')]: { type: 'Object', value: authentication.msnweather },
        [runtimeSetting('msnweather')]: { type: 'String', value: settingRef(runtimeSetting('msnweather')) },
      });
      for (const reference of ['arm-1', 'kusto'] as const) {
        expect(connections.managedApiConnections![reference]).toEqual(firstConnections.managedApiConnections![reference]);
      }
      expect(settings).toEqual(firstSettings);
      expect(connections.managedApiConnections!.msnweather.authentication).toBe(parameterRef(authParameter('msnweather')));
      expect(connections.managedApiConnections!.msnweather.connectionRuntimeUrl).toBe(parameterRef(runtimeSetting('msnweather')));
      expect(hostParameterSnapshots).toEqual([firstParameters, parameters]);

      const source = sourceBytes().slice(0, 3);
      clearObservations();
      await step.execute(context(format));
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(memory.writes).toEqual([workflowPath]);
      expect(sourceBytes().slice(0, 3)).toEqual(source);
      expectRequests(format, references);
      clearObservations();
      await parameterizeProjectConnections(context(format) as IActionContext, projectPath);
      expect(memory.writes).toEqual([]);
      expect(sourceBytes().slice(0, 3)).toEqual(source);
    }
  );

  it.each(['appsetting', 'APPSETTING', 'AppSetting'])(
    'accepts literal API IDs with @%s runtime references without prompting or saving',
    async (functionName) => {
      seedParameterized((reference) => `@${functionName}('${runtimeSetting(reference)}')`);
      const source = sourceBytes().slice(0, 3);
      const connections: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
      expect(areAllConnectionsParameterized(connections)).toBe(true);
      await step.execute(context('Arm'));
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(memory.writes).toEqual([workflowPath]);
      expect(sourceBytes().slice(0, 3)).toEqual(source);
      expectRequests('Arm', references);
      clearObservations();
      await parameterizeProjectConnections(context() as IActionContext, projectPath);
      expect(memory.writes).toEqual([]);
    }
  );

  it('preserves case-variant authentication/runtime references and secret placeholders when a raw connection is added', async () => {
    seedParameterized((reference) => `@AppSetting('${runtimeSetting(reference)}')`);
    const existing: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
    existing.managedApiConnections!['arm-1'].authentication = "@PARAMETERS('arm-1-Authentication')" as never;
    existing.managedApiConnections!.kusto.connectionRuntimeUrl = "@PARAMETERS('kusto-ConnectionRuntimeUrl')";
    existing.managedApiConnections!.msnweather = rawConnection('msnweather') as never;
    put(connectionsPath, existing);
    const parameters = await getParametersJson(projectPath);
    const settings = await getLocalSettingsJson(context(), projectPath);
    await step.execute(context('Arm'));
    const saved: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
    expect(saved.managedApiConnections!['arm-1'].authentication).toBe("@PARAMETERS('arm-1-Authentication')");
    expect(saved.managedApiConnections!['arm-1'].connectionRuntimeUrl).toBe("@AppSetting('arm-1-ConnectionRuntimeUrl')");
    expect(saved.managedApiConnections!.kusto.authentication).toBe("@parameters('kusto-Authentication')");
    expect(saved.managedApiConnections!.kusto.connectionRuntimeUrl).toBe("@PARAMETERS('kusto-ConnectionRuntimeUrl')");
    expect(await getParametersJson(projectPath)).toEqual(parameters);
    expect(await getLocalSettingsJson(context(), projectPath)).toEqual(settings);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    expectRequests('Arm', references);
  });

  it.each(['reported self-references', 'missing parameter', 'missing value', 'nested parameter expression'] as const)(
    'rejects %s in an already-parameterized three-reference project before prompt, source writes or HTTP',
    async (failure) => {
      corruptCustomerParameters();
      const parameters = json<Record<string, Parameter>>(parametersPath);
      if (failure === 'missing parameter') {
        delete parameters['arm-1-Authentication'];
      } else if (failure === 'missing value') {
        parameters['arm-1-Authentication'] = { type: 'Object' } as Parameter;
      } else if (failure === 'nested parameter expression') {
        parameters['arm-1-Authentication'].value = { nested: { authentication: parameterRef('arm-1-Authentication') } };
      }
      put(parametersPath, parameters);
      const source = sourceBytes();
      const connections: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
      expect(areAllConnectionsParameterized(connections)).toBe(true);
      await expect(step.execute(context('Arm'))).rejects.toThrow(/arm-1-Authentication.*Restore.*(?:source control|backup)/s);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(memory.writes).toEqual([]);
      expect(sourceBytes()).toEqual(source);
      expect(axios.post).not.toHaveBeenCalled();
      expect(startDesignTimeApi).not.toHaveBeenCalled();
      expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
      expect(hostParameterSnapshots).toEqual([]);
      // The directly invoked real command must also validate before its early return.
      await expect(parameterizeProjectConnections(context() as IActionContext, projectPath)).rejects.toThrow(
        /arm-1-Authentication.*Restore.*(?:source control|backup)/s
      );
      expect(memory.writes).toEqual([]);
      expect(sourceBytes()).toEqual(source);
    }
  );

  it('validates existing authentication before prompting even when the third connection is raw', async () => {
    corruptCustomerParameters();
    const connections: ConnectionsData = JSON.parse(await getConnectionsJson(projectPath));
    connections.managedApiConnections!.msnweather = rawConnection('msnweather') as never;
    put(connectionsPath, connections);
    const source = sourceBytes();
    expect(areAllConnectionsParameterized(connections)).toBe(false);
    await expect(step.execute(context('Arm'))).rejects.toThrow(/arm-1-Authentication.*Restore.*backup/s);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(memory.writes).toEqual([]);
    expect(sourceBytes()).toEqual(source);
    expect(axios.post).not.toHaveBeenCalled();
    expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
  });

  it.each(['Bicep', 'Terraform'] as const)(
    '%s exports the same corrupt-parameter project without parameterization or source saves, host first',
    async (format) => {
      corruptCustomerParameters();
      const source = sourceBytes();
      await step.execute(context(format));
      expectRequests(format, references);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(memory.writes).toEqual([]);
      expect(sourceBytes()).toEqual(source);
      expect(unzipLogicAppArtifacts).not.toHaveBeenCalled();
      expect(publishNativeExport).toHaveBeenCalledOnce();
      expect(publishNativeExport).toHaveBeenCalledWith(expect.any(Array), path.join(workspacePath, deploymentDirectory), format);
      expect(hostParameterSnapshots).toEqual([json<Record<string, Parameter>>(parametersPath)]);
    }
  );
});
