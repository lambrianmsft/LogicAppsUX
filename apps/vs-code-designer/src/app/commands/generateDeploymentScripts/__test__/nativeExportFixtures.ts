import AdmZip from 'adm-zip';
import { stringify } from 'yaml';
import type { NativeInfrastructureFormat } from '../nativeInfrastructureExport';
import { readBicepParameters } from '../bicepParameters';

export function bicepString(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$\{/g, '\\${')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (value) => `\\u{${value.charCodeAt(0).toString(16)}}`)}'`;
}

export function renderNativeParameters(input: { parameters: Record<string, { value: unknown }> }, reference?: string): string {
  const stem =
    reference === undefined ? (input.parameters.name?.value ?? 'app') : (input.parameters.connectionName?.value ?? 'resource-name');
  return `using './${stem}.bicep'\n\n${Object.entries(input.parameters)
    .map(([name, parameter]) => {
      const value = parameter.value;
      return `param ${name} = ${typeof value === 'string' && !['authentication', 'additionalAppSettings'].includes(name) ? bicepString(value) : `json(${bicepString(JSON.stringify(value))})`}`;
    })
    .join('\n')}\n`;
}

export function parseNativeParameters(content: string) {
  if (!content.startsWith('using ')) {
    return JSON.parse(content);
  }
  const template = /^using '\.\/([^']+)'/.exec(content)?.[1];
  return { parameters: readBicepParameters(Buffer.from(content), template, /^param connectionReferenceName = /m.test(content)) };
}

export const scope = { subscriptionId: 'target-sub', resourceGroupName: 'target-rg' };
export const workspaceId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/logs';

export function nativeZip(
  format: NativeInfrastructureFormat,
  reference?: string,
  overrides: Record<string, unknown> = {},
  connectionName = 'resource-name'
): Buffer {
  const bicepPipeline = format === 'Bicep' && reference === undefined;
  const bicepConnection = format === 'Bicep' && reference !== undefined;
  const entrypoint = bicepConnection ? `${connectionName}.bicep` : format === 'Bicep' ? 'app.bicep' : 'main.tf';
  const inputFile = bicepConnection
    ? `${connectionName}.bicepparam`
    : format === 'Bicep'
      ? 'app.bicepparam'
      : reference === undefined
        ? 'terraform.tfvars.json'
        : 'inputs.json';
  const descriptorFile = bicepConnection ? undefined : reference === undefined ? 'infrastructure-export.json' : 'export.json';
  const directory = reference === undefined || bicepConnection ? 'app/infrastructure' : `app/infrastructure/connections/${reference}`;
  const descriptor = {
    schemaVersion: bicepPipeline ? '4.0' : '1.0',
    infrastructureFormat: format,
    mode: 'InfrastructureOnly',
    pipelineSupport: bicepPipeline ? 'AzureDevOps' : 'None',
    ...(bicepPipeline ? { pipelineFile: 'infrastructure-pipeline.yml', pipelineSettingsFile: 'pipeline-settings.json' } : {}),
    applicationPackageIncluded: false,
    workflowParametersIncluded: false,
    connectionsJsonIncluded: false,
    moduleKind: reference === undefined ? 'Host' : 'Connection',
    targetScope: 'resourceGroup',
    entrypoint,
    inputFile,
    ...(reference === undefined ? scope : { subscriptionId: null, resourceGroupName: null }),
    connectionReferenceName: reference ?? null,
    runtimeUrlSettingName: reference === undefined ? null : `${reference}-ConnectionRuntimeUrl`,
    files: [
      entrypoint,
      inputFile,
      ...(descriptorFile ? [descriptorFile] : []),
      ...(bicepPipeline ? ['infrastructure-pipeline.yml', 'pipeline-settings.json'] : []),
    ],
    sensitiveFiles: [inputFile],
    requiredInputs:
      reference === undefined
        ? []
        : [...(format === 'Terraform' ? ['subscriptionId', 'resourceGroupName'] : []), 'principalId', 'tenantId', 'authentication'],
    ...overrides,
  };
  const zip = new AdmZip();
  zip.addFile(
    `${directory}/${entrypoint}`,
    Buffer.from(
      format === 'Bicep'
        ? "param workspaceResourceId string = '/subscriptions/${subscription().subscriptionId}/resourceGroups/defaultresourcegroup-eus/providers/microsoft.operationalinsights/workspaces/defaultworkspace-${subscription().subscriptionId}-eus'"
        : 'variable "workspaceResourceId" {\n  type = string\n  default = null\n}'
    )
  );
  const inputs =
    reference === undefined
      ? {
          name: 'app',
          location: 'eastus',
          hostingPlanName: 'plan',
          storageAccountName: 'storage',
          additionalAppSettings: {},
          ...(format === 'Terraform' ? scope : {}),
        }
      : {
          ...(bicepConnection
            ? {
                connectionName,
                connectionDisplayName: 'display-other',
                connectionReferenceName: reference,
                connectorName: 'arm',
                location: 'eastus',
              }
            : {}),
          principalId: '',
          tenantId: '',
          authentication: bicepConnection ? { parameterValues: {} } : {},
          ...(format === 'Terraform' ? { subscriptionId: '', resourceGroupName: '' } : {}),
        };
  zip.addFile(
    `${directory}/${inputFile}`,
    Buffer.from(
      format === 'Bicep'
        ? renderNativeParameters(
            { parameters: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { value }])) },
            reference
          )
        : JSON.stringify(inputs)
    )
  );
  if (descriptorFile) {
    zip.addFile(`${directory}/${descriptorFile}`, Buffer.from(JSON.stringify(descriptor)));
  }
  if (bicepPipeline) {
    const nativeInputs = {
      connectedServiceName: '${{ parameters.serviceConnectionName }}',
      infrastructureFormat: 'Bicep',
      infrastructureDirectory: '$(Build.SourcesDirectory)/${{ parameters.infrastructureDirectory }}',
      subscriptionId: '$(subscriptionId)',
      resourceGroupName: '$(resourceGroupName)',
      appName: '$(logicAppName)',
      location: '$(resourceGroupLocation)',
      hostingPlanName: '$(hostingPlanName)',
      storageAccountName: '$(storageAccountName)',
    };
    zip.addFile(
      `${directory}/infrastructure-pipeline.yml`,
      Buffer.from(
        stringify({
          trigger: 'none',
          pr: 'none',
          parameters: [
            { name: 'serviceConnectionName', displayName: 'Azure Resource Manager service connection', type: 'string', default: '' },
            {
              name: 'infrastructureDirectory',
              displayName: 'Infrastructure directory relative to the repository root',
              type: 'string',
              default: 'app/infrastructure',
            },
          ],
          pool: { vmImage: 'ubuntu-latest' },
          steps: [
            { checkout: 'self' },
            {
              task: 'AzureLogicAppsStandardConnectionsDeployment@1',
              displayName: 'Deploy Bicep infrastructure and connections',
              inputs: nativeInputs,
            },
          ],
        })
      )
    );
    zip.addFile(`${directory}/pipeline-settings.json`, Buffer.from(JSON.stringify({ schemaVersion: '1.0', connections: [] })));
  }
  return zip.toBuffer();
}

export function legacyBicepHostZip(): Buffer {
  const zip = new AdmZip(
    nativeZip('Bicep', undefined, {
      schemaVersion: '1.0',
      pipelineSupport: 'None',
      pipelineFile: undefined,
      pipelineSettingsFile: undefined,
      files: ['main.bicep', 'parameters.json', 'infrastructure-export.json'],
    })
  );
  for (const file of ['infrastructure-pipeline.yml', 'pipeline-settings.json']) {
    zip.deleteFile(`app/infrastructure/${file}`);
  }
  return zip.toBuffer();
}

export function legacyHelperBicepHostZip(): Buffer {
  const zip = new AdmZip(
    nativeZip('Bicep', undefined, {
      schemaVersion: '2.0',
      files: [
        'main.bicep',
        'parameters.json',
        'infrastructure-export.json',
        'infrastructure-pipeline.yml',
        'pipeline-settings.json',
        'Invoke-BicepInfrastructure.ps1',
      ],
    })
  );
  zip.updateFile(
    'app/infrastructure/infrastructure-pipeline.yml',
    Buffer.from('steps:\n- task: AzureCLI@2\n  inputs:\n    scriptPath: Invoke-BicepInfrastructure.ps1\n')
  );
  zip.addFile('app/infrastructure/Invoke-BicepInfrastructure.ps1', Buffer.from('param([string]$InfrastructureDirectory)\n'));
  return zip.toBuffer();
}
